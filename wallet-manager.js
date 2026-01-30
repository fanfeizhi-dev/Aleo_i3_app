// wallet-manager.js - Leo Wallet manager for Aleo (I3 tokens / credits)
// Leo Wallet 不需要 waitForAccounts 函数

class WalletManager {
    constructor() {
        this.walletAddress = null;
        this.isConnected = false;
        this.credits = 0;
        this.totalEarned = 0;
        this.isConnecting = false;

        this.walletType = null;
        
        // Leo Wallet (Aleo)
        this.leoAdapter = null;
        this.aleoPublicKey = null;

        this.loadFromStorage();
        this.initializeLeoWallet();
    }



    // ========== Leo Wallet (Aleo) 初始化 ==========
    async initializeLeoWallet() {
        // Leo Wallet 通过浏览器扩展注入 window.leoWallet
        // 这里只做初始化检查，实际连接在 connectLeo() 中进行
        console.log('Leo Wallet manager initialized (waiting for extension)');
    }

    // 获取 Leo Wallet provider
    getLeoProvider() {
        // Leo Wallet 扩展会注入 window.leoWallet
        return window.leoWallet || window.leo || null;
    }

    // 设置 Leo Wallet 事件监听
    setupLeoEventListeners() {
        const provider = this.getLeoProvider();
        if (!provider) return;

        // Leo Wallet 事件监听
        if (typeof provider.on === 'function') {
            provider.on('accountChange', (data) => {
                console.log('Leo Wallet account changed:', data);
                
                // data 可能是对象 {publicKey: '...'} 或字符串
                const newPublicKey = this.extractPublicKey(data);
                
                if (newPublicKey) {
                    if (this.walletAddress) {
                        this.saveWalletSpecificData();
                    }
                    this.aleoPublicKey = newPublicKey;
                    this.walletAddress = newPublicKey;
                    this.loadWalletSpecificData();
                    this.saveToStorage();
                    this.updateUI();
                    window.dispatchEvent(new CustomEvent('walletConnected', {
                        detail: { 
                            address: this.walletAddress, 
                            credits: this.credits, 
                            isNewUser: !this.getWalletData(this.walletAddress) 
                        }
                    }));
                } else {
                    this.disconnectWallet();
                }
            });

            provider.on('disconnect', () => {
                console.log('Leo Wallet disconnected');
                this.disconnectWallet();
            });
        }
    }

    // 从 Leo Wallet 返回的数据中提取 publicKey 字符串
    extractPublicKey(data) {
        if (!data) return null;
        
        // 如果是字符串，直接返回
        if (typeof data === 'string') {
            return data;
        }
        
        // 如果是对象，尝试提取 publicKey
        if (typeof data === 'object') {
            // 尝试多种属性名
            const key = data.publicKey || data.address || data.public_key;
            if (typeof key === 'string') {
                return key;
            }
        }
        
        return null;
    }

