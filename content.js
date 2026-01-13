// content.js

// --- 工具函数：随机延迟 ---
const sleep = (min = 1000, max = 3000) => {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return new Promise(resolve => setTimeout(resolve, ms));
};

// --- 工具函数：等待元素出现 ---
const waitForElement = (selector, timeout = 5000) => {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
};

// --- 核心工具：获取当前页面所有笔记元素 ---
// 多种选择器兼容
const getNoteElements = () => {
  const selectors = [
    '.note-item',           // 常见
    'section.note-item',    // 常见
    '.feed-item',           // 发现页有时用这个
    '.feeds-container section', // 通用结构
    '.reds-note-item'       // 部分新版页面
  ];

  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) return Array.from(els);
  }
  return [];
};

// --- 全局状态 ---
let isRunning = false;
// 用于去重，防止重复采集同一篇
let crawledUrls = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📢 content.js 收到消息:', request, '来自:', sender);

  if (request.action === "start_crawl") {
    console.log('🚀 收到开始采集请求:', request.mode, request.noteLimit, request.batchSize);

    if (isRunning) {
      console.log('⚠️  采集器正在运行中...');
      sendResponse({ status: "running", message: "采集器正在运行中..." });
      return;
    }

    isRunning = true;
    crawledUrls.clear(); // 每次开始清空记录
    console.log('✅ 重置采集器状态，准备开始采集');

    // 开始采集，支持批次处理
    console.log('📦 开始采集，模式：', request.mode, '笔记总量限制：', request.noteLimit, '批次大小：', request.batchSize);
    startCrawlWithBatch(request.mode, request.noteLimit, request.batchSize, sendResponse).catch(err => {
      isRunning = false;
      console.error('❌ 采集出错:', err);
      sendResponse({ status: "error", message: err.message });
    });
    return true; // 保持异步通道
  } else if (request.action === "stop_crawl") {
    console.log('🛑 收到停止采集请求');
    isRunning = false;
    console.log('✅ 已停止采集');
    sendResponse({ status: "stopped" });
  } else {
    // 处理未知消息类型
    console.warn('⚠️ 收到未知消息类型:', request.action);
    sendResponse({ status: "error", message: `未知消息类型: ${request.action}` });
  }
});

// --- 主流程入口 (支持批次处理) ---
async function startCrawlWithBatch(mode, noteLimit = 100, batchSize = 1000, sendResponse) {
  console.log(`🚀 开始采集，模式：${mode}，笔记总量限制：${noteLimit === 0 ? '无限制' : noteLimit}条，批次大小：${batchSize}条`);

  let profileData = null;
  if (mode === 'profile') {
    profileData = extractProfileBasic();
    console.log("博主基础信息:", profileData);
  }

  let totalNotes = [];
  let currentBatch = [];
  let batchCount = 0;

  // 开始采集
  if (mode === 'profile') {
    await crawlProfileWithBatch(noteLimit, batchSize, currentBatch, totalNotes, profileData, sendResponse);
  } else if (mode === 'discovery') {
    await crawlDiscoveryWithBatch(noteLimit, batchSize, currentBatch, totalNotes, sendResponse);
  }

  // 处理最后一批数据
  if (currentBatch.length > 0) {
    batchCount++;
    await sendBatchData(mode, currentBatch, totalNotes.length, batchCount, profileData, sendResponse);
  }

  // 发送完成消息
  sendResponse({
    status: "complete",
    data: {
      data: {
        crawled_at: new Date().toISOString(),
        mode: mode,
        ...(profileData ? profileData : {}),
        notes: totalNotes
      }
    }
  });
}

// --- 发送批次数据 --- 
async function sendBatchData(mode, batchNotes, totalCount, batchCount, profileData, sendResponse) {
  console.log(`📦 发送第 ${batchCount} 批数据，包含 ${batchNotes.length} 条笔记，总计 ${totalCount} 条`);

  // 构造批次数据
  let batchData = {
    data: {
      crawled_at: new Date().toISOString(),
      mode: mode,
      ...(profileData ? profileData : {}),
      notes: batchNotes,
      batch_info: {
        batch_number: batchCount,
        start_index: totalCount - batchNotes.length,
        end_index: totalCount,
        total_notes: totalCount
      }
    }
  };

  // 发送批次数据给popup.js
  chrome.runtime.sendMessage({
    action: "batch_data",
    data: batchData
  });

  // 清空当前批次
  batchNotes.length = 0;
}

