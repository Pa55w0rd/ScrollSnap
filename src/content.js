/**
 * 网页截图核心功能实现
 */

/**
 * 将 CSS 颜色值转换为 rgba 格式
 * @param {string} colorValue - CSS 颜色值
 * @returns {string|null} rgba 格式的颜色值，失败返回 null
 */
function convertColorToRgba(colorValue) {
  try {
    // 创建临时 canvas 来获取颜色的 RGB 值
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    
    // 设置颜色并绘制
    ctx.fillStyle = colorValue;
    ctx.fillRect(0, 0, 1, 1);
    
    // 获取像素数据
    const imageData = ctx.getImageData(0, 0, 1, 1);
    const [r, g, b, a] = imageData.data;
    
    // 返回 rgba 格式
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  } catch (e) {
    return null;
  }
}

/**
 * 预处理元素，将不支持的颜色函数转换为内联样式
 * @param {Element} element - 要处理的元素
 * @returns {Array} 返回修改记录，用于恢复
 */
function preprocessUnsupportedColors(element) {
  const modifications = [];
  
  try {
    console.log('[Content] 开始预处理不支持的颜色函数');
    
    // 不支持的颜色函数正则表达式
    const unsupportedColorRegex = /(oklab|oklch|lab|lch|hwb|color)\s*\([^)]*\)/gi;
    
    // 颜色相关的 CSS 属性
    const colorProperties = [
      'color', 'background-color', 'border-color', 'border-top-color', 
      'border-right-color', 'border-bottom-color', 'border-left-color',
      'outline-color', 'text-decoration-color', 'fill', 'stroke'
    ];
    
    // 获取元素及其所有子元素
    const elements = [element, ...element.querySelectorAll('*')];
    
    let convertedCount = 0;
    
    elements.forEach(el => {
      try {
        const computedStyle = window.getComputedStyle(el);
        const elementMods = { element: el, properties: [] };
        
        colorProperties.forEach(prop => {
          const value = computedStyle.getPropertyValue(prop);
          
          if (value && unsupportedColorRegex.test(value)) {
            // 使用 Canvas 将颜色转换为 rgba
            const rgbaColor = convertColorToRgba(value);
            
            if (rgbaColor) {
              // 保存原始内联样式（用于恢复）
              const originalValue = el.style.getPropertyValue(prop);
              const originalPriority = el.style.getPropertyPriority(prop);
              
              elementMods.properties.push({
                prop,
                originalValue,
                originalPriority
              });
              
              // 设置新的内联样式
              el.style.setProperty(prop, rgbaColor, 'important');
              convertedCount++;
            }
          }
        });
        
        if (elementMods.properties.length > 0) {
          modifications.push(elementMods);
        }
      } catch (e) {
        // 跳过无法处理的元素
      }
    });
    
    console.log(`[Content] 颜色预处理完成，共处理 ${convertedCount} 个颜色属性`);
  } catch (error) {
    console.error('[Content] 颜色预处理失败:', error);
  }
  
  return modifications;
}

/**
 * 恢复元素的原始样式
 * @param {Array} modifications - 修改记录
 */
function restoreOriginalStyles(modifications) {
  try {
    modifications.forEach(({ element, properties }) => {
      properties.forEach(({ prop, originalValue, originalPriority }) => {
        if (originalValue) {
          element.style.setProperty(prop, originalValue, originalPriority);
        } else {
          element.style.removeProperty(prop);
        }
      });
    });
    console.log('[Content] 已恢复原始样式');
  } catch (error) {
    console.error('[Content] 恢复样式失败:', error);
  }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    // 响应连接检测请求
    sendResponse({ pong: true });
  } else if (message.action === 'startCapture') {
    // 立即返回响应，避免消息通道超时
    sendResponse({ received: true });
    
    // 从 storage 获取格式设置
    chrome.storage.local.get(['format', 'quality'], (result) => {
      const format = result.format || 'png';
      const quality = (result.quality || 90) / 100;
      
      captureFullPage(format, quality)
        .then(() => {
          console.log('截图完成');
        })
        .catch(error => {
          console.error('截图失败:', error);
        });
    });
  } else if (message.action === 'captureVisible') {
    // 截取当前可见页面
    sendResponse({ received: true });
    
    captureVisiblePage(message.format, message.quality)
      .then(() => {
        console.log('可见页面截图完成');
      })
      .catch(error => {
        console.error('可见页面截图失败:', error);
      });
  } else if (message.action === 'enableManualSelector') {
    // 启用手动选择区域模式
    sendResponse({ received: true });
    enableManualSelector(message.format, message.quality);
  } else if (message.action === 'enableRegionSelector') {
    // 启用滚动区域选择模式
    sendResponse({ received: true });
    enableRegionSelector(message.format, message.quality);
  } else if (message.action === 'captureScrollableElement') {
    // 截取指定的可滚动元素
    sendResponse({ received: true });
    
    const element = document.querySelector(message.selector);
    if (element) {
      captureScrollableElement(element, message.format, message.quality)
        .then(() => {
          console.log('局部区域截图完成');
        })
        .catch(error => {
          console.error('局部区域截图失败:', error);
        });
    } else {
      console.error('未找到指定的滚动元素:', message.selector);
    }
  }
});

/**
 * 等待指定时间
 * @param {number} ms - 等待时间（毫秒）
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 截取当前可见区域
 */
