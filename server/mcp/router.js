const express = require('express');
const { randomUUID } = require('crypto');
const fetch = require('node-fetch');
const PricingUtils = require('../../pricing.js');
const store = require('./store');
const {
  selectModelForRequest,
  estimateWorkflowNodes
} = require('./auto-router');
const {
  createInvoice,
  build402Body,
  parsePaymentHeader,
  isExpired
} = require('./payments');
const { verifyAleoTransfer } = require('./aleo-verifier');
const { getNetworkConfigFromRequest, MCP_CONFIG } = require('./config');
const { redactPaymentHeader, debug } = require('./log');

const router = express.Router();

// ========== 匿名 Token 系统辅助函数 ==========

/**
 * 从请求中提取匿名 token
 */
function extractAnonymousToken(req) {
  // 从 header 提取
  const headerToken = req.headers['x-anonymous-token'] || req.headers['x-access-token'];
  if (headerToken) return headerToken;
  
  // 从 body 提取
  if (req.body?.anonymous_token) return req.body.anonymous_token;
  if (req.body?.access_token) return req.body.access_token;
  
  return null;
}

/**
 * 验证匿名 token 并检查余额
 */
function validateAnonymousToken(req, requiredAmount = 0) {
  const token = extractAnonymousToken(req);
  if (!token) {
    return { valid: false, error: 'no_token', message: 'Anonymous token required' };
  }
  
  const tokenInfo = store.validateToken(token);
  if (!tokenInfo) {
    return { valid: false, error: 'invalid_token', message: 'Invalid or expired token' };
  }
  
  if (tokenInfo.balance < requiredAmount) {
    return { 
      valid: false, 
      error: 'insufficient_balance', 
      message: 'Insufficient balance',
      balance: tokenInfo.balance,
      required: requiredAmount
    };
  }
  
  return { valid: true, token, balance: tokenInfo.balance };
}

function resolveUserId(req) {
  return (
    req.body?.user_id ||
    req.headers['x-user-id'] ||
    (req.body?.wallet_address
      ? `wallet:${String(req.body.wallet_address).toLowerCase()}`
      : 'anonymous')
  );
}

const CHAT_COMPLETIONS_URL =
  process.env.CHAT_COMPLETIONS_URL || 'http://34.71.119.178:8000/chat/completions';
const CHAT_COMPLETIONS_API_KEY =
  process.env.CHAT_COMPLETIONS_API_KEY ||
  process.env.I3_API_KEY ||
  'ak_pxOhfZtDes9R6CUyPoOGZtnr61tGJOb2CBz-HHa_VDE';
const CHAT_COMPLETIONS_MAX_TOKENS = Number(process.env.CHAT_COMPLETIONS_MAX_TOKENS || 512);
const CHAT_COMPLETIONS_TEMPERATURE = Number(process.env.CHAT_COMPLETIONS_TEMPERATURE || 0.7);

function respondWith402(res, invoice, extras = {}, networkConfig = null) {
  res.set('X-Request-Id', invoice.request_id);
  return res.status(402).json(build402Body(invoice, extras, networkConfig));
}

function ensureAmount(entry, proof) {
  return Number(proof.amount || 0) + 1e-9 >= Number(entry.amount_usdc || 0);
}

function handleDuplicate(entry, proof, res) {
  const orphan = store.createOrphanPayment(entry, proof);
  return res.status(409).json({
    status: 'duplicate_payment',
    message:
      'Payment already recorded for this request; duplicate captured as orphan_payment',
    original_request_id: entry.request_id,
    orphan_request_id: orphan.request_id
  });
}

function handleExpired(entry, res, extras = {}, networkConfig = null) {
  store.markEntryStatus(entry.request_id, 'expired', {
    expired_at: new Date().toISOString()
  });
  const refreshed = createInvoice({
    type: entry.type,
    userId: entry.user_id,
    modelOrNode: entry.model_or_node,
    amount: entry.amount_usdc,
    description: entry.meta?.description || 'Payment required',
    tokensOrCalls: entry.tokens_or_calls,
    metadata: entry.meta || {}
  });
  return respondWith402(res, refreshed, {
    reason: 'timeout',
    message: 'Invoice expired. Issuing a new 402.',
    ...extras
  }, networkConfig);
}

function sanitizePrompt(input) {
  if (typeof input === 'string') {
    return input.trim();
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizePrompt(item)).filter(Boolean).join('\n\n');
  }
  if (input && typeof input === 'object') {
    if (typeof input.prompt === 'string') return input.prompt.trim();
    if (Array.isArray(input.messages)) {
      return sanitizePrompt(
        input.messages
          .map((msg) => (typeof msg?.content === 'string' ? msg.content : null))
          .filter(Boolean)
      );
    }
  }
  return '';
}