// --- 主流程入口 (原始版本，用于兼容) ---
async function startCrawl(mode, noteLimit = 100) {
  console.log(`🚀 开始采集，模式：${mode}，笔记总量限制：${noteLimit === 0 ? '无限制' : noteLimit}条`);

  let data = null;
  if (mode === 'profile') {
    data = await crawlProfile(noteLimit);
  } else if (mode === 'discovery') {
    data = await crawlDiscovery(noteLimit);
  }

  // 构造符合API要求的数据结构
  let result = {
    data: {
      crawled_at: new Date().toISOString(),
      mode: mode,
      ...data
    }
  };

  return result;
}

// --- 场景 A: 博主主页采集 (修复数量少的问题) ---
async function crawlProfile(noteLimit = 100) {
  // 1. 获取博主基础信息
  const profileData = extractProfileBasic();
  console.log("博主基础信息:", profileData);

  const notesData = [];
  let noNewItemCount = 0;
  const maxScrolls = 100; // 最大滚动尝试次数，防止死循环

  // 改为：边滚动边采集
  for (let scrollStep = 0; scrollStep < maxScrolls; scrollStep++) {
    if (!isRunning) break;

    // 检查是否达到笔记总量限制
    if (noteLimit > 0 && notesData.length >= noteLimit) {
      console.log(`✅ 已达到笔记总量限制 (${noteLimit}条)，停止采集。`);
      break;
    }

    // 1. 查找当前屏幕内未采集过的笔记
    const currentElements = getNoteElements();
    let hasNewInThisScreen = false;

    for (const noteEl of currentElements) {
      if (!isRunning) break;

      // 检查是否达到笔记总量限制
      if (noteLimit > 0 && notesData.length >= noteLimit) {
        console.log(`✅ 已达到笔记总量限制 (${noteLimit}条)，停止采集。`);
        break;
      }

      // 获取链接用于去重
      const linkEl = noteEl.querySelector('a');
      // 如果没有A标签，尝试找封面图作为唯一标识，或者跳过
      const uniqueKey = linkEl ? linkEl.href : noteEl.querySelector('img')?.src;

      if (uniqueKey && !crawledUrls.has(uniqueKey)) {
        crawledUrls.add(uniqueKey);
        hasNewInThisScreen = true;

        // 滚动到该元素位置，确保点击有效
        noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500, 1000);

        // 执行采集单篇逻辑
        const noteDetail = await processSingleNote(noteEl);
        if (noteDetail) {
          notesData.push(noteDetail);
          console.log(`✅ 已采集: ${noteDetail.title} (${notesData.length}/${noteLimit === 0 ? '∞' : noteLimit})`);
        }
      }
    }

    // 2. 滚动逻辑
    if (!hasNewInThisScreen) {
      noNewItemCount++;
      console.log(`当前屏幕无新笔记，尝试滚动... (/3)`);
    } else {
      noNewItemCount = 0; // 重置计数
    }

    if (noNewItemCount >= 3) {
      console.log("连续3次滚动未发现新笔记，认为已到底部，停止采集。");
      break;
    }

    // 向下滚动一屏
    window.scrollBy(0, window.innerHeight * 0.8);
    await sleep(2000, 4000); // 等待加载，时间稍微长一点
  }

  profileData.notes = notesData;
  return profileData;
}

