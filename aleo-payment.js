/**
 * Aleo Payment Module - Leo Wallet Integration
 * 
 * 使用 Leo Wallet 进行 Aleo 链上支付
 * 优先使用 transfer_private (私密转账)，保护用户隐私
 * 接收地址: aleo1ultapnts8mjyfv5qq8qs88d55p9c60dme6h0e5zgcwdd7fyl5cpscgjwl2
 */

(function() {
    'use strict';

    // 平台收款地址
    const PLATFORM_RECIPIENT = 'aleo1ultapnts8mjyfv5qq8qs88d55p9c60dme6h0e5zgcwdd7fyl5cpscgjwl2';
    
    // Aleo Credits 精度 (1 Credit = 1,000,000 microcredits)
    const MICROCREDITS_PER_CREDIT = 1_000_000;
    
    // 默认交易费用 (microcredits)
    const DEFAULT_FEE = 25_000; // 0.025 Credits (transfer_private 需要更多 gas)

    /**
     * 获取 Leo Wallet Provider
     */
    function getLeoProvider() {
        if (window.leoWallet) {
            return window.leoWallet;
        }
        if (window.leo) {
            return window.leo;
        }
        return null;
    }

    /**
     * 检查 Leo Wallet 是否可用且已连接
     */
    function isLeoWalletReady() {
        const provider = getLeoProvider();
        if (!provider) {
            return { ready: false, error: 'Leo Wallet not installed' };
        }
        
        // 优先从 provider 直接获取 publicKey（最可靠的来源）
        // 这样即使 walletManager.walletAddress 被污染也能获取正确的地址
        let publicKey = null;
        
        if (provider.publicKey) {
            publicKey = typeof provider.publicKey === 'string' 
                ? provider.publicKey 
                : provider.publicKey.toString();
            console.log('[AleoPayment] Got publicKey from provider:', publicKey);
        }
        
        // 如果 provider 没有 publicKey，尝试从 walletManager 获取
        if (!publicKey && window.walletManager && window.walletManager.isConnected && window.walletManager.walletType === 'leo') {
            publicKey = window.walletManager.walletAddress;
            console.log('[AleoPayment] Got publicKey from walletManager:', publicKey);
        }
        
        // 验证 publicKey 是有效的 Aleo 地址格式，且不是平台收款地址
        if (publicKey) {
            // 确保不是平台收款地址（用户不应该从平台地址发送）
            if (publicKey === PLATFORM_RECIPIENT) {
                console.error('[AleoPayment] ERROR: publicKey is same as PLATFORM_RECIPIENT! This is wrong.');
                console.error('[AleoPayment] walletManager.walletAddress:', window.walletManager?.walletAddress);
                console.error('[AleoPayment] provider.publicKey:', provider.publicKey);
                // 尝试重新从 provider 获取
                if (provider.publicKey && provider.publicKey !== PLATFORM_RECIPIENT) {
                    publicKey = typeof provider.publicKey === 'string' 
                        ? provider.publicKey 
                        : provider.publicKey.toString();
                    console.log('[AleoPayment] Corrected publicKey from provider:', publicKey);
                } else {
                    return { ready: false, error: 'Invalid wallet address detected. Please reconnect your wallet.' };
                }
            }
            
            return { 
                ready: true, 
                provider,
                publicKey: publicKey
            };
        }
        
        return { ready: false, error: 'Leo Wallet not connected. Please reconnect.' };
    }

    /**
     * 等待 Leo Wallet 连接就绪（用于支付场景）
     * 
     * - 如果 provider 已有 publicKey，直接返回 ready
     * - 如果 provider 没有 publicKey 但 walletManager 显示已连接，主动尝试重新连接
     * - 支持 autoReconnect 参数控制是否主动弹窗重连
     * 
     * @param {number} maxWaitMs - 最大等待时间（毫秒）
     * @param {number} checkIntervalMs - 检查间隔（毫秒）
     * @param {boolean} autoReconnect - 是否允许主动调用 connect() 重连（默认 true）
     * @returns {Promise<{ready: boolean, provider?: Object, publicKey?: string, error?: string}>}
     */
    async function waitForLeoWalletReady(maxWaitMs = 5000, checkIntervalMs = 200, autoReconnect = false) {
        const startTime = Date.now();
        const provider = getLeoProvider();
        const wm = window.walletManager;
        
        // 情况 1: provider 已经有 publicKey（最理想的情况）
        if (provider && provider.publicKey) {
            console.log('[AleoPayment] Provider already connected with publicKey');
            return isLeoWalletReady();
        }
        
        // 情况 2: walletManager 显示已连接但 provider 没有 publicKey
        // 这说明浏览器会话已过期，需要重新授权
        if (wm && wm.isConnected && wm.walletType === 'leo' && provider) {
            console.log('[AleoPayment] Session may have expired, provider.publicKey is empty');
            
            // 先短暂等待，看看 provider 是否会自动恢复
            let waitCount = 0;
            const maxWaitCount = 3;
            
            while (waitCount < maxWaitCount) {
                await new Promise(resolve => setTimeout(resolve, 200));
                waitCount++;
                
                if (provider.publicKey) {
                    const pk = typeof provider.publicKey === 'string' 
                        ? provider.publicKey 
                        : provider.publicKey.toString();
                    console.log('[AleoPayment] Provider publicKey became available after wait:', pk);
                    return {
                        ready: true,
                        provider,
                        publicKey: pk
                    };
                }
            }
            
            // 如果允许自动重连，主动调用 connect()
            if (autoReconnect && typeof provider.connect === 'function') {
                console.log('[AleoPayment] Attempting auto-reconnect to Leo Wallet...');
                
                try {
                    // 使用适当的连接参数
                    const decryptPermission = 'ViewKeyAccess';
                    const network = 'testnetbeta';
                    const programs = ['credits.aleo'];
                    
                    const connectResult = await provider.connect(decryptPermission, network, programs);
                    console.log('[AleoPayment] Auto-reconnect result:', connectResult);
                    
                    // 等待 provider 更新
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // 检查连接结果
                    let newPublicKey = null;
                    
                    if (connectResult && typeof connectResult === 'object') {
                        newPublicKey = connectResult.publicKey || connectResult.address;
                    }
                    
                    if (!newPublicKey && provider.publicKey) {
                        newPublicKey = provider.publicKey;
                    }
                    
                    if (newPublicKey) {
                        const pk = typeof newPublicKey === 'string' ? newPublicKey : newPublicKey.toString();
                        console.log('[AleoPayment] Auto-reconnect successful, publicKey:', pk);
                        
                        // 更新 walletManager
                        if (wm) {
                            wm.walletAddress = pk;
                            wm.aleoPublicKey = pk;
                            if (typeof wm.saveToStorage === 'function') {
                                wm.saveToStorage();
                            }
                        }
                        
                        return {
                            ready: true,
                            provider,
                            publicKey: pk
                        };
                    }
                    
                    console.warn('[AleoPayment] Auto-reconnect did not return publicKey');
                } catch (connectError) {
                    console.warn('[AleoPayment] Auto-reconnect failed:', connectError.message);
                    
                    // 如果用户拒绝了连接请求
                    if (connectError.message && (
                        connectError.message.includes('reject') ||
                        connectError.message.includes('denied') ||
                        connectError.message.includes('cancel')
                    )) {
                        return {
                            ready: false,
                            error: 'Connection request was declined. Please try again.',
                            cancelled: true
                        };
                    }
                }
            }
            
            // 重连失败，提示用户手动操作
            console.warn('[AleoPayment] Session expired. User needs to reconnect wallet.');
            return {
                ready: false,
                error: 'Wallet session expired. Please click the wallet button to reconnect Leo Wallet.',
                needsReconnect: true
            };
        }
        
        // 情况 3: 完全没有连接
        if (!wm || !wm.isConnected) {
            return {
                ready: false,
                error: 'Please connect your Leo Wallet first.'
            };
        }
        
        // 情况 4: 连接的不是 Leo Wallet
        if (wm.walletType !== 'leo') {
            return {
                ready: false,
                error: 'Please connect with Leo Wallet for Aleo payments.'
            };
        }
        
        // 情况 5: 没有 provider（扩展未安装）
        if (!provider) {
            return {
                ready: false,
                error: 'Leo Wallet extension not detected. Please install Leo Wallet.'
            };
        }
        
        return {
            ready: false,
            error: 'Unable to connect to Leo Wallet. Please try refreshing the page.'
        };
    }

    /**
     * 等待获取真正的链上交易 ID
     * Leo Wallet 的 requestTransaction 可能返回本地请求 ID（UUID 格式）
     * 真正的 Aleo 交易 ID 格式为 at1...
     * 
     * @param {Object} leoWallet - Leo Wallet provider
     * @param {string} localTxId - requestTransaction 返回的 ID
     * @param {string} transferType - 'public' 或 'private'
     * @param {number} maxWaitMs - 最大等待时间（毫秒）
     * @returns {Promise<string>} 真正的交易 ID
     */
    async function waitForRealTransactionId(leoWallet, localTxId, transferType = 'unknown', maxWaitMs = 30000) {
        // 如果已经是有效的 Aleo 交易 ID，直接返回
        if (localTxId && typeof localTxId === 'string' && localTxId.startsWith('at1')) {
            console.log(`[AleoPayment] ✅ Already valid Aleo transaction ID: ${localTxId}`);
            return localTxId;
        }
        
        console.log(`[AleoPayment] 🔄 Waiting for real transaction ID...`);
        console.log(`[AleoPayment] Local request ID: ${localTxId}`);
        console.log(`[AleoPayment] Transfer type: ${transferType}`);
        console.log(`[AleoPayment] Max wait time: ${maxWaitMs}ms`);
        
        // 检查 transactionStatus 方法是否可用
        if (!leoWallet || typeof leoWallet.transactionStatus !== 'function') {
            console.warn('[AleoPayment] ⚠️ transactionStatus method not available');
            console.warn('[AleoPayment] Cannot poll for real transaction ID');
            throw new Error('Unable to verify transaction. Leo Wallet transactionStatus not available.');
        }
        
        const startTime = Date.now();
        const pollInterval = 2000; // 每 2 秒检查一次
        let attempt = 0;
        
        while (Date.now() - startTime < maxWaitMs) {
            attempt++;
            console.log(`[AleoPayment] Polling attempt ${attempt}...`);
            
            try {
                const status = await leoWallet.transactionStatus(localTxId);
                console.log(`[AleoPayment] Transaction status (attempt ${attempt}):`, status);
                
                // 检查各种可能的字段名
                const realTxId = status?.transactionId || 
                                 status?.transaction_id || 
                                 status?.txId || 
                                 status?.id ||
                                 status?.hash ||
                                 status?.txHash;
                
                if (realTxId && typeof realTxId === 'string' && realTxId.startsWith('at1')) {
                    console.log(`[AleoPayment] ✅ Got real transaction ID after ${attempt} attempts: ${realTxId}`);
                    return realTxId;
                }
                
                // 检查交易状态
                const txStatus = status?.status || status?.state;
                if (txStatus) {
                    console.log(`[AleoPayment] Transaction status: ${txStatus}`);
                    
                    // 如果交易失败，抛出错误
                    if (txStatus === 'failed' || txStatus === 'rejected' || txStatus === 'error') {
                        throw new Error(`Transaction ${txStatus}: ${status?.error || status?.message || 'Unknown error'}`);
                    }
                    
                    // 如果交易被广播/确认，继续等待真正的 ID
                    if (txStatus === 'broadcast' || txStatus === 'pending' || txStatus === 'processing') {
                        console.log(`[AleoPayment] Transaction is ${txStatus}, continuing to wait...`);
                    }
                }
                
            } catch (statusError) {
                console.warn(`[AleoPayment] Status check error (attempt ${attempt}):`, statusError.message);
                
                // 如果是明确的失败错误，不再重试
                if (statusError.message.includes('failed') || 
                    statusError.message.includes('rejected') ||
                    statusError.message.includes('insufficient')) {
                    throw statusError;
                }
            }
            
            // 等待后继续轮询
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
        // 超时
        console.error(`[AleoPayment] ❌ Timeout waiting for real transaction ID after ${maxWaitMs}ms`);
        throw new Error(`Transaction broadcast timeout. The transaction may still be processing. Local ID: ${localTxId}`);
    }

    /**
     * 将 ALEO 金额转换为 microcredits
     * @param {number|string} aleoAmount - ALEO 金额
     * @returns {number} microcredits
     */
    function aleoToMicrocredits(aleoAmount) {
        const amount = parseFloat(aleoAmount) || 0;
        return Math.floor(amount * MICROCREDITS_PER_CREDIT);
    }

    /**
     * 将 microcredits 转换为 ALEO
     * @param {number} microcredits 
     * @returns {string}
     */
    function microcreditsToAleo(microcredits) {
        return (microcredits / MICROCREDITS_PER_CREDIT).toFixed(6);
    }

    /**
     * 获取当前网络
     */
    function getCurrentNetwork() {
        try {
            if (typeof getPreferredNetwork === 'function') {
                const preferred = getPreferredNetwork();
                if (preferred && preferred.network) {
                    return preferred.network; // 'mainnet' 或 'testnetbeta'
                }
            }
        } catch (e) {
            console.warn('[AleoPayment] Failed to get preferred network:', e);
        }
        return 'mainnet'; // 默认主网
    }

    /**
     * 获取用户的私密 credits records
     * @returns {Promise<Array>} records 数组
     */
    async function getPrivateRecords() {
        const provider = getLeoProvider();
        if (!provider) {
            console.warn('[AleoPayment] No Leo Wallet provider');
            return [];
        }

        // 打印所有可用方法
        console.log('[AleoPayment] Provider methods:', Object.getOwnPropertyNames(provider));
        console.log('[AleoPayment] Provider prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(provider) || {}));
        
        // 检查 adapter 属性
        if (provider.adapter) {
            console.log('[AleoPayment] Has adapter property:', Object.getOwnPropertyNames(provider.adapter));
        }

        try {
            // 尝试不同的 API 调用方式
            let rawResult = null;
            
            // 方式1: requestRecords(programId)
            if (typeof provider.requestRecords === 'function') {
                console.log('[AleoPayment] Trying requestRecords("credits.aleo")...');
                try {
                    rawResult = await provider.requestRecords('credits.aleo');
                    console.log('[AleoPayment] requestRecords raw result:', rawResult);
                    console.log('[AleoPayment] Result type:', typeof rawResult);
                    console.log('[AleoPayment] Is array:', Array.isArray(rawResult));
                    if (rawResult) {
                        console.log('[AleoPayment] Result keys:', Object.keys(rawResult));
                    }
                } catch (e1) {
                    console.warn('[AleoPayment] requestRecords("credits.aleo") failed:', e1.message);
                    
                    // 方式2: 尝试传入对象参数
                    try {
                        console.log('[AleoPayment] Trying requestRecords with object param...');
                        rawResult = await provider.requestRecords({ program: 'credits.aleo' });
                        console.log('[AleoPayment] requestRecords with object succeeded:', rawResult);
                    } catch (e2) {
                        console.warn('[AleoPayment] requestRecords with object failed:', e2.message);
                    }
                }
            }
            
            // 解析返回结果 - 处理不同的格式
            let records = [];
            
            if (rawResult) {
                if (Array.isArray(rawResult)) {
                    // 格式1: 直接是数组
                    records = rawResult;
                    console.log('[AleoPayment] Result is array with', records.length, 'records');
                } else if (typeof rawResult === 'object') {
                    // 格式2: 可能是 { records: [...] } 或 { data: [...] }
                    if (Array.isArray(rawResult.records)) {
                        records = rawResult.records;
                        console.log('[AleoPayment] Extracted records from result.records:', records.length, 'records');
                    } else if (Array.isArray(rawResult.data)) {
                        records = rawResult.data;
                        console.log('[AleoPayment] Extracted records from result.data:', records.length, 'records');
                    } else {
                        // 格式3: 可能是单个 record 对象
                        // 检查是否有 record 的典型属性
                        if (rawResult.ciphertext || rawResult.plaintext || rawResult.nonce || rawResult.owner) {
                            records = [rawResult];
                            console.log('[AleoPayment] Result appears to be a single record');
                        } else {
                            // 尝试获取所有值
                            const values = Object.values(rawResult);
                            if (values.length > 0 && values.every(v => typeof v === 'object')) {
                                records = values;
                                console.log('[AleoPayment] Extracted', records.length, 'records from object values');
                            }
                        }
                    }
                }
            }
            
            if (records.length > 0) {
                // 打印每个 record 的详细信息
                console.log('[AleoPayment] Found', records.length, 'total records:');
                records.forEach((rec, i) => {
                    console.log(`[AleoPayment] Record ${i}:`, JSON.stringify(rec, null, 2));
                    const microcredits = extractMicrocreditsFromRecord(rec);
                    console.log(`[AleoPayment] Record ${i} balance:`, microcredits.toString(), 'microcredits =', microcreditsToAleo(Number(microcredits)), 'ALEO');
                });
                
                // 过滤出未花费的记录
                const unspentRecords = records.filter(rec => !rec.spent);
                console.log('[AleoPayment] Unspent records:', unspentRecords.length);
                
                if (unspentRecords.length > 0) {
                    return unspentRecords;
                }
            }
            
            console.log('[AleoPayment] ⚠️ No private records found.');
            console.log('[AleoPayment] 💡 To use private transfers, you need private records.');
            console.log('[AleoPayment] 💡 You can convert public balance to private using transfer_public_to_private.');
            return [];
        } catch (error) {
            console.warn('[AleoPayment] Failed to get records:', error);
        }

        return [];
    }

    /**
     * 从 record 中提取 microcredits 金额
     * @param {Object} record 
     * @returns {bigint}
     */
    function extractMicrocreditsFromRecord(record) {
        try {
            // record 可能有不同的格式
            // 格式1: { plaintext: "{ owner: aleo1..., microcredits: 1000000u64.private }" }
            // 格式2: { data: { microcredits: "1000000u64" } }
            // 格式3: { microcredits: "1000000u64" }
            
            let microcreditsStr = null;

            if (record.plaintext && typeof record.plaintext === 'string') {
                // 从 plaintext 字符串中提取
                const match = record.plaintext.match(/microcredits:\s*(\d+)u64/);
                if (match) {
                    microcreditsStr = match[1];
                }
            } else if (record.data && record.data.microcredits) {
                microcreditsStr = record.data.microcredits.replace(/u64.*$/, '');
            } else if (record.microcredits) {
                microcreditsStr = String(record.microcredits).replace(/u64.*$/, '');
            }

            if (microcreditsStr) {
                return BigInt(microcreditsStr);
            }
        } catch (e) {
            console.warn('[AleoPayment] Failed to extract microcredits:', e);
        }

        return BigInt(0);
    }

    /**
     * 查找足够余额的 record
     * @param {Array} records 
     * @param {number} requiredMicrocredits 
     * @param {number} fee 
     * @returns {Object|null}
     */
    function findSufficientRecord(records, requiredMicrocredits, fee) {
        const totalRequired = BigInt(requiredMicrocredits) + BigInt(fee);
        
        for (const record of records) {
            const balance = extractMicrocreditsFromRecord(record);
            console.log('[AleoPayment] Record balance:', balance.toString(), 'Required:', totalRequired.toString());
            
            if (balance >= totalRequired) {
                return record;
            }
        }
        
        return null;
    }

    /**
     * 获取用户的总私密余额
     * @returns {Promise<{total: bigint, records: Array}>}
     */
    async function getPrivateBalance() {
        const records = await getPrivateRecords();
        let total = BigInt(0);
        
        for (const record of records) {
            total += extractMicrocreditsFromRecord(record);
        }
        
        return { total, records };
    }

    /**
     * 发送 Aleo 私密支付交易 (transfer_private)
     * 
     * @param {Object} options
     * @param {string} options.recipient - 收款地址
     * @param {number} options.amountMicrocredits - 金额 (microcredits)
     * @param {Object} options.record - 私密 record
     * @param {number} options.fee - 交易费用 (microcredits)
     * @param {string} options.network - 网络
     * @param {Object} options.provider - Leo Wallet provider
     * @param {string} options.publicKey - 发送者公钥
     * @returns {Promise<{success: boolean, transactionId?: string, error?: string}>}
     */
    async function sendPrivateTransfer(options) {
        const { recipient, amountMicrocredits, record, fee, network, provider, publicKey } = options;

        console.log('[AleoPayment] Sending private transfer...');
        console.log('[AleoPayment] Record:', record);
        console.log('[AleoPayment] Amount:', amountMicrocredits, 'Fee:', fee, 'Network:', network);

        try {
            // 准备 record 输入
            // Leo Wallet 需要 record 的 plaintext 或完整对象
            let recordInput = record;
            if (record.plaintext) {
                // 有些情况下需要传递 plaintext 字符串
                recordInput = record.plaintext;
            }

            // 确保 network 有值
            const networkValue = network || 'testnetbeta';

            // 直接使用 window.leoWallet
            const leoWallet = window.leoWallet;
            if (!leoWallet) {
                console.error('[AleoPayment] window.leoWallet not found!');
                return { success: false, error: 'Leo Wallet not available' };
            }

            // ========== 新版 Leo Wallet API 格式 ==========
            // 构造交易输入: [record, recipient, amount]
            const newFormatTransaction = {
                address: publicKey,
                chainId: networkValue,
                transitions: [
                    {
                        program: 'credits.aleo',
                        functionName: 'transfer_private',
                        inputs: [
                            recordInput,
                            recipient,
                            `${amountMicrocredits}u64`
                        ]
                    }
                ],
                fee: parseInt(fee) || 25000,
                feePrivate: false
            };

            // 旧版 API 格式（作为备用）
            const oldFormatTransaction = {
                address: publicKey,
                network: networkValue,
                programId: 'credits.aleo',
                functionName: 'transfer_private',
                inputs: [recordInput, recipient, `${amountMicrocredits}u64`],
                fee: parseInt(fee) || 25000
            };

            console.log('[AleoPayment] Trying new API format for private transfer:', JSON.stringify(newFormatTransaction, null, 2));

            // 发送交易 - 先尝试新格式
            let txResult;
            try {
                txResult = await leoWallet.requestTransaction(newFormatTransaction);
                console.log('[AleoPayment] New format succeeded for private transfer');
            } catch (newFormatError) {
                console.warn('[AleoPayment] New format failed for private transfer, trying old format:', newFormatError.message);
                txResult = await leoWallet.requestTransaction(oldFormatTransaction);
            }
            
            console.log('[AleoPayment] Private transfer result:', txResult);

            if (txResult) {
                const txId = typeof txResult === 'string' 
                    ? txResult 
                    : (txResult.transactionId || txResult.transaction_id || txResult.txId || txResult.id);
                
                return {
                    success: true,
                    transactionId: txId,
                    transferType: 'private'
                };
            }

            return { success: false, error: 'No transaction ID returned' };

        } catch (error) {
            console.error('[AleoPayment] Private transfer error:', error);
            return { success: false, error: error.message || 'Private transfer failed' };
        }
    }

    /**
     * 发送 Aleo 公开支付交易 (transfer_public) - 作为后备
     */
    async function sendPublicTransfer(options) {
        const { recipient, amountMicrocredits, fee, network, provider, publicKey } = options;

        console.log('[AleoPayment] Sending public transfer (fallback)...');
        console.log('[AleoPayment] sendPublicTransfer options:', { recipient, amountMicrocredits, fee, network, publicKey });

        try {
            // 确保 network 有值
            const networkValue = network || 'testnetbeta';
            console.log('[AleoPayment] Using network value:', networkValue);

            // 直接使用 window.leoWallet 确保正确调用
            const leoWallet = window.leoWallet;
            if (!leoWallet) {
                console.error('[AleoPayment] window.leoWallet not found!');
                return { success: false, error: 'Leo Wallet not available' };
            }

            console.log('[AleoPayment] Leo Wallet methods:', Object.keys(leoWallet));

            // ========== 新版 Leo Wallet API 格式 ==========
            // 使用 chainId + transitions 数组格式
            const newFormatTransaction = {
                address: publicKey,
                chainId: networkValue,  // 'mainnet', 'testnetbeta', 或 'testnet3'
                transitions: [
                    {
                        program: 'credits.aleo',
                        functionName: 'transfer_public',
                        inputs: [
                            recipient,
                            `${amountMicrocredits}u64`
                        ]
                    }
                ],
                fee: parseInt(fee) || 25000,
                feePrivate: false
            };

            // 旧版 API 格式（作为备用）
            const oldFormatTransaction = {
                address: publicKey,
                network: networkValue,
                programId: 'credits.aleo',
                functionName: 'transfer_public',
                inputs: [recipient, `${amountMicrocredits}u64`],
                fee: parseInt(fee) || 25000
            };

            console.log('[AleoPayment] Trying new API format:', JSON.stringify(newFormatTransaction, null, 2));

            let txResult;
            try {
                // 先尝试新版 API 格式
                txResult = await leoWallet.requestTransaction(newFormatTransaction);
                console.log('[AleoPayment] New format succeeded');
            } catch (newFormatError) {
                console.warn('[AleoPayment] New format failed, trying old format:', newFormatError.message);
                console.log('[AleoPayment] Trying old API format:', JSON.stringify(oldFormatTransaction, null, 2));
                
                // 回退到旧版格式
                txResult = await leoWallet.requestTransaction(oldFormatTransaction);
            }
            
            console.log('[AleoPayment] Public transfer result:', txResult);

            if (txResult) {
                const txId = typeof txResult === 'string' 
                    ? txResult 
                    : (txResult.transactionId || txResult.transaction_id || txResult.txId || txResult.id);
                
                return {
                    success: true,
                    transactionId: txId,
                    transferType: 'public'
                };
            }

            return { success: false, error: 'No transaction ID returned' };

        } catch (error) {
            console.error('[AleoPayment] Public transfer error:', error);
            return { success: false, error: error.message || 'Public transfer failed' };
        }
    }

    /**
     * 将 Public Balance 转换为 Private Records (transfer_public_to_private)
     * 这是实现 Private Payment 的前提条件
     * 
     * @param {Object} options
     * @param {number|string} options.amount - 要转换的 ALEO 金额
     * @param {number} options.fee - 交易费用 (microcredits, 可选)
     * @returns {Promise<{success: boolean, transactionId?: string, error?: string}>}
     */
    async function transferPublicToPrivate(options = {}) {
        const { amount, fee = DEFAULT_FEE } = options;

        console.log('[AleoPayment] 🔒 Converting public balance to private records...');
        console.log('[AleoPayment] Amount:', amount, 'ALEO');

        // 1. 检查钱包状态（用户主动操作，允许自动重连）
        const walletStatus = await waitForLeoWalletReady(5000, 300, true);
        if (!walletStatus.ready) {
            return { success: false, error: walletStatus.error, needsReconnect: walletStatus.needsReconnect };
        }

        const { provider, publicKey } = walletStatus;
        console.log('[AleoPayment] User address:', publicKey);

        // 2. 转换金额为 microcredits
        const amountMicrocredits = aleoToMicrocredits(amount);
        if (amountMicrocredits <= 0) {
            return { success: false, error: 'Invalid amount' };
        }

        // 3. 获取当前网络
        const network = getCurrentNetwork();
        console.log('[AleoPayment] Network:', network);

        try {
            const leoWallet = window.leoWallet;
            if (!leoWallet) {
                return { success: false, error: 'Leo Wallet not available' };
            }

            // transfer_public_to_private 的输入: (recipient: address, amount: u64)
            // recipient 就是用户自己的地址（转给自己）
            const newFormatTransaction = {
                address: publicKey,
                chainId: network,
                transitions: [
                    {
                        program: 'credits.aleo',
                        functionName: 'transfer_public_to_private',
                        inputs: [
                            publicKey,  // recipient (自己)
                            `${amountMicrocredits}u64`
                        ]
                    }
                ],
                fee: parseInt(fee) || 25000,
                feePrivate: false
            };

            const oldFormatTransaction = {
                address: publicKey,
                network: network,
                programId: 'credits.aleo',
                functionName: 'transfer_public_to_private',
                inputs: [publicKey, `${amountMicrocredits}u64`],
                fee: parseInt(fee) || 25000
            };

            console.log('[AleoPayment] Calling transfer_public_to_private...');
            console.log('[AleoPayment] Transaction params:', JSON.stringify(newFormatTransaction, null, 2));

            let txResult;
            try {
                txResult = await leoWallet.requestTransaction(newFormatTransaction);
                console.log('[AleoPayment] New format succeeded');
            } catch (newFormatError) {
                console.warn('[AleoPayment] New format failed, trying old format:', newFormatError.message);
                txResult = await leoWallet.requestTransaction(oldFormatTransaction);
            }

            console.log('[AleoPayment] transfer_public_to_private result:', txResult);

            if (txResult) {
                const txId = typeof txResult === 'string' 
                    ? txResult 
                    : (txResult.transactionId || txResult.transaction_id || txResult.txId || txResult.id);
                
                console.log('[AleoPayment] ✅ Successfully converted', amount, 'ALEO to private records');
                console.log('[AleoPayment] Transaction ID:', txId);
                
                return {
                    success: true,
                    transactionId: txId,
                    amount: amount,
                    message: `Successfully converted ${amount} ALEO to private records. You can now use private transfers.`
                };
            }

            return { success: false, error: 'No transaction ID returned' };

        } catch (error) {
            console.error('[AleoPayment] transfer_public_to_private error:', error);
            return { success: false, error: error.message || 'Conversion failed' };
        }
    }

    /**
     * 显示隐私支付引导对话框
     * 当用户没有 private records 时，引导用户选择：
     * 1. 转换 public 到 private 再支付（推荐）
     * 2. 直接使用 public 支付
     * 3. 取消
     * 
     * @param {Object} options
     * @param {string} options.issue - 'no_records' | 'insufficient_balance'
     * @param {number} options.amountNeeded - 需要支付的 ALEO 金额
     * @returns {Promise<'convert_then_pay' | 'use_public' | 'cancel'>}
     */
    function showPrivacyGuidanceModal(options = {}) {
        return new Promise((resolve) => {
            const { issue, amountNeeded, amountMicrocredits } = options;
            
            // 移除已存在的模态框
            const existing = document.getElementById('privacyGuidanceModal');
            if (existing) existing.remove();
            
            const isNoRecords = issue === 'no_records';
            const title = isNoRecords ? 'Enable Private Payments' : 'Insufficient Private Balance';
            const description = isNoRecords 
                ? 'You don\'t have any private balance yet. Private payments protect your financial privacy on Aleo.'
                : 'Your private balance is not enough for this payment.';
            
            const modal = document.createElement('div');
            modal.id = 'privacyGuidanceModal';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10001;backdrop-filter:blur(4px);';
            
            modal.innerHTML = `
                <div style="background:#fff;border-radius:20px;max-width:520px;width:94%;padding:28px;box-shadow:0 25px 60px rgba(0,0,0,0.3);animation:slideUp 0.3s ease;">
                    <style>
                        @keyframes slideUp {
                            from { opacity: 0; transform: translateY(20px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                        .privacy-option {
                            border: 2px solid #e5e7eb;
                            border-radius: 12px;
                            padding: 16px;
                            margin-bottom: 12px;
                            cursor: pointer;
                            transition: all 0.2s;
                        }
                        .privacy-option:hover {
                            border-color: #8b5cf6;
                            background: #faf5ff;
                        }
                        .privacy-option.recommended {
                            border-color: #10b981;
                            background: linear-gradient(135deg, #f0fdf4, #ecfdf5);
                        }
                        .privacy-option.recommended:hover {
                            border-color: #059669;
                            background: linear-gradient(135deg, #dcfce7, #d1fae5);
                        }
                    </style>
                    
                    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
                        <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(139,92,246,0.3);">
                            <span style="font-size:28px;">🔒</span>
                        </div>
                        <div>
                            <h3 style="margin:0;font-size:20px;font-weight:700;color:#1f2937;">${title}</h3>
                            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${description}</p>
                        </div>
                    </div>
                    
                    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:20px;">
                        <div style="font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px;">
                            <span style="font-size:16px;">💡</span>
                            <span><strong>Payment amount:</strong> ${amountNeeded.toFixed(6)} ALEO (~${(amountMicrocredits / 1000000).toFixed(6)} with fee)</span>
                        </div>
                    </div>
                    
                    <div style="margin-bottom:20px;">
                        <div class="privacy-option recommended" id="optionConvert">
                            <div style="display:flex;align-items:flex-start;gap:12px;">
                                <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                    <span style="font-size:20px;">🔐</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                                        <span style="font-size:15px;font-weight:600;color:#166534;">Enable Privacy & Pay</span>
                                        <span style="font-size:10px;background:#10b981;color:white;padding:2px 8px;border-radius:10px;font-weight:600;">RECOMMENDED</span>
                                    </div>
                                    <p style="margin:0;font-size:12px;color:#15803d;line-height:1.5;">
                                        Convert some public ALEO to private first, then pay privately.<br>
                                        <strong>Your balance will be hidden from everyone.</strong>
                                    </p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="privacy-option" id="optionPublic">
                            <div style="display:flex;align-items:flex-start;gap:12px;">
                                <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                    <span style="font-size:20px;">👁️</span>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:15px;font-weight:600;color:#92400e;margin-bottom:4px;">Use Public Payment</div>
                                    <p style="margin:0;font-size:12px;color:#b45309;line-height:1.5;">
                                        Pay directly from public balance (faster, but visible on-chain).<br>
                                        Anyone can see your transaction and balance.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:10px;padding:14px;margin-bottom:20px;">
                        <div style="font-size:12px;color:#1e40af;font-weight:600;margin-bottom:6px;">🔐 Why Private Payments Matter</div>
                        <ul style="margin:0;padding-left:18px;font-size:11px;color:#1d4ed8;line-height:1.7;">
                            <li>Your wallet balance stays hidden from the public</li>
                            <li>Transaction amounts are encrypted</li>
                            <li>Only you and the recipient know the details</li>
                            <li>This is the core feature of Aleo blockchain</li>
                        </ul>
                    </div>
                    
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="privacyCancelBtn" style="padding:12px 24px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;font-size:14px;color:#6b7280;transition:all 0.2s;">
                            Cancel
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 选项点击事件
            modal.querySelector('#optionConvert').onclick = () => {
                modal.remove();
                resolve('convert_then_pay');
            };
            
            modal.querySelector('#optionPublic').onclick = () => {
                modal.remove();
                resolve('use_public');
            };
            
            modal.querySelector('#privacyCancelBtn').onclick = () => {
                modal.remove();
                resolve('cancel');
            };
            
            // 点击背景关闭
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve('cancel');
                }
            };
            
            // ESC 键关闭
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', handleEsc);
                    resolve('cancel');
                }
            };
            document.addEventListener('keydown', handleEsc);
        });
    }

    /**
     * 发送 Aleo 支付交易 (优先私密，回退公开)
     * 
     * @param {Object} options
     * @param {string} options.recipient - 收款地址 (默认使用平台地址)
     * @param {number|string} options.amount - ALEO 金额
     * @param {number} options.fee - 交易费用 (microcredits, 可选)
     * @param {string} options.memo - 备注 (用于识别订单)
     * @param {boolean} options.preferPrivate - 是否优先使用私密转账 (默认 true)
     * @returns {Promise<{success: boolean, transactionId?: string, transferType?: string, error?: string}>}
     */
    async function sendAleoPayment(options = {}) {
        const { 
            recipient = PLATFORM_RECIPIENT, 
            amount, 
            fee = DEFAULT_FEE,
            memo = '',
            preferPrivate = true  // 默认优先私密转账
        } = options;

        console.log('[AleoPayment] Starting payment:', { recipient, amount, fee, memo, preferPrivate });

        // 1. 检查钱包状态（用户主动发起支付，允许自动重连）
        console.log('[AleoPayment] Checking wallet status...');
        const walletStatus = await waitForLeoWalletReady(5000, 300, true);
        
        if (!walletStatus.ready) {
            console.error('[AleoPayment] Wallet not ready:', walletStatus.error);
            
            // 如果需要重新连接，显示提示让用户手动操作
            if (walletStatus.needsReconnect) {
                // 显示一个友好的提示
                if (typeof showNotification === 'function') {
                    showNotification('Please reconnect your Leo Wallet to continue with the payment.', 'warning');
                }
            }
            
            return { success: false, error: walletStatus.error };
        }

        const { provider, publicKey } = walletStatus;
        console.log('[AleoPayment] Wallet ready, using publicKey:', publicKey);

        // 2. 转换金额为 microcredits
        const amountMicrocredits = aleoToMicrocredits(amount);
        if (amountMicrocredits <= 0) {
            return { success: false, error: 'Invalid payment amount' };
        }

        // 3. 获取当前网络
        const network = getCurrentNetwork();
        console.log('[AleoPayment] Using network:', network);

        // 4. 如果优先私密转账，尝试获取私密 records
        let hasPrivateRecords = false;
        let privateRecordIssue = null; // 'no_records' | 'insufficient_balance' | null
        
        if (preferPrivate) {
            try {
                console.log('[AleoPayment] Checking for private records...');
                const records = await getPrivateRecords();
                
                if (records.length > 0) {
                    hasPrivateRecords = true;
                    // 查找足够余额的 record
                    const suitableRecord = findSufficientRecord(records, amountMicrocredits, fee);
                    
                    if (suitableRecord) {
                        console.log('[AleoPayment] Found suitable private record, using transfer_private');
                        
                        const privateResult = await sendPrivateTransfer({
                            recipient,
                            amountMicrocredits,
                            record: suitableRecord,
                            fee,
                            network,
                            provider,
                            publicKey
                        });

                        if (privateResult.success) {
                            return {
                                ...privateResult,
                                amount: amount,
                                amountMicrocredits: amountMicrocredits,
                                recipient: recipient,
                                network: network,
                                memo: memo,
                                privacyLevel: 'private'
                            };
                        }

                        // 如果私密转账失败，记录错误但继续尝试公开转账
                        console.warn('[AleoPayment] Private transfer failed:', privateResult.error);
                    } else {
                        console.log('[AleoPayment] No single record with sufficient balance for private transfer');
                        privateRecordIssue = 'insufficient_balance';
                    }
                } else {
                    console.log('[AleoPayment] No private records found');
                    privateRecordIssue = 'no_records';
                }
            } catch (error) {
                console.warn('[AleoPayment] Error checking private records:', error);
                privateRecordIssue = 'no_records';
            }
        }

        // 5. 如果没有 private records，显示用户引导
        if (privateRecordIssue && preferPrivate) {
            console.log('[AleoPayment] Showing privacy guidance to user...');
            
            const userChoice = await showPrivacyGuidanceModal({
                issue: privateRecordIssue,
                amountNeeded: amount,
                amountMicrocredits: amountMicrocredits + fee
            });
            
            if (userChoice === 'convert_then_pay') {
                // 用户选择先转换再支付
                console.log('[AleoPayment] User chose to convert public to private first');
                
                // 建议转换的金额：支付金额 + fee + 一些余量
                const suggestedConvertAmount = Math.max(1, Math.ceil((amountMicrocredits + fee) / MICROCREDITS_PER_CREDIT * 2));
                
                const convertResult = await transferPublicToPrivate({ 
                    amount: suggestedConvertAmount 
                });
                
                if (convertResult.success) {
                    console.log('[AleoPayment] Conversion successful, now attempting private payment');
                    
                    // 等待一下让 wallet 更新 records
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // 重新获取 records 并尝试私密支付
                    const newRecords = await getPrivateRecords();
                    const newSuitableRecord = findSufficientRecord(newRecords, amountMicrocredits, fee);
                    
                    if (newSuitableRecord) {
                        const privateResult = await sendPrivateTransfer({
                            recipient,
                            amountMicrocredits,
                            record: newSuitableRecord,
                            fee,
                            network,
                            provider,
                            publicKey
                        });

                        if (privateResult.success) {
                            return {
                                ...privateResult,
                                amount: amount,
                                amountMicrocredits: amountMicrocredits,
                                recipient: recipient,
                                network: network,
                                memo: memo,
                                privacyLevel: 'private'
                            };
                        }
                    }
                    
                    // 转换后仍然无法私密支付，回退到公开
                    console.warn('[AleoPayment] Still cannot do private transfer after conversion, falling back to public');
                } else {
                    console.warn('[AleoPayment] Conversion failed:', convertResult.error);
                }
            } else if (userChoice === 'cancel') {
                // 用户取消支付
                return { success: false, error: 'Payment cancelled by user', cancelled: true };
            }
            // userChoice === 'use_public' 会继续往下执行公开转账
        }

        // 6. 回退到公开转账
        console.log('[AleoPayment] Falling back to public transfer');
        
        try {
            const publicResult = await sendPublicTransfer({
                recipient,
                amountMicrocredits,
                fee,
                network,
                provider,
                publicKey
            });

            if (publicResult.success) {
                return {
                    ...publicResult,
                    amount: amount,
                    amountMicrocredits: amountMicrocredits,
                    recipient: recipient,
                    network: network,
                    memo: memo,
                    privacyLevel: 'public'
                };
            }

            // 处理用户取消
            if (publicResult.error && (
                publicResult.error.includes('rejected') || 
                publicResult.error.includes('cancelled') ||
                publicResult.error.includes('denied')
            )) {
                return { success: false, error: 'Transaction cancelled by user', cancelled: true };
            }

            return publicResult;

        } catch (error) {
            console.error('[AleoPayment] Transaction error:', error);
            
            // 处理用户取消
            if (error.message && (
                error.message.includes('rejected') || 
                error.message.includes('cancelled') ||
                error.message.includes('denied')
            )) {
                return { success: false, error: 'Transaction cancelled by user', cancelled: true };
            }
            
            return { success: false, error: error.message || 'Transaction failed' };
        }
    }

    /**
     * 结算 402 发票 - 使用 Leo Wallet 支付 (优先私密)
     * 
     * @param {Object} invoice - 402 发票对象
     * @returns {Promise<string|null>} 交易 ID 或 null (取消)
     */
    async function settleInvoiceWithLeo(invoice) {
        console.log('[AleoPayment] Settling invoice:', invoice);

        // 获取金额
        const amount = invoice.amount_usdc ?? invoice.amount ?? invoice.amount_aleo ?? 0;
        if (amount <= 0) {
            throw new Error('Invoice missing amount');
        }

        // 获取收款地址 (优先使用发票中的地址，否则使用平台默认地址)
        const recipient = invoice.recipient || PLATFORM_RECIPIENT;

        // 发送支付 (优先私密)
        const result = await sendAleoPayment({
            recipient: recipient,
            amount: amount,
            memo: invoice.request_id || invoice.memo || '',
            preferPrivate: true  // 优先使用私密转账
        });

        if (result.cancelled) {
            return null; // 用户取消
        }

        if (!result.success) {
            throw new Error(result.error || 'Payment failed');
        }

        // 记录转账类型
        console.log(`[AleoPayment] Payment successful via ${result.privacyLevel} transfer`);

        return result.transactionId;
    }

    /**
     * 获取 Aleo Explorer URL
     * Provable Explorer 是 Aleo 官方推荐的区块浏览器
     */
    function getExplorerUrl(transactionId, network) {
        const net = network || getCurrentNetwork();
        if (net === 'mainnet') {
            return `https://explorer.provable.com/transaction/${transactionId}`;
        }
        // testnetbeta
        return `https://testnet.explorer.provable.com/transaction/${transactionId}`;
    }

    // ========== 匿名充值系统 (方案 B: 隐私优先) ==========

    const ANONYMOUS_TOKEN_KEY = 'i3_anonymous_token';
    const MCP_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.mcpBaseUrl) || 'http://localhost:3000';

    /**
     * 获取已保存的匿名 token
     */
    function getAnonymousToken() {
        try {
            return localStorage.getItem(ANONYMOUS_TOKEN_KEY);
        } catch (e) {
            console.warn('[AleoPayment] Failed to get anonymous token:', e);
            return null;
        }
    }

    /**
     * 保存匿名 token
     */
    function saveAnonymousToken(token) {
        try {
            localStorage.setItem(ANONYMOUS_TOKEN_KEY, token);
            console.log('[AleoPayment] Anonymous token saved');
        } catch (e) {
            console.warn('[AleoPayment] Failed to save anonymous token:', e);
        }
    }

    /**
     * 清除匿名 token
     */
    function clearAnonymousToken() {
        try {
            localStorage.removeItem(ANONYMOUS_TOKEN_KEY);
            console.log('[AleoPayment] Anonymous token cleared');
        } catch (e) {
            console.warn('[AleoPayment] Failed to clear anonymous token:', e);
        }
    }

    /**
     * 查询匿名 token 余额
     * @returns {Promise<{balance: number, currency: string}|null>}
     */
    async function getAnonymousBalance() {
        const token = getAnonymousToken();
        if (!token) {
            return null;
        }

        try {
            const response = await fetch(`${MCP_BASE_URL}/mcp/token/balance`, {
                method: 'GET',
                headers: {
                    'X-Anonymous-Token': token
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    // Token 无效，清除
                    clearAnonymousToken();
                    return null;
                }
                throw new Error(`Failed to get balance: ${response.status}`);
            }

            const data = await response.json();
            return {
                balance: data.balance,
                currency: data.currency || 'ALEO'
            };
        } catch (error) {
            console.warn('[AleoPayment] Failed to get anonymous balance:', error);
            return null;
        }
    }

    /**
     * 匿名充值
     * 
     * 流程:
     * 1. 用户用 Leo Wallet 执行 transfer_private
     * 2. 交易成功后，调用服务端 /deposit 端点
     * 3. 服务端返回一个随机的 access_token
     * 4. 保存 token 到 localStorage
     * 
     * @param {Object} options
     * @param {number} options.amount - 充值金额 (ALEO)
     * @returns {Promise<{success: boolean, token?: string, balance?: number, error?: string}>}
     */
    async function anonymousDeposit(options = {}) {
        const { amount } = options;

        if (!amount || amount <= 0) {
            return { success: false, error: 'Invalid amount' };
        }

        console.log('[AleoPayment] Starting anonymous deposit:', { amount });

        // 1. 检查钱包状态
        const walletStatus = isLeoWalletReady();
        if (!walletStatus.ready) {
            return { success: false, error: walletStatus.error };
        }

        // 2. 执行 transfer_private
        const paymentResult = await sendAleoPayment({
            recipient: PLATFORM_RECIPIENT,
            amount: amount,
            memo: 'anonymous_deposit',
            preferPrivate: true  // 优先私密转账
        });

        if (!paymentResult.success) {
            return { success: false, error: paymentResult.error, cancelled: paymentResult.cancelled };
        }

        const txId = paymentResult.transactionId;
        console.log('[AleoPayment] Transfer successful:', txId);

        // 3. 调用服务端确认充值
        try {
            const existingToken = getAnonymousToken();
            
            const response = await fetch(`${MCP_BASE_URL}/mcp/deposit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tx_id: txId,
                    amount: amount,
                    existing_token: existingToken  // 如果有已存在的 token，追加充值
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Server error: ${response.status}`);
            }

            const data = await response.json();
            
            // 4. 保存 token
            if (data.access_token) {
                saveAnonymousToken(data.access_token);
            }

            console.log('[AleoPayment] ✅ Anonymous deposit successful:', {
                balance: data.balance,
                isNewToken: !existingToken
            });

            return {
                success: true,
                token: data.access_token,
                balance: data.balance,
                deposited: data.deposited,
                transactionId: txId,
                privacyLevel: paymentResult.privacyLevel
            };

        } catch (error) {
            console.error('[AleoPayment] Failed to confirm deposit:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to confirm deposit',
                transactionId: txId  // 交易已发送，但确认失败
            };
        }
    }

    /**
     * 匿名调用 AI API
     * 
     * @param {Object} options
     * @param {string} options.prompt - 用户输入
     * @param {string} options.model - 模型名称
     * @returns {Promise<{success: boolean, result?: Object, error?: string}>}
     */
    async function anonymousInvoke(options = {}) {
        const { prompt, model } = options;

        const token = getAnonymousToken();
        if (!token) {
            return { 
                success: false, 
                error: 'no_token',
                message: 'Please deposit first to get an access token'
            };
        }

        try {
            const response = await fetch(`${MCP_BASE_URL}/mcp/anonymous/invoke`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Anonymous-Token': token
                },
                body: JSON.stringify({ prompt, model })
            });

            const data = await response.json();

            if (!response.ok) {
                // 如果是余额不足，返回需要充值的信息
                if (response.status === 402) {
                    return {
                        success: false,
                        error: 'insufficient_balance',
                        required: data.required_amount,
                        balance: data.current_balance,
                        pricing: data.pricing,
                        deposit_info: data.deposit_info
                    };
                }
                throw new Error(data.message || `Server error: ${response.status}`);
            }

            return {
                success: true,
                result: data.result,
                cost: data.cost,
                remaining_balance: data.remaining_balance
            };

        } catch (error) {
            console.error('[AleoPayment] Anonymous invoke failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查是否有可用的匿名 token
     */
    function hasAnonymousToken() {
        return !!getAnonymousToken();
    }

    /**
     * 显示支付成功 Toast
     */
    function showPaymentSuccessToast(transactionId, amount, network, privacyLevel) {
        const isPrivate = privacyLevel === 'private';
        
        // 检查交易 ID 是否是 Leo Wallet 本地 ID (UUID 格式)
        // Leo Wallet 返回的是 UUID，链上交易 ID 格式是 at1... 
        const isLocalId = transactionId && transactionId.includes('-') && !transactionId.startsWith('at');
        const explorerUrl = isLocalId ? null : getExplorerUrl(transactionId, network);
        
        // 移除已存在的 toast
        const existing = document.getElementById('aleo-payment-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'aleo-payment-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            color: white;
            padding: 20px 24px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
            z-index: 100000;
            max-width: 400px;
            font-family: 'Inter', system-ui, sans-serif;
            animation: slideIn 0.3s ease-out;
        `;
        
        const shortTxId = transactionId ? `${transactionId.slice(0, 8)}...${transactionId.slice(-8)}` : 'N/A';
        const privacyBadge = isPrivate 
            ? '<span style="background: linear-gradient(135deg, #10b981, #059669); padding: 2px 8px; border-radius: 4px; font-size: 10px; margin-left: 8px;">🔒 Private</span>'
            : '<span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; font-size: 10px; margin-left: 8px;">Public</span>';
        
        // 根据交易 ID 类型显示不同的链接
        const explorerLink = isLocalId 
            ? `<div style="margin-top: 12px; color: rgba(255,255,255,0.7); font-size: 12px;">
                 ⏳ Transaction submitted to Leo Wallet.<br>
                 Check status in your wallet's transaction history.
               </div>`
            : `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" style="
                display: block;
                margin-top: 12px;
                color: #00d4aa;
                text-decoration: none;
                font-size: 13px;
                font-weight: 500;
            ">View on Aleo Explorer →</a>`;
        
        toast.innerHTML = `
            <style>
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            </style>
            <button onclick="this.parentElement.remove()" style="
                position: absolute;
                top: 8px;
                right: 12px;
                background: transparent;
                border: none;
                color: rgba(255,255,255,0.6);
                font-size: 18px;
                cursor: pointer;
            ">×</button>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                <div style="
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #00d4aa, #00b894);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                ">✓</div>
                <div>
                    <h4 style="margin: 0; font-size: 16px; font-weight: 600;">
                        Payment Successful
                        ${privacyBadge}
                    </h4>
                    <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.7);">${amount} ALEO</p>
                </div>
            </div>
            <div style="
                background: rgba(255,255,255,0.1);
                border-radius: 8px;
                padding: 12px;
                margin-top: 8px;
            ">
                <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;">Transaction ID</div>
                <code style="font-size: 12px; color: #00d4aa;">${shortTxId}</code>
            </div>
            ${explorerLink}
        `;

        document.body.appendChild(toast);

        // 15秒后自动关闭
        setTimeout(() => {
            try { toast.remove(); } catch (_) {}
        }, 15000);
    }

    /**
     * 诊断 Leo Wallet 功能
     */
    async function diagnoseLeoWallet() {
        console.log('====== Leo Wallet 诊断开始 ======');
        
        const leoWallet = window.leoWallet;
        if (!leoWallet) {
            console.error('❌ window.leoWallet 不存在');
            return { success: false, error: 'Leo Wallet not found' };
        }
        
        console.log('✅ window.leoWallet 存在');
        
        // 1. 检查所有属性和方法
        console.log('📋 Leo Wallet 属性和方法:');
        const allKeys = [];
        for (const key in leoWallet) {
            const type = typeof leoWallet[key];
            console.log(`  - ${key}: ${type}`);
            allKeys.push({ key, type });
        }
        
        // 2. 检查原型方法
        const proto = Object.getPrototypeOf(leoWallet);
        if (proto) {
            console.log('📋 Leo Wallet 原型方法:');
            Object.getOwnPropertyNames(proto).forEach(name => {
                if (name !== 'constructor') {
                    console.log(`  - ${name}: ${typeof proto[name]}`);
                }
            });
        }
        
        // 3. 检查连接状态
        console.log('🔗 连接状态:');
        console.log('  - publicKey:', leoWallet.publicKey);
        console.log('  - connected:', leoWallet.connected);
        
        // 4. 检查 decryptPermission
        if (leoWallet.decryptPermission !== undefined) {
            console.log('🔐 当前 decryptPermission:', leoWallet.decryptPermission);
        }
        
        // 5. 测试 requestRecords
        if (typeof leoWallet.requestRecords === 'function') {
            console.log('✅ requestRecords 方法存在');
            console.log('🔄 尝试调用 requestRecords("credits.aleo")...');
            try {
                const records = await leoWallet.requestRecords('credits.aleo');
                console.log('✅ requestRecords 成功:', records);
            } catch (e) {
                console.log('❌ requestRecords 失败:', e.name, e.message);
                // 尝试其他参数格式
                try {
                    console.log('🔄 尝试 requestRecords({ program: "credits.aleo" })...');
                    const records2 = await leoWallet.requestRecords({ program: 'credits.aleo' });
                    console.log('✅ requestRecords 对象格式成功:', records2);
                } catch (e2) {
                    console.log('❌ requestRecords 对象格式也失败:', e2.message);
                }
            }
        }
        
        // 6. 测试 requestTransaction
        if (typeof leoWallet.requestTransaction === 'function') {
            console.log('✅ requestTransaction 方法存在');
        }
        
        console.log('====== Leo Wallet 诊断结束 ======');
        console.log('💡 如果 requestRecords 失败，请尝试：');
        console.log('   1. 断开钱包连接');
        console.log('   2. 刷新页面');
        console.log('   3. 重新连接钱包（会请求新的权限）');
        
        return {
            success: true,
            publicKey: leoWallet.publicKey,
            connected: leoWallet.connected,
            methods: allKeys.filter(k => k.type === 'function').map(k => k.key)
        };
    }

    // 导出到全局
    window.AleoPayment = {
        PLATFORM_RECIPIENT,
        MICROCREDITS_PER_CREDIT,
        DEFAULT_FEE,
        getLeoProvider,
        isLeoWalletReady,
        waitForLeoWalletReady,
        aleoToMicrocredits,
        microcreditsToAleo,
        getCurrentNetwork,
        getPrivateRecords,
        getPrivateBalance,
        extractMicrocreditsFromRecord,
        findSufficientRecord,
        sendPrivateTransfer,
        sendPublicTransfer,
        transferPublicToPrivate,  // 将 public 转换为 private records
        sendAleoPayment,
        settleInvoiceWithLeo,
        getExplorerUrl,
        showPaymentSuccessToast,
        diagnoseLeoWallet,
        // 匿名充值系统 (方案 B: 隐私优先)
        getAnonymousToken,
        saveAnonymousToken,
        clearAnonymousToken,
        getAnonymousBalance,
        anonymousDeposit,
        anonymousInvoke,
        hasAnonymousToken
    };

    console.log('✅ Aleo Payment Module loaded (Privacy-First Mode with Anonymous Token Support)');
})();
