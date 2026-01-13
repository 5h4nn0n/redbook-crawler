// 重写 console.log 函数，同时输出到控制台和弹窗公告区域
const consoleOutput = document.getElementById('console-output');
const originalLog = console.log;
const originalError = console.error;

const maxConsoleLines = 50; // 最大显示行数

function addToConsole(message, isError = false) {
  if (!consoleOutput) return;

  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${message}\n`;

  // 添加到控制台输出
  consoleOutput.textContent += logMessage;

  // 限制行数，防止内存占用过高
  const lines = consoleOutput.textContent.split('\n');
  if (lines.length > maxConsoleLines) {
    consoleOutput.textContent = lines.slice(-maxConsoleLines).join('\n');
  }

  // 自动滚动到底部
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

console.log = function (...args) {
  originalLog.apply(console, args);
  const message = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  addToConsole(message);
};

console.error = function (...args) {
  originalError.apply(console, args);
  const message = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  addToConsole(`❌ ${message}`, true);
};

document.addEventListener('DOMContentLoaded', async () => {
  const statusDiv = document.getElementById('status');
  const extractProfileBtn = document.getElementById('extractProfileBtn');
  const stopBtn = document.getElementById('stopBtn');
  const saveAsJsonRadio = document.getElementById('saveAsJson');
  const sendToApiRadio = document.getElementById('sendToApi');
  const apiUrlGroup = document.getElementById('apiUrlGroup');
  const apiUrlInput = document.getElementById('apiUrl');
  const batchSizeInput = document.getElementById('batchSize');
  const noteLimitInput = document.getElementById('noteLimit');
  const downloadMediaCheckbox = document.getElementById('downloadMedia');

  // 统计信息元素
  const crawledCountElement = document.getElementById('crawledCount');
  const sentBatchCountElement = document.getElementById('sentBatchCount');
  const processedCountElement = document.getElementById('processedCount');

  // 统计变量
  let crawledCount = 0;
  let sentBatchCount = 0;
  let processedCount = 0;

  // 更新统计信息
  const updateStats = () => {
    if (crawledCountElement) crawledCountElement.textContent = crawledCount;
    if (sentBatchCountElement) sentBatchCountElement.textContent = sentBatchCount;
    if (processedCountElement) processedCountElement.textContent = processedCount;
  };

  // 重置统计信息
  const resetStats = () => {
    crawledCount = 0;
    sentBatchCount = 0;
    processedCount = 0;
    updateStats();
  };

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

  // 更新 API URL 输入框的可见性
  const updateApiUrlGroupVisibility = () => {
    if (sendToApiRadio.checked) {
      apiUrlGroup.style.display = "block";
    } else {
      apiUrlGroup.style.display = "none";
    }
  };

  // 初始化 API URL 输入框
  apiUrlInput.value = "http://localhost:3000/api/redbook";
  // 初始化每批数据大小输入框
  batchSizeInput.value = 5;
  // 初始化笔记总量限制输入框
  noteLimitInput.value = 10;

  // 监听数据处理选项的变化
  saveAsJsonRadio.addEventListener("change", updateApiUrlGroupVisibility);
  sendToApiRadio.addEventListener("change", updateApiUrlGroupVisibility);

  // 加载保存的偏好设置
  chrome.storage.local.get(["dataDestination", "apiUrl", "batchSize", "noteLimit", "downloadMedia"], (result) => {
    if (result.dataDestination === "api") {
      sendToApiRadio.checked = true;
    } else {
      saveAsJsonRadio.checked = true;
    }
    if (result.apiUrl) {
      apiUrlInput.value = result.apiUrl;
    }
    if (result.batchSize) {
      batchSizeInput.value = result.batchSize;
    }
    if (result.noteLimit) {
      noteLimitInput.value = result.noteLimit;
    }
    if (result.downloadMedia !== undefined) {
      downloadMediaCheckbox.checked = result.downloadMedia;
    }
    updateApiUrlGroupVisibility();
  });

  // 保存 API URL 到本地存储
  apiUrlInput.addEventListener("change", () => {
    chrome.storage.local.set({ apiUrl: apiUrlInput.value });
  });

  // 保存每批数据大小到本地存储
  batchSizeInput.addEventListener("change", () => {
    chrome.storage.local.set({ batchSize: batchSizeInput.value });
  });

  // 保存笔记总量限制到本地存储
  noteLimitInput.addEventListener("change", () => {
    chrome.storage.local.set({ noteLimit: noteLimitInput.value });
  });

  // 保存下载媒体选项到本地存储
  downloadMediaCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ downloadMedia: downloadMediaCheckbox.checked });
  });

  // 保存数据处理选项到本地存储
  saveAsJsonRadio.addEventListener("change", () => {
    chrome.storage.local.set({ dataDestination: "json" });
  });

  sendToApiRadio.addEventListener("change", () => {
    chrome.storage.local.set({ dataDestination: "api" });
  });

  // 初始化控制台信息
  console.log('📢 插件已加载，控制台信息将显示在此区域');
  console.log('🔍 请打开小红书页面并刷新，然后点击开始采集按钮');
  console.log('💡 所有操作日志将实时显示在此区域');

  // 开始采集按钮
  extractProfileBtn.addEventListener('click', async () => {
    console.log('📢 点击了开始采集按钮');

    // 获取数据处理选项
    const dataDestination = saveAsJsonRadio.checked ? 'json' : 'api';
    const apiUrl = apiUrlInput.value;
    const batchSize = parseInt(batchSizeInput.value) || 5;
    const noteLimit = parseInt(noteLimitInput.value) || 10;
    const shouldDownloadMedia = downloadMediaCheckbox.checked;

    console.log('📦 数据处理选项:', {
      dataDestination,
      apiUrl,
      batchSize,
      noteLimit,
      shouldDownloadMedia
    });

    // 重置统计信息
    resetStats();

    // 查找小红书标签页
    console.log('🔍 正在查找小红书标签页...');
    const tabs = await chrome.tabs.query({});
    console.log('📋 找到的标签页数量:', tabs.length);

    // 动态查找最新的小红书标签页
    let currentTargetTab = null;
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('xiaohongshu.com') || tab.url.includes('redbook.com'))) {
        console.log('✅ 找到小红书标签页:', tab.id, tab.url);
        currentTargetTab = tab;
        break;
      }
    }

    if (!currentTargetTab) {
      console.error('❌ 未找到小红书标签页');
      statusDiv.textContent = '❌ 未找到小红书标签页，请先打开小红书页面并刷新';
      return;
    }

    console.log('🚀 准备向标签页发送开始采集消息:', currentTargetTab.id);

    // 直接发送开始采集消息（content.js已经通过manifest.json自动注入）
    try {
      setRunningState(true);
      console.log('🚀 向标签页发送开始采集消息:', currentTargetTab.id, { action: "start_crawl", mode: 'profile', batchSize: batchSize, noteLimit: noteLimit });
      chrome.tabs.sendMessage(currentTargetTab.id, { action: "start_crawl", mode: 'profile', batchSize: batchSize, noteLimit: noteLimit }, (response) => {
        console.log('📡 收到消息响应:', response);

        if (chrome.runtime.lastError) {
          setRunningState(false);
          console.error('❌ 连接失败，请确保已打开小红书页面并刷新:', chrome.runtime.lastError);
          const errorMessage = chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError);
          statusDiv.textContent = `❌ 连接失败: ${errorMessage}`;
          return;
        }

        if (response && response.status === "complete") {
          setRunningState(false);
          console.log('✅ 采集完成，开始处理数据');
          handleDataProcessing(response.data, dataDestination, apiUrl, batchSize, shouldDownloadMedia);
        } else if (response && response.status === "error") {
          setRunningState(false);
          console.error('❌ 采集出错:', response.message);
          statusDiv.textContent = `❌ 出错: ${response.message}`;
        } else if (response) {
          console.log('📡 收到其他响应:', response);
        }
      });
    } catch (error) {
      setRunningState(false);
      console.error('❌ 发送消息失败:', error);
      statusDiv.textContent = `❌ 发送消息失败: ${error.message}`;
    }
  });

  // 停止采集
  stopBtn.addEventListener('click', async () => {
    console.log('📢 点击了停止采集按钮');

    // 查找小红书标签页
    const tabs = await chrome.tabs.query({});
    let targetTab = null;
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('xiaohongshu.com') || tab.url.includes('redbook.com'))) {
        targetTab = tab;
        break;
      }
    }

    if (targetTab) {
      console.log('🚀 向标签页发送停止采集消息:', targetTab.id);
      chrome.tabs.sendMessage(targetTab.id, { action: "stop_crawl" }, (response) => {
        console.log('📡 收到停止采集响应:', response);
        setRunningState(false);
        statusDiv.textContent = "✅ 已停止采集";
      });
    } else {
      console.error('❌ 未找到小红书标签页');
      statusDiv.textContent = '❌ 未找到小红书标签页';
    }
  });

  // 处理数据
  async function handleDataProcessing(data, dataDestination, apiUrl, batchSize, shouldDownloadMedia) {
    console.log('📦 开始处理数据，目标:', dataDestination);
    
    // 检查数据是否存在
    if (!data || !data.data) {
      console.error('❌ 数据不存在或格式错误:', data);
      statusDiv.textContent = "❌ 采集数据不存在，无法处理";
      return;
    }
    
    // 检查笔记数据
    const notes = data.data.notes;
    if (!notes || notes.length === 0) {
      console.error('❌ 笔记数据为空，无法处理');
      statusDiv.textContent = "❌ 未采集到任何笔记数据";
      return;
    }
    
    // 更新统计信息
    crawledCount = notes.length;
    updateStats();
    console.log(`📊 采集到 ${crawledCount} 条笔记`);
    
    // 如果需要下载媒体文件
    if (shouldDownloadMedia) {
      console.log('📥 准备下载媒体文件...');
      try {
        await downloadMediaFiles(notes);
        console.log('✅ 媒体文件下载完成');
      } catch (error) {
        console.error('❌ 媒体文件下载失败:', error);
      }
    }
    
    // 根据目标处理数据
    if (dataDestination === 'json') {
      console.log('💾 准备保存为JSON文件...');
      const jsonSuccess = await saveAsJsonInBatches(data, 'redbook_data.json', batchSize);
      if (jsonSuccess) {
        console.log('✅ JSON文件保存完成');
        statusDiv.textContent = "✅ 采集完成，已保存为JSON文件";
      } else {
        console.error('❌ JSON文件保存失败');
        statusDiv.textContent = "❌ 采集完成，但JSON文件保存失败";
      }
    } else if (dataDestination === 'api') {
      console.log('📡 准备发送数据到API...');
      console.log('📡 API URL:', apiUrl);
      console.log('📦 批次大小:', batchSize);
      
      const apiSuccess = await sendToApiInBatches(data, apiUrl, batchSize);
      if (apiSuccess) {
        console.log('✅ API数据发送完成');
        statusDiv.textContent = "✅ 采集完成，已同步到API";
      } else {
        console.error('❌ API数据发送失败');
        statusDiv.textContent = "❌ 采集完成，但API数据发送失败";
      }
    } else {
      console.error('❌ 未知的数据处理目标:', dataDestination);
      statusDiv.textContent = "❌ 未知的数据处理目标";
    }
    
    // 更新处理完成的统计信息
    processedCount = crawledCount;
    updateStats();
    console.log('📊 处理完成，统计信息已更新');
  }

  // 下载媒体文件
  async function downloadMediaFiles(notes) {
    console.log('📥 开始下载媒体文件，笔记数量:', notes.length);

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const noteId = note.note_id || `note_${i}`;
      console.log(`📦 处理笔记 ${i + 1}/${notes.length}: ${noteId}`);

      // 下载图片
      if (note.images && note.images.length > 0) {
        console.log(`📷 下载图片 ${note.images.length} 张`);
        for (let j = 0; j < note.images.length; j++) {
          const imageUrl = note.images[j];
          const filename = `redbook/${noteId}_image_${j + 1}.${getImageExtension(imageUrl)}`;
          await downloadSingleMedia(imageUrl, filename);

          // 更新本地存储路径
          const localPath = `redbook/${noteId}_image_${j + 1}.${getImageExtension(imageUrl)}`;
          notes[i].images[j] = localPath;
        }
      }

      // 下载视频
      if (note.videos && note.videos.length > 0) {
        console.log(`🎬 下载视频 ${note.videos.length} 个`);
        for (let j = 0; j < note.videos.length; j++) {
          const videoUrl = note.videos[j];
          const filename = `redbook/${noteId}_video_${j + 1}.${getVideoExtension(videoUrl)}`;
          await downloadSingleMedia(videoUrl, filename);

          // 更新本地存储路径
          const localPath = `redbook/${noteId}_video_${j + 1}.${getVideoExtension(videoUrl)}`;
          notes[i].videos[j] = localPath;
        }
      }
    }

    console.log('✅ 媒体文件下载完成');
  }

  // 下载单个媒体文件
  async function downloadSingleMedia(url, filename) {
    try {
      console.log(`� 开始下载媒体文件: ${url} -> ${filename}`);
      
      // 确保目录存在
      const dir = filename.substring(0, filename.lastIndexOf('/'));
      if (dir) {
        // 在Chrome扩展中，我们无法直接创建目录，但chrome.downloads会自动处理
        console.log(`📁 目标目录: ${dir}`);
      }
      
      // 验证URL
      if (!url || typeof url !== 'string') {
        console.error('❌ 无效的媒体文件URL:', url);
        return;
      }
      
      // 先尝试使用fetch获取文件，添加必要的请求头
      try {
        console.log(`🔄 尝试使用fetch获取文件内容...`);
        console.log(`🔗 请求URL: ${url}`);
        console.log(`📝 请求头: Referer: https://www.xiaohongshu.com/`);
        
        const startTime = Date.now();
        const response = await fetch(url, {
          headers: {
            'Referer': 'https://www.xiaohongshu.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        const endTime = Date.now();
        console.log(`⏱️ fetch请求耗时: ${endTime - startTime}ms`);
        
        console.log(`📡 fetch响应状态: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
        }
        
        let blob = await response.blob();
        let originalType = blob.type;
        console.log(`✅ 文件获取成功，大小: ${blob.size} bytes, 类型: ${originalType}`);
        
        // 检查是否是有效的媒体文件
        if (blob.size < 100) {
          console.warn(`⚠️ 下载的文件太小，可能不是有效的媒体文件: ${blob.size} bytes`);
        }
        if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/')) {
          console.warn(`⚠️ 下载的文件类型可能不是有效的媒体文件: ${blob.type}`);
        }
        
        // 如果是webp格式图片，转换为jpg格式
        if (blob.type === 'image/webp') {
          console.log(`🔄 检测到webp格式，开始转换为jpg...`);
          blob = await convertWebpToJpg(blob);
          console.log(`✅ 转换完成，新类型: ${blob.type}, 大小: ${blob.size} bytes`);
          // 更新文件名，将.webp后缀改为.jpg
          filename = filename.replace(/\.webp$/i, '.jpg');
          console.log(`🔄 更新文件名: ${filename}`);
        }
        
        // 使用blob URL下载
        const blobUrl = URL.createObjectURL(blob);
        console.log(`🔄 创建blob URL: ${blobUrl.substring(0, 50)}...`);
        
        const downloadId = await chrome.downloads.download({
          url: blobUrl,
          filename: filename,
          saveAs: false // 不显示保存对话框
        });
        
        console.log(`✅ 下载开始，ID: ${downloadId}`);
        
        // 等待下载完成
        await new Promise((resolve) => {
          const onChanged = (delta) => {
            if (delta.id === downloadId) {
              console.log(`📡 下载状态更新:`, delta);
              
              if (delta.state && delta.state.current === 'complete') {
                chrome.downloads.onChanged.removeListener(onChanged);
                URL.revokeObjectURL(blobUrl); // 释放blob URL
                console.log(`✅ 下载完成，ID: ${downloadId}`);
                resolve();
              } else if (delta.error) {
                chrome.downloads.onChanged.removeListener(onChanged);
                URL.revokeObjectURL(blobUrl); // 释放blob URL
                console.error(`❌ 下载失败: ${delta.error.current}`);
                resolve();
              }
            }
          };
          
          chrome.downloads.onChanged.addListener(onChanged);
          
          // 设置超时
          setTimeout(() => {
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(blobUrl); // 释放blob URL
            console.warn(`⚠️ 下载超时: ${url}`);
            resolve();
          }, 30000); // 30秒超时
        });
        
      } catch (fetchError) {
        console.warn(`⚠️ 使用fetch获取文件失败，尝试直接下载: ${fetchError.message}`);
        console.warn(`⚠️ 错误详情:`, fetchError);
        
        // 如果fetch失败，尝试直接使用chrome.downloads.download
        try {
          console.log(`🔄 尝试直接下载...`);
          const downloadId = await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: false // 不显示保存对话框
          });
          
          console.log(`✅ 直接下载开始，ID: ${downloadId}`);
          
          // 等待下载完成
          await new Promise((resolve) => {
            const onChanged = (delta) => {
              if (delta.id === downloadId) {
                console.log(`📡 直接下载状态更新:`, delta);
                
                if (delta.state && delta.state.current === 'complete') {
                  chrome.downloads.onChanged.removeListener(onChanged);
                  console.log(`✅ 直接下载完成，ID: ${downloadId}`);
                  resolve();
                } else if (delta.error) {
                  chrome.downloads.onChanged.removeListener(onChanged);
                  console.error(`❌ 直接下载失败: ${delta.error.current}`);
                  resolve();
                }
              }
            };
            
            chrome.downloads.onChanged.addListener(onChanged);
            
            // 设置超时
            setTimeout(() => {
              chrome.downloads.onChanged.removeListener(onChanged);
              console.warn(`⚠️ 直接下载超时: ${url}`);
              resolve();
            }, 30000); // 30秒超时
          });
        } catch (directError) {
          console.error(`❌ 直接下载也失败了:`, directError);
        }
      }
      
    } catch (error) {
      console.error(`❌ 下载失败: ${url}`, error);
      console.error(`❌ 错误类型:`, error.name);
      console.error(`❌ 错误信息:`, error.message);
      if (error.stack) {
        console.error(`❌ 错误堆栈:`, error.stack);
      }
    }
  }

  // 将webp格式转换为jpg格式
  function convertWebpToJpg(webpBlob) {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
          // 设置canvas尺寸与图片一致
          canvas.width = img.width;
          canvas.height = img.height;
          
          // 绘制图片到canvas
          ctx.drawImage(img, 0, 0);
          
          // 将canvas转换为jpg格式的blob
          canvas.toBlob(function(jpgBlob) {
            if (jpgBlob) {
              resolve(jpgBlob);
            } else {
              reject(new Error('转换为jpg失败'));
            }
          }, 'image/jpeg', 0.9); // 0.9是jpg质量
        };
        
        img.onerror = function() {
          reject(new Error('图片加载失败'));
        };
        
        // 加载webp图片
        img.src = URL.createObjectURL(webpBlob);
      } catch (error) {
        reject(error);
      }
    });
  }

  // 获取图片扩展名
  function getImageExtension(url) {
    const parts = url.split('.');
    return parts.length > 1 ? parts.pop().split('?')[0].split('#')[0] : 'jpg';
  }

  // 获取视频扩展名
  function getVideoExtension(url) {
    const parts = url.split('.');
    return parts.length > 1 ? parts.pop().split('?')[0].split('#')[0] : 'mp4';
  }

  // 分批保存为JSON文件
  async function saveAsJsonInBatches(data, filename, batchSize = 1000) {
    try {
      const notes = data.data.notes;
      const totalBatches = Math.ceil(notes.length / batchSize);
      let allSuccessful = true;

      console.log(`📦 准备分成 ${totalBatches} 批保存，每批最多 ${batchSize} 条`);

      for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = Math.min((i + 1) * batchSize, notes.length);
        const batchNotes = notes.slice(start, end);

        console.log(`🚀 保存第 ${i + 1}/${totalBatches} 批数据，包含 ${batchNotes.length} 条笔记`);

        const batchData = {
          ...data,
          data: {
            ...data.data,
            notes: batchNotes
          },
          batch_info: {
            batch_number: i + 1,
            total_batches: totalBatches,
            start_index: start,
            end_index: end,
            total_notes: notes.length
          }
        };

        // 生成批次文件名
        const batchFileName = filename.replace('.json', `_batch${i + 1}_${totalBatches}.json`);
        const success = saveAsJson(batchData.data, batchFileName);
        if (!success) {
          allSuccessful = false;
          console.error(`❌ 第 ${i + 1} 批保存失败`);
        } else {
          console.log(`✅ 第 ${i + 1} 批保存成功`);
          sentBatchCount++;
          processedCount += batchNotes.length;
          updateStats();
        }

        // 每批之间添加延迟，避免操作过于频繁
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return allSuccessful;
    } catch (error) {
      console.error('❌ 保存数据失败:', error);
      return false;
    }
  }

  // 保存为JSON文件
  function saveAsJson(data, fileName) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error("❌ JSON导出失败:", error);
      return false;
    }
  }

  // 分批发送到API
  async function sendToApiInBatches(data, apiUrl, batchSize = 1000) {
    try {
      const notes = data.data.notes;
      const totalBatches = Math.ceil(notes.length / batchSize);
      let allSuccessful = true;

      console.log(`📦 准备分成 ${totalBatches} 批发送，每批最多 ${batchSize} 条`);

      for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = Math.min((i + 1) * batchSize, notes.length);
        const batchNotes = notes.slice(start, end);

        console.log(`🚀 发送第 ${i + 1}/${totalBatches} 批数据，包含 ${batchNotes.length} 条笔记`);

        const batchData = {
          data: {
            ...data.data,
            notes: batchNotes,
            batch_info: {
              batch_number: i + 1,
              total_batches: totalBatches,
              start_index: start,
              end_index: end,
              total_notes: notes.length
            }
          }
        };

        const success = await sendSingleBatch(batchData, apiUrl);
        if (!success) {
          allSuccessful = false;
          console.error(`❌ 第 ${i + 1} 批发送失败`);
        } else {
          console.log(`✅ 第 ${i + 1} 批发送成功`);
          sentBatchCount++;
          processedCount += batchNotes.length;
          updateStats();
        }

        // 每批之间添加延迟，避免请求过于频繁
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      return allSuccessful;
    } catch (error) {
      console.error('❌ 发送数据失败:', error);
      return false;
    }
  }

  // 发送单个批次数据到API
  async function sendSingleBatch(data, apiUrl) {
    try {
      console.log('🚀 开始发送单个批次数据到API:', apiUrl);
      
      // 验证API URL
      if (!apiUrl) {
        console.error('❌ API URL 为空');
        return false;
      }
      
      // 检查API URL格式
      try {
        new URL(apiUrl);
        console.log('✅ API URL 格式正确:', apiUrl);
      } catch (urlError) {
        console.error('❌ API URL 格式错误:', urlError.message);
        console.error('❌ 错误的URL:', apiUrl);
        return false;
      }
      
      // 检查数据是否存在
      if (!data || !data.data || !data.data.notes) {
        console.error('❌ 数据格式错误，缺少必要字段');
        console.error('❌ 数据:', JSON.stringify(data));
        return false;
      }
      
      // 检查笔记数量
      const noteCount = data.data.notes.length;
      console.log(`📦 批次数据包含 ${noteCount} 条笔记`);
      
      // 直接使用data作为请求体，不添加额外的data包装
      console.log('📤 准备发送的数据:', JSON.stringify(data).substring(0, 500) + '...'); // 只显示前500个字符
      
      console.log('🔗 发送请求到:', apiUrl);
      console.log('📡 请求方法: POST');
      console.log('📝 请求头: { "Content-Type": "application/json" }');
      
      const startTime = Date.now();
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      const endTime = Date.now();
      console.log(`⏱️ 请求耗时: ${endTime - startTime}ms`);
      
      console.log(`📡 收到响应，状态码: ${response.status}, 状态: ${response.statusText}`);
      
      if (!response.ok) {
        console.error('❌ API请求失败:', response.status, response.statusText);
        try {
          const errorData = await response.json();
          console.error('❌ API错误响应:', errorData);
        } catch (e) {
          console.error('❌ 无法解析API错误响应:', e);
          try {
            const errorText = await response.text();
            console.error('❌ API错误响应文本:', errorText);
          } catch (e2) {
            console.error('❌ 无法获取API错误响应文本:', e2);
          }
        }
        return false;
      }
      
      try {
        const responseData = await response.json();
        console.log('✅ API响应成功:', responseData);
        return true;
      } catch (e) {
        console.error('❌ 无法解析API响应:', e);
        try {
          const responseText = await response.text();
          console.error('❌ API响应文本:', responseText);
        } catch (e2) {
          console.error('❌ 无法获取API响应文本:', e2);
        }
        return false;
      }
    } catch (error) {
      console.error('❌ 发送单个批次数据失败:', error);
      console.error('❌ 错误类型:', error.name);
      console.error('❌ 错误信息:', error.message);
      if (error.stack) {
        console.error('❌ 错误堆栈:', error.stack);
      }
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ 连接被拒绝，请检查API服务器是否正在运行');
      } else if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        console.error('❌ 网络错误，请检查网络连接和API URL是否正确');
      }
      return false;
    }
  }

  // 监听来自content.js的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('🔔 popup.js 收到消息:', message, '来自:', sender);
    
    if (message.action === 'batch_data') {
      console.log('📦 收到批次数据，开始处理...');
      console.log('📦 批次数据包含:', message.data.data.notes.length, '条笔记');
      
      // 获取当前的数据处理选项
      const dataDestination = sendToApiRadio.checked ? 'api' : 'json';
      const apiUrl = apiUrlInput.value;
      const batchSize = parseInt(batchSizeInput.value) || 5;
      const shouldDownloadMedia = downloadMediaCheckbox.checked;
      
      // 处理批次数据
      if (dataDestination === 'api') {
        console.log('📡 准备将批次数据发送到API:', apiUrl);
        sendSingleBatch(message.data, apiUrl).then(success => {
          if (success) {
            console.log('✅ 批次数据发送成功');
            sentBatchCount++;
            processedCount += message.data.data.notes.length;
            updateStats();
          } else {
            console.error('❌ 批次数据发送失败');
          }
        });
      } else {
        console.log('💾 准备将批次数据保存为JSON文件');
        // 这里可以添加保存为JSON文件的逻辑
      }
    }
  });
});
