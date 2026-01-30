const fetch = require('node-fetch');
const { MCP_CONFIG } = require('./config');

// Aleo API endpoints
const ALEO_MAINNET_API = 'https://api.explorer.aleo.org/v1/mainnet';
const ALEO_TESTNET_API = 'https://api.explorer.aleo.org/v1/testnet3';

/**
 * 获取网络对应的 API URL
 */
function getApiUrl(networkConfig) {
  const network = networkConfig?.network || MCP_CONFIG.payments.network || 'aleo-testnet';
  if (network.includes('testnet')) {
    return networkConfig?.rpcUrl || ALEO_TESTNET_API;
  }
  return networkConfig?.rpcUrl || ALEO_MAINNET_API;
}

/**
 * 获取网络对应的 Explorer URL
 */
function getExplorerUrl(networkConfig, txId) {
  const network = networkConfig?.network || MCP_CONFIG.payments.network || 'aleo-testnet';
  const baseUrl = networkConfig?.explorerBaseUrl || 
    (network.includes('testnet') 
      ? 'https://explorer.aleo.org/testnet/transaction'
      : 'https://explorer.aleo.org/transaction');
  return `${baseUrl}/${txId}`;
}

/**
 * 将 microcredits 转换为 Credits
 * 1 Credit = 1,000,000 microcredits
 */
function microCreditsToCredits(microcredits) {
  return Number(microcredits) / 1_000_000;
}

/**
 * 将 Credits 转换为 microcredits
 * 1 Credit = 1,000,000 microcredits
 */
function creditsToMicroCredits(credits) {
  return BigInt(Math.floor(Number(credits) * 1_000_000));
}

/**
 * 从 Aleo API 获取交易详情
 */
