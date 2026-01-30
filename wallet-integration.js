// wallet-integration.js - Leo Wallet 集成脚本 (Aleo Testnet)
// 在所有需要钱包功能的页面中使用

/**
 * 显示钱包选择模态框 - 新增功能
 */
function forceWalletModalVisible() {
  const modal = document.getElementById('walletModal');
  if (!modal) {
    console.error('Wallet modal not found in DOM');
    return;
  }
  modal.style.transform = 'none';
  modal.style.transition = 'none';
  modal.style.display = 'flex';
  modal.classList.add('show');
}

window.forceWalletModalVisible = forceWalletModalVisible;

function showWalletSelectionModal() {
  const modal = document.getElementById('walletModal');
  if (modal) {
    forceWalletModalVisible();
  } else {
    console.error('Wallet modal not found in DOM');
  }
}

/**
 * 关闭钱包选择模态框
 */
function closeWalletModal() {
    const modal = document.getElementById('walletModal');
    if (modal) {
        // 立即移除show类，不使用动画
        modal.classList.remove('show');
        modal.style.display = 'none';
        // 确保重置所有可能的transform属性
        modal.style.transform = 'none';
        modal.style.transition = 'none';
    }
}

function notifyUnsupportedWallet(name) {
  const message = `${name} is not available. Please connect with Leo Wallet (Aleo Testnet).`;
  if (typeof showNotification === 'function') {
    showNotification(message, 'error');
  } else if (typeof alert === 'function') {
    alert(message);
  } else {
    console.warn(message);
  }
}

/**
 * 连接 Leo Wallet (Aleo) - 从模态框调用
 */
async function connectLeoWallet() {
  console.log('[Connect][Leo] start');

  try {
    if (!window.walletManager) {
      throw new Error('Wallet manager not available');
    }

    const result = await window.walletManager.connectWallet('leo');
    
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to connect Leo Wallet');
    }

    // 成功后关闭弹窗
    const modal = document.getElementById('walletModal');
    if (modal) { 
      modal.classList.remove('show'); 
      modal.style.display = 'none'; 
    }

    const dropdown = document.getElementById('accountDropdown');
    if (dropdown) dropdown.classList.remove('show');

    showNotification('Leo Wallet connected!', 'success');
    console.log('[Connect][Leo] success ->', result.address);
    
  } catch (e) {
    console.error('[Connect][Leo] error:', e);
    showNotification(e?.message || 'Failed to connect Leo Wallet', 'error');
  }
}


/**
 * 钱包连接处理函数
 */
async function handleWalletConnect() {
    try {
        if (!window.walletManager) {
            showNotification('Wallet manager not loaded', 'error');
            return;
        }

        const result = await window.walletManager.connectWallet();
        if (result.success) {
            showNotification('Wallet connected successfully!', 'success');
            const dropdown = document.getElementById('accountDropdown');
            if (dropdown) {
                dropdown.classList.remove('show');
            }
        } else {
            showNotification(result.error, 'error');
        }
    } catch (error) {
        console.error('Wallet connection error:', error);
        showNotification('Failed to connect wallet', 'error');
    }
}

/**
 * 每日签到处理函数 - 支持 Admin 本地签到 + 普通用户链上签到
 */
async function handleDailyCheckin() {
    try {
        // 1. 检查钱包连接
        if (!window.walletManager || !window.walletManager.isConnected) {
            showNotification('Please connect your wallet first', 'error');
            return;
        }

        // 2. 判断是否为 Admin
        const isAdminUser = window.isAdmin && window.isAdmin();
        
        if (isAdminUser) {
            // Admin 用户 → 检查后执行本地签到
            if (!window.walletManager.canCheckinToday()) {
                showNotification('Already checked in today! Come back tomorrow.', 'error');
                return;
            }
            console.log('Admin user detected, executing local check-in');
            executeLocalCheckin();
        } else {
            // 普通用户 → 直接打开链上签到 Modal
            console.log('Regular user detected, opening on-chain check-in modal');
            
            if (typeof window.openOnChainCheckInModal === 'function') {
                // ⚠️ 关键修改：移除 await，不等待加载完成
                if (typeof window.loadUserCheckInStatus === 'function') {
                    window.loadUserCheckInStatus(); // 移除了 await
                }
                window.openOnChainCheckInModal();
            } else {
                console.error('On-chain check-in modal function not found');
                showNotification('Check-in feature not available', 'error');
            }
        }
    } catch (error) {
        console.error('Daily check-in error:', error);
        showNotification('Failed to process check-in: ' + error.message, 'error');
    }
}
/**
 * 执行本地签到(仅 Admin 用户)
 */
