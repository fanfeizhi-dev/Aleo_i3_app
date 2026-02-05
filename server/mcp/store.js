const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes } = require('crypto');
const { MCP_CONFIG } = require('./config');
const { sha256, redactToken, debug } = require('./log');

const STORE_FILE = MCP_CONFIG.billing.storeFile;
const TOKENS_FILE = path.join(path.dirname(STORE_FILE), 'anonymous-tokens.json');

function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

const STORE_SENSITIVE =
  boolEnv('MCP_STORE_SENSITIVE', MCP_CONFIG?.billing?.storeSensitive ?? false);
const BILLING_RETENTION_DAYS =
  numEnv('MCP_BILLING_RETENTION_DAYS', MCP_CONFIG?.billing?.retentionDays ?? 30);
const TOKEN_EVENT_RETENTION_DAYS =
  numEnv(
    'MCP_TOKEN_EVENT_RETENTION_DAYS',
    MCP_CONFIG?.billing?.tokenEventRetentionDays ?? 30
  );

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
    // 启动时做一次轻量裁剪（只影响历史已完成/过期记录，不影响支付流程）
    return { entries: pruneEntries(data.entries) };
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
    const tokens = data.tokens || {};
    // 启动时裁剪历史事件（不会影响余额）
    pruneTokenEvents(tokens);
    return tokens;
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

function tokenKey(token) {
  return sha256(String(token));
}

function resolveTokenKey(token) {
  if (!token) return null;
  const raw = String(token);
  // 兼容历史：如果磁盘上还存的是明文 token key，则优先命中
  if (tokenCache[raw]) return raw;
  const hashed = tokenKey(raw);
  if (tokenCache[hashed]) return hashed;
  return hashed;
}

function maybeMigrateLegacyTokenKey(token) {
  const raw = String(token || '');
  if (!raw) return null;
  if (!tokenCache[raw]) return null;
  const hashed = tokenKey(raw);
  if (tokenCache[hashed]) {
    // 已存在 hashed，则删除 legacy raw
    delete tokenCache[raw];
    persistTokens(tokenCache);
    return hashed;
  }
  tokenCache[hashed] = tokenCache[raw];
  delete tokenCache[raw];
  persistTokens(tokenCache);
  debug('[token-store] migrated legacy token key', { token: redactToken(raw) });
  return hashed;
}

function pruneTokenEvents(tokens) {
  const days = Number(TOKEN_EVENT_RETENTION_DAYS || 0);
  if (!Number.isFinite(days) || days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(tokens || {})) {
    const t = tokens[k];
    if (!t) continue;
    if (Array.isArray(t.deposits)) {
      t.deposits = t.deposits.filter((d) => Date.parse(d?.timestamp || 0) >= cutoff);
    }
    if (Array.isArray(t.usage)) {
      t.usage = t.usage.filter((u) => Date.parse(u?.timestamp || 0) >= cutoff);
    }
  }
}

function sanitizeResultForStorage(result) {
  if (!result || typeof result !== 'object') return result;
  // 只保留最小统计字段
  return {
    status: result.status || 'ok',
    model: result.model || undefined,
    usage: result.usage || undefined,
    error: result.error || undefined,
    warning: result.warning || undefined
  };
}

function sanitizeMetaForStorage(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  if (STORE_SENSITIVE) return meta;
  const clean = { ...meta };
  // 内容类/身份类敏感字段
  delete clean.prompt;
  delete clean.wallet_address;
  // 结果去内容，仅保留统计
  if (clean.result && typeof clean.result === 'object') {
    clean.result = sanitizeResultForStorage(clean.result);
  }
  // 验证信息去可关联链接/地址
  if (clean.verification && typeof clean.verification === 'object') {
    clean.verification = {
      ok: !!clean.verification.ok,
      code: clean.verification.code || undefined,
      network: clean.verification.network || undefined
    };
  }
  // 其它可能含大块内容/外部原始数据
  delete clean.raw;
  return clean;
}