const captureVisible = async () => {
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('截图超时（5秒）'));
        }, 5000);

        chrome.runtime.sendMessage({
          type: 'captureVisibleTab',
          options: { format: 'png', quality: 100 }
        }, response => {
          clearTimeout(timeout);
          
          // 检查 chrome.runtime.lastError
          if (chrome.runtime.lastError) {
            reject(new Error('Chrome API 错误: ' + chrome.runtime.lastError.message));
            return;
          }
          
          if (response && typeof response === 'string' && response.startsWith('data:image')) {
            resolve(response);
          } else {
            reject(new Error('未收到有效的截图数据'));
          }
        });
      });

      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        const imgTimeout = setTimeout(() => {
          reject(new Error('图片加载超时'));
        }, 3000);
        
        image.onload = () => {
          clearTimeout(imgTimeout);
          resolve(image);
        };
        image.onerror = () => {
          clearTimeout(imgTimeout);
          reject(new Error('图片加载失败'));
        };
        image.src = dataUrl;
      });

      return img;
    } catch (error) {
      retryCount++;
      console.error(`第 ${retryCount} 次截图失败:`, error);
      if (retryCount === maxRetries) {
        throw new Error(`截图失败（已重试 ${maxRetries} 次）: ${error.message}`);
      }
      await sleep(500); // 等待后重试
    }
  }
};

/**
 * 获取页面中的固定元素
 */
const getFixedElements = (progressContainer) => {
  return Array.from(document.querySelectorAll('*')).filter(el => {
    if (!el.offsetParent || el === progressContainer || el.contains(progressContainer)) return false;
    const style = window.getComputedStyle(el);
    return (style.position === 'fixed' || style.position === 'sticky') && 
           style.display !== 'none' && 
           style.visibility !== 'hidden' &&
           el.getBoundingClientRect().height > 0;
  });
};

/**
 * 截取整个页面
 * @param {string} format - 图片格式 ('png' 或 'jpeg')
 * @param {number} quality - 图片质量 (0-1)
 */