async function executeLocalCheckin() {
    try {
        const address = (window.walletManager.walletAddress || '').toLowerCase();

        // Firebase 同步(如果可用)
        if (window.firebaseDb) {
            const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = 
                await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');

            const walletRef = doc(window.firebaseDb, 'wallets', address);
            const snap = await getDoc(walletRef);

            let remoteTotalCheckins = 0;
            let lastCheckinAt = null;
            
            if (snap.exists()) {
                const data = snap.data() || {};
                lastCheckinAt = data.lastCheckinAt || null;
                remoteTotalCheckins = Number(data.totalCheckins || 0);
            } else {
                await setDoc(walletRef, { 
                    address: address, 
                    createdAt: serverTimestamp(), 
                    totalCheckins: 0 
                }, { merge: true });
            }

            // 同步时间戳到本地
            if (lastCheckinAt && typeof lastCheckinAt.toMillis === 'function') {
                try { 
                    localStorage.setItem('last_checkin_at', String(lastCheckinAt.toMillis())); 
                } catch (_) {}
            }

            // 执行本地签到
            const result = await window.walletManager.dailyCheckin();
            if (!result || !result.success) {
                showNotification(result?.error || 'Check-in failed', 'error');
                return;
            }

            // 同步到 Firestore
            try {
                await updateDoc(walletRef, {
                    lastCheckinAt: serverTimestamp(),
                    totalCheckins: remoteTotalCheckins + 1,
                    credits: window.walletManager.credits,
                    lastUpdated: serverTimestamp(),
                    lastCheckinType: 'local-admin'
                });
            } catch (e) {
                console.warn('Failed to sync to Firestore:', e);
            }

            showNotification(`Check-in successful! +${result.reward} I3 tokens`, 'success');
        } else {
            // Firebase 不可用时的降级处理
            const result = await window.walletManager.dailyCheckin();
            if (result && result.success) {
                showNotification(`Check-in successful! +${result.reward} I3 tokens`, 'success');
            } else {
                showNotification(result?.error || 'Check-in failed', 'error');
            }
        }
    } catch (error) {
        console.error('Local check-in error:', error);
        showNotification('Check-in failed: ' + error.message, 'error');
    }
}

/**
 * 钱包断开连接处理函数
 */
function handleWalletDisconnect() {
    try {
        if (window.walletManager) {
            window.walletManager.disconnectWallet();
        }
    } catch (error) {
        console.error('Wallet disconnect error:', error);
        showNotification('Failed to disconnect wallet', 'error');
    }
}