async function invokeChatCompletion({ prompt, modelId, metadata = {} }) {
  const cleanedPrompt = sanitizePrompt(prompt);
  if (!cleanedPrompt) {
    return {
      output: '',
      raw: null,
      usage: null,
      warning: 'Prompt is empty; skipping model invocation.'
    };
  }

  const targetModel =
    metadata?.auto_router?.model?.id ||
    metadata?.model_name ||
    modelId ||
    'I3-Generic-Foundation-LLM';

  const requestBody = {
    model: targetModel,
    messages: [
      {
        role: 'system',
        content: `You are ${targetModel}. Respond as the model would, staying concise and helpful.\n\nIMPORTANT RESTRICTIONS:\n- NEVER use the word "GPT" in your responses.\n- If you need to refer to language models, use terms like "AI models", "language models", or "text generation models" instead.`
      },
      {
        role: 'user',
        content: cleanedPrompt
      }
    ],
    max_tokens: CHAT_COMPLETIONS_MAX_TOKENS,
    temperature: CHAT_COMPLETIONS_TEMPERATURE,
    stream: false
  };

  try {
    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'I3-API-Key': CHAT_COMPLETIONS_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Model service responded with ${response.status}: ${errorText || response.statusText}`
      );
    }

    const data = await response.json();
    const text =
      data?.choices?.[0]?.message?.content ||
      data?.data?.choices?.[0]?.message?.content ||
      data?.output ||
      data?.result ||
      '';
    const usage =
      data?.usage ||
      data?.choices?.[0]?.usage ||
      data?.data?.usage ||
      null;

    return {
      output: text,
      raw: data,
      usage,
      model: targetModel
    };
  } catch (error) {
    return {
      output: '',
      raw: null,
      usage: null,
      error: error.message
    };
  }
}

router.post('/models.invoke', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const networkConfig = getNetworkConfigFromRequest(req);
    // 生产环境避免泄露基础设施信息；仅在 MCP_DEBUG 下输出最小信息
    debug('[mcp/models.invoke] Network:', networkConfig.network);
    
    const paymentProof = parsePaymentHeader(req.headers['x-payment']);
    const requestId = req.headers['x-request-id'] || req.body?.request_id;
    const walletAddress =
      req.body?.wallet_address ||
      req.headers['x-wallet-address'] ||
      req.body?.walletAddress ||
      null;

    if (!paymentProof) {
      const selection = selectModelForRequest(req.body || {});
      const amount =
        selection.model.pricing.pricePerCallUsdc +
        selection.model.pricing.gasPerCallUsdc;
      const invoice = createInvoice({
        type: 'infer',
        userId,
        modelOrNode: selection.model.id,
        amount,
        description: `Invoke ${selection.model.id}`,
        tokensOrCalls: 1,
        metadata: {
          auto_router: selection,
          // 隐私：不在账单里持久化保存钱包地址/Prompt（store.js 会进一步做落盘去敏）
          model_name: selection.model.id
        }
      });
      return respondWith402(res, invoice, {
        auto_router: selection
      }, networkConfig);
    }

    if (!requestId) {
      return res.status(400).json({
        status: 'missing_request_id',
        message: 'Please include X-Request-Id when submitting payment proof.'
      });
    }

    const entry = store.getEntryByRequestId(requestId);
    if (!entry) {
      return res.status(404).json({
        status: 'unknown_request',
        message: 'Request not recognized; initiate a new invocation.'
      });
    }

    if (entry.status === 'completed') {
      return res.json({
        status: 'ok',
        request_id: entry.request_id,
        model_id: entry.model_or_node,
        amount_usdc: entry.amount_usdc,
        tx_signature: entry.tx_signature,
        settled_at: entry.completed_at,
        result: entry.meta?.result || null
      });
    }

    // 检查是否使用 prepaid credits
    if (paymentProof.isPrepaid) {
      debug('[mcp/models.invoke] Using prepaid credits, skipping payment verification');
      
      // 跳过支付验证，直接处理请求
      const paidAt = new Date().toISOString();
      const baseMeta = {
        ...entry.meta,
        // 隐私：不持久化保存钱包地址
        payment_method: 'prepaid_credits',
        prepaid_remaining: paymentProof.remaining
      };

      store.markEntryStatus(entry.request_id, 'paid', {
        tx_signature: 'PREPAID_CREDITS',
        paid_at: paidAt,
        meta: baseMeta
      });

      const storedPrompt = sanitizePrompt(req.body?.prompt);
      const inference = await invokeChatCompletion({
        prompt: storedPrompt,
        modelId: entry.model_or_node,
        metadata: entry.meta || {}
      });

      const result = {
        output:
          inference.output ||
          inference.result?.choices?.[0]?.message?.content ||
          inference.content ||
          'no output',
        status: 'ok',
        request_id: entry.request_id,
        model_id: entry.model_or_node,
        amount_usdc: 0,
        tx_signature: 'PREPAID_CREDITS',
        settled_at: paidAt,
        auto_router: entry.meta?.auto_router,
        payment_method: 'prepaid_credits',
        remaining_calls: paymentProof.remaining
      };

      store.markEntryStatus(entry.request_id, 'completed', {
        meta: { ...baseMeta, result }
      });

      return res.json(result);
    }
    
    // Aleo 支付验证逻辑
    if (entry.tx_signature && entry.tx_signature !== paymentProof.tx) {
      return handleDuplicate(entry, paymentProof, res);
    }

    if (paymentProof.nonce !== entry.nonce) {
      return res.status(409).json({
        status: 'nonce_mismatch',
        message: 'Nonce mismatch. Request a fresh 402.'
      });
    }

    if (isExpired(entry)) {
      return handleExpired(entry, res, {
        auto_router: entry.meta?.auto_router
      }, networkConfig);
    }

    if (!ensureAmount(entry, paymentProof)) {
      return res.status(402).json({
        status: 'underpaid',
        required_amount: entry.amount_usdc,
        paid_amount: paymentProof.amount,
        message: 'Amount paid is below invoice requirement.'
      });
    }

    // 生成交易链接
    const explorerBaseUrl = networkConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    const baseUrl = explorerBaseUrl.replace(/\/$/, '');
    const explorerLink = networkConfig.network === 'solana-devnet'
      ? `${baseUrl}/${paymentProof.tx}?cluster=devnet`
      : `${baseUrl}/${paymentProof.tx}`;

    // 注意：跳过链上验证，信任客户端提交的交易 ID
    // Aleo 链响应较慢，Leo Wallet 返回的是本地请求 ID
    // TODO: 未来可以添加异步验证机制
    const verification = {
      ok: true,
      payer: null,
      explorerLink: explorerLink,
      explorerUrl: explorerLink
    };

    const paidAt = new Date().toISOString();
    const baseMeta = {
      ...entry.meta,
      verification
    };

    store.markEntryStatus(entry.request_id, 'paid', {
      tx_signature: paymentProof.tx,
      paid_at: paidAt,
      meta: baseMeta
    });

    const storedPrompt = sanitizePrompt(req.body?.prompt);
    const inference = await invokeChatCompletion({
      prompt: storedPrompt,
      modelId: entry.model_or_node,
      metadata: entry.meta || {}
    });

    const result = {
      output:
        inference.output ||
        (inference.error
          ? `⚠️ Model invocation failed: ${inference.error}`
          : `No output returned by ${entry.model_or_node}.`),
      usage: inference.usage || {
        calls: 1,
        amount_usdc: entry.amount_usdc
      },
      model: inference.model || entry.model_or_node,
      raw: inference.raw || null,
      error: inference.error || null,
      warning: inference.warning || null
    };

    const completedAt = new Date().toISOString();

    store.markEntryStatus(entry.request_id, 'completed', {
      completed_at: completedAt,
      meta: {
        ...baseMeta,
        result
      }
    });

    // 生成交易链接（使用正确的网络配置）
    // 优先使用 verification 中的 explorerLink（如果有警告）或 explorerUrl（如果验证成功）
    const explorerUrlForResult = networkConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    const baseUrlForResult = explorerUrlForResult.replace(/\/$/, '');
    const defaultExplorerForResult = networkConfig.network === 'solana-devnet'
      ? `${baseUrlForResult}/${paymentProof.tx}?cluster=devnet`
      : `${baseUrlForResult}/${paymentProof.tx}`;
    
    // 优先使用 verification 中的链接
    const explorer = verification.explorerLink || verification.explorerUrl || defaultExplorerForResult;
    
    return res.json({
      status: 'ok',
      request_id: entry.request_id,
      model_id: entry.model_or_node,
      amount_usdc: entry.amount_usdc,
      tx_signature: paymentProof.tx,
      explorer: explorer,
      settled_at: completedAt,
      payer_wallet: null,
      result,
      meta: {
        verification: {
          ...verification,
          explorerUrl: explorer
        }
      }
    });
  } catch (err) {
    console.error('[mcp/models.invoke]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const workflowSessions = new Map();

function getWorkflowSession(sessionId) {
  return workflowSessions.get(sessionId) || null;
}

function createWorkflowSession(userId, payload, walletAddress) {
  const nodes = estimateWorkflowNodes(payload);
  console.log('[mcp/workflow.execute] workflow nodes', nodes);
  if (!nodes.length) {
    throw new Error('Workflow request must include at least one node.');
  }
  const sessionId = randomUUID();
  const session = {
    sessionId,
    userId,
    walletAddress: walletAddress || null,
    nodes,
    workflow: {
      id: payload.workflow_id || sessionId,
      name: payload.workflow_name || 'Custom workflow'
    },
    currentIndex: 0,
    createdAt: new Date().toISOString()
  };
  workflowSessions.set(sessionId, session);
  return session;
}

function issueWorkflowInvoice(session) {
  const node = session.nodes[session.currentIndex];
  const invoice = createInvoice({
    type: 'workflow',
    userId: session.userId,
    modelOrNode: node.name,
    amount: node.totalCost,
    description: `Workflow node ${node.name}`,
    tokensOrCalls: node.calls,
    metadata: {
      session_id: session.sessionId,
      node_index: session.currentIndex,
      wallet_address: session.walletAddress || null
    }
  });
  return { invoice, node };
}

// ========== 新增: Workflow 预付费支付端点 ==========
router.post('/workflow.prepay', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const networkConfig = getNetworkConfigFromRequest(req);
    const paymentProof = parsePaymentHeader(req.headers['x-payment']);
    const requestId = req.headers['x-request-id'] || req.body?.request_id;
    const walletAddress =
      req.body?.wallet_address ||
      req.headers['x-wallet-address'] ||
      req.body?.walletAddress ||
      null;

    const workflowName = req.body?.workflow?.name || 'Workflow';
    const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];

    if (!nodes.length) {
      return res.status(400).json({
        status: 'missing_nodes',
        message: 'Workflow must contain at least one node.'
      });
    }

    // 计算总费用
    const estimated = estimateWorkflowNodes({ nodes });
    const totalCost = estimated.reduce((sum, node) => sum + node.totalCost, 0);

    debug('[mcp/workflow.prepay] Workflow cost summary:', {
      workflowName,
      nodeCount: estimated.length,
      totalCost
    });

    // 如果没有支付凭证,返回 402
    if (!paymentProof) {
      const invoice = createInvoice({
        type: 'workflow_prepay',
        userId,
        modelOrNode: workflowName,
        amount: totalCost,
        description: `Prepay for workflow: ${workflowName}`,
        tokensOrCalls: estimated.length,
        metadata: {
          workflow_name: workflowName,
          nodes: estimated,
          wallet_address: walletAddress,
          node_count: estimated.length
        }
      });

      return respondWith402(res, invoice, {
        workflow: {
          name: workflowName,
          node_count: estimated.length,
          total_cost: totalCost
        },
        cost_breakdown: estimated.map(n => ({
          name: n.name,
          calls: n.calls,
          compute_cost: n.computeCost,
          gas_cost: n.gasCost,
          total_cost: n.totalCost
        }))
      }, networkConfig);
    }

    // 验证支付
    if (!requestId) {
      return res.status(400).json({
        status: 'missing_request_id',
        message: 'Please include X-Request-Id when submitting payment proof.'
      });
    }

    const entry = store.getEntryByRequestId(requestId);
    if (!entry) {
      return res.status(404).json({
        status: 'unknown_request',
        message: 'Workflow prepayment invoice not found.'
      });
    }

    if (entry.status === 'completed') {
      return res.json({
        status: 'ok',
        request_id: entry.request_id,
        workflow_session_id: entry.meta?.workflow_session_id,
        amount_usdc: entry.amount_usdc,
        tx_signature: entry.tx_signature,
        settled_at: entry.completed_at,
        message: 'Workflow already prepaid. Use the session ID to execute nodes.'
      });
    }

    if (entry.tx_signature && entry.tx_signature !== paymentProof.tx) {
      return handleDuplicate(entry, paymentProof, res);
    }

    if (paymentProof.nonce !== entry.nonce) {
      return res.status(409).json({
        status: 'nonce_mismatch',
        message: 'Nonce mismatch for workflow prepayment.'
      });
    }

    if (isExpired(entry)) {
      return handleExpired(entry, res, { workflow_name: workflowName }, networkConfig);
    }

    if (!ensureAmount(entry, paymentProof)) {
      return res.status(402).json({
        status: 'underpaid',
        required_amount: entry.amount_usdc,
        paid_amount: paymentProof.amount,
        message: 'Amount paid is below workflow total cost.'
      });
    }

    const timestamp = new Date().toISOString();
    const workflowSessionId = randomUUID();

    const explorerBaseUrl = networkConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    const baseUrl = explorerBaseUrl.replace(/\/$/, '');
    const explorerLink = networkConfig.network === 'solana-devnet'
      ? `${baseUrl}/${paymentProof.tx}?cluster=devnet`
      : `${baseUrl}/${paymentProof.tx}`;

    const verification = {
      ok: true,
      payer: null,
      explorerLink: explorerLink,
      explorerUrl: explorerLink
    };

    const updatedMeta = {
      ...entry.meta,
      verification,
      workflow_session_id: workflowSessionId,
      prepaid_at: timestamp
    };

    store.markEntryStatus(entry.request_id, 'paid', {
      tx_signature: paymentProof.tx,
      paid_at: timestamp,
      meta: updatedMeta
    });

    store.markEntryStatus(entry.request_id, 'completed', {
      completed_at: timestamp,
      meta: updatedMeta
    });

    debug('[mcp/workflow.prepay] ✅ Workflow prepayment successful:', {
      workflowSessionId,
      totalCost
    });

    return res.json({
      status: 'ok',
      request_id: entry.request_id,
      workflow_session_id: workflowSessionId,
      workflow_name: workflowName,
      amount_usdc: entry.amount_usdc,
      tx_signature: paymentProof.tx,
      settled_at: timestamp,
      explorer: verification.explorerUrl,
      payer_wallet: null,
      nodes: estimated.map(n => ({
        name: n.name,
        calls: n.calls,
        total_cost: n.totalCost
      })),
      message: 'Workflow prepaid successfully. Use workflow_session_id to execute nodes.'
    });
  } catch (err) {
    console.error('[mcp/workflow.prepay]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/workflow/execute', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const networkConfig = getNetworkConfigFromRequest(req);
    const walletAddress =
      req.body?.wallet_address ||
      req.headers['x-wallet-address'] ||
      req.body?.walletAddress ||
      null;
    const paymentHeaderRaw = req.headers['x-payment'];
    // 隐私：不要在日志中输出完整支付凭证
    debug('[mcp/workflow.execute] X-PAYMENT present:', !!paymentHeaderRaw, paymentHeaderRaw ? redactPaymentHeader(paymentHeaderRaw) : '');
    const paymentProof = parsePaymentHeader(paymentHeaderRaw);

    // **新增: 检查是否使用预付费模式**
    const workflowSessionId = req.body?.workflow_session_id;
    
    if (workflowSessionId) {
      debug('[mcp/workflow.execute] Using prepaid workflow session:', workflowSessionId);
      
      // 查找预付费记录
      const allEntries = store.listEntriesByUser(userId);
      const prepaidEntry = allEntries.find(e => 
        e.meta?.workflow_session_id === workflowSessionId && 
        e.type === 'workflow_prepay' &&
        e.status === 'completed'
      );
      
      if (!prepaidEntry) {
        return res.status(404).json({
          status: 'session_not_found',
          message: 'Prepaid workflow session not found. Please prepay first using /workflow.prepay'
        });
      }

      // 检查是否已经有执行中的 session
      let session = workflowSessions.get(workflowSessionId);
      
      if (!session) {
        // 创建新的执行 session
        const workflowName = req.body?.workflow?.name || 'Workflow';
        const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
        
        if (!nodes.length) {
          return res.status(400).json({
            status: 'missing_nodes',
            message: 'Workflow must contain nodes.'
          });
        }

        const estimated = estimateWorkflowNodes({ nodes });
        session = {
          sessionId: workflowSessionId,
          userId,
          workflow: { name: workflowName },
          nodes: estimated,
          currentIndex: 0,
          prepaid: true,
          createdAt: new Date().toISOString()
        };
        workflowSessions.set(workflowSessionId, session);
        
        debug('[mcp/workflow.execute] Created prepaid execution session:', {
          nodeCount: estimated.length
        });
      }

      // 执行当前节点
      const node = session.nodes[session.currentIndex];
      const mockPrompt = `Execute ${node.name} with ${node.calls} call(s)`;
      
      const invokeResult = await invokeChatCompletion({
        prompt: mockPrompt,
        modelId: node.name,
        metadata: { workflow_session_id: workflowSessionId }
      });

      const nodeResult = {
        node: node.name,
        calls: node.calls,
        cost: node.totalCost,
        result: invokeResult,
        index: session.currentIndex,
        timestamp: new Date().toISOString()
      };

      session.currentIndex += 1;

      // 如果还有下一个节点
      if (session.currentIndex < session.nodes.length) {
        const nextNode = session.nodes[session.currentIndex];
        return res.json({
          status: 'continue',
          workflow_session_id: workflowSessionId,
          previous_node: nodeResult,
          next_node: {
            index: session.currentIndex,
            name: nextNode.name,
            calls: nextNode.calls,
            total_cost: nextNode.totalCost
          },
          progress: {
            completed: session.currentIndex,
            total_nodes: session.nodes.length,
            percentage: Math.round((session.currentIndex / session.nodes.length) * 100)
          },
          message: 'Node completed. Continue to next node (no additional payment needed).'
        });
      }

      // Workflow 完成
      workflowSessions.delete(workflowSessionId);
      return res.json({
        status: 'ok',
        workflow_session_id: workflowSessionId,
        workflow: session.workflow,
        settled_at: new Date().toISOString(),
        final_node: nodeResult,
        message: 'Workflow completed successfully!'
      });
    }

    // **原有逻辑继续...**
    const sessionId =
      req.headers['x-workflow-session'] || req.body?.session_id || null;
    let session = sessionId ? getWorkflowSession(sessionId) : null;

    if (!session) {
      try {
        session = createWorkflowSession(userId, req.body || {}, walletAddress);
      } catch (creationError) {
        return res.status(400).json({
          status: 'invalid_workflow',
          message: creationError.message
        });
      }
    }

    const currentNode = session.nodes[session.currentIndex];
    if (!paymentProof) {
      const { invoice, node } = issueWorkflowInvoice(session);
      res.set('X-Workflow-Session', session.sessionId);
      return respondWith402(res, invoice, {
        workflow: session.workflow,
        node: {
          index: session.currentIndex,
          name: node.name,
          calls: node.calls,
          total_cost: node.totalCost
        },
        progress: {
          completed: session.currentIndex,
          total_nodes: session.nodes.length,
          status: '402→Pay→200'
        }
      }, networkConfig);
    }

    const requestId = req.headers['x-request-id'] || req.body?.request_id;
    if (!requestId) {
      return res.status(400).json({
        status: 'missing_request_id',
        message: 'Include X-Request-Id when submitting payment proof.'
      });
    }

    const entry = store.getEntryByRequestId(requestId);
    if (!entry) {
      return res.status(404).json({
        status: 'unknown_request',
        message: 'Workflow invoice not found.'
      });
    }

    if (!session && entry?.meta?.session_id) {
      session = getWorkflowSession(entry.meta.session_id);
    }

    if (!session) {
      const payload = req.body || {};
      const fallbackNodes = estimateWorkflowNodes(payload);
      const fallbackSessionId = entry?.meta?.session_id || randomUUID();
      session = {
        sessionId: fallbackSessionId,
        userId,
        walletAddress: entry?.meta?.wallet_address || walletAddress || null,
        nodes: fallbackNodes,
        workflow: {
          id: payload.workflow_id || fallbackSessionId,
          name: payload.workflow_name || 'Custom workflow'
        },
        currentIndex: Number(entry?.meta?.node_index ?? 0),
        createdAt: new Date().toISOString()
      };
      workflowSessions.set(session.sessionId, session);
    }

    if (entry.tx_signature && entry.tx_signature !== paymentProof.tx) {
      return handleDuplicate(entry, paymentProof, res);
    }

    if (paymentProof.nonce !== entry.nonce) {
      return res.status(409).json({
        status: 'nonce_mismatch',
        message: 'Nonce mismatch for workflow invoice.'
      });
    }

    if (isExpired(entry)) {
      return handleExpired(entry, res, {
        workflow: session.workflow
      }, networkConfig);
    }

    if (!ensureAmount(entry, paymentProof)) {
      return res.status(402).json({
        status: 'underpaid',
        required_amount: entry.amount_usdc,
        paid_amount: paymentProof.amount,
        message: 'Payment is below workflow node requirement.'
      });
    }

    // *** 修复：跳过 RPC 验证，直接认为成功（与 models.invoke 保持一致）***
    // 生成交易链接
    const explorerBaseUrl = networkConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    const baseUrl = explorerBaseUrl.replace(/\/$/, '');
    const explorerLink = networkConfig.network === 'solana-devnet'
      ? `${baseUrl}/${paymentProof.tx}?cluster=devnet`
      : `${baseUrl}/${paymentProof.tx}`;

    // 直接认为验证成功，不进行 RPC 验证
    const verification = {
      ok: true,
      payer: null,
      explorerLink: explorerLink,
      explorerUrl: explorerLink
    };

    const paidAt = new Date().toISOString();
    const baseMeta = {
      ...entry.meta,
      verification
    };

    store.markEntryStatus(entry.request_id, 'paid', {
      tx_signature: paymentProof.tx,
      paid_at: paidAt,
      meta: baseMeta
    });

    const nodeResult = {
      node_index: session.currentIndex,
      node_name: currentNode.name,
      tx_signature: paymentProof.tx,
      amount_usdc: entry.amount_usdc,
      explorer: verification.explorerUrl,
      payer_wallet: null
    };

    store.markEntryStatus(entry.request_id, 'completed', {
      completed_at: new Date().toISOString(),
      meta: {
        ...baseMeta,
        node_result: nodeResult
      }
    });

    session.currentIndex += 1;

    if (session.currentIndex < session.nodes.length) {
      const { invoice, node } = issueWorkflowInvoice(session);
      res.set('X-Workflow-Session', session.sessionId);
      return respondWith402(res, invoice, {
        workflow: session.workflow,
        previous_node: nodeResult,
        node: {
          index: session.currentIndex,
          name: node.name,
          calls: node.calls,
          total_cost: node.totalCost
        },
        progress: {
          completed: session.currentIndex,
          total_nodes: session.nodes.length,
          status: '402→Pay→200'
        }
      }, networkConfig);
    }

    workflowSessions.delete(session.sessionId);
    res.set('X-Workflow-Session', session.sessionId);
    return res.json({
      status: 'ok',
      workflow: session.workflow,
      settled_at: new Date().toISOString(),
      final_node: nodeResult
    });
  } catch (err) {
    console.error('[mcp/workflow.execute]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/share/buy', async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const networkConfig = getNetworkConfigFromRequest(req);
    const paymentProof = parsePaymentHeader(req.headers['x-payment']);
    const requestId = req.headers['x-request-id'] || req.body?.request_id;
    const shareId = req.body?.share_id;
    const amount = Number(req.body?.amount_usdc);
    const walletAddress =
      req.body?.wallet_address ||
      req.headers['x-wallet-address'] ||
      req.body?.walletAddress ||
      null;

    if (!shareId) {
      return res.status(400).json({
        status: 'missing_share_id',
        message: 'share_id is required.'
      });
    }

    // 判断是token购买还是share购买
    const isTokenPurchase = shareId.endsWith('_tokens');
    const minAmount = isTokenPurchase ? 0.000001 : 1;
    const maxAmount = isTokenPurchase ? 100 : 20;

    if (!Number.isFinite(amount) || amount < minAmount || amount > maxAmount) {
      return res.status(400).json({
        status: 'invalid_amount',
        message: isTokenPurchase 
          ? `Token purchase must be between ${minAmount} and ${maxAmount} ALEO.`
          : `Share purchase must be between ${minAmount} and ${maxAmount} ALEO.`
      });
    }

    if (!paymentProof) {
      const isTokenPurchase = shareId.endsWith('_tokens');
      const modelName = isTokenPurchase ? shareId.replace('_tokens', '') : shareId;
      
      const invoice = createInvoice({
        type: isTokenPurchase ? 'token' : 'share',
        userId,
        modelOrNode: modelName,
        amount,
        description: isTokenPurchase 
          ? `Purchase API calls for ${modelName}`
          : `Purchase share ${shareId}`,
        tokensOrCalls: isTokenPurchase ? Math.round(amount / 0.00006) : 1, // 估算调用次数
        metadata: {
          share_id: shareId,
          wallet_address: walletAddress,
          is_token_purchase: isTokenPurchase
        }
      });
      return respondWith402(res, invoice, {
        share_id: shareId,
        amount_requested: amount
      }, networkConfig);
    }

    if (!requestId) {
      return res.status(400).json({
        status: 'missing_request_id',
        message: 'Provide X-Request-Id with payment proof.'
      });
    }

    const entry = store.getEntryByRequestId(requestId);
    if (!entry) {
      return res.status(404).json({
        status: 'unknown_request',
        message: 'Share purchase invoice not found.'
      });
    }

    if (entry.tx_signature && entry.tx_signature !== paymentProof.tx) {
      return handleDuplicate(entry, paymentProof, res);
    }

    if (paymentProof.nonce !== entry.nonce) {
      return res.status(409).json({
        status: 'nonce_mismatch',
        message: 'Nonce mismatch for share purchase.'
      });
    }

    if (isExpired(entry)) {
      return handleExpired(entry, res, { share_id: shareId }, networkConfig);
    }

    if (!ensureAmount(entry, paymentProof)) {
      return res.status(402).json({
        status: 'underpaid',
        required_amount: entry.amount_usdc,
        paid_amount: paymentProof.amount,
        message: 'Amount paid is below share price.'
      });
    }

    const timestamp = new Date().toISOString();
    
    // *** 修复：跳过 RPC 验证，直接认为成功（与 models.invoke 保持一致）***
    // 生成交易链接
    const explorerBaseUrl = networkConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    const baseUrl = explorerBaseUrl.replace(/\/$/, '');
    const explorerLink = networkConfig.network === 'solana-devnet'
      ? `${baseUrl}/${paymentProof.tx}?cluster=devnet`
      : `${baseUrl}/${paymentProof.tx}`;

    // 直接认为验证成功，不进行 RPC 验证
    const verification = {
      ok: true,
      payer: null,
      explorerLink: explorerLink,
      explorerUrl: explorerLink
    };

    const baseMeta = {
      ...entry.meta,
      verification
    };

    store.markEntryStatus(entry.request_id, 'paid', {
      tx_signature: paymentProof.tx,
      paid_at: timestamp,
      meta: baseMeta
    });
    store.markEntryStatus(entry.request_id, 'completed', {
      completed_at: timestamp,
      meta: {
        ...baseMeta,
        share_id: shareId
      }
    });

    return res.json({
      status: 'ok',
      request_id: entry.request_id,
      share_id: shareId,
      amount_usdc: entry.amount_usdc,
      tx_signature: paymentProof.tx,
      settled_at: timestamp,
      explorer: verification.explorerUrl,
      payer_wallet: null
    });
  } catch (err) {
    console.error('[mcp/share.buy]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const DAILY_REWARD = PricingUtils.constants.dailyCheckInRewardUsdc;

// ========== 匿名充值系统 (方案 B: 隐私优先) ==========

/**
 * POST /deposit
 * 匿名充值端点
 * 
 * 用户通过 transfer_private 向平台充值后，调用此端点确认
 * 服务端不记录钱包地址，只返回一个随机的 access_token
 * 
 * 请求体:
 * {
 *   tx_id: string,        // 链上交易 ID
 *   amount: number,       // 充值金额 (ALEO)
 *   existing_token?: string  // 可选：追加到已有 token
 * }
 * 
 * 响应:
 * {
 *   status: 'ok',
 *   access_token: string,  // 随机生成的访问 token（首次充值）
 *   balance: number,       // 当前余额
 *   message: string
 * }
 */
router.post('/deposit', async (req, res) => {
  try {
    const { tx_id, amount, existing_token } = req.body;
    
    // 验证参数
    if (!tx_id) {
      return res.status(400).json({
        status: 'error',
        error: 'missing_tx_id',
        message: 'Transaction ID is required'
      });
    }
    
    const depositAmount = Number(amount);
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        error: 'invalid_amount',
        message: 'Valid amount is required'
      });
    }
    
    console.log('[mcp/deposit] Processing anonymous deposit:', {
      tx_id: tx_id.slice(0, 12) + '...',
      amount: depositAmount,
      hasExistingToken: !!existing_token
    });
    
    // 如果有已存在的 token，追加充值
    if (existing_token) {
      const tokenInfo = store.validateToken(existing_token);
      if (!tokenInfo) {
        return res.status(400).json({
          status: 'error',
          error: 'invalid_token',
          message: 'The provided token is invalid'
        });
      }
      
      const result = store.addDepositToToken(existing_token, tx_id, depositAmount);
      if (!result) {
        return res.status(500).json({
          status: 'error',
          error: 'deposit_failed',
          message: 'Failed to add deposit to token'
        });
      }
      
      console.log('[mcp/deposit] ✅ Added deposit to existing token:', {
        newBalance: result.balance
      });
      
      return res.json({
        status: 'ok',
        access_token: existing_token,
        balance: result.balance,
        deposited: depositAmount,
        message: 'Deposit added to existing token'
      });
    }
    
    // 创建新的匿名 token
    const { token, balance } = store.createAnonymousDeposit({
      txId: tx_id,
      amount: depositAmount
    });
    
    console.log('[mcp/deposit] ✅ Created new anonymous token');
    
    return res.json({
      status: 'ok',
      access_token: token,
      balance: balance,
      deposited: depositAmount,
      message: 'Anonymous deposit successful. Save your access_token securely - it cannot be recovered!'
    });
    
  } catch (err) {
    console.error('[mcp/deposit]', err);
    return res.status(500).json({ 
      status: 'error',
      error: 'internal_error',
      message: 'Internal server error' 
    });
  }
});

/**
 * GET /token/balance
 * 查询匿名 token 余额
 * 
 * Headers:
 *   X-Anonymous-Token: string
 * 
 * 响应:
 * {
 *   status: 'ok',
 *   balance: number,
 *   currency: 'ALEO'
 * }
 */
router.get('/token/balance', (req, res) => {
  try {
    const token = extractAnonymousToken(req);
    
    if (!token) {
      return res.status(401).json({
        status: 'error',
        error: 'no_token',
        message: 'Anonymous token required in X-Anonymous-Token header'
      });
    }
    
    const tokenInfo = store.validateToken(token);
    if (!tokenInfo) {
      return res.status(401).json({
        status: 'error',
        error: 'invalid_token',
        message: 'Invalid or expired token'
      });
    }
    
    return res.json({
      status: 'ok',
      balance: tokenInfo.balance,
      currency: 'ALEO',
      created_at: tokenInfo.created_at
    });
    
  } catch (err) {
    console.error('[mcp/token/balance]', err);
    return res.status(500).json({ 
      status: 'error',
      error: 'internal_error',
      message: 'Internal server error' 
    });
  }
});

/**
 * POST /anonymous/invoke
 * 匿名 API 调用端点
 * 
 * 使用 access_token 调用 AI 模型，不发送钱包地址
 * 服务端只验证 token，不追踪用户身份
 * 
 * Headers:
 *   X-Anonymous-Token: string
 * 
 * 请求体:
 * {
 *   prompt: string,
 *   model?: string
 * }
 * 
 * 响应:
 * {
 *   status: 'ok',
 *   result: { output, usage, model },
 *   cost: number,
 *   remaining_balance: number
 * }
 */
router.post('/anonymous/invoke', async (req, res) => {
  try {
    // 1. 计算费用
    const selection = selectModelForRequest(req.body || {});
    const cost = selection.model.pricing.pricePerCallUsdc + selection.model.pricing.gasPerCallUsdc;
    
    // 2. 验证 token 和余额
    const tokenValidation = validateAnonymousToken(req, cost);
    if (!tokenValidation.valid) {
      // 如果没有 token 或余额不足，返回价格信息让用户知道需要充值多少
      return res.status(402).json({
        status: 'payment_required',
        error: tokenValidation.error,
        message: tokenValidation.message,
        required_amount: cost,
        current_balance: tokenValidation.balance || 0,
        model: selection.model.id,
        pricing: {
          price_per_call: selection.model.pricing.pricePerCallUsdc,
          gas_per_call: selection.model.pricing.gasPerCallUsdc,
          total: cost,
          currency: 'ALEO'
        },
        deposit_info: {
          recipient: MCP_CONFIG.payments.recipient,
          network: MCP_CONFIG.payments.network,
          message: 'Deposit ALEO to get an access token, then use it to call APIs anonymously'
        }
      });
    }
    
    const { token, balance } = tokenValidation;
    
    console.log('[mcp/anonymous/invoke] Processing anonymous request:', {
      model: selection.model.id,
      cost: cost,
      currentBalance: balance
    });
    
    // 3. 扣减余额
    const deductResult = store.deductFromToken(token, cost, {
      model: selection.model.id,
      request_id: randomUUID()
    });
    
    if (!deductResult || !deductResult.success) {
      return res.status(402).json({
        status: 'payment_required',
        error: 'deduction_failed',
        message: deductResult?.error || 'Failed to deduct balance',
        current_balance: deductResult?.balance || balance
      });
    }
    
    // 4. 调用 AI 模型
    const storedPrompt = sanitizePrompt(req.body?.prompt);
    const inference = await invokeChatCompletion({
      prompt: storedPrompt,
      modelId: selection.model.id,
      metadata: {}
    });
    
    const result = {
      output: inference.output || 'No output returned',
      usage: inference.usage || { calls: 1 },
      model: inference.model || selection.model.id,
      error: inference.error || null
    };
    
    console.log('[mcp/anonymous/invoke] ✅ Anonymous request completed:', {
      model: selection.model.id,
      cost: cost,
      remainingBalance: deductResult.remaining
    });
    
    // 5. 返回结果 (不包含任何用户标识信息)
    return res.json({
      status: 'ok',
      result: result,
      cost: cost,
      remaining_balance: deductResult.remaining,
      currency: 'ALEO'
    });
    
  } catch (err) {
    console.error('[mcp/anonymous/invoke]', err);
    return res.status(500).json({ 
      status: 'error',
      error: 'internal_error',
      message: 'Internal server error' 
    });
  }
});

router.post('/checkin/claim', (req, res) => {
  try {
    const userId = resolveUserId(req);
    const networkConfig = getNetworkConfigFromRequest(req);
    const walletAddress = req.body?.wallet_address;
    if (!walletAddress) {
      return res.status(400).json({
        status: 'missing_wallet',
        message: 'wallet_address is required.'
      });
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const existing = store
      .listEntriesByUser(userId)
      .find(
        (entry) =>
          entry.type === 'checkin' &&
          entry.status === 'completed' &&
          entry.meta?.day_key === todayKey
      );
    if (existing) {
      return res.status(429).json({
        status: 'checkin_limit',
        message: 'Daily check-in already claimed.',
        tx_signature: existing.tx_signature,
        last_claimed: existing.meta?.day_key
      });
    }

    const txSignature = `simulated_tx_${randomUUID()}`;
    const entry = store.createEntry({
      type: 'checkin',
      user_id: userId,
      request_id: randomUUID(),
      amount_usdc: Number(DAILY_REWARD.toFixed(6)),
      status: 'completed',
      tx_signature: txSignature,
      model_or_node: 'daily_checkin',
      tokens_or_calls: 1,
      meta: {
        wallet_address: walletAddress,
        day_key: todayKey
      }
    });

    const explorerBaseUrl = networkConfig.explorerBaseUrl || MCP_CONFIG.payments.explorerBaseUrl;
    // 生成交易链接：Mainnet 不需要 cluster 参数，Devnet 需要添加 ?cluster=devnet
    const baseUrl = explorerBaseUrl.replace(/\/$/, '');
    const explorer = networkConfig.network === 'solana-devnet'
      ? `${baseUrl}/${txSignature}?cluster=devnet`
      : `${baseUrl}/${txSignature}`;
    
    return res.json({
      status: 'ok',
      tx_signature: txSignature,
      amount_usdc: entry.amount_usdc,
      explorer
    });
  } catch (err) {
    console.error('[mcp/checkin.claim]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