async function captureFullPage(format = 'png', quality = 0.9) {
  if (window._isCapturing) {
    console.log('截图进行中，请稍候...');
    return;
  }
  window._isCapturing = true;

  const progressContainer = document.createElement('div');
  const shadowRoot = progressContainer.attachShadow({ mode: 'closed' });
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'screenshot-progress';
  
  const style = document.createElement('style');
  style.textContent = `
    #screenshot-progress {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 2147483647;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
  `;
  
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(loadingDiv);
  document.body.appendChild(progressContainer);
  
  // 保存原始状态
  const originalState = {
    scrollTop: window.pageYOffset,
    scrollLeft: window.pageXOffset,
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow
  };

  // 获取固定元素
  const fixedElements = getFixedElements(progressContainer);
  const fixedElementsState = new Map();

  try {
    loadingDiv.textContent = '正在准备截图...';
    await sleep(100);

    // 保存固定元素的原始状态并隐藏它们
    fixedElements.forEach(el => {
      fixedElementsState.set(el, {
        position: el.style.position,
        top: el.style.top,
        visibility: el.style.visibility
      });
      el.style.visibility = 'hidden';
    });

    // 获取页面尺寸（不包括固定元素）
    const pageWidth = Math.max(
      document.documentElement.clientWidth,
      document.documentElement.scrollWidth,
      document.documentElement.offsetWidth
    );
    
    const pageHeight = Math.max(
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
      document.body.scrollHeight,
      document.body.offsetHeight
    );

    const viewportHeight = window.innerHeight;
    const scale = window.devicePixelRatio || 1;

    // Canvas 最大高度限制
    const MAX_CANVAS_HEIGHT = 32767;
    const MAX_CANVAS_PIXELS = 268435456; // 256 MB 的像素数据限制

    // 计算单个 Canvas 的最大高度（考虑内存限制）
    const maxHeightByMemory = Math.floor(MAX_CANVAS_PIXELS / (pageWidth * scale));
    const maxSegmentHeight = Math.min(MAX_CANVAS_HEIGHT, maxHeightByMemory);
    
    // 计算需要的 Canvas 数量
    const totalSegments = Math.ceil(pageHeight * scale / maxSegmentHeight);
    
    // 创建多个 Canvas 存储图片段
    const canvasSegments = [];
    
    for (let segment = 0; segment < totalSegments; segment++) {
      const segmentCanvas = document.createElement('canvas');
      const ctx = segmentCanvas.getContext('2d', { alpha: false });
      
      const currentHeight = Math.min(maxSegmentHeight, pageHeight * scale - segment * maxSegmentHeight);
      segmentCanvas.width = pageWidth * scale;
      segmentCanvas.height = currentHeight;
      
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, segmentCanvas.width, segmentCanvas.height);
      
      canvasSegments.push(segmentCanvas);
    }

    // 计算视口截图次数
    const viewportSteps = Math.ceil(pageHeight / viewportHeight);
    
    // 逐段截图（主要内容）
    for (let i = 0; i < viewportSteps; i++) {
      const currentScrollTop = i * viewportHeight;
      window.scrollTo(0, currentScrollTop);
      
      // 等待滚动和重绘完成
      await sleep(200);
      
      // 更新进度
      const progress = Math.round((i + 1) / viewportSteps * 100);
      loadingDiv.textContent = `正在截图... ${progress}%`;
      
      try {
        // 暂时隐藏进度条
        progressContainer.style.visibility = 'hidden';
        await sleep(50);

        // 截取当前可见区域
        const img = await captureVisible();
        
        // 恢复进度条
        progressContainer.style.visibility = 'visible';

        // 计算当前部分的高度和目标 Canvas
        const partHeight = Math.min(viewportHeight, pageHeight - currentScrollTop);
        const targetSegment = Math.floor(currentScrollTop * scale / maxSegmentHeight);
        const targetY = (currentScrollTop * scale) % maxSegmentHeight;
        
        // 绘制到对应的 Canvas 上
        const ctx = canvasSegments[targetSegment].getContext('2d');
        ctx.drawImage(
          img,
          0, 0,
          img.width,
          partHeight * scale,
          0,
          targetY,
          pageWidth * scale,
          partHeight * scale
        );

        await sleep(50);
      } catch (error) {
        console.error(`第 ${i + 1} 段截图失败:`, error);
        throw error;
      }
    }

    // 恢复原始滚动位置
    window.scrollTo(0, 0);
    await sleep(100);

    // 恢复固定元素显示
    fixedElements.forEach(el => {
      const state = fixedElementsState.get(el);
      if (state) {
        el.style.visibility = 'visible';
      }
    });

    // 等待固定元素重新渲染
    await sleep(100);

    // 截取固定元素
    progressContainer.style.visibility = 'hidden';
    const fixedImg = await captureVisible();
    progressContainer.style.visibility = 'visible';

    // 将固定元素绘制到第一个 Canvas 的顶部
    const firstCtx = canvasSegments[0].getContext('2d');
    firstCtx.drawImage(
      fixedImg,
      0, 0,
      fixedImg.width,
      Math.min(viewportHeight, fixedImg.height) * scale,
      0, 0,
      pageWidth * scale,
      Math.min(viewportHeight, fixedImg.height) * scale
    );

    // 恢复原始状态
    window.scrollTo(originalState.scrollLeft, originalState.scrollTop);
    document.body.style.overflow = originalState.bodyOverflow;
    document.documentElement.style.overflow = originalState.htmlOverflow;

    // 恢复固定元素的原始状态
    fixedElements.forEach(el => {
      const state = fixedElementsState.get(el);
      if (state) {
        Object.assign(el.style, state);
      }
    });

    // 生成最终图片（可能需要多个文件）
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    for (let i = 0; i < canvasSegments.length; i++) {
      const dataUrl = canvasSegments[i].toDataURL(mimeType, quality);
      
      // 发送到后台进行下载
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'downloadCapture',
          dataUrl: dataUrl,
          format: format,
          suffix: canvasSegments.length > 1 ? `_part${i + 1}` : ''
        }, response => {
          if (response && response.success) {
            resolve();
          } else {
            reject(new Error(response?.error || '保存截图失败'));
          }
        });
      });

      // 清理内存
      canvasSegments[i].width = 1;
      canvasSegments[i].height = 1;
    }

    // 显示完成消息
    loadingDiv.textContent = canvasSegments.length > 1 
      ? `截图完成！已保存 ${canvasSegments.length} 个部分`
      : '截图完成！';
    loadingDiv.style.background = 'rgba(0,128,0,0.8)';

  } catch (error) {
    console.error('[Content] 截图失败:', error);
    loadingDiv.textContent = `截图失败: ${error.message}`;
    loadingDiv.style.background = 'rgba(255,0,0,0.8)';
    
    // 显示更详细的错误信息
    setTimeout(() => {
      alert('截图失败！\n\n错误信息: ' + error.message + '\n\n请打开开发者工具(F12)查看详细日志。');
    }, 500);
    
    throw error;
  } finally {
    window._isCapturing = false;
    
    // 延迟移除进度条
    setTimeout(() => {
      if (document.body.contains(progressContainer)) {
        progressContainer.style.opacity = '0';
        setTimeout(() => {
          document.body.removeChild(progressContainer);
        }, 300);
      }
    }, 1500);
  }
}

/**
 * 判断元素是否可滚动
 * @param {HTMLElement} element - 要检查的元素
 * @param {boolean} debug - 是否输出调试信息
 * @returns {boolean} 是否可滚动
 */
function isScrollable(element, debug = false) {
  if (!element || element === document.body || element === document.documentElement) {
    return false;
  }
  
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const overflow = style.overflow;
  
  // 检查垂直滚动
  const hasVerticalOverflow = element.scrollHeight > element.clientHeight;
  const allowsVerticalScroll = overflowY === 'scroll' || overflowY === 'auto' || 
                               overflow === 'scroll' || overflow === 'auto';
  const hasVerticalScroll = allowsVerticalScroll && hasVerticalOverflow;
  
  // 检查水平滚动
  const hasHorizontalOverflow = element.scrollWidth > element.clientWidth;
  const allowsHorizontalScroll = overflowX === 'scroll' || overflowX === 'auto' ||
                                overflow === 'scroll' || overflow === 'auto';
  const hasHorizontalScroll = allowsHorizontalScroll && hasHorizontalOverflow;
  
  const isScrollable = hasVerticalScroll || hasHorizontalScroll;
  
  // 调试信息
  if (debug && isScrollable) {
    console.log('[Content] 找到可滚动元素:', {
      element: element,
      tagName: element.tagName,
      className: element.className,
      overflowY: overflowY,
      overflowX: overflowX,
      overflow: overflow,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      hasVerticalScroll: hasVerticalScroll,
      hasHorizontalScroll: hasHorizontalScroll
    });
  }
  
  return isScrollable;
}

