// Account Dropdown Module
// Provides: injectAccountDropdown(targetEl), toggleAccountDropdown()

(function(){
  const dropdownHtml = `
    <div class="account-dropdown">
      <button class="account-btn" onclick="toggleAccountDropdown()" id="accountBtn">
        <span id="accountBtnText">Login</span>
        <span id="paymentModeStatus" style="display:none;margin-left:8px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;align-items:center;gap:4px;cursor:help;"></span>
      </button>
      <div class="dropdown-content" id="accountDropdown">
        <div id="walletSection" style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <button id="connectWalletBtn" onclick="showWalletSelectionModal()" style="width:100%;padding:8px 12px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Connect Wallet</button>
          <div id="walletInfo" style="display:none;margin-top:8px;font-size:12px;color:#6b7280;"></div>
          <button id="enablePrivacyBtn" onclick="showEnablePrivacyModal()" style="display:none;width:100%;padding:8px 12px;margin-top:8px;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;">
            🔒 Enable Private Payments
          </button>
        </div>
        <a href="myassets.html" class="dropdown-item">
          <img src="svg/myasset.svg" alt="My Assets" 
          style="width:16px;height:16px;object-fit:contain;" />
          My Assets
        </a>
      </div>
    </div>`;

  function toggleAccountDropdown() {
    let dropdown = document.getElementById('accountDropdown');
    if (!dropdown) {
      try {
        const mount = document.querySelector('#accountDropdownMount');
        if (mount) {
          injectAccountDropdown(mount);
          dropdown = document.getElementById('accountDropdown');
        }
      } catch (_) {}
    }
    if (dropdown) dropdown.classList.toggle('show');
  }

  function injectAccountDropdown(targetEl){
    const container = (typeof targetEl === 'string') ? document.querySelector(targetEl) : targetEl;
    if (!container) return false;
    container.innerHTML = dropdownHtml;
    try { console.log('✅ Account dropdown injected'); } catch(_){}
    try { refreshWalletInfoUI(); } catch (_) {}
    return true;
  }

  // Global close handlers
  document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('accountDropdown');
    const accountBtn = document.querySelector('.account-btn');
    if (dropdown && accountBtn && !accountBtn.contains(event.target) && !dropdown.contains(event.target)) {
      dropdown.classList.remove('show');
    }
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      const dropdown = document.getElementById('accountDropdown');
      if (dropdown && dropdown.classList.contains('show')) dropdown.classList.remove('show');
    }
  });

  window.injectAccountDropdown = injectAccountDropdown;
  window.toggleAccountDropdown = toggleAccountDropdown;

  // ============ Wallet info (address + chainId) rendering ============
  function formatAddressShort(address){
    if (!address || typeof address !== 'string') return '';
    const trimmed = address.trim();
    if (trimmed.length <= 12) return trimmed;
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }

  async function getCurrentChainId(){
    try {
      if (window.ethereum && typeof window.ethereum.request === 'function') {
        const cid = await window.ethereum.request({ method: 'eth_chainId' });
        return cid || null;
      }
    } catch (_) {}
    return null;
  }

  async function refreshWalletInfoUI(){
    const infoEl = document.getElementById('walletInfo');
    const privacyBtn = document.getElementById('enablePrivacyBtn');
    if (!infoEl) return;
    const wm = window.walletManager;
    if (wm && wm.isConnected && wm.walletAddress) {
      const chainId = await getCurrentChainId();
      const shortAddr = formatAddressShort(wm.walletAddress);
      infoEl.style.display = 'block';
      
      // 如果是 Leo Wallet，显示详细信息
      if (wm.walletType === 'leo') {
        infoEl.innerHTML = '<div style="color:#374151;">Connected: ' + shortAddr + '</div>' +
          '<div style="margin-top:4px;font-size:11px;color:#059669;">🔒 Aleo Privacy Wallet</div>';
        
        if (privacyBtn) privacyBtn.style.display = 'block';
      } else {
        infoEl.textContent = 'Connected Wallet: ' + shortAddr;
        if (privacyBtn) privacyBtn.style.display = 'none';
      }
    } else {
      infoEl.style.display = 'none';
      infoEl.textContent = '';
      if (privacyBtn) privacyBtn.style.display = 'none';
    }
  }

  // 显示启用隐私支付的对话框
  function showEnablePrivacyModal() {
    // 关闭下拉菜单
    const dropdown = document.getElementById('accountDropdown');
    if (dropdown) dropdown.classList.remove('show');
    
    // 移除已存在的模态框
    const existing = document.getElementById('enablePrivacyModal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'enablePrivacyModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:480px;width:92%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.3);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;">
            <span style="font-size:24px;">🔒</span>
          </div>
          <div>
            <h3 style="margin:0;font-size:18px;font-weight:600;">Enable Private Payments</h3>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Convert public balance to private records</p>
          </div>
        </div>
        
        <div style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="font-size:12px;color:#166534;font-weight:600;margin-bottom:8px;">🔐 How Private Payments Work</div>
          <ul style="margin:0;padding-left:20px;font-size:12px;color:#15803d;line-height:1.8;">
            <li>Aleo has two types of balance: <strong>public</strong> and <strong>private</strong></li>
            <li>Private payments use encrypted records (no one can see your balance)</li>
            <li>You need to convert some public ALEO to private first</li>
            <li>This is a one-time setup for each amount</li>
          </ul>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:8px;">Amount to convert (ALEO)</label>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <button class="privacy-amount-btn" data-amount="1" style="flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;">1 ALEO</button>
            <button class="privacy-amount-btn" data-amount="5" style="flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;">5 ALEO</button>
            <button class="privacy-amount-btn" data-amount="10" style="flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;">10 ALEO</button>
          </div>
          <input type="number" id="privacyAmountInput" placeholder="Custom amount" min="0.1" step="0.1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
        </div>
        
        <div id="privacyStatus" style="display:none;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:16px;">
          <div id="privacyStatusText" style="font-size:12px;color:#92400e;"></div>
        </div>
        
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="privacyCancelBtn" style="padding:10px 20px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;">Cancel</button>
          <button id="privacyConvertBtn" style="padding:10px 20px;border:none;border-radius:8px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;cursor:pointer;font-size:14px;font-weight:600;">
            🔒 Convert to Private
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 金额按钮点击
    const amountBtns = modal.querySelectorAll('.privacy-amount-btn');
    const amountInput = modal.querySelector('#privacyAmountInput');
    amountBtns.forEach(btn => {
      btn.onclick = () => {
        amountBtns.forEach(b => b.style.background = '#fff');
        btn.style.background = 'linear-gradient(135deg,#d1fae5,#a7f3d0)';
        amountInput.value = btn.dataset.amount;
      };
    });
    
    // 取消按钮
    modal.querySelector('#privacyCancelBtn').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    // 转换按钮
    modal.querySelector('#privacyConvertBtn').onclick = async () => {
      const amount = parseFloat(amountInput.value);
      if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
      }
      
      const statusEl = modal.querySelector('#privacyStatus');
      const statusText = modal.querySelector('#privacyStatusText');
      const convertBtn = modal.querySelector('#privacyConvertBtn');
      
      statusEl.style.display = 'block';
      statusText.textContent = '🔄 Requesting Leo Wallet signature...';
      convertBtn.disabled = true;
      convertBtn.textContent = 'Converting...';
      
      try {
        if (!window.AleoPayment || typeof window.AleoPayment.transferPublicToPrivate !== 'function') {
          throw new Error('AleoPayment module not loaded');
        }
        
        const result = await window.AleoPayment.transferPublicToPrivate({ amount });
        
        if (result.success) {
          statusEl.style.background = '#d1fae5';
          const txIdShort = result.transactionId ? result.transactionId.slice(0, 12) + '...' : 'N/A';
          statusText.innerHTML = '✅ Successfully converted ' + amount + ' ALEO to private records!<br>' +
            '<small style="color:#6b7280;">Transaction: ' + txIdShort + '</small><br>' +
            '<small style="color:#15803d;">You can now use private payments for better privacy.</small>';
          convertBtn.textContent = '✓ Done';
          
          // 刷新钱包信息显示和支付模式状态（强制刷新，因为用户刚启用了隐私支付）
          try { refreshWalletInfoUI(); } catch(_) {}
          try { 
            if (window.walletManager && typeof window.walletManager.refreshPaymentModeStatus === 'function') {
              window.walletManager.refreshPaymentModeStatus();
            }
          } catch(_) {}
          
          // 3秒后关闭
          setTimeout(() => modal.remove(), 3000);
        } else {
          statusEl.style.background = '#fee2e2';
          
          // 检查是否是需要重连的错误
          const errorMsg = result.error || 'Unknown error';
          const needsReconnect = result.needsReconnect || 
            errorMsg.includes('session expired') || 
            errorMsg.includes('reconnect');
          
          if (needsReconnect) {
            statusText.innerHTML = '⚠️ Wallet session expired<br>' +
              '<small style="color:#92400e;">Leo Wallet needs to reconnect. Click the button below:</small>';
            
            // 添加重连按钮
            const reconnectBtn = document.createElement('button');
            reconnectBtn.textContent = '🔗 Reconnect Wallet';
            reconnectBtn.style.cssText = 'margin-top:10px;padding:8px 16px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;width:100%;';
            reconnectBtn.onclick = async () => {
              reconnectBtn.textContent = 'Connecting...';
              reconnectBtn.disabled = true;
              
              try {
                // 尝试重新连接
                if (window.showWalletSelectionModal) {
                  modal.remove();
                  window.showWalletSelectionModal();
                } else if (window.leoWallet && typeof window.leoWallet.connect === 'function') {
                  await window.leoWallet.connect('ViewKeyAccess', 'testnetbeta', ['credits.aleo']);
                  statusEl.style.background = '#d1fae5';
                  statusText.innerHTML = '✅ Reconnected! Click "Convert to Private" to continue.';
                  convertBtn.disabled = false;
                  convertBtn.textContent = '🔒 Convert to Private';
                  reconnectBtn.remove();
                }
              } catch (e) {
                statusText.innerHTML = '❌ Reconnection failed: ' + e.message + '<br><small>Please refresh the page and try again.</small>';
                reconnectBtn.textContent = '🔗 Try Again';
                reconnectBtn.disabled = false;
              }
            };
            statusEl.appendChild(reconnectBtn);
          } else {
            statusText.textContent = '❌ Failed: ' + errorMsg;
          }
          
          convertBtn.disabled = false;
          convertBtn.textContent = '🔒 Retry';
        }
      } catch (error) {
        statusEl.style.background = '#fee2e2';
        statusText.textContent = '❌ Error: ' + error.message;
        convertBtn.disabled = false;
        convertBtn.textContent = '🔒 Retry';
      }
    };
  }

  window.showEnablePrivacyModal = showEnablePrivacyModal;

  try {
    window.addEventListener('walletConnected', refreshWalletInfoUI);
    window.addEventListener('walletUpdated', refreshWalletInfoUI);
    window.addEventListener('walletDisconnected', refreshWalletInfoUI);
    // Also attempt initial render on DOM ready
    document.addEventListener('DOMContentLoaded', function(){
      try { refreshWalletInfoUI(); } catch (_) {}
    });
  } catch (_) {}
})();