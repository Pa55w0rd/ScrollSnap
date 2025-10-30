/**
 * 监听扩展图标点击事件
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // 向content script发送开始截图消息
    chrome.tabs.sendMessage(tab.id, {
      action: 'startCapture'
    });
  } catch (error) {
    console.error('启动截图失败:', error);
  }
});

/**
 * 监听消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'captureVisibleTab') {
    // 使用 activeTab 权限进行截图
    console.log('[Background] 收到截图请求:', message.options);
    
    chrome.tabs.captureVisibleTab(null, message.options)
      .then(dataUrl => {
        if (dataUrl && dataUrl.startsWith('data:image')) {
          console.log('[Background] 截图成功，数据长度:', dataUrl.length);
          sendResponse(dataUrl);
        } else {
          console.error('[Background] 截图返回无效数据');
          sendResponse(null);
        }
      })
      .catch(error => {
        console.error('[Background] 截图API失败:', error.message, error);
        sendResponse(null);
      });

    return true; // 保持消息通道开放
  } 
  
  else if (message.action === 'downloadCapture') {
    try {
      console.log('[Background] 收到下载请求, 格式:', message.format, '后缀:', message.suffix);
      
      // 验证数据
      if (!message.dataUrl || !message.dataUrl.startsWith('data:image')) {
        console.error('[Background] 无效的图片数据');
        sendResponse({ success: false, error: '无效的图片数据' });
        return true;
      }
      
      // 生成文件名
      const date = new Date();
      const timestamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date.getSeconds().toString().padStart(2, '0')}`;
      const filename = `webpage_${timestamp}${message.suffix || ''}.${message.format}`;

      console.log('[Background] 开始下载:', filename);

      // 下载图片
      chrome.downloads.download({
        url: message.dataUrl,
        filename: filename,
        saveAs: false
      }).then((downloadId) => {
        console.log('[Background] 下载成功, ID:', downloadId);
        sendResponse({ success: true, downloadId });
      }).catch(error => {
        console.error('[Background] 下载失败:', error);
        sendResponse({ success: false, error: error.message });
      });

      return true; // 保持消息通道开放
    } catch (error) {
      console.error('[Background] 处理下载请求失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
});

// 存储设置
chrome.storage.local.get(['captureMode', 'format', 'quality'], (result) => {
  if (!result.format) {
    chrome.storage.local.set({
      captureMode: 'fullpage',
      format: 'png',
      quality: 90
    });
  }
});

