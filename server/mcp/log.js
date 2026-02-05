const crypto = require('crypto');

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

const LOG_DEBUG = envFlag('MCP_DEBUG', false);

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function redactToken(token) {
  if (!token) return token;
  const t = String(token);
  if (t.length <= 12) return `${t.slice(0, 2)}…${t.slice(-2)}`;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function redactTx(tx) {
  if (!tx) return tx;
  const t = String(tx);
  // Aleo tx ids are typically at1..., Leo local ids are UUID-like.
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

function redactUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(String(url));
    // Drop query + path to avoid leaking tx ids embedded in URLs
    return `${u.protocol}//${u.host}${u.pathname.split('/').slice(0, 2).join('/') || '/'}`;
  } catch (_) {
    return '[redacted-url]';
  }
}

function redactPaymentHeader(header) {
  if (!header) return header;
  const h = String(header);
  // Best-effort: keep scheme, redact tx and nonce-like fields.
  return h
    .replace(/tx=([^;,\s]+)/gi, (m, v) => `tx=${redactTx(v)}`)
    .replace(/nonce=([^;,\s]+)/gi, () => `nonce=[redacted]`)
    .replace(/memo=([^;,\s]+)/gi, () => `memo=[redacted]`)
    .replace(/amount=([^;,\s]+)/gi, (m, v) => `amount=${v}`); // amount is less sensitive than identifiers
}

function debug(...args) {
  if (!LOG_DEBUG) return;
  console.log(...args);
}

module.exports = {
  LOG_DEBUG,
  sha256,
  redactToken,
  redactTx,
  redactUrl,
  redactPaymentHeader,
  debug
};

