(function () {
  const MCP_NAMESPACE = 'mcp';
  const DEFAULT_BASE_URL = 'http://localhost:3000';
  const CONFIGURED_BASE_URL =
    (window.APP_CONFIG && (window.APP_CONFIG.mcpBaseUrl || window.APP_CONFIG?.mcp?.baseUrl)) ||
    DEFAULT_BASE_URL;
  const MCP_BASE_URL = CONFIGURED_BASE_URL.replace(/\/$/, '');
  const APP_SETTINGS = window.APP_CONFIG || {};
  const SOLANA_SETTINGS = APP_SETTINGS.solana || {};
  const DEFAULT_SOLANA_RPC = SOLANA_SETTINGS.rpcEndpoint || 'https://mainnet.helius-rpc.com/?api-key=fd6a5779-892d-47eb-a88b-bc961ca4b606';
  const DEFAULT_SOLANA_DECIMALS = Number(SOLANA_SETTINGS.usdcDecimals || 6);
  const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96SFy5gQvt2apZKvEXsPQQMwM8g';

  let cachedWeb3 = null;
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

  function detectPhantomProvider() {
    if (window.walletManager?.solana) {
      return window.walletManager.solana;
    }
    if (window.solana?.isPhantom) {
      return window.solana;
    }
    if (window.phantom?.solana?.isPhantom) {
      return window.phantom.solana;
    }
    return null;
  }

  function detectWalletAddress() {
    const provider = detectPhantomProvider();
    if (provider?.publicKey?.toBase58) {
      return provider.publicKey.toBase58();
    }
    if (provider?.publicKey?.toString) {
      return provider.publicKey.toString();
    }
    if (window.walletManager?.walletAddress) {
      return window.walletManager.walletAddress;
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

  async function ensurePhantomConnected() {
    const provider = detectPhantomProvider();
    if (!provider) {
      throw new Error('Phantom wallet not detected. Please install or enable the extension.');
    }
    if (!provider.publicKey) {
      const response = await provider.connect();
      const connectedKey = response?.publicKey || provider.publicKey;
      if (!connectedKey) {
        throw new Error('Wallet connection did not return a public key.');
      }
    }
    const address =
      provider.publicKey?.toBase58?.() ||
      provider.publicKey?.toString?.() ||
      null;
    if (!address) {
      throw new Error('Unable to resolve connected wallet address.');
    }
    return { provider, address };
  }

  async function loadSolanaWeb3() {
    if (cachedWeb3) return cachedWeb3;
    const sources = [
      'https://unpkg.com/@solana/web3.js@1.95.3/lib/index.browser.esm.js',
      'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.browser.esm.js',
      'https://esm.sh/@solana/web3.js@1.95.3?bundle'
    ];
    let lastError = null;
    for (const src of sources) {
      try {
        cachedWeb3 = await import(/* @vite-ignore */ src);
        return cachedWeb3;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Failed to load @solana/web3.js');
  }

  function amountToBaseUnits(amount, decimals = DEFAULT_SOLANA_DECIMALS) {
    const fixed = Number(amount).toFixed(decimals);
    const [whole, fraction = ''] = fixed.split('.');
    const digits = `${whole}${fraction}`.replace(/^(-?)0+(?=\d)/, '$1');
    if (!/^-?\d+$/.test(digits)) {
      throw new Error(`Invalid amount "${amount}"`);
    }
    return BigInt(digits);
  }

  function toLittleEndianBytes(value, byteCount) {
    let n = BigInt(value);
    const bytes = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i += 1) {
      bytes[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return bytes;
  }

  function getAssociatedTokenAddressSync(mint, owner, web3, ids) {
    const seeds = [
      owner.toBuffer(),
      ids.TOKEN_PROGRAM_ID_BYTES,
      mint.toBuffer()
    ];
    return web3.PublicKey.findProgramAddressSync(seeds, ids.ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  }

  function createAssociatedTokenAccountInstruction(payer, ata, owner, mint, web3, ids) {
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ids.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ids.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ];
    return new web3.TransactionInstruction({
      programId: ids.ASSOCIATED_TOKEN_PROGRAM_ID,
      keys,
      data: Uint8Array.of(0)
    });
  }

  function createTransferInstruction(source, destination, owner, amountRaw, web3, ids) {
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer instruction discriminator
    data.set(toLittleEndianBytes(amountRaw, 8), 1);
    const keys = [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ];
    return new web3.TransactionInstruction({
      programId: ids.TOKEN_PROGRAM_ID,
      keys,
      data
    });
  }

  let PROGRAM_IDS = null;

  function ensureProgramIds(web3) {
    if (PROGRAM_IDS) return PROGRAM_IDS;
    const tokenProgram = new web3.PublicKey(
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    );
    const associatedProgram = new web3.PublicKey(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );
    const sysvarRent = new web3.PublicKey(
      'SysvarRent111111111111111111111111111111111'
    );
    PROGRAM_IDS = {
      TOKEN_PROGRAM_ID: tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID: associatedProgram,
      SYSVAR_RENT_PUBKEY: sysvarRent,
      TOKEN_PROGRAM_ID_BYTES: tokenProgram.toBuffer()
    };
    return PROGRAM_IDS;
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
        #mcp-status-panel { position: fixed; right: 24px; bottom: 24px; width: 320px; max-height: 50vh; overflow-y: auto; background: rgba(17, 24, 39, 0.92); color: #fff; border-radius: 16px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.45); padding: 18px 20px; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.45; z-index: 99999; display: none; }
        #mcp-status-panel.show { display: block; }
        #mcp-status-panel h4 { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
        #mcp-status-panel .mcp-close { position: absolute; top: 12px; right: 14px; cursor: pointer; border: none; background: transparent; color: rgba(255,255,255,0.6); font-size: 14px; }
        #mcp-status-panel .mcp-close:hover { color: #fff; }
        #mcp-status-panel .mcp-log { margin: 0; padding: 0; list-style: none; }
        #mcp-status-panel .mcp-log li { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
        #mcp-status-panel .mcp-log li:last-child { border-bottom: none; }
        #mcp-status-panel .mcp-pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 600; letter-spacing: 0.2px; }
        #mcp-status-panel .pill-invoice { background: rgba(59, 130, 246, 0.18); color: #bfdbfe; }
        #mcp-status-panel .pill-pay { background: rgba(16, 185, 129, 0.18); color: #bbf7d0; }
        #mcp-status-panel .pill-result { background: rgba(244, 114, 182, 0.18); color: #fbcfe8; }
        #mcp-status-panel .pill-cancel { background: rgba(248, 113, 113, 0.18); color: #fecaca; }
        #mcp-status-panel .mcp-log small { display: block; margin-top: 3px; color: rgba(255,255,255,0.65); }
      </style>
      <button class="mcp-close" aria-label="Close">✕</button>
      <h4>402 Payment Progress</h4>
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
    
    if (meta.amount) lines.push(`Amount: ${meta.amount} USDC`);
    if (meta.memo) lines.push(`Memo: ${meta.memo}`);
    if (meta.tx) {
      // 根据当前选择的网络生成正确的交易链接
      let explorer = meta.explorer;
      if (!explorer) {
        try {
          const networkRaw = localStorage.getItem('i3_preferred_network');
          if (networkRaw) {
            const networkData = JSON.parse(networkRaw);
            if (networkData && networkData.key) {
              const isMainnet = networkData.key === 'solana-mainnet';
              explorer = isMainnet
                ? `https://explorer.solana.com/tx/${encodeURIComponent(meta.tx)}`
                : `https://explorer.solana.com/tx/${encodeURIComponent(meta.tx)}?cluster=devnet`;
            } else {
              // 默认使用 Mainnet
              explorer = `https://explorer.solana.com/tx/${encodeURIComponent(meta.tx)}`;
            }
          } else {
            // 默认使用 Mainnet
            explorer = `https://explorer.solana.com/tx/${encodeURIComponent(meta.tx)}`;
          }
        } catch (e) {
          // 如果读取失败，默认使用 Mainnet
          explorer = `https://explorer.solana.com/tx/${encodeURIComponent(meta.tx)}`;
        }
      }
      const short = `${meta.tx.slice(0, 4)}…${meta.tx.slice(-4)}`;
      lines.push(
        `Tx: <a href="${explorer}" target="_blank" rel="noopener noreferrer">${short}</a>`
      );
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
      console.log('[MCPClient] settleInvoice start', invoice);
      console.log('[MCPClient] Invoice details:', {
        network: invoice.network,
        mint: invoice.mint,
        rpc_endpoint: invoice.rpc_endpoint,
        amount_usdc: invoice.amount_usdc
      });
      
      // 检查选择的网络
      try {
        const networkRaw = localStorage.getItem('i3_preferred_network');
        if (networkRaw) {
          const networkData = JSON.parse(networkRaw);
          console.log('[MCPClient] Selected network from localStorage:', networkData);
        }
      } catch (e) {
        console.warn('[MCPClient] Failed to read network from localStorage:', e);
      }
      
      const { provider, address } = await ensurePhantomConnected();
      
      // 记录网络信息（不显示提示，因为用户已经连接）
      try {
        const networkRaw = localStorage.getItem('i3_preferred_network');
        if (networkRaw) {
          const networkData = JSON.parse(networkRaw);
          if (networkData && networkData.key) {
            const isMainnet = networkData.key === 'solana-mainnet';
            const networkName = isMainnet ? 'Mainnet' : 'Devnet';
            console.log(`[MCPClient] Payment will be processed on ${networkName}`);
          }
        }
      } catch (e) {
        console.warn('[MCPClient] Failed to check network:', e);
      }
      
      const web3 = await loadSolanaWeb3();
      const {
        Connection,
        PublicKey,
        Transaction,
        MemoProgram,
        TransactionInstruction
      } = web3;

      const ids = ensureProgramIds(web3);

      // 使用 Helius RPC 端点（私有 API，不受 rate limiting 影响）
      const HELIUS_MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=fd6a5779-892d-47eb-a88b-bc961ca4b606';
      const MAINNET_RPC_ENDPOINTS = [
        HELIUS_MAINNET_RPC
      ];
      console.log('[MCPClient] Using Helius RPC for Mainnet:', HELIUS_MAINNET_RPC);
      
      const DEVNET_RPC_ENDPOINTS = [
        'https://api.devnet.solana.com'
      ];
      
      // RPC 请求超时时间（毫秒）
      const RPC_TIMEOUT = 10000; // 10 秒
      
      // 优先使用选择的网络配置，然后使用发票中的 RPC 端点，最后使用默认值
      let rpcEndpoint = invoice.rpc_endpoint || DEFAULT_SOLANA_RPC;
      let selectedNetwork = null;
      let rpcEndpoints = MAINNET_RPC_ENDPOINTS; // 默认 mainnet
      
      try {
        const networkRaw = localStorage.getItem('i3_preferred_network');
        if (networkRaw) {
          const networkData = JSON.parse(networkRaw);
          if (networkData && networkData.key) {
            selectedNetwork = networkData.key;
            // 根据选择的网络获取 RPC 端点列表
            if (networkData.key === 'solana-mainnet') {
              rpcEndpoints = MAINNET_RPC_ENDPOINTS;
              rpcEndpoint = MAINNET_RPC_ENDPOINTS[0];
            } else {
              rpcEndpoints = DEVNET_RPC_ENDPOINTS;
              rpcEndpoint = DEVNET_RPC_ENDPOINTS[0];
            }
            console.log('[MCPClient] Using network-specific RPC:', rpcEndpoint, 'for network:', networkData.key);
          }
        }
      } catch (e) {
        console.warn('[MCPClient] Failed to read network from localStorage, using invoice RPC:', e);
      }
      
      // 验证网络匹配
      const invoiceNetwork = invoice.network || '';
      if (selectedNetwork && invoiceNetwork) {
        const invoiceIsMainnet = invoiceNetwork.includes('mainnet') || invoiceNetwork === 'mainnet-beta';
        const selectedIsMainnet = selectedNetwork === 'solana-mainnet';
        if (invoiceIsMainnet !== selectedIsMainnet) {
          console.warn('[MCPClient] Network mismatch:', {
            selected: selectedNetwork,
            invoice: invoiceNetwork,
            'invoice.rpc_endpoint': invoice.rpc_endpoint
          });
        }
      }

      const payerPubkey = new PublicKey(address);
      const recipientRaw = (invoice.recipient ?? '').toString().trim();
      let mintRaw = (invoice.mint ?? '').toString().trim();
      
      // 验证并修正 mint 地址（确保使用正确的网络）
      try {
        const networkRaw = localStorage.getItem('i3_preferred_network');
        if (networkRaw) {
          const networkData = JSON.parse(networkRaw);
          if (networkData && networkData.key) {
            const isMainnet = networkData.key === 'solana-mainnet';
            const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
            const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
            
            const expectedMint = isMainnet ? MAINNET_USDC_MINT : DEVNET_USDC_MINT;
            const networkName = isMainnet ? 'Mainnet' : 'Devnet';
            
            if (mintRaw && mintRaw !== expectedMint) {
              console.warn(`[MCPClient] Invoice mint (${mintRaw}) doesn't match selected network (${networkName}). Using ${expectedMint} instead.`);
              mintRaw = expectedMint;
            } else if (!mintRaw) {
              console.log(`[MCPClient] Invoice missing mint, using ${networkName} mint: ${expectedMint}`);
              mintRaw = expectedMint;
            }
            
            console.log(`[MCPClient] Using ${networkName} USDC mint:`, mintRaw);
          }
        }
      } catch (e) {
        console.warn('[MCPClient] Failed to verify mint address:', e);
      }
      
      console.log('[MCPClient] invoice addresses', { recipientRaw, mintRaw, invoiceNetwork: invoice.network });
      if (!recipientRaw) {
        throw new Error('Invoice missing recipient address.');
      }
      if (!mintRaw) {
        throw new Error('Invoice missing mint address.');
      }
      const recipientPubkey = new PublicKey(recipientRaw);
      const mintPubkey = new PublicKey(mintRaw);
      const decimals = Number(invoice.decimals ?? DEFAULT_SOLANA_DECIMALS);
      const amountRaw = amountToBaseUnits(invoice.amount_usdc, decimals);

      const payerAta = getAssociatedTokenAddressSync(mintPubkey, payerPubkey, web3, ids);

      // 超时包装函数
      function withTimeout(promise, timeoutMs, errorMessage) {
        return Promise.race([
          promise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(errorMessage || `Request timeout after ${timeoutMs}ms`)), timeoutMs)
          )
        ]);
      }

      // 尝试多个 RPC 端点（处理 rate limiting）
      let payerAccountInfo = null;
      let lastError = null;
      let allRpcFailed = false;
      const networkName = selectedNetwork === 'solana-mainnet' ? 'Mainnet' : 'Devnet';
      
      for (let i = 0; i < rpcEndpoints.length; i++) {
        const currentRpc = rpcEndpoints[i];
        try {
          console.log(`[MCPClient] Trying RPC endpoint ${i + 1}/${rpcEndpoints.length}:`, currentRpc);
          const connection = new Connection(currentRpc, 'confirmed');
          
          // 先检查余额（更轻量的操作），带超时
          try {
            const balance = await withTimeout(
              connection.getBalance(payerPubkey),
              RPC_TIMEOUT,
              `Balance check timeout on ${currentRpc}`
            );
            console.log(`[MCPClient] Wallet balance on ${networkName}:`, balance / 1e9, 'SOL');
            
            if (balance === 0) {
              throw new Error(
                `Your wallet has no SOL on ${networkName}. ` +
                `Please switch to the network where you have SOL, or add SOL to your ${networkName} wallet. ` +
                `Current network: ${networkName}`
              );
            }
          } catch (balanceError) {
            const errorMsg = balanceError?.message || String(balanceError);
            if (errorMsg.includes('SOL') || errorMsg.includes('network')) {
              throw balanceError;
            }
            // 如果是 403 错误，直接跳过所有 RPC 检查
            if (errorMsg.includes('403') || errorMsg.includes('Access forbidden')) {
              console.warn(`[MCPClient] RPC endpoint blocked (403) during balance check. Skipping verification.`);
              allRpcFailed = true;
              rpcEndpoint = rpcEndpoints[0] || invoice.rpc_endpoint || DEFAULT_SOLANA_RPC;
              break;
            }
            // 如果是超时或连接错误，继续尝试下一个端点
            if (errorMsg.includes('timeout') || errorMsg.includes('Failed to fetch') || errorMsg.includes('CONNECTION')) {
              console.warn(`[MCPClient] Balance check failed (${errorMsg}), trying next endpoint...`);
              continue;
            }
            // 如果余额检查失败但不是账户问题，继续尝试获取账户信息
            console.warn('[MCPClient] Balance check failed, but continuing:', errorMsg);
          }
          
          // 获取账户信息，带超时
          payerAccountInfo = await withTimeout(
            connection.getAccountInfo(payerAta),
            RPC_TIMEOUT,
            `Account info timeout on ${currentRpc}`
          );
          
          // 如果成功，更新 rpcEndpoint 用于后续操作
          rpcEndpoint = currentRpc;
          console.log(`[MCPClient] Successfully connected to RPC:`, currentRpc);
          break;
        } catch (rpcError) {
          const errorMsg = rpcError?.message || String(rpcError);
          lastError = rpcError;
          
          // 如果是超时、连接错误、403 错误且还有备用端点，继续尝试
          const isRetryableError = 
            errorMsg.includes('403') || 
            errorMsg.includes('Access forbidden') ||
            errorMsg.includes('timeout') ||
            errorMsg.includes('Failed to fetch') ||
            errorMsg.includes('CONNECTION') ||
            errorMsg.includes('ERR_CONNECTION');
            
          if (isRetryableError && i < rpcEndpoints.length - 1) {
            console.warn(`[MCPClient] RPC endpoint ${i + 1} failed (${errorMsg}), trying next endpoint...`);
            continue;
          }
          
          // 如果是最后一个端点或非可重试错误，检查是否是账户问题
          if (errorMsg.includes('403') || errorMsg.includes('Access forbidden')) {
            // 所有公共端点都失败了，但不抛出错误，而是跳过 RPC 检查
            // Phantom 钱包会使用自己的 RPC 连接来处理交易
            console.warn(`[MCPClient] All public RPC endpoints failed with 403 (likely IP blocked or rate limited).`);
            console.warn(`[MCPClient] Skipping account verification. Phantom wallet will handle validation using its own RPC.`);
            // 不抛出错误，让代码继续执行，构建交易
            allRpcFailed = true;
            rpcEndpoint = rpcEndpoints[0] || invoice.rpc_endpoint || DEFAULT_SOLANA_RPC;
            break; // 退出循环，继续构建交易
          }
          
          // 如果是超时错误且所有端点都尝试过了
          if (errorMsg.includes('timeout') && i === rpcEndpoints.length - 1) {
            throw new Error(
              `All RPC endpoints timed out on ${networkName}. ` +
              `Please check your network connection or try again later.`
            );
          }
          
          // 其他错误直接抛出
          throw rpcError;
        }
      }
      
      // 如果无法获取账户信息（RPC 失败），仍然尝试构建交易
      // Phantom 钱包在发送交易时会验证账户，所以如果账户不存在，Phantom 会拒绝
      if (!payerAccountInfo) {
        // 如果所有 RPC 都失败（403 被屏蔽），直接跳过验证，让 Phantom 处理
        if (allRpcFailed) {
          console.warn('[MCPClient] All RPC endpoints failed (403 blocked). Skipping account verification.');
          console.warn('[MCPClient] Phantom wallet will handle all validation using its own RPC connection.');
          // 确保有默认 RPC 端点
          if (!rpcEndpoint) {
            rpcEndpoint = rpcEndpoints[0] || invoice.rpc_endpoint || DEFAULT_SOLANA_RPC;
          }
        } else if (lastError) {
          const errorMsg = lastError?.message || String(lastError);
          // 如果是明确的账户问题（不是 RPC 问题），抛出错误
          if (errorMsg.includes('USDC') && !errorMsg.includes('403') && !errorMsg.includes('rate-limited')) {
            throw lastError;
          }
          // 如果是 RPC 问题，继续尝试构建交易（让 Phantom 验证）
          if (errorMsg.includes('403') || errorMsg.includes('rate-limited') || errorMsg.includes('timeout')) {
            console.warn('[MCPClient] RPC failed, but continuing to build transaction. Phantom will validate the account.');
            // 使用第一个 RPC 端点作为默认值（即使可能失败，Phantom 会使用自己的 RPC）
            if (!rpcEndpoint || rpcEndpoints.length > 0) {
              rpcEndpoint = rpcEndpoints[0] || invoice.rpc_endpoint || DEFAULT_SOLANA_RPC;
            }
          } else {
            throw new Error('USDC associated token account not found in wallet. Please ensure you have USDC on this network.');
          }
        } else {
          throw new Error('USDC associated token account not found in wallet. Please ensure you have USDC on this network.');
        }
      }
      
      // 如果所有 RPC 都失败，显示友好提示
      if (allRpcFailed) {
        console.log('%cℹ️ RPC endpoints are blocked, but Phantom wallet will handle the transaction', 
          'color: orange; font-weight: bold; font-size: 14px;');
        if (typeof showNotification === 'function') {
          showNotification(
            'Public RPC endpoints are temporarily unavailable. Phantom wallet will handle the transaction using its own RPC connection. Please confirm the transaction in your Phantom wallet.',
            'info',
            8000
          );
        }
      }
      
      // 创建最终连接（使用成功的 RPC 端点，或默认端点）
      const connection = new Connection(rpcEndpoint, 'confirmed');

      const recipientAta = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey, web3, ids);

      const tx = new Transaction();

      // 检查接收方账户是否存在
      // 注意：如果 RPC 失败，我们仍然需要添加创建指令，因为 Solana 要求接收方必须有关联 token 账户
      // 如果账户已存在，创建指令会被忽略，不会导致错误
      let recipientAccountInfo = null;
      try {
        recipientAccountInfo = await withTimeout(
          connection.getAccountInfo(recipientAta),
          RPC_TIMEOUT,
          `Recipient account check timeout`
        );
      } catch (recipientError) {
        const errorMsg = recipientError?.message || String(recipientError);
        // 如果是 403 错误，无法检查账户，但我们仍然可以尝试创建（如果已存在会被忽略）
        if (errorMsg.includes('403') || errorMsg.includes('Access forbidden')) {
          console.warn('[MCPClient] RPC blocked (403) during recipient account check. Will attempt to create account if needed.');
          recipientAccountInfo = null;
        } else {
          console.warn('[MCPClient] Failed to check recipient account, will attempt to create if needed:', errorMsg);
          recipientAccountInfo = null;
        }
      }
      
      // 如果账户不存在，添加创建指令（如果已存在，指令会被忽略）
      if (!recipientAccountInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            payerPubkey,
            recipientAta,
            recipientPubkey,
            mintPubkey,
            web3,
            ids
          )
        );
      }

      tx.add(
        createTransferInstruction(
          payerAta,
          recipientAta,
          payerPubkey,
          amountRaw,
          web3,
          ids
        )
      );

      if (invoice.memo) {
        console.warn('[MCPClient] memo instruction skipped (frontend helper unavailable)');
      }

      tx.feePayer = payerPubkey;
      
      // 获取最新的 blockhash（如果 RPC 失败，Phantom 会自己处理）
      let blockhash = null;
      let lastValidBlockHeight = null;
      try {
        const blockhashResult = await withTimeout(
          connection.getLatestBlockhash('finalized'),
          RPC_TIMEOUT,
          'Blockhash fetch timeout'
        );
        blockhash = blockhashResult.blockhash;
        lastValidBlockHeight = blockhashResult.lastValidBlockHeight;
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      } catch (blockhashError) {
        const errorMsg = blockhashError?.message || String(blockhashError);
        if (errorMsg.includes('403') || errorMsg.includes('Access forbidden')) {
          console.warn('[MCPClient] RPC blocked (403) when getting blockhash. Phantom will handle it.');
        } else {
          console.warn('[MCPClient] Failed to get blockhash from RPC, Phantom will handle it:', errorMsg);
        }
        // 不设置 blockhash，让 Phantom 钱包自己处理
        // Phantom 在发送交易时会自动获取最新的 blockhash
      }

      // 最终网络验证和提示
      try {
        const networkRaw = localStorage.getItem('i3_preferred_network');
        if (networkRaw) {
          const networkData = JSON.parse(networkRaw);
          if (networkData && networkData.key) {
            const isMainnet = networkData.key === 'solana-mainnet';
            const networkName = isMainnet ? 'Mainnet' : 'Devnet';
            console.log(`[MCPClient] Sending transaction on ${networkName} with mint: ${mintRaw}`);
            console.log(`[MCPClient] RPC endpoint: ${rpcEndpoint}`);
            
            // 在控制台显示网络信息
            console.log(`%c📡 Transaction on ${networkName}`, 
              'color: green; font-weight: bold; font-size: 14px;');
            console.log(`%cMint: ${mintRaw}`, 'color: blue;');
            console.log(`%cRPC: ${rpcEndpoint}`, 'color: blue;');
          }
        }
      } catch (e) {
        console.warn('[MCPClient] Failed to log network info:', e);
      }

      // 如果 blockhash 获取失败，使用 Phantom 的 signAndSendTransaction（它会自动处理 blockhash）
      // 不能使用 signTransaction，因为它需要 blockhash 来序列化交易
      let signature;
      if (!blockhash) {
        // 没有 blockhash，使用 Phantom 的 signAndSendTransaction（自动处理 blockhash）
        if (typeof provider.signAndSendTransaction === 'function') {
          console.log('[MCPClient] Using Phantom signAndSendTransaction (auto-handles blockhash)');
          try {
            const result = await provider.signAndSendTransaction(tx, {
              skipPreflight: false,
              preflightCommitment: 'processed'
            });
            signature = result?.signature || result;
          } catch (sendErr) {
            const errorMsg = sendErr?.message || String(sendErr);
            if (errorMsg.includes('user rejected') || errorMsg.includes('User rejected')) {
              logStatus('cancel', 'User cancelled wallet payment', {
                amount: invoice.amount_usdc,
                memo: invoice.memo
              });
              return null;
            }
            throw new Error(`Failed to send transaction: ${errorMsg}. Please ensure your Phantom wallet is connected and has sufficient balance.`);
          }
        } else if (typeof provider.sendTransaction === 'function') {
          console.log('[MCPClient] Using Phantom sendTransaction (auto-handles blockhash)');
          try {
            signature = await provider.sendTransaction(tx, connection, { skipPreflight: false });
          } catch (sendErr) {
            const errorMsg = sendErr?.message || String(sendErr);
            if (errorMsg.includes('user rejected') || errorMsg.includes('User rejected')) {
              logStatus('cancel', 'User cancelled wallet payment', {
                amount: invoice.amount_usdc,
                memo: invoice.memo
              });
              return null;
            }
            throw new Error(`Failed to send transaction: ${errorMsg}. Please ensure your Phantom wallet is connected and has sufficient balance.`);
          }
        } else {
          throw new Error('Cannot send transaction: blockhash is required but RPC endpoints are unavailable, and Phantom wallet does not support signAndSendTransaction. Please try again later or use a custom RPC endpoint.');
        }
      } else {
        // 有 blockhash，可以使用两种方法
        try {
          if (typeof provider.signAndSendTransaction === 'function') {
            const result = await provider.signAndSendTransaction(tx, {
              skipPreflight: false,
              preflightCommitment: 'processed'
            });
            signature = result?.signature || result;
          } else if (typeof provider.sendTransaction === 'function') {
          signature = await provider.sendTransaction(tx, connection, { skipPreflight: false });
        } else {
          const signed = await provider.signTransaction(tx);
          signature = await connection.sendRawTransaction(signed.serialize());
        }
      } catch (sendErr) {
          const errorMsg = sendErr?.message || String(sendErr);
          if (errorMsg.includes('user rejected') || errorMsg.includes('User rejected')) {
            logStatus('cancel', 'User cancelled wallet payment', {
              amount: invoice.amount_usdc,
              memo: invoice.memo
            });
            return null;
          }
        console.error('[MCPClient] Phantom send failed, falling back to raw send', sendErr);
          try {
        const signed = await provider.signTransaction(tx);
        signature = await connection.sendRawTransaction(signed.serialize());
          } catch (fallbackErr) {
            throw new Error(`Failed to send transaction: ${fallbackErr?.message || String(fallbackErr)}`);
          }
        }
      }

      // 尝试确认交易（如果 RPC 失败，跳过确认，Phantom 已经处理了）
      try {
        if (blockhash && lastValidBlockHeight) {
          await withTimeout(
            connection.confirmTransaction(
        {
          blockhash,
          lastValidBlockHeight,
          signature
        },
        'confirmed'
            ),
            RPC_TIMEOUT,
            'Transaction confirmation timeout'
          );
          console.log('[MCPClient] Transaction confirmed on-chain');
        } else {
          console.warn('[MCPClient] Skipping transaction confirmation (blockhash not available). Phantom has already processed the transaction.');
        }
      } catch (confirmError) {
        console.warn('[MCPClient] Failed to confirm transaction via RPC, but Phantom has already sent it:', confirmError.message);
        // 继续执行，因为 Phantom 已经发送了交易
      }

      logStatus('payment', 'Payment settled on Solana. Retrying request…', {
      amount: invoice.amount_usdc,
      memo: invoice.memo,
        tx: signature
      });
      emit('payment', { invoice, tx: signature });
      return signature;
    } catch (error) {
      console.error('[MCPClient] settleInvoice error', error);
      if (error?.logs) {
        console.error('[MCPClient] transaction logs', error.logs);
      }
      // 只有用户明确取消时才返回 null，其他所有错误都抛出
      if (error?.code === 4001 || /user rejected/i.test(String(error?.message || '').toLowerCase())) {
        logStatus('cancel', 'User cancelled wallet payment', {
          amount: invoice.amount_usdc,
          memo: invoice.memo
        });
        return null;
      }
      // 所有其他错误都抛出，阻止请求继续
      console.error('[MCPClient] payment error - throwing to prevent request continuation', error);
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
          baseHeaders['X-Solana-Network'] = network.key;
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
        if (invoice.status && invoice.status !== 'payment_required') {
          // 如果验证失败但提供了 explorerLink，说明交易可能已成功但 RPC 延迟
          // 在这种情况下，不显示错误，而是继续重试请求（后端应该会允许继续）
          if (invoice.status === 'payment_verification_failed' && 
              invoice.code === 'tx_not_found' && 
              invoice.details?.explorerLink) {
            console.warn('[MCPClient] Transaction not found on RPC, but explorer link is available. Retrying request without showing error...');
            console.warn('[MCPClient] Explorer link:', invoice.details.explorerLink);
            // 不显示错误，继续重试请求（后端应该会允许继续，因为我们已经修改了后端逻辑）
            // 等待一小段时间后重试，给 RPC 一些时间
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          // 检查错误消息中是否包含 "Transaction not found" 且提供了 explorerLink
          // 如果是，也不显示错误，而是继续重试
          const errorMessage = invoice.message || invoice.status || '';
          if (errorMessage.includes('Transaction not found') && invoice.details?.explorerLink) {
            console.warn('[MCPClient] Transaction not found on RPC, but explorer link is available. Retrying request without showing error...');
            console.warn('[MCPClient] Explorer link:', invoice.details.explorerLink);
            // 不显示错误，继续重试请求
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
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
        
        // 检查 Explorer URL 是否有效（排除本地 ID - UUID 格式）
        const isValidExplorerUrl = explorerUrl && !explorerUrl.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        
        if (isValidExplorerUrl) {
          showExplorerToast({
            url: explorerUrl,
            title: 'On-chain Transaction',
            subtitle: 'Click to view on Explorer.'
          });
        } else if (explorerUrl) {
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