/**
 * 显示通知消息
 * @param {string} message - 通知消息
 * @param {string} type - 通知类型 ('success' 或 'error')
 */
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        z-index: 10000;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: all 0.3s ease;
        transform: translateX(100%);
        opacity: 0;
    `;
    document.body.appendChild(notification);

    // 动画显示
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
        notification.style.opacity = '1';
    }, 10);

    // 自动消失
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

/**
 * 初始化钱包UI状态
 */
function initializeWalletUI() {
    try {
        if (window.walletManager) {
            const userInfo = window.walletManager.getUserInfo();
            if (userInfo.isConnected) {
                updateWalletUI(userInfo.address, userInfo.credits);
                updateConnectButton(true);
            } else {
                resetWalletUI();
                updateConnectButton(false);
            }

            updateCheckinButton();

            // 初始化时渲染首选网络徽章
            try {
                const preferred = getPreferredNetwork?.();
                if (preferred) renderNetworkBadge(preferred);
            } catch (e) {
                console.error('Failed to render preferred network badge:', e);
            }
        }
    } catch (error) {
        console.error('Error initializing wallet UI:', error);
    }
}

/**
 * 更新钱包UI显示
 * @param {string} address - 钱包地址
 * @param {number} credits - 不再使用
 */
function updateWalletUI(address, credits) {
    const accountBtnText = document.getElementById('accountBtnText');
    const paymentModeStatus = document.getElementById('paymentModeStatus');

    if (accountBtnText && address) {
        // 已连接：显示截断的钱包地址
        // Aleo 地址格式: aleo1... (较长，截取前10后6)
        if (address.startsWith('aleo1')) {
            accountBtnText.textContent = `${address.slice(0, 10)}...${address.slice(-6)}`;
        } else {
            accountBtnText.textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
        }
    } else if (accountBtnText) {
        // 未连接：显示 Login
        accountBtnText.textContent = 'Login';
    }

    setWalletTypeIcon(window.walletManager?.walletType || null);

    // 显示支付模式状态（仅 Leo Wallet，不显示余额保护隐私）
    if (paymentModeStatus && address && window.walletManager?.walletType === 'leo') {
        window.walletManager?.updatePaymentModeStatus?.();
    } else if (paymentModeStatus) {
        // 未连接或非 Leo 钱包：隐藏
        paymentModeStatus.style.display = 'none';
    }
}


/**
 * 重置钱包UI到未连接状态
 */
function resetWalletUI() {
    const accountBtnText = document.getElementById('accountBtnText');
    const paymentModeStatus = document.getElementById('paymentModeStatus');
    
    if (accountBtnText) {
        accountBtnText.textContent = 'Login';
    }
    setWalletTypeIcon(null);
    
    if (paymentModeStatus) {
      paymentModeStatus.style.display = 'none';
    }

}

/**
 * 在账号按钮文本(#accountBtnText)右侧显示当前钱包的小图标
 * 会自动创建 <img id="walletTypeIcon">，并根据 walletType 切换 src/alt
 * @param {string|null} walletType - 'metamask' | 'walletconnect' | 'coinbase' | 'solana-phantom' | null
 */
function setWalletTypeIcon(walletType) {
    const textEl = document.getElementById('accountBtnText');
    if (!textEl) return;

    // 确保有图标元素
    let iconEl = document.getElementById('walletTypeIcon');
    if (!iconEl) {
        iconEl = document.createElement('img');
        iconEl.id = 'walletTypeIcon';
        // 插到地址文本后面
        if (textEl.parentNode) {
            textEl.parentNode.insertBefore(iconEl, textEl.nextSibling);
        }
    }

    // 本地 SVG 映射
    const ICONS = {
        leo: 'svg/leo.svg'
    };

    // 根据类型设置
    const key = (walletType || '').toLowerCase();
    if (ICONS[key]) {
        iconEl.src = ICONS[key];
        iconEl.alt = key;
        iconEl.title = key === 'leo' ? 'Leo Wallet (Aleo)' : key.charAt(0).toUpperCase() + key.slice(1);
        iconEl.style.display = 'inline-block';
    } else {
        // 未连接或未知类型 -> 隐藏
        iconEl.removeAttribute('src');
        iconEl.removeAttribute('alt');
        iconEl.style.display = 'none';
    }
}


/**
 * 更新连接按钮状态 - 修改为显示钱包选择模态框
 * @param {boolean} isConnected - 是否已连接
 */
function updateConnectButton(isConnected) {
    const connectBtn = document.getElementById('connectWalletBtn');
    if (connectBtn) {
        if (isConnected) {
            connectBtn.textContent = 'Disconnect Wallet';
            connectBtn.onclick = handleWalletDisconnect;
            connectBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        } else {
            connectBtn.textContent = 'Connect Wallet';
            connectBtn.onclick = showWalletSelectionModal; // 修改为显示钱包选择模态框
            connectBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
        }
    }
}

/**
 * 更新签到按钮状态 - 更新为I3 tokens术语
 */
function updateCheckinButton() {
    const checkinBtn = document.getElementById('checkinBtn');
    if (!checkinBtn || !window.walletManager) return;
    
    const userInfo = window.walletManager.getUserInfo();
    
    // 🔑 强制检查：明确的 Admin 判断
    const isAdminUser = (
        typeof window.isAdmin === 'function' && 
        window.currentUser && 
        window.currentUser.email && 
        window.isAdmin() === true
    );
    
    console.log('updateCheckinButton called:', { 
        isConnected: userInfo.isConnected, 
        isAdminUser 
    });
    
    if (userInfo.isConnected) {
        if (isAdminUser) {
            // Admin 逻辑
            const canCheckin = window.walletManager.canCheckinToday();
            checkinBtn.textContent = canCheckin ? 'Daily Check-in' : 'Already Checked-in Today';
            checkinBtn.disabled = !canCheckin;
            checkinBtn.style.opacity = canCheckin ? '1' : '0.6';
            checkinBtn.style.cursor = canCheckin ? 'pointer' : 'not-allowed';
            checkinBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
            checkinBtn.style.color = '#ffffff';
        } else {
            // 🔑 非 Admin：强制覆盖所有样式
            checkinBtn.textContent = 'Daily Check-in';
            checkinBtn.disabled = false;
            checkinBtn.style.opacity = '1';
            checkinBtn.style.cursor = 'pointer';
            checkinBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
            checkinBtn.style.color = '#ffffff';
        }
    } else {
        // 未连接
        checkinBtn.textContent = 'Daily Check-in';
        checkinBtn.disabled = true;
        checkinBtn.style.opacity = '0.4';
        checkinBtn.style.background = '#f3f4f6';
        checkinBtn.style.color = '#9ca3af';
        checkinBtn.style.cursor = 'not-allowed';
    }
}

/**
 * 检查钱包管理器是否可用
 */
function checkWalletManager() {
    let attempts = 0;
    const maxAttempts = 50;
    
    const checkInterval = setInterval(() => {
        attempts++;
        
        if (window.walletManager) {
            clearInterval(checkInterval);
            initializeWalletUI();
            console.log('Wallet manager found and UI initialized');
        } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            console.warn('Wallet manager not found after maximum attempts');
        }
    }, 100);
}

// 钱包事件监听器
window.addEventListener('walletConnected', function(event) {
    console.log('Wallet connected event received:', event.detail);
    const { address, credits, isNewUser } = event.detail;
    
    updateWalletUI(address, credits);
    updateConnectButton(true);
    updateCheckinButton();
    
    // 渲染网络徽章
    const preferredNetwork = getPreferredNetwork();
    const info = mapChainIdToDisplay(null, window.walletManager?.walletType, preferredNetwork?.network);
    renderNetworkBadge(info);
    
    // Persist wallet linkage to Firestore after Firebase is ready
    const writeWalletLinkage = () => {
        try {
            if (typeof window.onWalletConnected !== 'function') return;
            const networkName = preferredNetwork?.name || 'Aleo';
            window.onWalletConnected(address, null, networkName);
        } catch (e) {
            console.warn('Failed to write wallet linkage to Firestore:', e);
        }
    };
    if (window.firebaseDb) {
        writeWalletLinkage();
    } else {
        const onReady = () => { window.removeEventListener('firebaseReady', onReady); writeWalletLinkage(); };
        window.addEventListener('firebaseReady', onReady);
    }

    // Optional: Attempt Firebase login automatically if allowed via setting
    try {
        const autoGoogle = (localStorage.getItem('autoGoogleOnWalletConnect') || 'off') === 'on';
        if (autoGoogle && window.firebaseAuth && !window.firebaseAuth.currentUser && typeof window.handleGoogleSignIn === 'function') {
            window.handleGoogleSignIn('auto');
        }
    } catch (e) {
        console.warn('Skipping Firebase auto-login after wallet connect:', e);
    }
    
    if (isNewUser) {
        showNotification('Welcome! You can earn credits daily by checking in!', 'success');
    }
});

window.addEventListener('walletDisconnected', function() {
    console.log('Wallet disconnected event received');
    resetWalletUI();
    updateConnectButton(false);
    updateCheckinButton();
    const preferred = getPreferredNetwork();
    renderNetworkBadge({ name: preferred.name, icon: preferred.icon });
    showNotification('Wallet disconnected', 'success');
});

window.addEventListener('dailyCheckinSuccess', function(event) {
    console.log('Daily checkin success event received:', event.detail);
    const { reward, newBalance, totalCheckins } = event.detail;
    
    updateCheckinButton();
    
    // 显示更详细的成功信息
    showNotification(`Check-in #${totalCheckins} complete! +${reward} credits earned`, 'success');
});