// --- 场景 A: 博主主页采集 (支持批次处理) ---
async function crawlProfileWithBatch(noteLimit = 100, batchSize = 1000, currentBatch, totalNotes, profileData, sendResponse) {
  let noNewItemCount = 0;
  const maxScrolls = 100; // 最大滚动尝试次数，防止死循环
  let batchCount = 0;

  // 边滚动边采集边处理批次
  for (let scrollStep = 0; scrollStep < maxScrolls; scrollStep++) {
    if (!isRunning) break;

    // 检查是否达到笔记总量限制
    if (noteLimit > 0 && totalNotes.length >= noteLimit) {
      console.log(`✅ 已达到笔记总量限制 (${noteLimit}条)，停止采集。`);
      break;
    }

    // 1. 查找当前屏幕内未采集过的笔记
    const currentElements = getNoteElements();
    let hasNewInThisScreen = false;

    for (const noteEl of currentElements) {
      if (!isRunning) break;

      // 检查是否达到笔记总量限制
      if (noteLimit > 0 && totalNotes.length >= noteLimit) {
        console.log(`✅ 已达到笔记总量限制 (${noteLimit}条)，停止采集。`);
        break;
      }

      // 获取链接用于去重
      const linkEl = noteEl.querySelector('a');
      // 如果没有A标签，尝试找封面图作为唯一标识，或者跳过
      const uniqueKey = linkEl ? linkEl.href : noteEl.querySelector('img')?.src;

      if (uniqueKey && !crawledUrls.has(uniqueKey)) {
        crawledUrls.add(uniqueKey);
        hasNewInThisScreen = true;

        // 滚动到该元素位置，确保点击有效
        noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500, 1000);

        // 执行采集单篇逻辑
        const noteDetail = await processSingleNote(noteEl);
        if (noteDetail) {
          currentBatch.push(noteDetail);
          totalNotes.push(noteDetail);
          console.log(`✅ 已采集: ${noteDetail.title} (${totalNotes.length}/${noteLimit === 0 ? '∞' : noteLimit})`);

          // 检查是否达到批次大小
          if (currentBatch.length >= batchSize) {
            batchCount++;
            console.log(`📦 批次${batchCount}已满 (${batchSize}条)，开始处理...`);
            await sendBatchData('profile', currentBatch, totalNotes.length, batchCount, profileData, sendResponse);
          }
        }
      }
    }

    // 2. 滚动逻辑
    if (!hasNewInThisScreen) {
      noNewItemCount++;
      console.log(`当前屏幕无新笔记，尝试滚动... (/3)`);
    } else {
      noNewItemCount = 0; // 重置计数
    }

    if (noNewItemCount >= 3) {
      console.log("连续3次滚动未发现新笔记，认为已到底部，停止采集。");
      break;
    }

    // 向下滚动一屏
    window.scrollBy(0, window.innerHeight * 0.8);
    await sleep(2000, 4000); // 等待加载，时间稍微长一点
  }
}

// --- 场景 B: 发现页采集 (修复为空的问题) ---
async function crawlDiscovery(noteLimit = 100) {
  const notesData = [];
  const maxItems = noteLimit > 0 ? noteLimit : 1000; // 发现页限制采集数量，避免无限采集

  // 确保页面加载完成
  await sleep(1000, 2000);

  let collectedCount = 0;
  let scrollAttempts = 0;

  while (collectedCount < maxItems && scrollAttempts < 20) {
    if (!isRunning) break;

    const currentElements = getNoteElements();

    if (currentElements.length === 0) {
      console.warn("未找到笔记元素，尝试滚动刷新...");
      window.scrollBy(0, 500);
      await sleep(2000, 3000);
      scrollAttempts++;
      continue;
    }

    for (const noteEl of currentElements) {
      if (collectedCount >= maxItems || !isRunning) break;

      const linkEl = noteEl.querySelector('a');
      const uniqueKey = linkEl ? linkEl.href : noteEl.innerHTML;

      if (uniqueKey && !crawledUrls.has(uniqueKey)) {
        crawledUrls.add(uniqueKey);

        // 滚动并采集
        noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(800, 1500);

        const noteDetail = await processSingleNote(noteEl);
        if (noteDetail) {
          notesData.push(noteDetail);
          collectedCount++;
          console.log(`✅ 发现页采集 [/]: ${noteDetail.title} (${collectedCount}/${noteLimit === 0 ? '∞' : noteLimit})`);
        }
      }
    }

    // 滚动加载更多
    window.scrollBy(0, window.innerHeight);
    await sleep(2000, 3000);
    scrollAttempts++;
  }

  return { notes: notesData };
}