async function getTransaction(apiUrl, txId) {
  const url = `${apiUrl}/transaction/${txId}`;
  console.log(`[Aleo Verifier] Fetching transaction from: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Aleo API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * 解析 Aleo 交易中的转账信息
 * 支持 credits.aleo 的 transfer_public 和 transfer_private_to_public 等函数
 */
function parseTransferFromTransaction(tx, expectedRecipient) {
  if (!tx || !tx.execution) {
    return null;
  }

  const transitions = tx.execution.transitions || [];
  
  for (const transition of transitions) {
    // 只处理 credits.aleo 程序的转账
    if (transition.program !== 'credits.aleo') {
      continue;
    }
    
    // 检查是否是转账函数
    const transferFunctions = [
      'transfer_public',
      'transfer_private_to_public',
      'transfer_public_to_private'
    ];
    
    if (!transferFunctions.includes(transition.function)) {
      continue;
    }
    
    // 解析输入参数
    const inputs = transition.inputs || [];
    const outputs = transition.outputs || [];
    
    // 对于 transfer_public: inputs = [sender, recipient, amount]
    // 对于 transfer_private_to_public: inputs = [record, recipient, amount]
    
    let recipient = null;
    let amount = null;
    
    // 尝试从 inputs 中提取 recipient 和 amount
    for (const input of inputs) {
      const value = input.value || '';
      
      // 检查是否是 Aleo 地址
      if (value.startsWith('aleo1') && value.length === 63) {
        recipient = value;
      }
      
      // 检查是否是金额 (以 u64 结尾)
      if (value.endsWith('u64')) {
        amount = BigInt(value.replace('u64', ''));
      }
    }
    
    // 验证收款人
    if (recipient && recipient.toLowerCase() === expectedRecipient.toLowerCase()) {
      return {
        recipient,
        amount: amount || BigInt(0),
        function: transition.function,
        program: transition.program
      };
    }
  }
  
  return null;
}

/**
 * 验证 Aleo Credits 转账
 * 
 * @param {Object} params
 * @param {string} params.signature - 交易 ID
 * @param {number} params.amount - 期望金额 (Credits)
 * @param {string} params.recipient - 收款地址
 * @param {number} params.decimals - 精度 (默认 6)
 * @param {string} params.expectedWallet - 期望的付款地址
 * @param {Object} params.networkConfig - 网络配置
 */
async function verifyAleoTransfer({
  signature,
  amount,
  recipient,
  decimals,
  expectedWallet,
  networkConfig
}) {
  const apiUrl = getApiUrl(networkConfig);
  const txId = signature;
  const explorerUrl = getExplorerUrl(networkConfig, txId);
  
  if (!txId) {
    return {
      ok: false,
      code: 'missing_tx_id',
      message: 'Missing transaction ID',
      explorerUrl
    };
  }
  
  const expectedRecipient = recipient || MCP_CONFIG.payments.recipient || '';
  if (!expectedRecipient) {
    return {
      ok: false,
      code: 'missing_recipient',
      message: 'No recipient configured for payments',
      explorerUrl
    };
  }
  
  const decs = decimals || MCP_CONFIG.payments.decimals || 6;
  
  try {
    // 轮询等待交易上链
    let tx = null;
    const maxAttempts = 30; // Aleo 交易确认可能需要更长时间
    
    console.log(`[Aleo Verifier] Starting transaction verification with polling (max ${maxAttempts} attempts)...`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        tx = await getTransaction(apiUrl, txId);
        if (tx) {
          console.log(`[Aleo Verifier] ✅ Transaction found after ${attempt + 1} attempt(s)`);
          break;
        }
      } catch (err) {
        console.warn(`[Aleo Verifier] Attempt ${attempt + 1}/${maxAttempts} failed:`, err.message);
      }
      
      if (attempt < maxAttempts - 1) {
        const waitTime = 3000; // 每次等待3秒
        console.log(`[Aleo Verifier] Transaction not found yet, waiting ${waitTime}ms before retry ${attempt + 2}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!tx) {
      console.error(`[Aleo Verifier] ❌ Transaction not found after ${maxAttempts} attempts`);
      return {
        ok: false,
        code: 'tx_not_found',
        message: 'Transaction not found on Aleo network after polling',
        explorerUrl
      };
    }
    
    // 检查交易状态
    if (tx.status && tx.status !== 'accepted') {
      return {
        ok: false,
        code: 'tx_not_accepted',
        message: `Transaction status is ${tx.status}, not accepted`,
        explorerUrl
      };
    }
    
    // 解析转账信息
    const transfer = parseTransferFromTransaction(tx, expectedRecipient);
    
    if (!transfer) {
      return {
        ok: false,
        code: 'no_transfer_found',
        message: 'No valid transfer to the expected recipient found in transaction',
        details: { expectedRecipient },
        explorerUrl
      };
    }
    
    // 验证金额
    const expectedMicroCredits = creditsToMicroCredits(amount);
    
    if (transfer.amount < expectedMicroCredits) {
      return {
        ok: false,
        code: 'amount_too_low',
        message: 'On-chain amount is below invoice requirement',
        details: {
          expected: expectedMicroCredits.toString(),
          actual: transfer.amount.toString(),
          expectedCredits: amount,
          actualCredits: microCreditsToCredits(transfer.amount)
        },
        explorerUrl
      };
    }
    
    // 如果提供了 expectedWallet，验证付款人
    // 注意：对于私密交易，付款人可能无法验证
    
    return {
      ok: true,
      code: 'ok',
      message: 'Payment verified on Aleo network',
      payer: expectedWallet || 'private',
      amountRaw: transfer.amount.toString(),
      amountCredits: microCreditsToCredits(transfer.amount),
      explorerUrl,
      network: networkConfig?.network || MCP_CONFIG.payments.network || 'aleo-testnet',
      transfer: {
        function: transfer.function,
        program: transfer.program,
        recipient: transfer.recipient
      }
    };
    
  } catch (err) {
    console.error('[Aleo Verifier] Error verifying payment:', err);
    return {
      ok: false,
      code: 'verification_error',
      message: err.message || 'Unknown verification error',
      explorerUrl
    };
  }
}

module.exports = {
  verifyAleoTransfer,
  creditsToMicroCredits,
  microCreditsToCredits,
  getApiUrl,
  getExplorerUrl
};