window.addEventListener('creditsSpent', function(event) {
    console.log('Credits spent event received:', event.detail);
    const { amount, newBalance, reason } = event.detail;
    
    showNotification(`Spent ${amount} credits for ${reason}`, 'success');
});

// ESC 键关闭模态框
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('walletModal');
        if (modal && modal.classList.contains('show')) {
            closeWalletModal();
        }
    }
});

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('Wallet integration script loaded');
    checkWalletManager();
    // Cross-page reconcile: if Firebase is ready and wallet connected, hydrate from Firestore
    try {
        if (window.walletManager && window.walletManager.isConnected && typeof window.walletManager.fetchRemoteWalletDataIfAvailable === 'function') {
            if (window.firebaseDb) {
                window.walletManager.fetchRemoteWalletDataIfAvailable();
            } else {
                window.addEventListener('firebaseReady', () => {
                    if (window.walletManager && window.walletManager.isConnected) {
                        window.walletManager.fetchRemoteWalletDataIfAvailable();
                    }
                });
            }
        }
    } catch (e) { console.warn('Cross-page reconcile skipped:', e); }
});

// 页面可见性变化时重新检查状态
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && window.walletManager) {
        setTimeout(() => {
            initializeWalletUI();
        }, 500);
    }
});

// 导出函数到全局作用域
window.handleWalletConnect = handleWalletConnect;
window.handleDailyCheckin = handleDailyCheckin;
window.executeLocalCheckin = executeLocalCheckin;
window.handleWalletDisconnect = handleWalletDisconnect;
window.showNotification = showNotification;
window.initializeWalletUI = initializeWalletUI;
window.showWalletSelectionModal = showWalletSelectionModal;
window.closeWalletModal = closeWalletModal;
window.connectLeoWallet = connectLeoWallet;

