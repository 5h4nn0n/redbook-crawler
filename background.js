// redbook-crawler/background.js
// Background Script for handling API requests and other background tasks

/**
 * 处理从Content Script或Popup发送的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📬 Background Script received message:", message);

  // 处理API请求
  if (message.action === 'sendToApi') {
    handleApiRequest(message.data, message.apiUrl, sendResponse);
    return true; // 表示异步响应
  }
});

/**
 * 处理点击扩展图标
 */
chrome.action.onClicked.addListener((tab) => {
  console.log('📢 Extension icon clicked, creating popup window...');

  // 使用更简单的窗口创建方式
  try {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 400,
      height: 600,
      focused: true
    }, (window) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Error creating window:', chrome.runtime.lastError);
      } else {
        console.log('✅ Popup window created successfully:', window);
      }
    });
  } catch (error) {
    console.error('❌ Exception creating window:', error);
  }
});

/**
 * 处理API请求
 * @param {object} data - 要发送的数据
 * @param {string} apiUrl - API端点URL
 * @param {function} sendResponse - 响应回调函数
 */
async function handleApiRequest(data, apiUrl, sendResponse) {
  try {
    console.log(`🚀 Sending data to API: ${apiUrl}`);
    console.log(`📊 Data size: ${JSON.stringify(data).length} bytes`);

    // 发送API请求
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      console.log("✅ API request successful");
      const responseData = await response.json();
      console.log("📡 API response:", responseData);
      sendResponse({ success: true, data: responseData });
    } else {
      console.error(`❌ API request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`📡 API error response:`, errorText);
      sendResponse({
        success: false,
        error: `${response.status} ${response.statusText}`,
        errorDetails: errorText
      });
    }
  } catch (error) {
    console.error("❌ Error sending API request:", error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

/**
 * 扩展安装时的初始化
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`🔧 Extension installed/updated: ${details.reason}`);
  // 可以在这里添加初始化逻辑
});

/**
 * 扩展启动时的初始化
 */
console.log("✅ RedBook Crawler Background Script loaded");