	/**
     * 连接 Leo Wallet (Aleo)
     */
    async connectLeo() {
        if (this.isConnecting) {
            return { success: false, error: 'Connection already in progress' };
        }
	  this.isConnecting = true;

        try {
            // 检测 Leo Wallet 是否安装
            const leoWallet = this.getLeoProvider();
            
            // 调试：输出 Leo Wallet 对象结构
            console.log('[Leo] Provider found:', leoWallet);
            if (leoWallet) {
                console.log('[Leo] Provider methods:', Object.keys(leoWallet));
                console.log('[Leo] Provider prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(leoWallet)));
            }
            
            if (!leoWallet) {
	      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
	      if (typeof showNotification === 'function') {
	        showNotification(
	          isMobile
                            ? 'Please open this page in Leo Wallet browser.'
                            : 'Leo Wallet not detected. Opening download page...',
	          isMobile ? 'error' : 'info'
	        );
	      }
                // 打开 Leo Wallet 下载页
                try { 
                    window.open('https://www.leo.app/', '_blank', 'noopener,noreferrer'); 
                } catch (_) {}
                return { success: false, error: 'Leo Wallet not installed. Download page opened.' };
            }

            // 连接钱包 - Leo Wallet API
            // 参数文档：
            // - decryptPermission: 'NoDecrypt' | 'UponRequest' | 'AutoDecrypt' | 'ViewKeyAccess' | 'OnChainHistory'
            // - network: 'mainnet' | 'testnetbeta'
            // - programs: string[] (需要交互的程序列表)
            
            let publicKey = null;
            
            if (typeof leoWallet.connect === 'function') {
                try {
                    // 需要 OnChainHistory 权限才能读取私密记录 (用于 transfer_private)
                    // 可选值: 'NoDecrypt' | 'UponRequest' | 'AutoDecrypt' | 'ViewKeyAccess' | 'OnChainHistory'
                    const decryptPermission = 'OnChainHistory';
                    
                    // 从用户选择的网络配置中读取 network 参数
                    // Leo Wallet 支持: 'mainnet' | 'testnetbeta'
                    let network = 'mainnet';  // 默认主网
                    try {
                        const preferredNetwork = typeof getPreferredNetwork === 'function' ? getPreferredNetwork() : null;
                        if (preferredNetwork && preferredNetwork.network) {
                            network = preferredNetwork.network;
                        }
                    } catch (e) {
                        console.warn('[Leo] Could not get preferred network, using mainnet:', e);
                    }
                    
                    // programs 参数：需要交互的程序列表
                    // 注意：传递字符串数组，Leo Wallet 会显示这些程序
                    const programs = ['credits.aleo'];
                    
                    console.log('[Leo] Connecting with params:', { decryptPermission, network, programs });
                    
                    // 调用 connect
                    // Leo Wallet API: connect(decryptPermission, network, programs)
                    // 返回值可能是 publicKey 字符串或包含 publicKey 的对象
                    let result;
                    try {
                        result = await leoWallet.connect(decryptPermission, network, programs);
                    } catch (connectErr) {
                        // 某些版本的 Leo Wallet 可能不支持 programs 参数
                        // 尝试不传 programs 参数
                        console.warn('[Leo] connect() with programs failed, trying without programs:', connectErr.message);
                        result = await leoWallet.connect(decryptPermission, network);
                    }
                    
                    console.log('[Leo] connect() returned:', result);
                    
                    // 从返回结果或 leoWallet.publicKey 提取 publicKey
                    publicKey = this.extractPublicKey(result) || this.extractPublicKey(leoWallet.publicKey);
                    
                    console.log('[Leo] Extracted publicKey:', publicKey);
                    
                } catch (e) {
                    console.error('[Leo] connect() failed:', e);
                    
                    // 如果是用户拒绝
                    if (e?.message?.includes('reject') || e?.message?.includes('cancel') || 
                        e?.message?.includes('denied') || e?.name === 'UserRejectedRequestError') {
                        throw new Error('Connection rejected by user');
                    }
                    throw e;
                }
            }

            // 备用：直接读取 publicKey 属性（如果已经连接）
            if (!publicKey && leoWallet.publicKey) {
                console.log('[Leo] Reading existing publicKey property...');
                publicKey = this.extractPublicKey(leoWallet.publicKey);
            }

            if (!publicKey) {
                throw new Error('No public key returned from Leo Wallet. Please make sure Leo Wallet is unlocked.');
            }

            // 转换为字符串（如果是对象）
            const publicKeyStr = typeof publicKey === 'string' ? publicKey : publicKey.toString();

            // 更新状态
            this.walletType = 'leo';
            this.aleoPublicKey = publicKeyStr;
            this.walletAddress = publicKeyStr;
            this.isConnected = true;
            this.leoAdapter = leoWallet; // 保存 provider 引用

            // 设置事件监听
            this.setupLeoEventListeners();

            // 同步数据
            await this.fetchRemoteWalletDataIfAvailable();
                this.loadWalletSpecificData();
                this.saveToStorage();
                this.updateUI();
                
            // 广播事件
                window.dispatchEvent(new CustomEvent('walletConnected', {
                    detail: { 
                        address: this.walletAddress, 
                        credits: this.credits, 
                        isNewUser: !this.getWalletData(this.walletAddress) 
                    }
                }));

            // 渲染网络徽章
            try {
                const preferredNetwork = typeof getPreferredNetwork === 'function' ? getPreferredNetwork() : null;
                const networkName = preferredNetwork?.name || 'Aleo';
                renderNetworkBadge({ name: networkName, icon: 'svg/leo.svg' });
            } catch (e) {}

            console.log('Leo Wallet connected:', this.walletAddress);
            return { success: true, address: this.walletAddress, credits: this.credits };

        } catch (error) {
            console.error('Leo Wallet connect error:', error);
            let friendlyMessage = error?.message || String(error);
            
            if (/user reject/i.test(friendlyMessage) || /cancelled/i.test(friendlyMessage)) {
                friendlyMessage = 'Connection cancelled by user';
            } else if (/not installed/i.test(friendlyMessage)) {
                friendlyMessage = 'Leo Wallet not detected. Please install the Leo Wallet extension.';
            }
            
            return { success: false, error: friendlyMessage };
        } finally {
            this.isConnecting = false;
        }
    }

    /**
     * 更新支付模式状态显示
     * 不显示余额（保护隐私），只显示当前是 Private 还是 Public 支付模式
     * 
     * 注意：使用缓存避免频繁调用 getPrivateRecords()（会触发钱包弹窗）
     */
    async updatePaymentModeStatus(forceRefresh = false) {
        try {
            const statusDisplay = document.getElementById('paymentModeStatus');
            if (!statusDisplay || !this.aleoPublicKey) {
                return;
            }

            // 缓存机制：避免频繁调用 getPrivateRecords（会触发钱包弹窗）
            // 缓存 5 分钟，除非强制刷新
            const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
            const now = Date.now();
            
            if (!forceRefresh && 
                this._paymentModeCache && 
                this._paymentModeCacheTime && 
                (now - this._paymentModeCacheTime) < CACHE_DURATION) {
                // 使用缓存的结果更新 UI
                this._updatePaymentModeUI(statusDisplay, this._paymentModeCache);
                return;
            }

            // 检查是否有 private records（异步检测）
            // 注意：这可能会触发 Leo Wallet 弹窗，所以我们使用缓存
            let hasPrivateBalance = false;
            try {
                if (window.AleoPayment && typeof window.AleoPayment.getPrivateRecords === 'function') {
                    const records = await window.AleoPayment.getPrivateRecords();
                    hasPrivateBalance = records && records.length > 0;
                }
            } catch (e) {
                console.warn('[WalletManager] Failed to check private records:', e);
                // 如果检测失败，使用之前的缓存（如果有）
                if (this._paymentModeCache !== undefined) {
                    hasPrivateBalance = this._paymentModeCache;
                }
            }

            // 更新缓存
            this._paymentModeCache = hasPrivateBalance;
            this._paymentModeCacheTime = now;
            this._hasPrivateBalance = hasPrivateBalance;
            
            // 更新 UI
            this._updatePaymentModeUI(statusDisplay, hasPrivateBalance);
            
            console.log('[WalletManager] Payment mode:', hasPrivateBalance ? 'Private' : 'Public');
        } catch (error) {
            console.warn('Failed to update payment mode status:', error);
        }
    }
    
    /**
     * 更新支付模式 UI（内部方法）
     */
    _updatePaymentModeUI(statusDisplay, hasPrivateBalance) {
        statusDisplay.style.display = 'inline-flex';
        if (hasPrivateBalance) {
            statusDisplay.innerHTML = '<span style="color:#10b981;">🔒</span> Private';
            statusDisplay.title = 'Private Payment Mode - Your transactions are encrypted';
            statusDisplay.style.background = 'rgba(16, 185, 129, 0.15)';
            statusDisplay.style.color = '#10b981';
        } else {
            statusDisplay.innerHTML = '<span style="color:#f59e0b;">👁️</span> Public';
            statusDisplay.title = 'Public Payment Mode - Enable private payments in wallet menu';
            statusDisplay.style.background = 'rgba(245, 158, 11, 0.15)';
            statusDisplay.style.color = '#f59e0b';
        }
    }
    
    /**
     * 强制刷新支付模式状态（用于启用隐私支付后）
     */
    refreshPaymentModeStatus() {
        return this.updatePaymentModeStatus(true);
    }


    // ========== 统一连接入口（Leo Wallet 默认） ==========
    async connectWallet(walletType = 'leo') {
        if (walletType === 'leo') {
            return this.connectLeo();
        }
        // 其他钱包类型不再支持
        return { success: false, error: 'Only Leo Wallet is supported' };
	}

disconnectWallet() {
	    if (this.walletAddress) {
	        this.saveWalletSpecificData?.();
	    }
        
        // Leo Wallet 断开连接
        if (this.walletType === 'leo') {
            try {
                const provider = this.getLeoProvider();
                if (provider && typeof provider.disconnect === 'function') {
                    provider.disconnect();
	            }
	        } catch (error) {
                console.warn('Error disconnecting Leo Wallet:', error);
            }
        }
        
        // 清理 Leo Wallet 相关属性
        this.aleoPublicKey = null;
        this.leoAdapter = null;
        
        // 统一清理所有钱包类型的通用属性
	    this.walletAddress = null;
	    this.isConnected = false;
	    this.walletType = null;
	    this.credits = 0;
	    this.totalEarned = 0;
        
	    // Clear current session data (do not delete per-wallet archives)
	    try {
	        localStorage.removeItem('wallet_connected');
	        localStorage.removeItem('wallet_type');
	        localStorage.removeItem('user_credits');
	        localStorage.removeItem('total_earned');
	    } catch (_) {}
        
	    this.updateUI?.();
	    window.dispatchEvent(new CustomEvent('walletDisconnected'));
	    console.log('Wallet disconnected');
	}


	// Persist per-wallet archive
	saveWalletSpecificData() {
		if (!this.walletAddress) return;
		try {
			// 确保地址是字符串
			const addrStr = typeof this.walletAddress === 'string' ? this.walletAddress : String(this.walletAddress);
			const walletKey = `wallet_data_${addrStr.toLowerCase()}`;
			const walletData = {
				address: this.walletAddress,
				credits: this.credits,
				totalEarned: this.totalEarned || 0,
				lastCheckin: localStorage.getItem('last_checkin'),
				lastCheckinAt: localStorage.getItem('last_checkin_at'),
				totalCheckins: parseInt(localStorage.getItem('total_checkins') || '0'),
				transactions: JSON.parse(localStorage.getItem('credit_transactions') || '[]'),
				lastSaved: new Date().toISOString()
			};
			localStorage.setItem(walletKey, JSON.stringify(walletData));
			console.log(`💾 Saved data for wallet ${this.walletAddress}:`, walletData);
		} catch (error) {
			console.error('Error saving wallet-specific data:', error);
		}
	}

	// Load per-wallet archive into session
	loadWalletSpecificData() {
		if (!this.walletAddress) {
			console.warn('⚠️ No wallet address available for loading data');
			return;
		}

		try {
			const walletData = this.getWalletData(this.walletAddress);
			if (walletData) {
				console.log('📦 Local per-wallet archive found:', walletData);
				this.credits = walletData.credits || 0;
				this.totalEarned = walletData.totalEarned || 0;

				if (walletData.lastCheckin) {
					localStorage.setItem('last_checkin', walletData.lastCheckin);
				} else {
					localStorage.removeItem('last_checkin');
				}

				// Restore precise timestamp if present in local archive
				if (walletData.lastCheckinAt) {
					localStorage.setItem('last_checkin_at', String(walletData.lastCheckinAt));
				} else {
					localStorage.removeItem('last_checkin_at');
				}

				if (typeof walletData.totalCheckins === 'number') {
					localStorage.setItem('total_checkins', walletData.totalCheckins.toString());
				} else {
					localStorage.removeItem('total_checkins');
				}

				if (walletData.transactions && Array.isArray(walletData.transactions)) {
					localStorage.setItem('credit_transactions', JSON.stringify(walletData.transactions));
				} else {
					localStorage.removeItem('credit_transactions');
				}

				console.log(`📦 Loaded data for wallet ${this.walletAddress}:`, {
					credits: this.credits,
					totalEarned: this.totalEarned,
					lastCheckin: walletData.lastCheckin,
					totalCheckins: walletData.totalCheckins
				});
			} else {
				// No local archive - initialize local zero state, then attempt to hydrate from Firestore if available
				this.credits = 0;
				this.totalEarned = 0;
				localStorage.removeItem('last_checkin');
				localStorage.removeItem('total_checkins');
				localStorage.removeItem('credit_transactions');
				console.log(`🆕 No local data for wallet ${this.walletAddress}. Checking Firebase for existing record...`);
			}
		} catch (error) {
			console.error('Error loading wallet-specific data:', error);
			this.credits = 0;
			this.totalEarned = 0;
		}
	}

	// Attempt to fetch existing wallet record from Firestore and hydrate local/session state
	async fetchRemoteWalletDataIfAvailable() {
		if (!this.walletAddress) return;
		try {
			if (!window.firebaseDb) return;
			const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
			// 确保地址是字符串
			const addrStr = typeof this.walletAddress === 'string' ? this.walletAddress : String(this.walletAddress);
			const addrLower = addrStr.toLowerCase();
			let walletRef = doc(window.firebaseDb, 'wallets', addrLower);
			let snap = await getDoc(walletRef);
			if (!snap.exists()) {
				walletRef = doc(window.firebaseDb, 'wallets', this.walletAddress);
				snap = await getDoc(walletRef);
			}
			if (snap.exists()) {
				const data = snap.data() || {};
				console.log('🌐 Firestore wallet snapshot:', data);
				console.log('🔁 Updating credits from local', this.credits, '→ remote', Number(data.credits || 0));
				// ===== PATCH W2 (replace the assignment line) =====
				const remote = Number(data.credits ?? 0);
				// 远端如果为 0，不要把本地刚签到的 30 覆盖掉；只在远端更大时采用远端
				if (Number.isFinite(remote) && remote > this.credits) {
  					this.credits = remote;
				}

				// totalEarned is not tracked in server; keep local aggregation if any
				if (data.lastCheckinAt && typeof data.lastCheckinAt.toMillis === 'function') {
					try { localStorage.setItem('last_checkin_at', String(data.lastCheckinAt.toMillis())); } catch (_) {}
				}
				if (typeof data.totalCheckins === 'number') {
					try { localStorage.setItem('total_checkins', String(data.totalCheckins)); } catch (_) {}
				}
				this.saveToStorage();
				this.updateUI();
				try {
					window.dispatchEvent(new CustomEvent('walletUpdated', {
						detail: { address: this.walletAddress, credits: this.credits }
					}));
				} catch (_) {}
				console.log(`📡 Loaded wallet data from Firestore for ${this.walletAddress}:`, { credits: this.credits });
			} else {
				console.log(`📭 No existing Firestore record for wallet ${this.walletAddress}`);
			}
		} catch (e) {
			console.warn('Failed to fetch remote wallet data:', e);
		}
	}


	getWalletData(address) {
		if (!address) return null;
		try {
			// 确保地址是字符串
			const addrStr = typeof address === 'string' ? address : String(address);
			const walletKey = `wallet_data_${addrStr.toLowerCase()}`;
			const data = localStorage.getItem(walletKey);
			return data ? JSON.parse(data) : null;
		} catch (error) {
			console.error('Error getting wallet data:', error);
			return null;
		}
	}

	// Daily check-in with 24h gating support via local last_checkin_at
	async dailyCheckin(options = {}) {
		const skipLocalGate = !!options.skipLocalGate;
		if (!this.isConnected) {
			return { success: false, error: 'Please connect your wallet first' };
		}

		if (!skipLocalGate) {
			const nowMs = Date.now();
			const lastCheckinAtMs = parseInt(localStorage.getItem('last_checkin_at') || '0', 10);
			if (lastCheckinAtMs > 0) {
				const DAY_MS = 24 * 60 * 60 * 1000;
				if (nowMs - lastCheckinAtMs < DAY_MS) {
					return { success: false, error: 'Already checked in recently. Please try again later.' };
				}
			} else {
				// Fallback to date-based gate for legacy data
				const now = new Date();
				const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
				const lastCheckin = localStorage.getItem('last_checkin');
				if (lastCheckin === today) {
					return { success: false, error: 'Already checked in today! Come back tomorrow.' };
				}
			}
		}

		const reward = (window.APP_CONFIG?.pricing?.dailyCheckInRewardUsdc) || (window.PricingUtils?.constants?.dailyCheckInRewardUsdc) || 0.01;
		const DAILY_REWARD = Number(reward);

		let claimResult = null;
		try {
			if (window.MCPClient && typeof window.MCPClient.claimCheckin === 'function') {
				const response = await window.MCPClient.claimCheckin({ wallet_address: this.walletAddress });
				if (response.status !== 'ok') {
					return { success: false, error: response.error?.message || 'Check-in failed via MCP.' };
				}
				claimResult = response.result;
			}
		} catch (err) {
			console.warn('[dailyCheckin] MCP claim failed:', err);
			return { success: false, error: err?.message || 'Check-in failed via MCP.' };
		}

		this.credits += DAILY_REWARD;
		this.totalEarned = (this.totalEarned || 0) + DAILY_REWARD;

		const totalCheckins = parseInt(localStorage.getItem('total_checkins') || '0') + 1;
		// Maintain legacy date-based key alongside timestamp for backward compatibility
		try {
			const nowForLegacy = new Date();
			const today = `${nowForLegacy.getFullYear()}-${String(nowForLegacy.getMonth() + 1).padStart(2, '0')}-${String(nowForLegacy.getDate()).padStart(2, '0')}`;
			localStorage.setItem('last_checkin', today);
		} catch (_) {}
		try { localStorage.setItem('last_checkin_at', String(Date.now())); } catch (_) {}
		localStorage.setItem('total_checkins', totalCheckins.toString());

		this.saveToStorage();
		this.saveWalletSpecificData();
		this.updateUI();
		// ===== PATCH W3: persist to Firestore after local update =====
		try {
 	 		const lastMs  = parseInt(localStorage.getItem('last_checkin_at') || String(Date.now()), 10);
  			const totalChk = parseInt(localStorage.getItem('total_checkins') || '0', 10);

  			__i3_saveRemoteWalletData(window.firebaseDb, this.walletAddress, {
    		credits: this.credits,
    		totalCheckins: totalChk,
    		lastCheckinAtMs: lastMs
  		}).catch(e => console.warn('[dailyCheckin] remote persist failed:', e));
		} catch (e) {
  		console.warn('[dailyCheckin] remote persist try-block failed:', e);
		}


		this.recordTransaction(DAILY_REWARD, 'daily_checkin');

		window.dispatchEvent(new CustomEvent('dailyCheckinSuccess', {
			detail: {
				reward: DAILY_REWARD,
				newBalance: this.credits,
				totalCheckins: totalCheckins,
				mcp: claimResult
			}
		}));

		console.log(`Daily checkin successful! Earned ${DAILY_REWARD} ALEO.`, claimResult);

		return {
			success: true,
			reward: DAILY_REWARD,
			newBalance: this.credits,
			totalCheckins: totalCheckins,
			mcp: claimResult
		};
	}

	canCheckinToday() {
		// Prefer Firestore-hydrated timestamp for a precise 24h window
		const lastCheckinAtMs = parseInt(localStorage.getItem('last_checkin_at') || '0', 10);
		if (!Number.isNaN(lastCheckinAtMs) && lastCheckinAtMs > 0) {
			const DAY_MS = 24 * 60 * 60 * 1000;
			return (Date.now() - lastCheckinAtMs) >= DAY_MS;
		}
		// Fallback to legacy date-based gating if timestamp missing
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const lastCheckin = localStorage.getItem('last_checkin');
		return lastCheckin !== today;
	}

	loadFromStorage() {
		try {
			const savedWallet = localStorage.getItem('wallet_connected');
			if (savedWallet) {
				this.walletAddress = savedWallet;
				this.isConnected = true;
				this.walletType = localStorage.getItem('wallet_type') || 'metamask';
				this.loadWalletSpecificData();
				console.log(`🔄 Restored wallet session: ${this.walletAddress} with ${this.credits} I3 tokens`);
				
				// 如果是 Leo Wallet，自动尝试重新连接以获取 provider.publicKey
				// 这样在页面刷新后也能正常使用支付功能
				if (this.walletType === 'leo') {
					this.autoReconnectLeoWallet();
				}
				
				// Immediately reconcile with Firestore so server-side credit changes reflect after refresh
				try {
					if (typeof this.fetchRemoteWalletDataIfAvailable === 'function') {
						this.fetchRemoteWalletDataIfAvailable().then(() => {
							console.log('🔁 Reconciled with Firestore after restore. Credits now:', this.credits);
							this.loadWalletSpecificData();
							this.saveToStorage();
							this.updateUI();
							try { window.dispatchEvent(new CustomEvent('walletUpdated', { detail: { address: this.walletAddress, credits: this.credits } })); } catch (_) {}
						});
					}
				} catch (e) { console.warn('Post-restore reconcile skipped:', e); }
			}
		} catch (error) {
			console.error('Error loading wallet data:', error);
		}
	}
	
	// 自动重新连接 Leo Wallet（页面刷新后恢复 provider 连接）
	// 重要：不主动调用 connect() 以避免触发钱包弹窗
	// 只检查 provider 是否已经有 publicKey（用户之前已授权的情况）
	async autoReconnectLeoWallet() {
		console.log('[Leo] 🔄 autoReconnectLeoWallet() called');
		
		// 防止重复调用
		if (this._autoReconnectInProgress) {
			console.log('[Leo] Auto-reconnect already in progress, skipping');
			return;
		}
		this._autoReconnectInProgress = true;
		
		try {
			// 等待 Leo Wallet 扩展加载完成
			let leoWallet = window.leoWallet || window.leo;
			
			// 如果 Leo Wallet 还没加载，等待一下
			if (!leoWallet) {
				console.log('[Leo] Leo Wallet not yet available, waiting 500ms...');
				await new Promise(resolve => setTimeout(resolve, 500));
				leoWallet = window.leoWallet || window.leo;
			}
			
			if (!leoWallet) {
				console.log('[Leo] Leo Wallet still not available after wait');
				this._autoReconnectInProgress = false;
				return;
			}
			
			console.log('[Leo] Leo Wallet provider found, checking publicKey...');
			console.log('[Leo] Current provider.publicKey:', leoWallet.publicKey);
			
			// 检查是否已经有 publicKey（用户之前已授权且浏览器会话未过期）
			if (leoWallet.publicKey) {
				const pk = typeof leoWallet.publicKey === 'string' 
					? leoWallet.publicKey 
					: leoWallet.publicKey.toString();
				console.log('[Leo] ✅ Provider already has publicKey:', pk);
				
				// 验证 publicKey 与保存的地址一致
				if (pk !== this.walletAddress) {
					console.warn('[Leo] publicKey mismatch! Updating walletAddress from provider');
					console.warn('[Leo] Old walletAddress:', this.walletAddress);
					console.warn('[Leo] New publicKey:', pk);
					this.walletAddress = pk;
					this.aleoPublicKey = pk;
					this.saveToStorage();
				}
				
				this.leoAdapter = leoWallet;
				this.setupLeoEventListeners();
				this._autoReconnectInProgress = false;
				return;
			}
			
			// ======== 重要修改 ========
			// 不主动调用 connect()，因为这会触发钱包弹窗
			// 用户需要点击钱包按钮手动重新连接
			// 这避免了页面加载时不停弹窗的问题
			console.log('[Leo] ⚠️ Provider has no publicKey (session expired or not authorized)');
			console.log('[Leo] 💡 User needs to click wallet button to reconnect manually');
			
			// 保持 UI 显示已连接状态（地址仍然有效），但标记需要重新授权
			// 当用户尝试进行交易时，aleo-payment.js 的 waitForLeoWalletReady() 会处理重连
			this._needsReauthorization = true;
			
		} catch (error) {
			console.warn('[Leo] ❌ Auto-reconnect error:', error);
		} finally {
			this._autoReconnectInProgress = false;
		}
	}

	saveToStorage() {
		try {
			if (this.isConnected) {
				localStorage.setItem('wallet_connected', this.walletAddress);
				localStorage.setItem('wallet_type', this.walletType || 'metamask'); 
				localStorage.setItem('user_credits', this.credits.toString());
				localStorage.setItem('total_earned', (this.totalEarned || 0).toString());
				this.saveWalletSpecificData();
			}
		} catch (error) {
			console.error('Error saving wallet data:', error);
		}
	}

	spendCredits(amount, reason = 'model_usage') {
		if (!this.isConnected) {
			return { success: false, error: 'Please connect your wallet first' };
		}
		if (amount <= 0) {
			return { success: false, error: 'Invalid amount' };
		}

		// Allow negative balance; caller may prompt user to top up
		this.credits -= amount;
		this.saveToStorage();
		this.updateUI();
		this.recordTransaction(-amount, reason);

		window.dispatchEvent(new CustomEvent('creditsSpent', {
			detail: { amount: amount, newBalance: this.credits, reason: reason }
		}));

		// Fire an event when credits drop to zero or below so UIs can prompt top-up
		if (this.credits <= 0) {
			try {
				window.dispatchEvent(new CustomEvent('creditsLow', { detail: { newBalance: this.credits } }));
			} catch (_) {}
		}

		return { success: true, spent: amount, newBalance: this.credits };
	}

	recordTransaction(amount, reason) {
		try {
			const transactions = JSON.parse(localStorage.getItem('credit_transactions') || '[]');
			transactions.push({
				amount: amount,
				reason: reason,
				timestamp: new Date().toISOString(),
				balance: this.credits
			});
			const recentTransactions = transactions.slice(-100);
			localStorage.setItem('credit_transactions', JSON.stringify(recentTransactions));
			if (this.walletAddress) {
				this.saveWalletSpecificData();
			}
		} catch (error) {
			console.error('Error recording transaction:', error);
		}
	}

	getCheckinStatus() {
		const lastCheckin = localStorage.getItem('last_checkin');
		const lastCheckinAt = localStorage.getItem('last_checkin_at');
		const totalCheckins = parseInt(localStorage.getItem('total_checkins') || '0');
		return {
			canCheckin: this.canCheckinToday(),
			lastCheckin: lastCheckin,
			lastCheckinAt: lastCheckinAt ? Number(lastCheckinAt) : null,
			totalCheckins: totalCheckins
		};
	}

	getUserInfo() {
		return {
			isConnected: this.isConnected,
			address: this.walletAddress,
			credits: this.credits,
			totalEarned: this.totalEarned || 0,
			checkinStatus: this.getCheckinStatus()
		};
	}

    // setupEventListeners 已移至 setupLeoEventListeners

	updateUI() {
		const accountBtnText = document.getElementById('accountBtnText');
        const paymentModeStatus = document.getElementById('paymentModeStatus');
        const connectBtn = document.getElementById('connectWalletBtn');
        const checkinBtn = document.getElementById('checkinBtn');
        const checkinStatus = document.getElementById('checkinStatus');
        
		// 右侧钱包类型小图标
		if (typeof window.setWalletTypeIcon === 'function') {
			window.setWalletTypeIcon(this.walletType || null);
		}
        
		if (this.isConnected && this.walletAddress) {
			// 已连接 —— 按钮显示地址
            // Aleo 地址格式: aleo1... (较长，截取前10后6)
			if (accountBtnText) {
                const addr = this.walletAddress;
                if (addr.startsWith('aleo1')) {
                    accountBtnText.textContent = `${addr.slice(0, 10)}...${addr.slice(-6)}`;
                } else {
                    accountBtnText.textContent = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
                }
            }
            
            // 已连接 —— 如果是 Leo Wallet，显示支付模式状态（不显示余额，保护隐私）
            const paymentModeStatus = document.getElementById('paymentModeStatus');
            if (paymentModeStatus && this.walletType === 'leo') {
                this.updatePaymentModeStatus();
            } else if (paymentModeStatus) {
                paymentModeStatus.style.display = 'none';
            }
            
			// Connect/Disconnect 按钮
			if (connectBtn) {
				connectBtn.textContent = 'Disconnect Wallet';
				connectBtn.removeAttribute('onclick');
				connectBtn.onclick = () => this.disconnectWallet();
			}
            
			// Daily Check-in 状态
			if (checkinBtn) {
				// 检查是否是 Admin 用户
				const isAdminUser = (
					typeof window.isAdmin === 'function' && 
					window.currentUser && 
					window.currentUser.email && 
					window.isAdmin() === true
				);
				
				if (isAdminUser) {
					// Admin: 使用本地状态检查
					const canCheckin = this.canCheckinToday();
					checkinBtn.textContent = canCheckin ? 'Daily Check-in' : 'Already Checked-in Today';
					checkinBtn.disabled = !canCheckin;
					checkinBtn.style.opacity = canCheckin ? '1' : '0.6';
					checkinBtn.style.cursor = canCheckin ? 'pointer' : 'not-allowed';
				} else {
					// 非 Admin: 始终显示可点击状态
					checkinBtn.textContent = 'Daily Check-in';
					checkinBtn.disabled = false;
					checkinBtn.style.opacity = '1';
					checkinBtn.style.cursor = 'pointer';
				}
				
				checkinBtn.style.background = 'linear-gradient(135deg, #8b5cf6, #7c3aed)';
				checkinBtn.style.color = '#ffffff';
				checkinBtn.style.border = '1px solid #e5e7eb';
			}
			if (checkinStatus) checkinStatus.style.display = 'block';
		} else {
            // 未连接 —— 只显示 Login，隐藏支付模式状态
			if (accountBtnText) {
				accountBtnText.textContent = 'Login';
			}
            if (paymentModeStatus) {
                paymentModeStatus.style.display = 'none';
			}
			// Connect/Disconnect 按钮
			if (connectBtn) {
				connectBtn.textContent = 'Connect Wallet';
				connectBtn.removeAttribute('onclick');
				connectBtn.setAttribute('onclick', 'showWalletSelectionModal()');
			}
			// Daily Check-in 置灰
			if (checkinBtn) {
				checkinBtn.textContent = 'Daily Check-in';
				checkinBtn.disabled = true;
				checkinBtn.style.opacity = '0.4';
				checkinBtn.style.background = '#f3f4f6';
				checkinBtn.style.color = '#9ca3af';
				checkinBtn.style.border = '1px solid #e5e7eb';
				checkinBtn.style.cursor = 'not-allowed';
			}
			if (checkinStatus) checkinStatus.style.display = 'none';
		}
	}

}

// ===== PATCH W1: save remote wallet data to Firestore (TOP-LEVEL, OUTSIDE ANY CLASS) =====
async function __i3_saveRemoteWalletData(db, address, { credits, totalCheckins, lastCheckinAtMs } = {}) {
  try {
    if (!db || !address) return;
    const isEvm = /^0x/i.test(address);                       // EVM 小写化；Solana 保持原样
    const docId = isEvm ? address.toLowerCase() : address;

    const { doc, setDoc, serverTimestamp } =
      await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');

    const ref = doc(db, 'wallets', docId);
    const payload = { lastUpdated: serverTimestamp() };

    if (Number.isFinite(credits)) {
      payload.credits = Number(credits);
    }
    if (Number.isFinite(totalCheckins)) {
      payload.totalCheckins = Number(totalCheckins);
    }
    if (Number.isFinite(lastCheckinAtMs)) {
      payload.lastCheckinAt = new Date(lastCheckinAtMs);
    }

    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    console.warn('[__i3_saveRemoteWalletData] failed:', e);
  }
}
// 让其他脚本（如 solana-checkin.js）可调用
window.__i3_saveRemoteWalletData = __i3_saveRemoteWalletData;

// Create global instance
window.walletManager = new WalletManager();

// Initialize UI after page load
document.addEventListener('DOMContentLoaded', function() {
	setTimeout(() => {
		if (window.walletManager) {
			window.walletManager.updateUI();
		}
	}, 1000);
});

console.log('Leo Wallet Manager loaded successfully');