// 其他钱包不再支持
window.connectMetaMaskWallet = () => notifyUnsupportedWallet('MetaMask');
window.connectSolanaPhantom = () => notifyUnsupportedWallet('Phantom');
window.connectWalletConnect = () => notifyUnsupportedWallet('WalletConnect');
window.connectCoinbaseWallet = () => notifyUnsupportedWallet('Coinbase Wallet');

console.log('✅ Leo Wallet integration functions loaded successfully');


console.log('✅ Leo Wallet connection function loaded');

// === Network badge helpers ===
function mapChainIdToDisplay(chainId, walletType, networkHint) {
  // Aleo (Leo Wallet)
  if (walletType === 'leo') {
    // 优先从配置获取网络名称
    const preferredNetwork = getPreferredNetwork();
    if (preferredNetwork) {
      return { name: preferredNetwork.name, icon: preferredNetwork.icon };
    }
    // 兜底
    const net = (networkHint || 'mainnet').toLowerCase();
    return { name: `Aleo ${net.charAt(0).toUpperCase() + net.slice(1)}`, icon: 'svg/leo.svg' };
  }
  return null; // 未匹配则不显示
}

function renderNetworkBadge(info) {
  const badge = document.getElementById('networkBadge');
  if (!badge) return;

  // 没有链信息时隐藏
  if (!info) {
    badge.style.display = 'none';
    return;
  }

  const { name, icon } = info;
  const iconEl = badge.querySelector('.network-badge__icon');
  const textEl = badge.querySelector('.network-badge__text');

  if (textEl) textEl.textContent = name;

  if (iconEl && icon) {
    // 先预加载图标，避免出现破图闪烁
    const img = new Image();
    img.onload = () => {
      iconEl.src = icon;
      iconEl.alt = name;
      badge.style.display = 'inline-flex';
    };
    img.onerror = () => {
      // 图标加载失败也至少显示徽章
      badge.style.display = 'inline-flex';
    };
    img.src = icon;
  } else {
    badge.style.display = 'inline-flex';
  }

  badge.style.cursor = 'pointer';
  const currentNetwork = getPreferredNetwork();
  badge.title = `Click to switch network (Current: ${currentNetwork.name})`;
  badge.onclick = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (typeof openNetworkPickerModal === 'function') {
      openNetworkPickerModal();
    }
  };
}


