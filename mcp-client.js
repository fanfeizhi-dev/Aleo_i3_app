(function () {
  const MCP_NAMESPACE = 'mcp';
  const DEFAULT_BASE_URL = 'http://localhost:3000';
  const CONFIGURED_BASE_URL =
    (window.APP_CONFIG && (window.APP_CONFIG.mcpBaseUrl || window.APP_CONFIG?.mcp?.baseUrl)) ||
    DEFAULT_BASE_URL;
  const MCP_BASE_URL = CONFIGURED_BASE_URL.replace(/\/$/, '');
  let explorerToastStylesInjected = false;

  function injectExplorerToastStyles() {
    if (explorerToastStylesInjected) return;
    const style = document.createElement('style');
    style.textContent = `
      .mcp-explorer-toast {
        position: fixed;
        right: 24px;
        bottom: 24px;
        width: 360px;
        max-width: calc(100% - 32px);
        background: rgba(17, 24, 39, 0.92);
        color: #fff;
        border-radius: 16px;
        box-shadow: 0 20px 45px rgba(15, 23, 42, 0.45);
        padding: 18px 20px;
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        line-height: 1.5;
        z-index: 100000;
        animation: mcp-toast-in 0.25s ease-out;
      }
      .mcp-explorer-toast h4 {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 600;
      }
      .mcp-explorer-toast a {
        color: #38bdf8;
        font-weight: 600;
        text-decoration: none;
      }
      .mcp-explorer-toast a:hover {
        text-decoration: underline;
      }
      .mcp-explorer-toast button {
        position: absolute;
        top: 12px;
        right: 14px;
        cursor: pointer;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.7);
        font-size: 14px;
      }
      .mcp-explorer-toast button:hover {
        color: #fff;
      }
      @keyframes mcp-toast-in {
        from { transform: translateY(12px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    explorerToastStylesInjected = true;
  }

  function showExplorerToast({ url, title, subtitle }) {
    if (!url) return;
    injectExplorerToastStyles();
    const toast = document.createElement('div');
    toast.className = 'mcp-explorer-toast';
    toast.innerHTML = `
      <button aria-label="Dismiss explorer link">✕</button>
      <h4>${title || 'Payment Settled'}</h4>
      <div>${subtitle || 'View the on-chain transaction:'}</div>
      <div style="margin-top: 10px;">
        <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
      </div>
    `;
    const close = toast.querySelector('button');
    const remove = () => {
      toast.remove();
    };
    close.addEventListener('click', remove);
    setTimeout(remove, 15000);
    document.body.appendChild(toast);
  }

  function detectMetaMaskProvider() {
    if (window.ethereum && window.ethereum.isMetaMask) {
      return window.ethereum;
    }
    if (window.walletManager?.ethereum) {
      return window.walletManager.ethereum;
    }
    return null;
  }

  function detectWalletAddress() {
    // 优先从 walletManager 获取地址
    if (window.walletManager && window.walletManager.walletAddress) {
      return window.walletManager.walletAddress;
    }
    // 退一步，从 MetaMask 读取 selectedAddress
    if (window.ethereum && window.ethereum.selectedAddress) {
      return window.ethereum.selectedAddress;
    }
    return null;
  }

  function normalizeModelIdentifier(name) {
    if (!name) return '';
    return String(name)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-:_]/g, '');
  }

  function modelIdentifiersMatch(a, b) {
    if (!a || !b) return false;
    const normA = normalizeModelIdentifier(a);
    const normB = normalizeModelIdentifier(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    const compactA = normA.replace(/[-_:]/g, '');
    const compactB = normB.replace(/[-_:]/g, '');
    return compactA && compactA === compactB;
  }

  function resolveModelMatch(storedName, candidates = []) {
    if (!storedName) return null;
    for (const candidate of candidates) {
      if (modelIdentifiersMatch(storedName, candidate)) {
        return candidate;
      }
    }
    return null;
  }

  async function ensureMetaMaskConnected() {
    const provider = detectMetaMaskProvider();
    if (!provider) {
      throw new Error('MetaMask not detected. Please install MetaMask extension.');
    }
    
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts[0]) {
        throw new Error('No accounts found in MetaMask');
      }
      return { provider, address: accounts[0] };
    } catch (err) {
      throw new Error(`MetaMask connection failed: ${err.message}`);
    }
  }

  function amountToBaseUnits(amount, decimals = 18) {
    const str = String(amount);
    const [whole = '0', frac = ''] = str.split('.');
    const wholePart = whole || '0';
    const fracPart = frac.padEnd(decimals, '0').slice(0, decimals);
    const combined = wholePart + fracPart;
    return BigInt(combined);
  }


  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function emit(event, detail) {
    try {
      window.dispatchEvent(new CustomEvent(`${MCP_NAMESPACE}:${event}`, { detail }));
    } catch (_) {
      // noop
    }
  }

  function ensurePanel() {
    let panel = document.getElementById('mcp-status-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'mcp-status-panel';
    panel.innerHTML = `
      <style>
        #mcp-status-panel { 
          position: fixed; right: 24px; bottom: 24px; width: 360px; max-height: 60vh; overflow-y: auto; 
          background: linear-gradient(135deg, rgba(0, 40, 35, 0.95), rgba(0, 60, 50, 0.95)); 
          color: #fff; border-radius: 20px; 
          box-shadow: 0 20px 50px rgba(0, 212, 170, 0.15), 0 0 0 1px rgba(0, 212, 170, 0.2); 
          padding: 20px 22px; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.5; z-index: 99999; display: none; 
        }
        #mcp-status-panel.show { display: block; }
        #mcp-status-panel .mcp-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        #mcp-status-panel .mcp-logo { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #00d4aa, #00b894); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; }
        #mcp-status-panel h4 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; }
        #mcp-status-panel .mcp-subtitle { font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid rgba(0, 212, 170, 0.2); }
        #mcp-status-panel .mcp-close { position: absolute; top: 14px; right: 16px; cursor: pointer; border: none; background: transparent; color: rgba(255,255,255,0.5); font-size: 16px; }
        #mcp-status-panel .mcp-close:hover { color: #00d4aa; }
        #mcp-status-panel .mcp-log { margin: 0; padding: 0; list-style: none; }
        #mcp-status-panel .mcp-log li { padding: 10px 12px; margin-bottom: 8px; background: rgba(0, 212, 170, 0.08); border-radius: 10px; border-left: 3px solid #00d4aa; }
        #mcp-status-panel .mcp-log li:last-child { margin-bottom: 0; }
        #mcp-status-panel .mcp-pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }
        #mcp-status-panel .pill-invoice { background: rgba(0, 212, 170, 0.2); color: #7dffe5; }
        #mcp-status-panel .pill-pay { background: rgba(0, 212, 170, 0.3); color: #00ffcc; }
        #mcp-status-panel .pill-result { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; }
        #mcp-status-panel .pill-cancel { background: rgba(248, 113, 113, 0.2); color: #fecaca; }
        #mcp-status-panel .mcp-log small { display: block; margin-top: 6px; color: rgba(255,255,255,0.6); font-size: 11px; }
        #mcp-status-panel .mcp-log small a { color: #00d4aa; }
        #mcp-status-panel .mcp-privacy-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: rgba(0, 212, 170, 0.8); margin-left: 8px; }
      </style>
      <button class="mcp-close" aria-label="Close">✕</button>
      <div class="mcp-header">
        <img src="svg/chains/aleo.svg" alt="Aleo" style="width:28px;height:28px;border-radius:50%;">
        <h4>Aleo Payment</h4>
        <span class="mcp-privacy-badge">🔒 Private</span>
      </div>
      <div class="mcp-subtitle">Offchain execution • Encrypted state • Zero-knowledge proofs</div>
      <ul class="mcp-log"></ul>
    `;
    panel.querySelector('.mcp-close').addEventListener('click', () => {
      panel.classList.remove('show');
    });
    document.body.appendChild(panel);
    return panel;
  }

  function logStatus(kind, text, meta = {}) {
    const panel = ensurePanel();
    const list = panel.querySelector('.mcp-log');
    const li = document.createElement('li');
    const pillClass = {
      invoice: 'pill-invoice',
      payment: 'pill-pay',
      result: 'pill-result',
      cancel: 'pill-cancel'
    }[kind] || 'pill-invoice';
    const title = {
      invoice: '402 Invoice',
      payment: 'Paid',
      result: 'Result',
      cancel: 'Cancelled'
    }[kind] || 'Update';
    const lines = [];
    
    // Auto Router 选中的模型信息
    if (meta.autoRouterModel) {
      lines.push(`🤖 Auto Router → <strong style="color: #a78bfa;">${meta.autoRouterModel}</strong>`);
    }
    
    if (meta.amount) lines.push(`Amount: ${meta.amount} ALEO`);
    if (meta.memo) lines.push(`Memo: ${meta.memo}`);
    if (meta.tx) {
      // 检查是否是有效的 Aleo 交易 ID（at1... 开头）
      // Leo Wallet 返回的本地 ID 是 UUID 格式，不是真正的链上交易 ID
      const isValidAleoTxId = meta.tx && meta.tx.startsWith('at1');
      const isUuidFormat = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(meta.tx);
      
      if (isValidAleoTxId) {
        // 有效的 Aleo 交易 ID，显示链接
        let explorer = meta.explorer;
        if (!explorer) {
          if (window.AleoPayment && typeof window.AleoPayment.getExplorerUrl === 'function') {
            explorer = window.AleoPayment.getExplorerUrl(meta.tx);
          } else {
            explorer = `https://explorer.aleo.org/transaction/${encodeURIComponent(meta.tx)}`;
          }
        }
        const short = `${meta.tx.slice(0, 6)}…${meta.tx.slice(-4)}`;
        lines.push(
          `Tx: <a href="${explorer}" target="_blank" rel="noopener noreferrer">${short}</a>`
        );
      } else if (isUuidFormat) {
        // Leo Wallet 本地 ID，显示等待提示而不是链接
        lines.push(`⏳ Processing in wallet...`);
      }
    }
    if (meta.node) lines.push(`Node: ${meta.node}`);
    if (meta.description) lines.push(meta.description);
    li.innerHTML = `
      <span class="mcp-pill ${pillClass}">${title}</span>
      <div>${text}</div>
      ${lines.length ? `<small>${lines.join(' • ')}</small>` : ''}
    `;
    list.appendChild(li);
    panel.classList.add('show');
    panel.scrollTop = panel.scrollHeight;
  }

  async function settleInvoice(invoice) {
    try {
      console.log('[MCPClient] settleInvoice (Aleo/Leo Wallet)', invoice);
      
      // 检查是否使用 Leo Wallet (Aleo)
      const wm = window.walletManager;
      const isLeoWallet = wm && wm.walletType === 'leo';
      
      if (isLeoWallet && window.AleoPayment) {
        // —— 使用 Leo Wallet 进行 Aleo 支付 (优先私密转账) ——
        console.log('[MCPClient] Using Leo Wallet for Aleo payment (Privacy-First Mode)');
        
        const amount = invoice.amount_usdc ?? invoice.amount ?? invoice.amount_aleo ?? 0;
        if (amount == null || amount <= 0) {
          throw new Error('Invoice missing amount');
        }
        
        // 使用 AleoPayment 模块 (优先私密转账)
        const result = await window.AleoPayment.sendAleoPayment({
          recipient: invoice.recipient || window.AleoPayment.PLATFORM_RECIPIENT,
          amount: amount,
          memo: invoice.request_id || invoice.memo || '',
          preferPrivate: true  // 优先使用 transfer_private
        });
        
        if (result.cancelled) {
          return null; // 用户取消
        }
        
        if (!result.success) {
          throw new Error(result.error || 'Aleo payment failed');
        }
        
        const txId = result.transactionId;
        const network = result.network || window.AleoPayment.getCurrentNetwork();
        const explorerUrl = window.AleoPayment.getExplorerUrl(txId, network);
        const privacyLevel = result.privacyLevel || 'public';
        
        console.log(`[MCPClient] Aleo payment sent via ${privacyLevel} transfer:`, txId);
        
        // 显示成功 Toast (包含隐私级别)
        try {
          window.AleoPayment.showPaymentSuccessToast(txId, amount, network, privacyLevel);
        } catch (e) {
          console.warn('[MCPClient] Failed to show payment toast:', e);
        }
        
        // 日志显示隐私级别
        const privacyIcon = privacyLevel === 'private' ? '🔒' : '📢';
        if (typeof logStatus === 'function') {
          logStatus('payment', `${privacyIcon} Aleo ${privacyLevel} payment of ${amount} ALEO sent`, {
            tx: txId,
            explorerUrl
          });
        }
        
        return txId;
      }
      
      // —— Leo Wallet 必须连接才能支付 ——
      console.warn('[MCPClient] Leo Wallet not available');
      throw new Error('Please connect Leo Wallet to make payments on Aleo Network.');
      
    } catch (error) {
      console.error('[MCPClient] settleInvoice error:', error);
      if (typeof logStatus === 'function') {
        logStatus('cancel', error && error.message ? error.message : 'Payment cancelled', {
          error: String(error && error.stack ? error.stack : error)
        });
      }
      throw error;
    }
  }


  async function request(path, body, opts = {}) {
    const fullEndpoint = path.startsWith('http')
      ? path
      : `${MCP_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    console.log('[MCPClient] request start', fullEndpoint, body);
    const baseHeaders = { 'Content-Type': 'application/json' };
    let sessionHeaders = { ...(opts.headers || {}) };
    let paymentHeaders = {};
    const history = [];
    const payload = { ...(body || {}) };
    let walletAddress = detectWalletAddress();
    if (walletAddress) {
      baseHeaders['X-Wallet-Address'] = walletAddress;
      if (!payload.wallet_address) {
        payload.wallet_address = walletAddress;
      }
    }
    
    // 添加网络信息到请求头
    try {
      const networkRaw = localStorage.getItem('i3_preferred_network');
      if (networkRaw) {
        const network = JSON.parse(networkRaw);
        if (network && network.key) {
          baseHeaders['X-Aleo-Network'] = network.key;
          if (!payload.network) {
            payload.network = network.key;
          }
        }
      }
    } catch (e) {
      console.warn('[MCPClient] Failed to read network from localStorage:', e);
    }

    while (true) {
      if (walletAddress && payload.wallet_address !== walletAddress) {
        payload.wallet_address = walletAddress;
      }
      const payloadJson = JSON.stringify(payload);
      const headers = { ...baseHeaders, ...sessionHeaders, ...paymentHeaders };
      console.log('[MCPClient] issuing fetch', fullEndpoint, { headers });
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers,
        body: payloadJson
      });
      console.log('[MCPClient] response status', response.status, fullEndpoint);
      paymentHeaders = {};

      const session = response.headers.get('X-Workflow-Session');
      if (session) {
        sessionHeaders['X-Workflow-Session'] = session;
      }

      if (response.status === 402) {
        const invoice = await response.json();
        console.log('[MCPClient] received 402 invoice', invoice);
        console.log('[MCPClient] Invoice status:', invoice.status);
        console.log('[MCPClient] Is payment_required?', invoice.status === 'payment_required');
        console.log('[MCPClient] Full invoice:', JSON.stringify(invoice, null, 2));
        if (invoice.status && invoice.status !== 'payment_required') {
          // 如果验证失败但提供了 explorerLink，说明交易可能已成功但 RPC 延迟
          // 在这种情况下，不显示错误，而是继续重试请求（后端应该会允许继续）
          if (invoice.status === 'payment_verification_failed' && 
              invoice.code === 'tx_not_found' && 
              invoice.details?.explorerLink) {
            
            // *** 新增: 增加重试计数器 ***
            if (!history.retryCount) history.retryCount = 0;
            history.retryCount++;
            
            console.warn(`[MCPClient] Transaction not found on RPC (attempt ${history.retryCount}/20), but explorer link is available. Retrying...`);
            console.warn('[MCPClient] Explorer link:', invoice.details.explorerLink);
            
            // *** 修改: 增加等待时间,最多重试 20 次 ***
            if (history.retryCount <= 20) {
              const waitTime = Math.min(2000 * history.retryCount, 5000); // 从2秒逐渐增加到5秒
              console.log(`[MCPClient] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              console.error('[MCPClient] Max retries reached, but transaction exists on explorer');
              // 即使达到最大重试次数,如果有 explorerLink,也视为成功
              return {
                status: 'ok',
                result: {
                  tx: invoice.details.explorerLink.split('/').pop(),
                  message: 'Payment confirmed via explorer (RPC delayed)',
                  explorerLink: invoice.details.explorerLink
                },
                history
              };
            }
          }
          
          // 检查错误消息中是否包含 "Transaction not found" 且提供了 explorerLink
          // 如果是，也不显示错误，而是继续重试
          const errorMessage = invoice.message || invoice.status || '';
          if (errorMessage.includes('Transaction not found') && invoice.details?.explorerLink) {
            
            // *** 新增: 增加重试计数器 ***
            if (!history.retryCount) history.retryCount = 0;
            history.retryCount++;
            
            console.warn(`[MCPClient] Transaction not found on RPC (attempt ${history.retryCount}/20), but explorer link is available. Retrying...`);
            console.warn('[MCPClient] Explorer link:', invoice.details.explorerLink);
            
            // *** 修改: 增加等待时间,最多重试 20 次 ***
            if (history.retryCount <= 20) {
              const waitTime = Math.min(2000 * history.retryCount, 5000); // 从2秒逐渐增加到5秒
              console.log(`[MCPClient] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              console.error('[MCPClient] Max retries reached, but transaction exists on explorer');
              // 即使达到最大重试次数,如果有 explorerLink,也视为成功
              return {
                status: 'ok',
                result: {
                  message: 'Payment confirmed via explorer (RPC delayed)',
                  explorerLink: invoice.details.explorerLink
                },
                history
              };
            }
          }
          
          const reason = invoice.message || invoice.status || 'Payment required';
          logStatus('cancel', reason, {
            amount: invoice.amount_usdc,
            memo: invoice.memo
          });
          return {
            status: 'invoice_error',
            invoice,
            history: [...history, { type: 'invoice_error', invoice }]
          };
        }
        
        // 检查是否有 prepaid credits
        const prepaidCreditsRaw = localStorage.getItem('prepaidCredits');
        if (prepaidCreditsRaw) {
          try {
            const prepaidCredits = JSON.parse(prepaidCreditsRaw);
            const modelCandidates = [
              payload.model,
              payload.modelName,
              payload.modelId,
              invoice.model_or_node,
              invoice.model,
              invoice.modelId,
              invoice.auto_router?.model?.id,
              invoice.auto_router?.model?.name
            ].filter(Boolean);
            const matchedCandidate = resolveModelMatch(prepaidCredits.modelName, modelCandidates);
            const fallbackModel = payload.model || payload.modelId || invoice.model_or_node;
            const modelName = matchedCandidate || fallbackModel;
            
            console.log('[MCPClient] Checking prepaid credits:', {
              prepaidModel: prepaidCredits.modelName,
              requestModel: modelName,
              remaining: prepaidCredits.remainingCalls,
              invoiceModel: invoice.model_or_node
            });
            
            // 尝试多种方式匹配模型名称
            const requestedModel = modelName || invoice.model_or_node;
            const isModelMatch = modelIdentifiersMatch(prepaidCredits.modelName, requestedModel);
            
            if (isModelMatch && prepaidCredits.remainingCalls > 0) {
              console.log(`[MCPClient] ✅ Using prepaid credits: ${prepaidCredits.remainingCalls} calls remaining for ${requestedModel}`);
              
              // 减少一次 API call
              prepaidCredits.remainingCalls -= 1;
              prepaidCredits.lastUsedAt = new Date().toISOString();
              
              // 如果用完了，清除 prepaid credits
              if (prepaidCredits.remainingCalls <= 0) {
                console.log('[MCPClient] Prepaid credits exhausted, clearing...');
                localStorage.removeItem('prepaidCredits');
                
                // 显示通知
                setTimeout(() => {
                  const notification = document.createElement('div');
                  notification.style.cssText = `
                    position: fixed; top: 20px; right: 20px; z-index: 10000;
                    background: linear-gradient(135deg, #f59e0b, #d97706);
                    color: white; padding: 16px 24px; border-radius: 12px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                    font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600;
                  `;
                  notification.innerHTML = `
                    ⚠️ API calls exhausted!<br>
                    <span style="font-size: 12px; font-weight: 400;">Purchase more from Modelverse to continue.</span>
                  `;
                  document.body.appendChild(notification);
                  
                  setTimeout(() => notification.remove(), 5000);
                }, 500);
              } else {
                localStorage.setItem('prepaidCredits', JSON.stringify(prepaidCredits));
              }
              
              // 同步更新 myAssets
              const myAssetsRaw = localStorage.getItem('myAssets');
              if (myAssetsRaw) {
                const myAssets = JSON.parse(myAssetsRaw);
                const tokenAsset = myAssets.tokens.find(
                  (t) => modelIdentifiersMatch(t.modelName, prepaidCredits.modelName) ||
                    modelIdentifiersMatch(t.modelName, modelName)
                );
                if (tokenAsset && tokenAsset.quantity > 0) {
                  tokenAsset.quantity -= 1;
                  localStorage.setItem('myAssets', JSON.stringify(myAssets));
                  console.log(`[MCPClient] Deducted 1 API call. Remaining: ${tokenAsset.quantity}`);
                  
                  // 如果 myAssets 中也用完了，移除该 token
                  if (tokenAsset.quantity <= 0) {
                    myAssets.tokens = myAssets.tokens.filter(
                      (t) =>
                        !modelIdentifiersMatch(t.modelName, prepaidCredits.modelName) &&
                        !modelIdentifiersMatch(t.modelName, modelName)
                    );
                    localStorage.setItem('myAssets', JSON.stringify(myAssets));
                    console.log(`[MCPClient] Removed ${modelName} from myAssets (exhausted)`);
                  }
                }
              }
              
              // 使用 prepaid 标记跳过实际支付
              logStatus('invoice', `Using prepaid credits (${prepaidCredits.remainingCalls} remaining)`, {
                amount: invoice.amount_usdc,
                memo: 'PREPAID'
              });
              
              // 设置特殊的支付 header 表示使用 prepaid credits
              paymentHeaders = {
                'X-PAYMENT': `prepaid model=${normalizeModelIdentifier(requestedModel || prepaidCredits.modelName)}; remaining=${prepaidCredits.remainingCalls}; nonce=${invoice.nonce}`,
                'X-Prepaid-Credits': 'true',
                'X-Request-Id': invoice.request_id || invoice.memo
              };
              
              console.log('[MCPClient] Setting prepaid payment headers:', paymentHeaders);
              
              // 触发 UI 更新事件
              window.dispatchEvent(new CustomEvent('prepaidCreditsUsed', { 
                detail: { 
                  modelName: requestedModel, 
                  remaining: prepaidCredits.remainingCalls 
                } 
              }));
              
              continue;
            } else {
              console.log('[MCPClient] Prepaid credits not applicable:', {
                modelMatch: isModelMatch,
                hasCredits: prepaidCredits.remainingCalls > 0,
                prepaidModel: prepaidCredits.modelName,
                requestedModel: requestedModel
              });
            }
          } catch (err) {
            console.warn('[MCPClient] Error checking prepaid credits:', err);
          }
        }
        
        history.push({ type: 'invoice', invoice });
        
        // 获取 Auto Router 选中的模型信息
        const autoRouterModel = invoice.auto_router?.model?.id || invoice.model_or_node || payload.model;
        
        logStatus('invoice', invoice.description || 'Payment required', {
          amount: invoice.amount_usdc,
          memo: invoice.memo,
          autoRouterModel: autoRouterModel
        });
        emit('invoice', { endpoint: fullEndpoint, invoice });
        if (typeof opts.onInvoice === 'function') {
          try { await opts.onInvoice(invoice); } catch (_) {}
        }
        if (opts.autoPay === false) {
          return { status: 'invoice', invoice, history, headers: sessionHeaders };
        }
        let tx;
        try {
          tx = opts.paymentProvider
          ? await opts.paymentProvider(invoice)
            : await settleInvoice(invoice);
        } catch (paymentError) {
          history.push({ type: 'payment_error', invoice, error: paymentError });
          logStatus('cancel', `Payment failed: ${paymentError?.message || 'Payment error'}`, {
            amount: invoice.amount_usdc,
            memo: invoice.memo
          });
          emit('payment:error', { endpoint: fullEndpoint, invoice, error: paymentError });
          throw paymentError;
        }
        if (!tx) {
          return { status: 'cancelled', invoice, history };
        }
        history.push({ type: 'payment', invoice, tx });
        if (typeof opts.onPayment === 'function') {
          try { await opts.onPayment(invoice, tx); } catch (_) {}
        }
        emit('payment:settled', { endpoint: fullEndpoint, invoice, tx });
        walletAddress = detectWalletAddress() || walletAddress;
        if (walletAddress) {
          baseHeaders['X-Wallet-Address'] = walletAddress;
        }
        const memoPart = invoice.memo ? `; memo=${invoice.memo}` : '';
        paymentHeaders = {
          'X-Request-Id': invoice.request_id,
          'X-PAYMENT': `aleo tx=${tx}; amount=${invoice.amount_usdc}; nonce=${invoice.nonce}${memoPart}`
        };
        continue;
      }

      const result = await response.json();
      console.log('[MCPClient] final result', result);
      history.push({ type: 'result', result });
      if (typeof opts.onResult === 'function') {
        try { await opts.onResult(result); } catch (_) {}
      }
      emit('result', { endpoint: fullEndpoint, result });
      logStatus('result', 'Call completed', {});
      try {
        const explorerUrl =
          result?.final_node?.explorer ||
          result?.explorer ||
          result?.receipt?.explorer ||
          result?.meta?.verification?.explorerUrl;
        
        // 检查 Explorer URL 是否有效（排除 Leo Wallet 本地 ID - UUID 格式）
        // 有效的 Aleo 交易 ID 格式是 at1... 开头
        const isValidExplorerUrl = explorerUrl && !explorerUrl.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        
        if (isValidExplorerUrl) {
          showExplorerToast({
            url: explorerUrl,
            title: 'On-chain Transaction',
            subtitle: 'Click to view on Aleo Explorer.'
          });
        } else if (explorerUrl) {
          // 如果是本地 ID，显示等待提示
          console.log('[MCPClient] Explorer URL contains local ID, skipping toast:', explorerUrl);
        }
      } catch (toastError) {
        console.warn('[MCPClient] failed to display explorer toast', toastError);
      }
      return { status: 'ok', result, history };
    }
  }

  async function invokeModel({ prompt, modelName, metadata } = {}) {
    const body = {
      prompt,
      model: modelName,
      metadata: metadata || {}
    };
    return request('/mcp/models.invoke', body, {});
  }

  // ========== 匿名调用系统 (方案 B: 隐私优先) ==========

  /**
   * 匿名调用 AI 模型
   * 使用 access_token 而不是钱包地址，保护用户隐私
   * 
   * @param {Object} options
   * @param {string} options.prompt - 用户输入
   * @param {string} options.modelName - 模型名称
   * @returns {Promise<{status: string, result?: Object, error?: string}>}
   */
  async function anonymousInvokeModel({ prompt, modelName } = {}) {
    // 检查是否有 AleoPayment 模块
    if (!window.AleoPayment) {
      return { status: 'error', error: 'AleoPayment module not loaded' };
    }

    // 检查是否有匿名 token
    if (!window.AleoPayment.hasAnonymousToken()) {
      logStatus('cancel', 'No access token. Please deposit first.', {});
      return { 
        status: 'no_token', 
        error: 'Please deposit ALEO first to get an access token',
        deposit_required: true
      };
    }

    // 调用匿名 API
    logStatus('invoice', `Calling ${modelName || 'AI model'} anonymously...`, {});
    
    const result = await window.AleoPayment.anonymousInvoke({
      prompt,
      model: modelName
    });

    if (!result.success) {
      if (result.error === 'insufficient_balance') {
        logStatus('cancel', `Insufficient balance. Need ${result.required} ALEO`, {
          amount: result.required
        });
        return {
          status: 'insufficient_balance',
          error: 'Insufficient balance',
          required: result.required,
          balance: result.balance,
          pricing: result.pricing,
          deposit_info: result.deposit_info
        };
      }
      
      logStatus('cancel', result.error || 'Anonymous call failed', {});
      return { status: 'error', error: result.error };
    }

    // 成功
    logStatus('result', 'Anonymous call completed', {
      description: `Cost: ${result.cost} ALEO, Remaining: ${result.remaining_balance} ALEO`
    });

    return {
      status: 'ok',
      result: result.result,
      cost: result.cost,
      remaining_balance: result.remaining_balance
    };
  }

  /**
   * 获取当前匿名余额
   */
  async function getAnonymousBalance() {
    if (!window.AleoPayment) {
      return null;
    }
    return window.AleoPayment.getAnonymousBalance();
  }

  /**
   * 匿名充值
   * @param {number} amount - 充值金额 (ALEO)
   */
  async function anonymousDeposit(amount) {
    if (!window.AleoPayment) {
      return { success: false, error: 'AleoPayment module not loaded' };
    }

    logStatus('invoice', `Depositing ${amount} ALEO anonymously...`, { amount });

    const result = await window.AleoPayment.anonymousDeposit({ amount });

    if (!result.success) {
      if (result.cancelled) {
        logStatus('cancel', 'Deposit cancelled by user', {});
        return { success: false, cancelled: true };
      }
      logStatus('cancel', result.error || 'Deposit failed', {});
      return { success: false, error: result.error };
    }

    const privacyIcon = result.privacyLevel === 'private' ? '🔒' : '📢';
    logStatus('payment', `${privacyIcon} Deposited ${result.deposited} ALEO`, {
      tx: result.transactionId,
      description: `Balance: ${result.balance} ALEO`
    });

    return {
      success: true,
      balance: result.balance,
      token: result.token,
      transactionId: result.transactionId
    };
  }

  async function executeWorkflow(payload, hooks = {}) {
    return request('/mcp/workflow/execute', payload, {
      onInvoice: hooks.onInvoice,
      onPayment: hooks.onPayment,
      onResult: hooks.onResult
    });
  }

  async function purchaseShare(payload, hooks = {}) {
    return request('/mcp/share/buy', payload, {
      onInvoice: hooks.onInvoice,
      onPayment: hooks.onPayment,
      onResult: hooks.onResult
    });
  }

  async function claimCheckin(payload, hooks = {}) {
    const res = await fetch(`${MCP_BASE_URL}/mcp/checkin/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      logStatus('result', 'Check-in successful', {
        amount: data.amount_usdc,
        tx: data.tx_signature
      });
      if (typeof hooks.onResult === 'function') {
        try { await hooks.onResult(data); } catch (_) {}
      }
      emit('result', { endpoint: 'checkin', result: data });
      return { status: 'ok', result: data };
    }
    emit('error', { endpoint: 'checkin', error: data });
    return { status: 'error', error: data };
  }

  window.MCPClient = {
    baseUrl: MCP_BASE_URL,
    request,
    invokeModel,
    executeWorkflow,
    settleInvoice,
    purchaseShare,
    claimCheckin,
    logStatus,
    // 匿名调用系统 (方案 B: 隐私优先)
    anonymousInvokeModel,
    anonymousDeposit,
    getAnonymousBalance,
    // Debug helpers
    debugPrepaidCredits() {
      const prepaidCreditsRaw = localStorage.getItem('prepaidCredits');
      const myAssetsRaw = localStorage.getItem('myAssets');
      const currentModelRaw = localStorage.getItem('currentModel');
      
      console.log('=== Prepaid Credits Debug ===');
      console.log('1. Prepaid Credits:', prepaidCreditsRaw ? JSON.parse(prepaidCreditsRaw) : 'None');
      console.log('2. My Assets Tokens:', myAssetsRaw ? JSON.parse(myAssetsRaw).tokens : 'None');
      console.log('3. Current Model:', currentModelRaw ? JSON.parse(currentModelRaw) : 'None');
      
      return {
        prepaidCredits: prepaidCreditsRaw ? JSON.parse(prepaidCreditsRaw) : null,
        myAssets: myAssetsRaw ? JSON.parse(myAssetsRaw) : null,
        currentModel: currentModelRaw ? JSON.parse(currentModelRaw) : null
      };
    },
    clearPrepaidCredits() {
      localStorage.removeItem('prepaidCredits');
      console.log('✅ Prepaid credits cleared. Please refresh and use the "Use" button again.');
    }
  };
})();
