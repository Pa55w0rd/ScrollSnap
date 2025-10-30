/**
 * 检测 content script 是否已加载
 * @param {number} tabId - 标签页 ID
 * @returns {Promise<boolean>} 是否已加载
 */
async function checkContentScriptLoaded(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

/**
 * 显示友好的错误提示
 * @param {string} message - 错误消息
 */
function showConnectionError() {
    const errorMsg = '⚠️ 无法连接到页面\n\n' +
                    '这通常是因为：\n' +
                    '1. 刚安装或更新了扩展\n' +
                    '2. 页面还没有刷新\n\n' +
                    '请刷新页面后重试！\n\n' +
                    '快捷键：F5 或 Ctrl+R (Mac: Cmd+R)';
    alert(errorMsg);
}

/**
 * 初始化UI元素
 */
document.addEventListener('DOMContentLoaded', () => {
    // 初始化本地化消息
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const messageName = element.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(messageName);
        if (message) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = message;
            } else {
                element.textContent = message;
            }
        }
    });
    
    // 初始化 option 元素的本地化
    document.querySelectorAll('[data-i18n-option]').forEach(element => {
        const messageName = element.getAttribute('data-i18n-option');
        const message = chrome.i18n.getMessage(messageName);
        if (message) {
            element.textContent = message;
        }
    });

    // 设置标题
    document.title = chrome.i18n.getMessage('extName');
    document.querySelector('h1').textContent = chrome.i18n.getMessage('extName');
    
    const qualityInput = document.getElementById('quality');
    const qualityValue = document.getElementById('quality-value');
    const captureButton = document.getElementById('capture');
    const progressContainer = document.getElementById('progress');
    const progressFill = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');

    // 加载保存的设置
    chrome.storage.local.get(['captureMode', 'format', 'quality'], (result) => {
        if (result.captureMode) {
            document.getElementById('capture-mode').value = result.captureMode;
        }
        if (result.format) {
            document.getElementById('format').value = result.format;
        }
        if (result.quality) {
            qualityInput.value = result.quality;
            qualityValue.textContent = `${result.quality}%`;
        }
    });

    // 监听质量滑块变化
    qualityInput.addEventListener('input', (e) => {
        const value = e.target.value;
        qualityValue.textContent = `${value}%`;
        chrome.storage.local.set({ quality: value });
    });

    // 监听截图模式变化
    document.getElementById('capture-mode').addEventListener('change', (e) => {
        chrome.storage.local.set({ captureMode: e.target.value });
    });

    // 监听格式选择变化
    document.getElementById('format').addEventListener('change', (e) => {
        chrome.storage.local.set({ format: e.target.value });
    });

    // 监听截图按钮点击
    captureButton.addEventListener('click', async () => {
        const captureMode = document.getElementById('capture-mode').value;
        const format = document.getElementById('format').value;
        const quality = parseInt(qualityInput.value) / 100;

        try {
            // 获取当前标签页
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // 检查 content script 是否已加载
            const isLoaded = await checkContentScriptLoaded(tab.id);
            if (!isLoaded) {
                showConnectionError();
                return;
            }

            if (captureMode === 'region') {
                // 滚动区域选择模式
                chrome.tabs.sendMessage(tab.id, {
                    action: 'enableRegionSelector',
                    format,
                    quality
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        showConnectionError();
                        return;
                    }
                    if (response && response.received) {
                        // 关闭 popup，让用户可以选择区域
                        window.close();
                    } else {
                        alert(chrome.i18n.getMessage('captureError'));
                    }
                });
            } else if (captureMode === 'manual') {
                // 手动选择矩形区域模式
                chrome.tabs.sendMessage(tab.id, {
                    action: 'enableManualSelector',
                    format,
                    quality
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        showConnectionError();
                        return;
                    }
                    if (response && response.received) {
                        // 关闭 popup，让用户可以选择区域
                        window.close();
                    } else {
                        alert(chrome.i18n.getMessage('captureError'));
                    }
                });
            } else if (captureMode === 'visible') {
                // 当前可见页面截图
                progressContainer.style.display = 'block';
                captureButton.disabled = true;
                
                chrome.tabs.sendMessage(tab.id, {
                    action: 'captureVisible',
                    format,
                    quality
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        progressContainer.style.display = 'none';
                        captureButton.disabled = false;
                        showConnectionError();
                        return;
                    }
                    if (response && response.received) {
                        updateProgress(50, '正在截图...');
                        setTimeout(() => {
                            updateProgress(100, chrome.i18n.getMessage('captureComplete'));
                            setTimeout(() => {
                                window.close();
                            }, 1000);
                        }, 1500);
                    } else {
                        updateProgress(0, chrome.i18n.getMessage('captureError'));
                        captureButton.disabled = false;
                    }
                });
            } else {
                // 整页截图模式
                // 显示进度条
                progressContainer.style.display = 'block';
                captureButton.disabled = true;

                // 发送消息到content script开始截图
                chrome.tabs.sendMessage(tab.id, {
                    action: 'startCapture',
                    format,
                    quality
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        progressContainer.style.display = 'none';
                        captureButton.disabled = false;
                        showConnectionError();
                        return;
                    }
                    if (response && response.received) {
                        updateProgress(50, chrome.i18n.getMessage('capturingStatus'));
                        // 截图完成后会自动关闭
                        setTimeout(() => {
                            updateProgress(100, chrome.i18n.getMessage('captureComplete'));
                            setTimeout(() => {
                                window.close();
                            }, 1000);
                        }, 2000);
                    } else {
                        updateProgress(0, chrome.i18n.getMessage('captureError'));
                        captureButton.disabled = false;
                    }
                });

                // 监听截图进度
                chrome.runtime.onMessage.addListener((message) => {
                    if (message.type === 'captureProgress') {
                        updateProgress(message.progress, chrome.i18n.getMessage('capturingStatus'));
                    }
                });
            }
        } catch (error) {
            console.error('截图错误:', error);
            alert(chrome.i18n.getMessage('captureError') + ': ' + error.message);
            captureButton.disabled = false;
        }
    });

    /**
     * 更新进度条和状态文本
     * @param {number} progress - 进度百分比
     * @param {string} status - 状态文本
     */
    function updateProgress(progress, status) {
        progressFill.style.width = `${progress}%`;
        progressText.textContent = status;
    }
});