// Aleo 不需要 enforcePreferredEvmChain 函数

function openNetworkPickerModal() {
  const modal = document.getElementById('networkModal');
  if (!modal) {
    console.error('Network modal not found');
    return;
  }
  
  const current = getPreferredNetwork();
  
  // 更新选项状态
  Object.keys(I3_NETWORKS).forEach(key => {
    const option = document.querySelector(`[data-network-key="${key}"]`);
    if (option) {
      if (key === current.key) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    }
  });
  
  modal.style.display = 'flex';
  modal.classList.add('show');
  setTimeout(() => {
    modal.dataset.readyToClose = 'true';
  }, 100);
}

function closeNetworkModal() {
  const modal = document.getElementById('networkModal');
  if (modal) {
    modal.classList.remove('show');
    modal.dataset.readyToClose = 'false';
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }
}

function selectNetwork(key) {
  setPreferredNetwork(key);
  closeNetworkModal();
  
  // 如果钱包已连接，断开连接并提示用户重新连接以使用新网络
  if (window.walletManager && window.walletManager.isConnected) {
    const network = I3_NETWORKS[key];
    // 断开当前连接
    try {
      if (window.walletManager.disconnect) {
        window.walletManager.disconnect();
      }
    } catch (e) {
      console.warn('Failed to disconnect wallet:', e);
    }
    
    if (typeof showNotification === 'function') {
      showNotification(`Network switched to ${network.name}. Please reconnect your wallet to use the new network.`, 'info');
    }
  }
}


// ===== Preferred Network (pre-connect) =====
const I3_NETWORKS = {
  'aleo-testnet': {
    kind: 'aleo',
    key: 'aleo-testnet',
    name: 'Aleo Testnet',
    icon: 'svg/leo.svg',
    network: 'testnetbeta',       // Leo Wallet 网络参数
    chainId: null,
    rpcEndpoint: 'https://api.explorer.aleo.org/v1/testnet3',
    explorerBaseUrl: 'https://explorer.aleo.org/testnet3/transaction'
  }
};

function getPreferredNetwork() {
  try {
    const raw = localStorage.getItem('i3_preferred_network');
    const data = raw ? JSON.parse(raw) : null;
    if (data && I3_NETWORKS[data.key]) return I3_NETWORKS[data.key];
  } catch {}
  // 默认使用 Aleo Testnet
  return I3_NETWORKS['aleo-testnet'];
}

function setPreferredNetwork(key) {
  const n = I3_NETWORKS[key] || I3_NETWORKS['aleo-testnet'];
  localStorage.setItem('i3_preferred_network', JSON.stringify({ key: n.key }));
  // 更新全局配置
  updateNetworkConfig(n);
  // 刷新徽章
  renderNetworkBadge({ name: n.name, icon: n.icon });
  // 触发网络变更事件
  window.dispatchEvent(new CustomEvent('networkChanged', { detail: n }));
}

function updateNetworkConfig(network) {
  // 更新 window.APP_CONFIG
  if (window.APP_CONFIG) {
    if (!window.APP_CONFIG.aleo) window.APP_CONFIG.aleo = {};
    window.APP_CONFIG.aleo.network = network.network;
    window.APP_CONFIG.aleo.rpcEndpoint = network.rpcEndpoint;
    if (window.APP_CONFIG.mcp) {
      window.APP_CONFIG.mcp.receiptExplorerBaseUrl = network.explorerBaseUrl;
    }
  }
  
  console.log('✅ Network configuration updated:', network.name);
}

document.addEventListener('DOMContentLoaded', () => {
  const n = getPreferredNetwork();
  // 应用网络配置
  updateNetworkConfig(n);
  // 未连接也显示徽章
  renderNetworkBadge({ name: n.name, icon: n.icon });
});

