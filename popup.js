document.addEventListener('DOMContentLoaded', async () => {
  const statusDiv = document.getElementById('status');
  const extractProfileBtn = document.getElementById('extractProfileBtn');
  const stopBtn = document.getElementById('stopBtn');

  // 简单的 UI 切换
  const setRunningState = (running) => {
    if (running) {
      extractProfileBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.classList.remove('hidden');
      statusDiv.textContent = "🕷️ 正在模拟人工采集，请勿关闭页面...";
    } else {
      extractProfileBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      statusDiv.textContent = "✅ 采集完成或已就绪";
    }
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // 判断当前页面模式
  let mode = 'discovery';
  if (tab.url.includes('/user/profile/')) {
    mode = 'profile';
    extractProfileBtn.textContent = "开始采集博主主页 (含笔记详情)";
  } else {
    extractProfileBtn.textContent = "采集当前页笔记";
  }

  // 开始采集
  extractProfileBtn.addEventListener('click', () => {
    setRunningState(true);
    
    // 发送开始消息
    chrome.tabs.sendMessage(tab.id, { action: "start_crawl", mode: mode }, (response) => {
      setRunningState(false);
      
      if (chrome.runtime.lastError) {
        statusDiv.textContent = "❌ 连接失败，请刷新页面";
        return;
      }

      if (response && response.status === "complete") {
        handleDataDownload(response.data);
      } else if (response && response.status === "error") {
        statusDiv.textContent = `❌ 出错: ${response.message}`;
      }
    });
  });

  // 停止采集
  stopBtn.addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { action: "stop_crawl" }, (response) => {
      statusDiv.textContent = "🛑 已发送停止指令";
    });
  });

  function handleDataDownload(data) {
    if (!data) return;

    // 生成文件名
    let filename = "xhs_data.json";
    const timestamp = getFormattedTimestamp();

    if (data.mode === 'profile' && data.data.unique_id) {
      // 格式: {UserUniqueID}_{年月日时分}.json
      filename = `${data.data.unique_id}_${timestamp}.json`;
    } else {
      filename = `xhs_discovery_${timestamp}.json`;
    }

    const jsonStr = JSON.stringify(data.data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // 下载
    chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify'
    });
    
    statusDiv.textContent = `✅ 已导出: ${filename}`;
  }

  function getFormattedTimestamp() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${min}`;
  }
});