/**
 * 获取元素的唯一选择器
 * @param {HTMLElement} element - 要获取选择器的元素
 * @returns {string} CSS 选择器
 */
function getUniqueSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }
  
  let path = [];
  let current = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }
    
    // 添加 nth-child 确保唯一性
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

/**
 * 查找页面中所有可滚动元素
 * @returns {Array} 可滚动元素列表
 */
function findScrollableElements() {
  const scrollables = [];
  const allElements = document.querySelectorAll('*');
  
  allElements.forEach(element => {
    if (isScrollable(element)) {
      scrollables.push({
        element: element,
        selector: getUniqueSelector(element),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      });
    }
  });
  
  return scrollables;
}

/**
 * 启用可视化区域选择器
 */
/**
 * 启用滚动区域选择模式
 * @param {string} format - 图片格式 ('png' 或 'jpeg')
 * @param {number} quality - 图片质量 (0-1)
 */
function enableRegionSelector(format = 'png', quality = 0.9) {
  // 如果已经在选择模式，不重复创建
  if (window._regionSelectorActive) {
    return;
  }
  window._regionSelectorActive = true;
  
  // 创建自定义光标 SVG - 移除注释，避免编码问题
  const cursorSvg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><line x1="24" y1="2" x2="24" y2="16" stroke="black" stroke-width="5"/><line x1="24" y1="32" x2="24" y2="46" stroke="black" stroke-width="5"/><line x1="2" y1="24" x2="16" y2="24" stroke="black" stroke-width="5"/><line x1="32" y1="24" x2="46" y2="24" stroke="black" stroke-width="5"/><line x1="24" y1="2" x2="24" y2="16" stroke="white" stroke-width="3"/><line x1="24" y1="32" x2="24" y2="46" stroke="white" stroke-width="3"/><line x1="2" y1="24" x2="16" y2="24" stroke="white" stroke-width="3"/><line x1="32" y1="24" x2="46" y2="24" stroke="white" stroke-width="3"/><circle cx="24" cy="24" r="5" fill="white" stroke="black" stroke-width="3"/><circle cx="24" cy="24" r="2" fill="#2196F3"/></svg>')}`;
  
  // 创建遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'screenshot-region-selector-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2147483646;
    cursor: url('${cursorSvg}') 24 24, crosshair !important;
  `;
  
  // 创建提示信息
  const tooltip = document.createElement('div');
  tooltip.id = 'screenshot-region-selector-tooltip';
  tooltip.innerHTML = `
    <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">📷 滚动截图</div>
    <div style="font-size: 14px;">移动鼠标到可滚动区域</div>
    <div style="font-size: 12px; margin-top: 5px; opacity: 0.8;">按 ESC 取消</div>
  `;
  tooltip.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    text-align: center;
  `;
  
  // 创建高亮矩形框（在遮罩层上方绘制）
  const highlightBox = document.createElement('div');
  highlightBox.id = 'screenshot-region-highlight-box';
  highlightBox.style.position = 'fixed';
  highlightBox.style.border = '5px solid #00ff00';
  highlightBox.style.boxShadow = '0 0 0 3px #000, inset 0 0 0 3px #000, 0 0 30px #00ff00';
  highlightBox.style.pointerEvents = 'none';
  highlightBox.style.zIndex = '2147483647';
  highlightBox.style.display = 'none';
  highlightBox.style.backgroundColor = 'transparent';
  document.body.appendChild(highlightBox);
  console.log('[Content] 高亮框已创建');
  
  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);
  
  // 当前高亮的元素
  let currentHighlighted = null;
  
  // 添加全局光标样式 - 使用自定义 SVG 光标，确保高对比度
  const cursorStyle = document.createElement('style');
  cursorStyle.id = 'screenshot-region-cursor-style';
  
  cursorStyle.textContent = `
    *, body, html {
      cursor: url('${cursorSvg}') 24 24, crosshair !important;
    }
  `;
  document.head.appendChild(cursorStyle);
  
  // 鼠标移动事件 - 高亮可滚动元素
  const mouseMoveHandler = (e) => {
    // 临时隐藏遮罩层和高亮框，获取真实的页面元素
    overlay.style.display = 'none';
    highlightBox.style.display = 'none';
    const element = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.display = '';
    
    console.log('[Content] 鼠标移动到元素:', element?.tagName, element?.className);
    
    // 移除之前的高亮
    if (currentHighlighted) {
      currentHighlighted.style.boxShadow = '';
      currentHighlighted.style.outline = '';
      currentHighlighted.style.outlineOffset = '';
      currentHighlighted.style.position = '';
      currentHighlighted.style.zIndex = '';
      currentHighlighted.style.cursor = '';
    }
    
    // 查找最近的可滚动父元素
    let scrollableParent = element;
    while (scrollableParent && scrollableParent !== document.body) {
      if (isScrollable(scrollableParent)) {  // 与clickHandler保持一致
        currentHighlighted = scrollableParent;
        
        // 获取元素位置并显示高亮框
        const rect = scrollableParent.getBoundingClientRect();
        const borderWidth = 5; // 边框宽度
        highlightBox.style.display = 'block';
        highlightBox.style.left = (rect.left - borderWidth) + 'px';
        highlightBox.style.top = (rect.top - borderWidth) + 'px';
        highlightBox.style.width = (rect.width) + 'px';
        highlightBox.style.height = (rect.height) + 'px';
        
        console.log('[Content] 显示高亮框:', {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        });
        
        // 更新提示信息
        const scrollInfo = scrollableParent.scrollHeight > scrollableParent.clientHeight 
          ? `内容高度 ${scrollableParent.scrollHeight}px` 
          : '可滚动区域';
        tooltip.innerHTML = `
          <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">✅ 找到了！</div>
          <div style="font-size: 14px;">${scrollInfo}</div>
          <div style="font-size: 12px; margin-top: 5px; opacity: 0.8;">点击开始截图</div>
        `;
        break;
      }
      scrollableParent = scrollableParent.parentElement;
    }
    
    if (!scrollableParent || scrollableParent === document.body) {
      // 隐藏高亮框
      highlightBox.style.display = 'none';
      
      tooltip.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">📷 滚动截图</div>
        <div style="font-size: 14px;">移动鼠标到可滚动区域</div>
        <div style="font-size: 12px; margin-top: 5px; opacity: 0.8;">按 ESC 取消</div>
      `;
    }
  };
  
  // 点击事件 - 选择元素并开始截图
  const clickHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 临时隐藏遮罩层和提示，以便获取真正的页面元素
    overlay.style.display = 'none';
    tooltip.style.display = 'none';
    
    const element = document.elementFromPoint(e.clientX, e.clientY);
    
    // 恢复显示
    overlay.style.display = '';
    tooltip.style.display = '';
    
    console.log('[Content] 点击的元素:', element);
    
    // 查找最近的可滚动父元素
    let scrollableParent = element;
    let checkedElements = [];
    
    while (scrollableParent && scrollableParent !== document.body) {
      const elementInfo = {
        tagName: scrollableParent.tagName,
        className: scrollableParent.className,
        id: scrollableParent.id,
        isScrollable: isScrollable(scrollableParent)
      };
      
      checkedElements.push(elementInfo);
      
      if (isScrollable(scrollableParent)) {
        console.log('[Content] 找到可滚动父元素，开始截图');
        // 清理
        cleanup();
        
        // 开始截图（使用传入的格式和质量参数）
        captureScrollableElement(scrollableParent, format, quality)
          .catch(error => {
            console.error('[Content] 截图失败:', error);
            alert('截图失败: ' + error.message);
          });
        
        return;
      }
      scrollableParent = scrollableParent.parentElement;
    }
    
    // 如果没有找到可滚动元素，输出详细信息
    console.log('[Content] 未找到可滚动元素，已检查的元素:', checkedElements);
    
    // 获取点击元素的详细信息用于调试
    const clickedStyle = window.getComputedStyle(element);
    console.log('[Content] 点击元素的样式信息:', {
      overflow: clickedStyle.overflow,
      overflowY: clickedStyle.overflowY,
      overflowX: clickedStyle.overflowX,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    });
    
    alert('⚠️ 此区域不可滚动\n\n' +
          '区域截图用于截取有滚动条的局部区域（如聊天窗口、评论列表）。\n\n' +
          '如果要截取整个网页，请使用"整页截图"模式。\n\n' +
          '提示：\n' +
          '• 可滚动区域会显示蓝色高亮边框\n' +
          '• 按 ESC 可以取消选择\n' +
          '• 查看控制台(F12)获取更多调试信息');
  };
  
  // ESC 键取消
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };
  
  // 清理函数
  const cleanup = () => {
    window._regionSelectorActive = false;
    
    if (currentHighlighted) {
      currentHighlighted.style.boxShadow = '';
      currentHighlighted.style.outline = '';
      currentHighlighted.style.outlineOffset = '';
      currentHighlighted.style.position = '';
      currentHighlighted.style.zIndex = '';
      currentHighlighted.style.cursor = '';
    }
    
    // 移除全局光标样式
    const styleEl = document.getElementById('screenshot-region-cursor-style');
    if (styleEl) {
      styleEl.remove();
    }
    
    // 移除高亮框
    if (highlightBox && highlightBox.parentNode) {
      highlightBox.remove();
    }
    
    overlay.remove();
    tooltip.remove();
    
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('keydown', keyHandler);
  };
  
  // 添加事件监听
  document.addEventListener('mousemove', mouseMoveHandler);
  document.addEventListener('click', clickHandler, true);
  document.addEventListener('keydown', keyHandler);
}

/**
 * 截取可滚动元素的完整内容
 * @param {HTMLElement} scrollContainer - 滚动容器元素
 * @param {string} format - 图片格式 (png/jpeg)
 * @param {number} quality - 图片质量 (0-1)
 */
async function captureScrollableElement(scrollContainer, format = 'png', quality = 0.9) {
  if (window._isCapturingRegion) {
    console.log('区域截图进行中，请稍候...');
    return;
  }
  window._isCapturingRegion = true;
  
  // 创建进度提示
  const progressContainer = document.createElement('div');
  const shadowRoot = progressContainer.attachShadow({ mode: 'closed' });
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'screenshot-progress';
  
  const style = document.createElement('style');
  style.textContent = `
    #screenshot-progress {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 2147483647;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
  `;
  
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(loadingDiv);
  document.body.appendChild(progressContainer);
  
  // 保存原始滚动位置
  const originalScrollTop = scrollContainer.scrollTop;
  const originalScrollLeft = scrollContainer.scrollLeft;
  
  try {
    loadingDiv.textContent = '正在准备截图...';
    await sleep(100);
    
    // 获取容器尺寸信息
    const rect = scrollContainer.getBoundingClientRect();
    let scrollHeight = scrollContainer.scrollHeight;
    let scrollWidth = scrollContainer.scrollWidth;
    const clientHeight = scrollContainer.clientHeight;
    const clientWidth = scrollContainer.clientWidth;
    
    console.log('[Content] 容器初始信息 - 可见尺寸:', clientWidth, 'x', clientHeight, ', 滚动尺寸:', scrollWidth, 'x', scrollHeight);
    
    // 检查 html2canvas 是否可用
    if (typeof html2canvas === 'undefined') {
      throw new Error('html2canvas 库未加载，请刷新页面后重试');
    }
    
    // 使用 html2canvas 截取整个滚动内容
    loadingDiv.textContent = '正在渲染内容...';
    
    // 预处理不支持的颜色函数
    const colorModifications = preprocessUnsupportedColors(scrollContainer);
    
    // 保存原始样式
    const originalOverflow = scrollContainer.style.overflow;
    const originalOverflowX = scrollContainer.style.overflowX;
    const originalOverflowY = scrollContainer.style.overflowY;
    const originalMaxHeight = scrollContainer.style.maxHeight;
    const originalHeight = scrollContainer.style.height;
    const originalWidth = scrollContainer.style.width;
    const originalMinWidth = scrollContainer.style.minWidth;
    const originalMaxWidth = scrollContainer.style.maxWidth;
    
    // 临时修改样式，固定宽度并移除滚动限制
    scrollContainer.style.width = scrollWidth + 'px';  // 固定宽度，防止展开时变化
    scrollContainer.style.minWidth = scrollWidth + 'px';
    scrollContainer.style.maxWidth = scrollWidth + 'px';
    scrollContainer.style.overflow = 'visible';
    scrollContainer.style.maxHeight = 'none';
    // 不修改 height，让容器自然展开
    
    // 等待布局稳定
    await sleep(300);
    
    // 强制加载容器内的所有图片
    const images = scrollContainer.querySelectorAll('img');
    const imagePromises = [];
    images.forEach(img => {
      if (!img.complete) {
        imagePromises.push(new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
          // 如果是懒加载图片，触发加载
          if (img.loading === 'lazy') {
            img.loading = 'eager';
          }
          // 如果有 data-src，手动加载
          if (img.dataset.src && !img.src) {
            img.src = img.dataset.src;
          }
        }));
      }
    });
    
    // 等待所有图片加载完成（最多等待3秒）
    if (imagePromises.length > 0) {
      console.log(`[Content] 等待 ${imagePromises.length} 张图片加载...`);
      await Promise.race([
        Promise.all(imagePromises),
        sleep(3000)
      ]);
    }
    
    // 再次等待，确保布局完全稳定
    await sleep(200);
    
    // 重新获取展开后的尺寸
    const finalHeight = scrollContainer.scrollHeight;
    const finalWidth = scrollContainer.scrollWidth;
    
    console.log('[Content] 展开后尺寸:', finalWidth, 'x', finalHeight);
    console.log('[Content] 设备像素比:', window.devicePixelRatio);
    console.log('[Content] 开始使用 html2canvas 渲染');
    
    // 截取展开后的容器
    const canvas = await html2canvas(scrollContainer, {
      allowTaint: true,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollY: 0,
      scrollX: 0,
      // 明确指定渲染窗口和元素尺寸
      windowWidth: finalWidth,
      windowHeight: finalHeight,
      width: finalWidth,
      height: finalHeight,
      scale: window.devicePixelRatio || 1  // 使用设备像素比，确保高清屏幕的清晰度
    });
    
    console.log('[Content] html2canvas 渲染完成, Canvas 尺寸:', canvas.width, 'x', canvas.height);
    console.log('[Content] Canvas 逻辑尺寸:', canvas.width / (window.devicePixelRatio || 1), 'x', canvas.height / (window.devicePixelRatio || 1));
    
    // 恢复原始样式
    scrollContainer.style.width = originalWidth;
    scrollContainer.style.minWidth = originalMinWidth;
    scrollContainer.style.maxWidth = originalMaxWidth;
    scrollContainer.style.overflow = originalOverflow;
    scrollContainer.style.overflowX = originalOverflowX;
    scrollContainer.style.overflowY = originalOverflowY;
    scrollContainer.style.maxHeight = originalMaxHeight;
    scrollContainer.style.height = originalHeight;
    
    restoreOriginalStyles(colorModifications);
    scrollContainer.scrollTop = originalScrollTop;
    scrollContainer.scrollLeft = originalScrollLeft;
    
    loadingDiv.textContent = '正在保存图片...';
    
    // 转换为图片数据
    const dataUrl = canvas.toDataURL(`image/${format}`, quality);
    
    // 发送到后台进行下载
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'downloadCapture',
        dataUrl: dataUrl,
        format: format,
        suffix: '_region'
      }, response => {
        if (response && response.success) {
          resolve();
        } else {
          reject(new Error(response?.error || '保存截图失败'));
        }
      });
    });
    
    // 清理内存
    canvas.width = 1;
    canvas.height = 1;
    
    // 显示完成消息
    loadingDiv.textContent = '截图完成！';
    loadingDiv.style.background = 'rgba(0,128,0,0.8)';
    
  } catch (error) {
    console.error('[Content] 区域截图失败:', error);
    loadingDiv.textContent = '截图失败: ' + error.message;
    loadingDiv.style.background = 'rgba(255,0,0,0.8)';
    
    // 恢复原始滚动位置
    scrollContainer.scrollTop = originalScrollTop;
    scrollContainer.scrollLeft = originalScrollLeft;
    
    // 显示更详细的错误信息
    setTimeout(() => {
      let errorMsg = '区域截图失败！\n\n错误信息: ' + error.message;
      
      // 检查 html2canvas 是否可用
      if (typeof html2canvas === 'undefined') {
        errorMsg += '\n\n可能原因: html2canvas 库未加载';
      }
      
      errorMsg += '\n\n请打开开发者工具(F12)查看详细日志。';
      alert(errorMsg);
    }, 500);
    
    throw error;
  } finally {
    window._isCapturingRegion = false;
    
    // 延迟移除进度条
    setTimeout(() => {
      if (document.body.contains(progressContainer)) {
        progressContainer.style.opacity = '0';
        setTimeout(() => {
          document.body.removeChild(progressContainer);
        }, 300);
      }
    }, 1500);
  }
}

/**
 * 截取当前可见页面
 * @param {string} format - 图片格式 (png/jpeg)
 * @param {number} quality - 图片质量 (0-1)
 */
async function captureVisiblePage(format = 'png', quality = 0.9) {
  if (window._isCapturingVisible) {
    console.log('可见页面截图进行中，请稍候...');
    return;
  }
  window._isCapturingVisible = true;
  
  // 创建进度提示
  const progressContainer = document.createElement('div');
  const shadowRoot = progressContainer.attachShadow({ mode: 'closed' });
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'screenshot-progress';
  
  const style = document.createElement('style');
  style.textContent = `
    #screenshot-progress {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 2147483647;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
  `;
  
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(loadingDiv);
  document.body.appendChild(progressContainer);
  
  try {
    loadingDiv.textContent = '正在截取可见页面...';
    await sleep(100);
    
    console.log('[Content] 开始截取可见页面');
    
    // 截取当前可见区域
    progressContainer.style.visibility = 'hidden';
    await sleep(50);
    
    const img = await captureVisible();
    
    progressContainer.style.visibility = 'visible';
    loadingDiv.textContent = '正在保存图片...';
    
    // 创建 Canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    
    // 绘制图片
    ctx.drawImage(img, 0, 0);
    
    // 转换为指定格式
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mimeType, quality);
    
    // 发送到后台进行下载
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'downloadCapture',
        dataUrl: dataUrl,
        format: format,
        suffix: '_visible'
      }, response => {
        if (response && response.success) {
          resolve();
        } else {
          reject(new Error(response?.error || '保存截图失败'));
        }
      });
    });
    
    // 清理内存
    canvas.width = 1;
    canvas.height = 1;
    
    // 显示完成消息
    loadingDiv.textContent = '截图完成！';
    loadingDiv.style.background = 'rgba(0,128,0,0.8)';
    
    console.log('[Content] 可见页面截图完成');
    
  } catch (error) {
    console.error('[Content] 可见页面截图失败:', error);
    loadingDiv.textContent = `截图失败: ${error.message}`;
    loadingDiv.style.background = 'rgba(255,0,0,0.8)';
    
    setTimeout(() => {
      alert('可见页面截图失败！\n\n错误信息: ' + error.message + '\n\n请打开开发者工具(F12)查看详细日志。');
    }, 500);
    
    throw error;
  } finally {
    window._isCapturingVisible = false;
    
    // 延迟移除进度条
    setTimeout(() => {
      if (document.body.contains(progressContainer)) {
        progressContainer.style.opacity = '0';
        setTimeout(() => {
          document.body.removeChild(progressContainer);
        }, 300);
      }
    }, 1500);
  }
}

/**
 * 启用手动选择区域功能
 * @param {string} format - 图片格式 (png/jpeg)
 * @param {number} quality - 图片质量 (0-1)
 */
function enableManualSelector(format = 'png', quality = 0.9) {
  // 如果已经在选择模式，不重复创建
  if (window._manualSelectorActive) {
    return;
  }
  window._manualSelectorActive = true;
  
  console.log('[Content] 启用手动选择区域模式');
  
  // 创建遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'screenshot-manual-selector-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 2147483646;
    cursor: crosshair;
  `;
  
  // 创建选区框
  const selectionBox = document.createElement('div');
  selectionBox.id = 'screenshot-selection-box';
  selectionBox.style.cssText = `
    position: fixed;
    border: 2px solid #2196F3;
    background: rgba(33, 150, 243, 0.1);
    z-index: 2147483647;
    pointer-events: none;
    display: none;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
  `;
  
  // 创建提示信息
  const tooltip = document.createElement('div');
  tooltip.id = 'screenshot-manual-selector-tooltip';
  tooltip.innerHTML = `
    <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">📷 手动选择区域</div>
    <div style="font-size: 14px;">按住鼠标左键拖拽选择截图区域</div>
    <div style="font-size: 12px; margin-top: 5px; opacity: 0.8;">按 ESC 取消</div>
  `;
  tooltip.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    text-align: center;
  `;
  
  // 创建尺寸提示
  const sizeInfo = document.createElement('div');
  sizeInfo.id = 'screenshot-size-info';
  sizeInfo.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 2147483647;
    pointer-events: none;
    display: none;
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(selectionBox);
  document.body.appendChild(tooltip);
  document.body.appendChild(sizeInfo);
  
  let isSelecting = false;
  let startX = 0;
  let startY = 0;
  let scrollX = window.pageXOffset;
  let scrollY = window.pageYOffset;
  
  // 鼠标按下事件
  const mouseDownHandler = (e) => {
    if (e.button !== 0) return; // 只响应左键
    
    isSelecting = true;
    scrollX = window.pageXOffset;
    scrollY = window.pageYOffset;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.display = 'block';
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    
    tooltip.style.display = 'none';
  };
  
  // 鼠标移动事件
  const mouseMoveHandler = (e) => {
    if (!isSelecting) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    
    // 显示尺寸信息
    if (width > 10 && height > 10) {
      sizeInfo.style.display = 'block';
      sizeInfo.style.left = (currentX + 10) + 'px';
      sizeInfo.style.top = (currentY + 10) + 'px';
      sizeInfo.textContent = `${width} × ${height} px`;
    }
  };
  
  // 鼠标松开事件
  const mouseUpHandler = async (e) => {
    if (!isSelecting) return;
    
    isSelecting = false;
    sizeInfo.style.display = 'none';
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    // 如果选区太小，取消选择
    if (width < 10 || height < 10) {
      selectionBox.style.display = 'none';
      tooltip.style.display = 'block';
      console.log('[Content] 选区太小，已取消');
      return;
    }
    
    console.log('[Content] 选择区域:', { left, top, width, height });
    
    // 清理UI
    cleanup();
    
    // 开始截图
    try {
      await captureManualRegion(left, top, width, height, scrollX, scrollY, format, quality);
    } catch (error) {
      console.error('[Content] 手动区域截图失败:', error);
      alert('截图失败: ' + error.message);
    }
  };
  
  // ESC 键取消
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };
  
  // 清理函数
  const cleanup = () => {
    window._manualSelectorActive = false;
    
    overlay.remove();
    selectionBox.remove();
    tooltip.remove();
    sizeInfo.remove();
    
    document.removeEventListener('mousedown', mouseDownHandler);
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
    document.removeEventListener('keydown', keyHandler);
    
    console.log('[Content] 手动选择模式已退出');
  };
  
  // 添加事件监听
  document.addEventListener('mousedown', mouseDownHandler);
  document.addEventListener('mousemove', mouseMoveHandler);
  document.addEventListener('mouseup', mouseUpHandler);
  document.addEventListener('keydown', keyHandler);
}

/**
 * 截取手动选择的区域
 * @param {number} left - 左边距
 * @param {number} top - 上边距
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {number} scrollX - 滚动X位置
 * @param {number} scrollY - 滚动Y位置
 * @param {string} format - 图片格式
 * @param {number} quality - 图片质量
 */
async function captureManualRegion(left, top, width, height, scrollX, scrollY, format = 'png', quality = 0.9) {
  if (window._isCapturingManual) {
    console.log('手动区域截图进行中，请稍候...');
    return;
  }
  window._isCapturingManual = true;
  
  // 创建进度提示
  const progressContainer = document.createElement('div');
  const shadowRoot = progressContainer.attachShadow({ mode: 'closed' });
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'screenshot-progress';
  
  const style = document.createElement('style');
  style.textContent = `
    #screenshot-progress {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 2147483647;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
  `;
  
  shadowRoot.appendChild(style);
  shadowRoot.appendChild(loadingDiv);
  document.body.appendChild(progressContainer);
  
  try {
    loadingDiv.textContent = '正在截取选定区域...';
    await sleep(100);
    
    console.log('[Content] 开始截取手动选择区域');
    
    // 截取当前可见区域
    progressContainer.style.visibility = 'hidden';
    await sleep(50);
    
    const img = await captureVisible();
    
    progressContainer.style.visibility = 'visible';
    loadingDiv.textContent = '正在处理图片...';
    
    // 创建 Canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = window.devicePixelRatio || 1;
    
    canvas.width = width * scale;
    canvas.height = height * scale;
    
    // 绘制选定区域
    ctx.drawImage(
      img,
      left * scale,
      top * scale,
      width * scale,
      height * scale,
      0,
      0,
      width * scale,
      height * scale
    );
    
    loadingDiv.textContent = '正在保存图片...';
    
    // 转换为指定格式
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = canvas.toDataURL(mimeType, quality);
    
    // 发送到后台进行下载
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'downloadCapture',
        dataUrl: dataUrl,
        format: format,
        suffix: '_manual'
      }, response => {
        if (response && response.success) {
          resolve();
        } else {
          reject(new Error(response?.error || '保存截图失败'));
        }
      });
    });
    
    // 清理内存
    canvas.width = 1;
    canvas.height = 1;
    
    // 显示完成消息
    loadingDiv.textContent = '截图完成！';
    loadingDiv.style.background = 'rgba(0,128,0,0.8)';
    
    console.log('[Content] 手动区域截图完成');
    
  } catch (error) {
    console.error('[Content] 手动区域截图失败:', error);
    loadingDiv.textContent = `截图失败: ${error.message}`;
    loadingDiv.style.background = 'rgba(255,0,0,0.8)';
    
    setTimeout(() => {
      alert('手动区域截图失败！\n\n错误信息: ' + error.message + '\n\n请打开开发者工具(F12)查看详细日志。');
    }, 500);
    
    throw error;
  } finally {
    window._isCapturingManual = false;
    
    // 延迟移除进度条
    setTimeout(() => {
      if (document.body.contains(progressContainer)) {
        progressContainer.style.opacity = '0';
        setTimeout(() => {
          document.body.removeChild(progressContainer);
        }, 300);
      }
    }, 1500);
  }
}