function sanitizeEntryForStorage(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (STORE_SENSITIVE) return entry;
  const clean = { ...entry };
  if (clean.meta) clean.meta = sanitizeMetaForStorage(clean.meta);
  return clean;
}

function pruneEntries(entries) {
  const days = Number(BILLING_RETENTION_DAYS || 0);
  if (!Number.isFinite(days) || days <= 0) return Array.isArray(entries) ? entries : [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const list = Array.isArray(entries) ? entries : [];
  // 仅裁剪历史“已终态”记录，避免影响正在进行的支付/工作流
  return list.filter((e) => {
    const status = e?.status;
    if (status === 'pending_payment' || status === 'paid') return true;
    const ts = Date.parse(e?.updated_at || e?.created_at || 0);
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoff;
  });
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
  const key = tokenKey(token);
  const now = new Date().toISOString();
  
  tokenCache[key] = {
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
    token: redactToken(token),
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
  // 如命中 legacy raw key，则迁移为 hashed key（并确保后续使用的是新 key）
  maybeMigrateLegacyTokenKey(token);
  const key = resolveTokenKey(token);
  if (!key || !tokenCache[key]) {
    return null;
  }
  
  const now = new Date().toISOString();
  tokenCache[key].balance += amount;
  tokenCache[key].updated_at = now;
  tokenCache[key].deposits.push({
    tx_id: txId,
    amount: amount,
    timestamp: now
  });
  
  persistTokens(tokenCache);
  
  return { balance: tokenCache[key].balance };
}

/**
 * 验证 token 并检查余额
 * @param {string} token 
 * @returns {Object|null} { valid, balance } 或 null
 */
function validateToken(token) {
  if (!token) return null;
  // 命中 legacy raw key 时，自动迁移（不改变客户端 token 形态）
  maybeMigrateLegacyTokenKey(token);
  const key = resolveTokenKey(token);
  if (!key || !tokenCache[key]) {
    return null;
  }
  
  return {
    valid: true,
    balance: tokenCache[key].balance,
    created_at: tokenCache[key].created_at
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
  maybeMigrateLegacyTokenKey(token);
  const key = resolveTokenKey(token);
  if (!key || !tokenCache[key]) return null;
  
  if (tokenCache[key].balance < amount) {
    return { success: false, error: 'insufficient_balance', balance: tokenCache[key].balance };
  }
  
  const now = new Date().toISOString();
  tokenCache[key].balance -= amount;
  tokenCache[key].updated_at = now;
  tokenCache[key].usage.push({
    amount: amount,
    timestamp: now,
    ...usageInfo
  });
  
  pruneTokenEvents(tokenCache);
  persistTokens(tokenCache);
  
  return { 
    success: true, 
    remaining: tokenCache[key].balance,
    deducted: amount
  };
}

/**
 * 获取 token 余额
 * @param {string} token 
 */
function getTokenBalance(token) {
  maybeMigrateLegacyTokenKey(token);
  const key = resolveTokenKey(token);
  if (!key || !tokenCache[key]) return null;
  return tokenCache[key].balance;
}

const state = loadState();
const byRequestId = new Map();
for (const entry of state.entries) {
  if (entry.request_id) {
    byRequestId.set(entry.request_id, entry);
  }
}

function persist() {
  // 落盘时执行去敏与保留策略（不影响内存中正在执行的流程）
  const pruned = pruneEntries(state.entries);
  // 如果发生裁剪，确保索引同步（避免通过 request_id 访问到已裁剪对象）
  if (pruned.length !== state.entries.length) {
    const alive = new Set(pruned.map((e) => e?.request_id).filter(Boolean));
    for (const key of byRequestId.keys()) {
      if (!alive.has(key)) byRequestId.delete(key);
    }
    state.entries = pruned;
  } else {
    state.entries = pruned;
  }
  const toWrite = {
    entries: state.entries.map((e) => sanitizeEntryForStorage(e))
  };
  fs.writeFileSync(STORE_FILE, JSON.stringify(toWrite, null, 2));
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