// 监听网络变更事件，更新相关组件
window.addEventListener('networkChanged', (event) => {
  const network = event.detail;
  // 如果钱包管理器存在，更新其配置
  if (window.walletManager && typeof window.walletManager.updateNetworkConfig === 'function') {
    window.walletManager.updateNetworkConfig(network);
  }
  // 如果 MCPClient 存在，可能需要重新初始化连接
  if (window.MCPClient) {
    console.log('Network changed, MCP client may need reconnection');
  }
});

// ===== 链上签到 Modal 控制函数 =====
function openOnChainCheckInModal() {
    const modal = document.getElementById('onChainCheckInModal');
    if (!modal) {
        console.error('On-chain check-in modal not found');
        return;
    }
    
    // 检查钱包连接
    if (!window.walletManager || !window.walletManager.isConnected) {
        showNotification('Please connect your wallet first', 'error');
        return;
    }
    
    modal.style.display = 'flex';
        // —— 插入开始：打开时根据本地状态初始化 UI —— 
		try {
		  const btn = document.getElementById('executeCheckInBtn');
		  const streakEl = document.getElementById('currentStreak');
		  const totalEl  = document.getElementById('totalCheckIns');
		  const rewardEl = document.getElementById('nextReward');
		  // 固定显示 30
		  if (rewardEl) rewardEl.textContent = '30';
		  // 从本地数据回填数字（与 walletManager/dailyCheckin 写入的 key 对齐）
		  const totalChk = parseInt(localStorage.getItem('total_checkins') || '0', 10);
		  if (totalEl) totalEl.textContent = String(totalChk);
		  // streak 采用同一 id（若你有单独累计，也可从 localStorage 读取自有 key）
		  // 先不做复杂计算：若今天已签，则至少显示 >=1；否则保持现值或 0
		  const lastMs = parseInt(localStorage.getItem('last_checkin_at') || '0', 10);
		  const DAY_MS = 24 * 60 * 60 * 1000;
		  const checkedToday = lastMs > 0 && (Date.now() - lastMs) < DAY_MS;
		  if (checkedToday) {
		    if (btn) {
		      btn.disabled = true;
		      btn.textContent = 'Already Checked Today';
		      btn.classList?.add?.('opacity-60', 'pointer-events-none');
		    }
		  } else {
		    if (btn) {
		      btn.disabled = false;
		      btn.textContent = 'Daily Check-in';
		      btn.classList?.remove?.('opacity-60', 'pointer-events-none');
		    }
		  }
		  // 兼容你在 Solana 成功后写入的"今日已签"标志（双保险）
		  try {
		    const mark = JSON.parse(localStorage.getItem('checkin_status_SOLANA') || 'null');
		    if (mark && mark.date === new Date().toISOString().slice(0,10) && btn) {
		      btn.disabled = true;
		      btn.textContent = 'Already Checked Today';
		      btn.classList?.add?.('opacity-60', 'pointer-events-none');
		    }
		  } catch (_) {}
		} catch (e) {
		  console.warn('[modal init] Failed to init gate from local storage:', e);
		}
		// —— 插入结束 —— 
    modal.classList.add('show');
}

function closeOnChainCheckInModal() {
    const modal = document.getElementById('onChainCheckInModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

async function executeOnChainCheckIn() {
    const chainSelector = document.getElementById('chainSelector');
    const selectedChain = chainSelector ? chainSelector.value : 'SOLANA';
    const loadingDiv = document.getElementById('checkInLoading');
    const btn = document.getElementById('executeCheckInBtn');
    
    try {
        // 显示加载状态
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (btn) btn.disabled = true;
        
        // 这里添加你的链上签到逻辑
        // 暂时使用本地签到作为示例
        handleDailyCheckin();
        
        // 成功后关闭 Modal
        setTimeout(() => {
            closeOnChainCheckInModal();
        }, 1500);
        
    } catch (error) {
        console.error('On-chain check-in error:', error);
        showNotification('On-chain check-in failed: ' + error.message, 'error');
    } finally {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (btn) btn.disabled = false;
    }
}

// 导出到全局
window.openOnChainCheckInModal = openOnChainCheckInModal;
window.closeOnChainCheckInModal = closeOnChainCheckInModal;
window.executeOnChainCheckIn = executeOnChainCheckIn;

console.log('✅ On-chain check-in modal functions loaded');