// --- 场景 B: 发现页采集 (支持批次处理) ---
async function crawlDiscoveryWithBatch(noteLimit = 100, batchSize = 1000, currentBatch, totalNotes, sendResponse) {
  const maxItems = noteLimit > 0 ? noteLimit : 1000; // 发现页限制采集数量，避免无限采集
  let collectedCount = 0;
  let scrollAttempts = 0;
  let batchCount = 0;

  // 确保页面加载完成
  await sleep(1000, 2000);

  while (collectedCount < maxItems && scrollAttempts < 20) {
    if (!isRunning) break;

    const currentElements = getNoteElements();

    if (currentElements.length === 0) {
      console.warn("未找到笔记元素，尝试滚动刷新...");
      window.scrollBy(0, 500);
      await sleep(2000, 3000);
      scrollAttempts++;
      continue;
    }

    for (const noteEl of currentElements) {
      if (collectedCount >= maxItems || !isRunning) break;

      const linkEl = noteEl.querySelector('a');
      const uniqueKey = linkEl ? linkEl.href : noteEl.innerHTML;

      if (uniqueKey && !crawledUrls.has(uniqueKey)) {
        crawledUrls.add(uniqueKey);

        // 滚动并采集
        noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(800, 1500);

        const noteDetail = await processSingleNote(noteEl);
        if (noteDetail) {
          currentBatch.push(noteDetail);
          totalNotes.push(noteDetail);
          collectedCount++;
          console.log(`✅ 发现页采集 [/]: ${noteDetail.title} (${collectedCount}/${noteLimit === 0 ? '∞' : noteLimit})`);

          // 检查是否达到批次大小
          if (currentBatch.length >= batchSize) {
            batchCount++;
            console.log(`📦 批次${batchCount}已满 (${batchSize}条)，开始处理...`);
            await sendBatchData('discovery', currentBatch, totalNotes.length, batchCount, null, sendResponse);
          }
        }
      }
    }

    // 滚动加载更多
    window.scrollBy(0, window.innerHeight);
    await sleep(2000, 3000);
    scrollAttempts++;
  }
}

// --- 通用逻辑：处理单篇笔记 (点击-采集-关闭) ---
async function processSingleNote(noteEl) {
  try {
    // 点击打开
    const cover = noteEl.querySelector('.cover') || noteEl.querySelector('a') || noteEl;
    cover.click();

    // 等待弹窗
    const detailContainer = await waitForElement('.note-detail-container', 6000) ||
      await waitForElement('.note-container', 6000);

    if (detailContainer) {
      await sleep(1500, 3000); // 等待内容渲染

      // 采集详情
      const detail = await extractNoteDetail(detailContainer);

      // 关闭弹窗
      const closeBtn = document.querySelector('.close-circle') ||
        document.querySelector('.close') ||
        document.querySelector('.mask'); // 点击遮罩层也可以关闭

      if (closeBtn) {
        closeBtn.click();
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      }

      await sleep(1000, 2000); // 等待弹窗消失
      return detail;
    } else {
      console.warn("等待弹窗超时，跳过");
      return null;
    }
  } catch (e) {
    console.error("采集单篇出错:", e);
    return null;
  }
}

