const path = require('path');

// 网络配置映射 - Aleo Testnet Only
const NETWORK_CONFIGS = {
  'aleo-testnet': {
    network: 'aleo-testnet',
    // Provable Explorer 是 Aleo 官方推荐的区块浏览器
    explorerBaseUrl: 'https://testnet.explorer.provable.com/transaction',
    rpcUrl: 'https://api.explorer.aleo.org/v1/testnet3',
    tokenType: 'native',
    decimals: 6  // Aleo Credits: 1 Credit = 1,000,000 microcredits
  }
};

// 默认网络
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'aleo-testnet';

const MCP_CONFIG = {
  payments: {
    network: DEFAULT_NETWORK,
    // 对于 Aleo，使用原生 Credits 作为支付币
    tokenType: NETWORK_CONFIGS[DEFAULT_NETWORK]?.tokenType || 'native',
    // 收款地址 - Aleo 地址
    recipient:
      process.env.ALEO_RECIPIENT ||
      'aleo1ultapnts8mjyfv5qq8qs88d55p9c60dme6h0e5zgcwdd7fyl5cpscgjwl2',
    paymentUrl: process.env.ALEO_PAYMENT_URL || null,
    explorerBaseUrl:
      NETWORK_CONFIGS[DEFAULT_NETWORK]?.explorerBaseUrl ||
      'https://explorer.aleo.org/transaction',
    rpcUrl:
      NETWORK_CONFIGS[DEFAULT_NETWORK]?.rpcUrl ||
      'https://api.explorer.aleo.org/v1/testnet3',
    // Aleo Credits 使用 6 位精度 (microcredits)
    decimals: Number(
      process.env.ALEO_DECIMALS ||
        NETWORK_CONFIGS[DEFAULT_NETWORK]?.decimals ||
        6
    ),
    expiresInSeconds: Number(process.env.ALEO_EXPIRES_SECONDS || 300)
  },
  billing: {
    storeFile: path.join(__dirname, '..', '..', 'data', 'billing-entries.json')
  },
  autoRouter: {
    defaultMaxCandidates: 3
  }
};

// 根据请求头获取网络配置
function getNetworkConfigFromRequest(req) {
  const networkHeader =
    req.headers['x-aleo-network'] ||
    req.body?.network ||
    DEFAULT_NETWORK;
  const networkKey = networkHeader || DEFAULT_NETWORK;
  const config = NETWORK_CONFIGS[networkKey] || NETWORK_CONFIGS[DEFAULT_NETWORK];
  return {
    ...MCP_CONFIG.payments,
    network: config.network,
    explorerBaseUrl: config.explorerBaseUrl,
    rpcUrl: config.rpcUrl,
    decimals: config.decimals ?? MCP_CONFIG.payments.decimals,
    tokenType: config.tokenType || MCP_CONFIG.payments.tokenType
  };
}

module.exports = { MCP_CONFIG, getNetworkConfigFromRequest, NETWORK_CONFIGS };
