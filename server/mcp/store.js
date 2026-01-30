const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes } = require('crypto');
const { MCP_CONFIG } = require('./config');

const STORE_FILE = MCP_CONFIG.billing.storeFile;
const TOKENS_FILE = path.join(path.dirname(STORE_FILE), 'anonymous-tokens.json');

function ensureStoreFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ entries: [] }, null, 2));
  }
}

function ensureTokensFile() {
  const dir = path.dirname(TOKENS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(TOKENS_FILE)) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({ tokens: {} }, null, 2));
  }
}

function loadState() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.entries)) {
      return { entries: [] };
    }
    return data;
  } catch (err) {
    console.warn('[billing-store] failed to load store, resetting', err);
    return { entries: [] };
  }
}

// ========== 匿名 Token 系统 ==========

function loadTokens() {
  ensureTokensFile();
  try {
    const raw = fs.readFileSync(TOKENS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return data.tokens || {};
  } catch (err) {
    console.warn('[token-store] failed to load tokens, resetting', err);
    return {};
  }
}

function persistTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify({ tokens }, null, 2));
}

// 内存中的 token 缓存
const tokenCache = loadTokens();

/**
 * 生成一个新的匿名访问 token
 * 不关联任何钱包地址，完全匿名
 */
function generateAnonymousToken() {
  // 生成一个随机的 32 字节 token
  const token = 'i3_' + randomBytes(24).toString('hex');
  return token;
}

/**
 * 创建匿名充值记录
 * @param {Object} params
 * @param {string} params.txId - 链上交易 ID
 * @param {number} params.amount - 充值金额 (ALEO)
 * @returns {Object} { token, balance }
 */
function createAnonymousDeposit({ txId, amount }) {
  const token = generateAnonymousToken();
  const now = new Date().toISOString();
  
  tokenCache[token] = {
    balance: amount,
    created_at: now,
    updated_at: now,
    deposits: [{
      tx_id: txId,
      amount: amount,
      timestamp: now
    }],
    usage: []
  };
  
  persistTokens(tokenCache);
  
  console.log('[token-store] Created anonymous token:', {
    token: token.slice(0, 12) + '...',
    balance: amount
  });
  
  return { token, balance: amount };
}

/**
 * 追加充值到已有 token
 * @param {string} token 
 * @param {string} txId 
 * @param {number} amount 
 */
function addDepositToToken(token, txId, amount) {
  if (!tokenCache[token]) {
    return null;
  }
  
  const now = new Date().toISOString();
  tokenCache[token].balance += amount;
  tokenCache[token].updated_at = now;
  tokenCache[token].deposits.push({
    tx_id: txId,
    amount: amount,
    timestamp: now
  });
  
  persistTokens(tokenCache);
  
  return { balance: tokenCache[token].balance };
}

/**
 * 验证 token 并检查余额
 * @param {string} token 
 * @returns {Object|null} { valid, balance } 或 null
 */
function validateToken(token) {
  if (!token || !tokenCache[token]) {
    return null;
  }
  
  return {
    valid: true,
    balance: tokenCache[token].balance,
    created_at: tokenCache[token].created_at
  };
}

/**
 * 从 token 扣减余额
 * @param {string} token 
 * @param {number} amount 
 * @param {Object} usageInfo - 使用信息 (model, request_id 等)
 * @returns {Object|null} { success, remaining } 或 null
 */
function deductFromToken(token, amount, usageInfo = {}) {
  if (!tokenCache[token]) {
    return null;
  }
  
  if (tokenCache[token].balance < amount) {
    return { success: false, error: 'insufficient_balance', balance: tokenCache[token].balance };
  }
  
  const now = new Date().toISOString();
  tokenCache[token].balance -= amount;
  tokenCache[token].updated_at = now;
  tokenCache[token].usage.push({
    amount: amount,
    timestamp: now,
    ...usageInfo
  });
  
  persistTokens(tokenCache);
  
  return { 
    success: true, 
    remaining: tokenCache[token].balance,
    deducted: amount
  };
}

/**
 * 获取 token 余额
 * @param {string} token 
 */
function getTokenBalance(token) {
  if (!tokenCache[token]) {
    return null;
  }
  return tokenCache[token].balance;
}

const state = loadState();
const byRequestId = new Map();
for (const entry of state.entries) {
  if (entry.request_id) {
    byRequestId.set(entry.request_id, entry);
  }
}

function persist() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2));
}

function createEntry(data) {
  const nowIso = new Date().toISOString();
  const entry = {
    id: randomUUID(),
    status: 'pending_payment',
    created_at: nowIso,
    updated_at: nowIso,
    meta: {},
    ...data
  };
  state.entries.push(entry);
  if (entry.request_id) {
    byRequestId.set(entry.request_id, entry);
  }
  persist();
  return entry;
}

function updateEntryByRequestId(requestId, patch) {
  if (!requestId) return null;
  const entry = byRequestId.get(requestId);
  if (!entry) return null;
  Object.assign(entry, patch, { updated_at: new Date().toISOString() });
  persist();
  return entry;
}

function getEntryByRequestId(requestId) {
  if (!requestId) return null;
  return byRequestId.get(requestId) || null;
}

function listEntriesByUser(userId) {
  return state.entries.filter((entry) => entry.user_id === userId);
}

function markEntryStatus(requestId, status, extras = {}) {
  return updateEntryByRequestId(requestId, {
    status,
    ...extras
  });
}

function createOrphanPayment(originalEntry, proof) {
  const orphan = createEntry({
    type: 'orphan_payment',
    request_id: randomUUID(),
    user_id: originalEntry?.user_id || 'unknown',
    amount_usdc: Number(proof.amount || 0),
    status: 'flagged_orphan',
    tx_signature: proof.tx,
    model_or_node: originalEntry?.model_or_node || null,
    tokens_or_calls: originalEntry?.tokens_or_calls || null,
    meta: {
      linked_request_id: originalEntry?.request_id || null,
      reason: 'duplicate_payment'
    }
  });
  return orphan;
}

module.exports = {
  createEntry,
  updateEntryByRequestId,
  getEntryByRequestId,
  listEntriesByUser,
  markEntryStatus,
  createOrphanPayment,
  // 匿名 Token 系统
  generateAnonymousToken,
  createAnonymousDeposit,
  addDepositToToken,
  validateToken,
  deductFromToken,
  getTokenBalance
};