// --- 基础信息提取 (针对 DOM 结构进行了精准适配) ---
function extractProfileBasic() {
  // 1. 获取 URL 中的唯一 ID
  const urlParts = window.location.pathname.split('/');
  // 处理 URL 尾部可能有参数的情况
  const uniqueId = (urlParts[urlParts.length - 1] || "").split('?')[0];

  // 2. 提取 IP 属地
  let ipLocation = "未知";

  // 策略 A: 直接查找 .user-IP 类名 (根据你提供的 HTML 结构)
  const ipEl = document.querySelector('.user-IP');
  if (ipEl) {
    // 移除 "IP属地：" 前缀及空格
    ipLocation = ipEl.innerText.replace('IP属地：', '').replace('IP属地:', '').trim();
  } else {
    // 策略 B: 兜底查找 (遍历 .user-content 下的 span 或 .user-desc)
    const candidates = document.querySelectorAll('.user-content span, .user-desc, .user-tags span');
    const found = Array.from(candidates).find(el => el.innerText.includes('IP属地'));
    if (found) {
      ipLocation = found.innerText.replace('IP属地：', '').replace('IP属地:', '').trim();
    }
  }

  // 3. 提取小红书号
  let redId = "";
  const redIdElem = document.querySelector('.user-redId');
  if (redIdElem) {
    redId = redIdElem.innerText.replace('小红书号：', '').replace('小红书号:', '').trim();
  }

  // 4. 提取昵称
  const nickname = document.querySelector('.user-name')?.innerText ||
    document.querySelector('.name')?.innerText ||
    document.querySelector('.user-nickname')?.innerText || "";

  // 5. 提取简介
  const desc = document.querySelector('.user-desc')?.innerText || "";

  return {
    unique_id: uniqueId,
    nickname: nickname.trim(),
    red_id: redId,
    ip_location: ipLocation,
    desc: desc.trim(),
    stats: extractStats()
  };
}

function extractStats() {
  const stats = {};
  const items = document.querySelectorAll('.user-interactions div');
  if (items.length >= 3) {
    stats.follows = items[0].innerText;
    stats.fans = items[1].innerText;
    stats.likes_collects = items[2].innerText;
  }
  return stats;
}

// --- 笔记详情提取 (保持不变) ---
async function extractNoteDetail(container) {
  const title = container.querySelector('.title')?.innerText || "";
  const desc = container.querySelector('.desc')?.innerText || "";
  const dateElem = container.querySelector('.bottom-container .date');
  const dateText = dateElem ? dateElem.innerText : "";

  let publishTime = dateText;
  let publishIp = "未知";
  if (dateText.includes(' ')) {
    const parts = dateText.split(' ');
    const lastPart = parts[parts.length - 1];
    if (!lastPart.includes(':') && !lastPart.includes('-')) {
      publishIp = lastPart;
      publishTime = dateText.replace(lastPart, '').trim();
    }
  }

  // 提取笔记ID
  let noteId = "";
  const noteMask = document.querySelector('.note-detail-mask');
  if (noteMask) {
    noteId = noteMask.getAttribute('note-id') || "";
  }

  const comments = await extractComments(container);

  // 提取视频链接
  const videos = [];

  // 尝试多种选择器查找视频元素
  const videoSelectors = [
    '.swiper-slide video',           // 轮播图中的视频
    '.video-container video',        // 视频容器中的视频
    '.player video',                 // 播放器中的视频
    'video'                          // 所有视频元素
  ];

  for (const selector of videoSelectors) {
    const videoElements = container.querySelectorAll(selector);
    for (const video of videoElements) {
      if (video.src) {
        videos.push(video.src);
      } else if (video.querySelector('source')) {
        // 处理带有source标签的视频
        const source = video.querySelector('source');
        if (source.src) {
          videos.push(source.src);
        }
      }
    }
  }

  // 兜底：尝试从data属性中提取视频链接
  const dataVideoElements = container.querySelectorAll('[data-video]');
  for (const elem of dataVideoElements) {
    const videoUrl = elem.getAttribute('data-video');
    if (videoUrl) {
      videos.push(videoUrl);
    }
  }

  // 去重
  const uniqueVideos = [...new Set(videos)];

  return {
    note_id: noteId,
    title,
    desc,
    publish_time: publishTime,
    publish_ip: publishIp,
    comments_count: comments.length,
    comments: comments,
    images: Array.from(container.querySelectorAll('.swiper-slide img')).map(img => img.src),
    videos: uniqueVideos
  };
}

// --- 评论提取 (升级版：支持父子评论层级关系 + 新版日期IP结构) ---
async function extractComments(container) {
  const commentList = [];

  // 1. 找到评论区容器
  const commentScrollContainer = container.querySelector('.comments-container') ||
    container.querySelector('.comment-list') ||
    container.querySelector('.note-comments');

  if (!commentScrollContainer) return [];

  // 2. 滚动加载更多评论 (建议多滚几次以加载更多回复)
  // 注意：如果评论很多，完全展开需要很长时间，这里只做适量滚动
  for (let i = 0; i < 3; i++) {
    commentScrollContainer.scrollTop = commentScrollContainer.scrollHeight;
    await sleep(800, 1500);
  }

  // 3. 尝试点击 "展开 x 条回复" 按钮 (可选，为了获取更多子评论)
  const showMoreBtns = commentScrollContainer.querySelectorAll('.show-more');
  for (const btn of showMoreBtns) {
    try {
      btn.click();
      await sleep(500, 1000); // 等待展开
    } catch (e) { /* 忽略点击错误 */ }
  }

  // 4. 按“父评论”块进行遍历，保持层级结构
  const parentBlocks = commentScrollContainer.querySelectorAll('.parent-comment');

  // 如果找不到 .parent-comment 结构（可能是旧版页面），则回退到扁平采集
  if (parentBlocks.length === 0) {
    const allItems = commentScrollContainer.querySelectorAll('.comment-item');
    allItems.forEach(item => commentList.push(parseCommentNode(item)));
    return commentList;
  }

  // 遍历每一个父评论块
  parentBlocks.forEach(block => {
    // A. 提取主评论 (父评论块里的第一个 comment-item)
    // 使用 :scope > .comment-item 确保只选直接子元素，或者利用结构特性
    const mainCommentEl = block.querySelector('.comment-item');
    if (!mainCommentEl) return;

    const parentData = parseCommentNode(mainCommentEl);

    // B. 提取子回复
    parentData.replies = []; // 新增 replies 数组
    const replyContainer = block.querySelector('.reply-container');

    if (replyContainer) {
      const subComments = replyContainer.querySelectorAll('.comment-item');
      subComments.forEach(subEl => {
        parentData.replies.push(parseCommentNode(subEl));
      });
    }

    commentList.push(parentData);
  });

  return commentList;
}

// --- 辅助函数：解析单个评论节点 (提取通用信息) ---
function parseCommentNode(item) {
  const userEl = item.querySelector('.name');
  const contentEl = item.querySelector('.note-text') || item.querySelector('.content');
  const likeEl = item.querySelector('.like .count');

  // 1. 用户信息提取
  let userId = "";
  let nickname = "未知";
  let userLink = "";

  if (userEl) {
    nickname = userEl.innerText.trim();
    userId = userEl.getAttribute('data-user-id') || "";
    userLink = userEl.href || "";

    // 兜底：从 href 解析 ID
    if (!userId && userLink) {
      const match = userLink.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
      if (match) userId = match[1];
    }
  }

  // 兜底：从头像提取 ID
  if (!userId) {
    const avatarEl = item.querySelector('.avatar-item') || item.querySelector('a.avatar');
    if (avatarEl) {
      userId = avatarEl.getAttribute('data-user-id') || "";
    }
  }

  // 2. 日期与 IP 提取 (适配新结构：分开的 span)
  let cTime = "";
  let cIp = "";

  const dateContainer = item.querySelector('.info .date');
  if (dateContainer) {
    // 优先查找明确的 .location 类名
    const locSpan = dateContainer.querySelector('.location');
    if (locSpan) {
      cIp = locSpan.innerText.trim();
      // 日期通常是 dateContainer 的第一个文本节点或第一个 span (排除 location)
      // 简单处理：获取整个文本，把 IP 替换掉
      cTime = dateContainer.innerText.replace(cIp, '').trim();
    } else {
      // 旧版逻辑：空格分割
      const txt = dateContainer.innerText.trim();
      const parts = txt.split(' ');
      if (parts.length > 1 && !/\d/.test(parts[parts.length - 1])) {
        cIp = parts[parts.length - 1];
        cTime = txt.replace(cIp, '').trim();
      } else {
        cTime = txt;
      }
    }
  }

  return {
    id: item.getAttribute('id') || "", // 评论唯一ID
    user_id: userId,
    nickname: nickname,
    user_link: userLink,
    content: contentEl ? contentEl.innerText.trim() : "",
    likes: likeEl ? likeEl.innerText.trim() : "0",
    time: cTime,
    ip_location: cIp,
    replies: [] // 默认为空，如果是父评论会在外部填充
  };
}


