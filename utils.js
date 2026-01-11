// 小红书爬虫工具函数库
(function () {
    'use strict';

    /**
     * 终止信号管理类
     */
    class StopSignalManager {
        /**
         * 设置终止信号
         */
        static async stopCrawler() {
            try {
                await chrome.storage.local.set({ 'redbook_crawler_should_stop': true });
                console.log("🛑 爬虫终止信号已发送（持久化存储），等待当前操作完成...");
            } catch (error) {
                console.error("❌ 终止信号存储失败:", error);
                // 降级方案：使用sessionStorage
                sessionStorage.setItem('redbook_crawler_should_stop', 'true');
            }
        }

        /**
         * 检查终止信号
         */
        static async checkStopSignal() {
            try {
                // 优先检查Chrome存储
                const result = await chrome.storage.local.get(['redbook_crawler_should_stop']);
                if (result.redbook_crawler_should_stop) {
                    console.log("🛑 爬虫被用户终止（持久化存储检测）");
                    // 清除终止标志
                    await chrome.storage.local.remove(['redbook_crawler_should_stop']);
                    throw new Error("爬虫被用户终止");
                }

                // 检查sessionStorage（降级方案）
                if (sessionStorage.getItem('redbook_crawler_should_stop') === 'true') {
                    console.log("🛑 爬虫被用户终止（sessionStorage检测）");
                    sessionStorage.removeItem('redbook_crawler_should_stop');
                    throw new Error("爬虫被用户终止");
                }
            } catch (error) {
                // 如果Chrome存储API不可用，使用降级方案
                if (error.message.includes('chrome.storage')) {
                    if (sessionStorage.getItem('redbook_crawler_should_stop') === 'true') {
                        console.log("🛑 爬虫被用户终止（sessionStorage降级检测）");
                        sessionStorage.removeItem('redbook_crawler_should_stop');
                        throw new Error("爬虫被用户终止");
                    }
                } else {
                    throw error;
                }
            }
        }

        /**
         * 清除终止状态
         */
        static async clearStopSignal() {
            try {
                await chrome.storage.local.remove(['redbook_crawler_should_stop']);
            } catch (error) {
                // 忽略错误
            }
            sessionStorage.removeItem('redbook_crawler_should_stop');
        }
    }

    /**
     * 图片下载工具类
     */
    class ImageDownloader {
        /**
         * 下载单张图片
         */
        static async downloadImage(url, fileName) {
            try {
                await StopSignalManager.checkStopSignal();

                // 添加Referer头绕过小红书防盗链
                const headers = {
                    'Referer': 'https://www.xiaohongshu.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                };

                const response = await fetch(url, { headers });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const blob = await response.blob();

                // 检查下载的是否是真正的图片
                if (blob.size < 1000 || !blob.type.startsWith('image/')) {
                    console.warn(`⚠️ 下载的文件可能不是图片: ${fileName}, 大小: ${blob.size} bytes, 类型: ${blob.type}`);
                    throw new Error(`下载的文件不是有效图片: ${blob.type}`);
                }

                console.log(`✅ 图片下载成功: ${fileName}, 大小: ${blob.size} bytes, 类型: ${blob.type}`);

                return {
                    success: true,
                    blob: blob,
                    fileName: fileName,
                    size: blob.size,
                    type: blob.type
                };

            } catch (error) {
                console.error(`❌ 图片下载失败: ${fileName}, 错误:`, error);
                return {
                    success: false,
                    fileName: fileName,
                    error: error.message
                };
            }
        }

        /**
         * 批量下载图片
         */
        static async downloadImages(imageList, batchSize = 5) {
            console.log(`📷 开始批量下载图片，共 ${imageList.length} 张，批次大小: ${batchSize}`);

            const results = [];

            for (let i = 0; i < imageList.length; i += batchSize) {
                await StopSignalManager.checkStopSignal();

                const batch = imageList.slice(i, i + batchSize);
                console.log(`🔄 下载批次 ${Math.floor(i / batchSize) + 1}, 图片数: ${batch.length}`);

                const batchPromises = batch.map(item =>
                    this.downloadImage(item.url, item.fileName)
                );

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);

                // 批次间延迟，避免请求过快
                await Utils.sleep(1000);
            }

            const successCount = results.filter(r => r.success).length;
            const failedCount = results.filter(r => !r.success).length;

            console.log(`📊 图片下载完成: 成功 ${successCount} 张, 失败 ${failedCount} 张`);

            return results;
        }
    }

    /**
     * 通用工具类
     */
    class Utils {
        /**
         * 睡眠函数
         */
        static sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        /**
         * 带重试的fetch请求
         */
        static async fetchWithRetry(url, options = {}, maxRetries = 3, delay = 1000) {
            let lastError;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    await StopSignalManager.checkStopSignal();

                    console.log(`🌐 请求尝试 ${attempt}/${maxRetries}: ${url}`);

                    const response = await fetch(url, options);

                    if (response.ok) {
                        return response;
                    }

                    // 如果是4xx错误，不重试
                    if (response.status >= 400 && response.status < 500) {
                        throw new Error(`客户端错误: ${response.status}`);
                    }

                    throw new Error(`HTTP错误: ${response.status}`);

                } catch (error) {
                    lastError = error;
                    console.warn(`⚠️ 请求失败 (${attempt}/${maxRetries}):`, error);

                    if (attempt < maxRetries) {
                        console.log(`⏳ 等待 ${delay}ms 后重试...`);
                        await this.sleep(delay);
                        delay *= 2; // 指数退避
                    }
                }
            }

            throw new Error(`所有重试失败: ${lastError.message}`);
        }

        /**
         * 检测当前平台
         */
        static detectPlatform() {
            const url = window.location.href.toLowerCase();
            const hostname = window.location.hostname.toLowerCase();

            // 小红书域名检测
            const xhsDomains = [
                'xiaohongshu.com',
                'xhslink.com',
                'www.xiaohongshu.com',
                'm.xiaohongshu.com'
            ];

            // 小红书URL关键词
            const xhsKeywords = [
                'xiaohongshu',
                'xhslink',
                'redbook',
                '小红书'
            ];

            // 检查域名
            for (const domain of xhsDomains) {
                if (hostname.includes(domain)) {
                    return 'web';
                }
            }

            // 检查URL关键词
            for (const keyword of xhsKeywords) {
                if (url.includes(keyword)) {
                    return 'web';
                }
            }

            // 检查页面标题
            const title = document.title.toLowerCase();
            if (title.includes('小红书') || title.includes('xiaohongshu')) {
                return 'web';
            }

            return 'unknown';
        }

        /**
         * 提取用户ID
         */
        static extractUserID() {
            const url = window.location.href;

            console.log('🔍 开始提取用户ID，当前URL:', url);

            // 方法1: 从URL路径提取（主要方法）
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');

            // 小红书用户主页URL格式: 
            // https://www.xiaohongshu.com/user/profile/{userId}
            // https://www.xiaohongshu.com/user/profile/{userId}?xsec_token=xxx&xsec_source=pc_search&m_source=pwa
            const profileMatch = url.match(/xiaohongshu\.com\/user\/profile\/([a-zA-Z0-9]+)(?:\?|$)/i);
            if (profileMatch) {
                const userId = profileMatch[1];
                console.log('✅ 方法1 - 从URL提取到用户ID:', userId);
                return userId;
            }

            // 方法2: 从URL路径中查找可能的用户ID
            for (const part of pathParts) {
                // 检查是否是24位十六进制字符串（MongoDB ObjectId格式）
                if (/^[a-f0-9]{24}$/i.test(part)) {
                    console.log('✅ 方法2 - 从URL路径提取到可能的用户ID:', part);
                    return part;
                }
            }

            // 方法3: 笔记页面格式
            // https://www.xiaohongshu.com/explore/{noteId}
            // https://www.xiaohongshu.com/discovery/item/{noteId}
            const noteMatch = url.match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)(?:\?|$)/i);
            if (noteMatch) {
                const noteId = noteMatch[1];
                console.log('✅ 方法3 - 从URL提取到笔记ID:', noteId);
                return 'note_' + noteId;
            }

            // 方法4: 尝试从页面元素中提取用户ID
            try {
                console.log('🔍 方法4 - 尝试从页面元素提取用户ID...');

                // 4.1 查找用户主页链接
                const userLinks = document.querySelectorAll('a[href*="/user/profile/"]');
                console.log('🔗 找到用户主页链接数量:', userLinks.length);

                for (const link of userLinks) {
                    const href = link.getAttribute('href');
                    if (href) {
                        const match = href.match(/\/user\/profile\/([a-zA-Z0-9]+)(?:\?|$)/i);
                        if (match) {
                            const userId = match[1];
                            console.log('✅ 方法4.1 - 从页面链接提取到用户ID:', userId);
                            return userId;
                        }
                    }
                }

                // 4.2 查找所有可能的用户ID元素
                const selectors = [
                    '[data-user-id]',
                    '[data-userid]',
                    '[data-id]',
                    '[class*="user-id"]',
                    '[class*="userid"]',
                    '[class*="user-id"]',
                    '[class*="author-id"]',
                    '[class*="creator-id"]',
                    '[class*="profile-id"]'
                ];

                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    for (const element of elements) {
                        const dataUserId = element.getAttribute('data-user-id') ||
                            element.getAttribute('data-userid') ||
                            element.getAttribute('data-id');
                        if (dataUserId && /^[a-zA-Z0-9]{10,30}$/.test(dataUserId)) {
                            console.log('✅ 方法4.2 - 从data属性提取到用户ID:', dataUserId);
                            return dataUserId;
                        }
                    }
                }

                // 4.3 查找用户昵称或ID元素
                const textSelectors = [
                    '[class*="user-name"]',
                    '[class*="nickname"]',
                    '[class*="author"]',
                    '[class*="creator"]',
                    '[class*="profile"]',
                    '.username',
                    '.nickname',
                    '.author',
                    '.creator'
                ];

                for (const selector of textSelectors) {
                    const elements = document.querySelectorAll(selector);
                    for (const element of elements) {
                        const text = element.textContent || '';
                        if (text.trim()) {
                            // 检查是否是有效的用户ID格式（24位十六进制）
                            const hexMatch = text.match(/[a-f0-9]{24}/i);
                            if (hexMatch) {
                                console.log('✅ 方法4.3 - 从文本内容提取到用户ID:', hexMatch[0]);
                                return hexMatch[0];
                            }
                        }
                    }
                }

                console.warn('⚠️ 从页面元素提取用户ID失败，未找到有效信息');

            } catch (error) {
                console.warn('❌ 从页面元素提取用户ID失败:', error);
            }

            // 方法5: 从页面标题或元信息中提取
            try {
                const title = document.title;
                const description = document.querySelector('meta[name="description"]')?.content || '';

                // 检查标题中是否包含用户ID
                const titleMatch = title.match(/[a-f0-9]{24}/i);
                if (titleMatch) {
                    console.log('✅ 方法5 - 从页面标题提取到用户ID:', titleMatch[0]);
                    return titleMatch[0];
                }

                // 检查描述中是否包含用户ID
                const descMatch = description.match(/[a-f0-9]{24}/i);
                if (descMatch) {
                    console.log('✅ 方法5 - 从页面描述提取到用户ID:', descMatch[0]);
                    return descMatch[0];
                }

            } catch (error) {
                console.warn('❌ 从页面元信息提取用户ID失败:', error);
            }

            // 方法6: 尝试从JavaScript变量中提取
            try {
                // 检查页面中是否有包含用户ID的JavaScript变量
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const scriptText = script.textContent || '';
                    if (scriptText.includes('user_id') || scriptText.includes('userId')) {
                        const matches = scriptText.match(/user[_-]?id[\s:="]+([a-f0-9]{24})/gi);
                        if (matches) {
                            for (const match of matches) {
                                const userIdMatch = match.match(/[a-f0-9]{24}/i);
                                if (userIdMatch) {
                                    console.log('✅ 方法6 - 从JavaScript变量提取到用户ID:', userIdMatch[0]);
                                    return userIdMatch[0];
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('❌ 从JavaScript变量提取用户ID失败:', error);
            }

            // 如果所有方法都失败，提供详细的错误信息
            const errorDetails = `
无法从URL或页面内容提取用户ID或笔记ID。

当前页面信息:
- URL: ${url}
- 标题: ${document.title}
- 路径: ${window.location.pathname}

请确认:
1. 当前页面是小红书用户主页（如: https://www.xiaohongshu.com/user/profile/xxxxxxxxxxxxxxxxxx）
2. 或者当前页面是小红书笔记页面
3. 页面已完全加载
4. 没有登录或权限限制
      `;

            console.error('❌ 用户ID提取失败详情:', errorDetails);
            throw new Error(errorDetails);
        }

    /**
     * 提取xsec_token
     */
    static extractXsecToken() {
      const url = window.location.href;
      console.log('🔍 开始提取xsec_token，当前URL:', url);
      
      // 方法1: 从URL参数中提取
      const urlObj = new URL(url);
      let xsecToken = urlObj.searchParams.get('xsec_token');
      
      if (xsecToken) {
        console.log('✅ 方法1 - 从URL参数提取到xsec_token:', xsecToken);
        return xsecToken;
      }
      
      // 方法2: 从页面脚本中提取
      try {
        console.log('🔍 方法2 - 尝试从页面脚本提取xsec_token...');
        
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const scriptText = script.textContent || '';
          if (scriptText.includes('xsec_token')) {
            // 尝试多种可能的模式
            const patterns = [
              /xsec_token[\s:="\']+([^"\'&]+)/,
              /xsec_token\s*=\s*["\']([^"\']+)["\']/,
              /"xsec_token"\s*:\s*["\']([^"\']+)["\']/,
              /xsec_token\s*:\s*["\']([^"\']+)["\']/,
              /xsec_token=([^&\s]+)/
            ];
            
            for (const pattern of patterns) {
              const match = scriptText.match(pattern);
              if (match) {
                xsecToken = match[1];
                console.log('✅ 方法2 - 从页面脚本提取到xsec_token');
                return xsecToken;
              }
            }
          }
        }
        
        console.warn('⚠️ 从页面脚本提取xsec_token失败，未找到有效信息');
        
      } catch (error) {
        console.warn('❌ 从页面脚本提取xsec_token失败:', error);
      }
      
      // 方法3: 从Cookie中提取
      try {
        console.log('🔍 方法3 - 尝试从Cookie提取xsec_token...');
        
        const cookie = document.cookie;
        const cookieMatch = cookie.match(/xsec_token=([^;]+)/);
        if (cookieMatch) {
          xsecToken = cookieMatch[1];
          console.log('✅ 方法3 - 从Cookie提取到xsec_token');
          return xsecToken;
        }
        
      } catch (error) {
        console.warn('❌ 从Cookie提取xsec_token失败:', error);
      }
      
      // 方法4: 从localStorage或sessionStorage中提取
      try {
        console.log('🔍 方法4 - 尝试从存储中提取xsec_token...');
        
        xsecToken = localStorage.getItem('xsec_token') || sessionStorage.getItem('xsec_token');
        if (xsecToken) {
          console.log('✅ 方法4 - 从存储中提取到xsec_token');
          return xsecToken;
        }
        
      } catch (error) {
        console.warn('❌ 从存储中提取xsec_token失败:', error);
      }
      
      console.warn('⚠️ 未找到xsec_token，API请求可能会失败');
      return '';
    }

    /**
     * 检查xsec_token是否有效
     */
    static isXsecTokenValid(token) {
      return token && token.length > 10;
    }

    /**
     * 获取页面Cookie
     */
    static getPageCookie() {
        return document.cookie;
    }

    /**
     * 构建请求头
     */
    static buildHeaders() {
        const cookie = this.getPageCookie();
        
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': window.location.href,
            'Origin': 'https://www.xiaohongshu.com',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Cookie': cookie
        };
    }

    /**
     * 清理文本内容
     */
    static cleanText(text) {
        if (!text) return '';

        return text
            .replace(/\s+/g, ' ')
            .replace(/[\r\n]/g, ' ')
            .trim();
    }

    /**
     * 格式化日期
     */
    static formatDate(timestamp) {
        if (!timestamp) return '';

        try {
            const date = new Date(timestamp);
            return date.toISOString().replace('T', ' ').split('.')[0];
        } catch (error) {
            console.warn('日期格式化错误:', error);
            return '';
        }
    }

    /**
     * 创建下载文件
     */
    static createDownloadFile(content, fileName, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();

        // 清理
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        console.log(`📥 文件创建成功: ${fileName}`);
    }

    /**
     * 从页面直接提取用户信息
     */
    static extractUserInfoFromPage(userId) {
        try {
            console.log('🔍 尝试从页面直接提取用户信息...');

            // 提取用户昵称
            const nicknameElements = document.querySelectorAll('.user-name, .nickname, [class*="nickname"], [class*="username"], [class*="user-name"]');
            const nickname = nicknameElements.length > 0 ? nicknameElements[0].textContent.trim() : '';

            // 提取用户描述
            const descElements = document.querySelectorAll('.user-desc, .description, [class*="desc"], [class*="description"]');
            const desc = descElements.length > 0 ? descElements[0].textContent.trim() : '';

            // 提取小红书号
            const redIdElements = document.querySelectorAll('.red-id, [class*="red-id"], [class*="user-id"]');
            let redId = '';
            if (redIdElements.length > 0) {
                const redIdText = redIdElements[0].textContent.trim();
                const match = redIdText.match(/小红书号：(\d+)/);
                redId = match ? match[1] : redIdText;
            }

            // 提取IP属地
            const ipElements = document.querySelectorAll('.ip-location, [class*="ip-location"], [class*="ip"]');
            const ipLocation = ipElements.length > 0 ? ipElements[0].textContent.trim() : '';

            // 提取关注、粉丝、获赞数
            const statsElements = document.querySelectorAll('.stats-item, .stat-item, [class*="stat"], [class*="stats"]');
            let follows = 0, fans = 0, interaction = 0;

            if (statsElements.length >= 3) {
                follows = this.parseNumber(statsElements[0].textContent);
                fans = this.parseNumber(statsElements[1].textContent);
                interaction = this.parseNumber(statsElements[2].textContent);
            }

            // 提取头像
            const avatarElements = document.querySelectorAll('.avatar, .user-avatar, [class*="avatar"] img');
            const image = avatarElements.length > 0 ? avatarElements[0].src : '';

            console.log('✅ 从页面提取用户信息成功:', { nickname, desc, redId, ipLocation, follows, fans, interaction });

            return {
                user_id: userId,
                nickname: nickname,
                desc: desc,
                image: image,
                red_id: redId,
                ip_location: ipLocation,
                follows: follows,
                fans: fans,
                interaction: interaction,
                collected: 0,
                tags: [],
                level: {}
            };
        } catch (error) {
            console.error('❌ 从页面提取用户信息失败:', error);
            return null;
        }
    }

    /**
     * 解析数字文本
     */
    static parseNumber(text) {
        if (!text) return 0;

        // 清理文本，只保留数字和单位
        const cleanText = text.replace(/[^\d\.\s万千万亿]/g, '').trim();

        // 处理万、千等单位
        const numMatch = cleanText.match(/(\d+(?:\.\d+)?)/);
        if (!numMatch) return 0;

        const num = parseFloat(numMatch[1]);

        if (cleanText.includes('万')) {
            return num * 10000;
        } else if (cleanText.includes('千')) {
            return num * 1000;
        } else if (cleanText.includes('亿')) {
            return num * 100000000;
        }

        return num;
    }

    /**
     * 从页面直接提取笔记列表
     */
    static extractNotesFromPage() {
        try {
            console.log('🔍 尝试从页面直接提取笔记列表...');

            const notes = [];
            const noteElements = document.querySelectorAll('.note-item, .note-card, [class*="note"], article');

            console.log(`📝 找到 ${noteElements.length} 个笔记元素`);

            noteElements.forEach((element, index) => {
                try {
                    // 提取笔记ID
                    const noteLink = element.querySelector('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/user/profile/"]');
                    let noteId = `note_${index}`;

                    if (noteLink) {
                        const href = noteLink.getAttribute('href');
                        const match = href.match(/\/(explore|discovery\/item)\/([a-zA-Z0-9]+)/);
                        if (match) {
                            noteId = match[2];
                        } else {
                            // 从用户页面链接提取
                            const userNoteMatch = href.match(/\/user\/profile\/[^\/]+\/([a-zA-Z0-9]+)/);
                            if (userNoteMatch) {
                                noteId = userNoteMatch[1];
                            }
                        }
                    }

                    // 提取标题和描述
                    const titleElement = element.querySelector('.note-title, .title, [class*="title"], h3, h4');
                    const descElement = element.querySelector('.note-desc, .desc, [class*="desc"], p');
                    const title = titleElement ? titleElement.textContent.trim() : '';
                    const desc = descElement ? descElement.textContent.trim() : '';

                    // 提取图片
                    const imageElements = element.querySelectorAll('img');
                    const images = Array.from(imageElements)
                        .filter(img => img.src && !img.src.includes('data:image'))
                        .map(img => ({
                            url: img.src,
                            original: img.src,
                            default: img.src
                        }));

                    // 提取统计数据
                    const statsElements = element.querySelectorAll('.note-stats, .stats, [class*="stat"], .like, .comment, .collect');
                    let liked_count = 0, comment_count = 0, collected_count = 0;

                    statsElements.forEach(statElement => {
                        const text = statElement.textContent || '';
                        if (text.includes('赞') || text.includes('like')) {
                            liked_count = this.parseNumber(text);
                        } else if (text.includes('评论') || text.includes('comment')) {
                            comment_count = this.parseNumber(text);
                        } else if (text.includes('收藏') || text.includes('collect')) {
                            collected_count = this.parseNumber(text);
                        }
                    });

                    // 只添加有内容的笔记
                    if (title || desc || images.length > 0) {
                        notes.push({
                            note_id: noteId,
                            title: title,
                            desc: desc,
                            images: images,
                            liked_count: liked_count,
                            comment_count: comment_count,
                            collected_count: collected_count,
                            share_count: 0,
                            time: Date.now(),
                            type: 'note'
                        });
                    }
                } catch (error) {
                    console.warn('⚠️ 提取单个笔记失败:', error);
                }
            });

            console.log('✅ 从页面提取笔记成功，共提取', notes.length, '篇笔记');
            return notes;
        } catch (error) {
            console.error('❌ 从页面提取笔记列表失败:', error);
            return [];
        }
    }
}

/**
 * 数据处理类
 */
class DataProcessor {
        /**
         * 处理用户信息
         */
        static processUserInfo(rawUserData) {
            if (!rawUserData) return {};

            return {
                user_id: rawUserData.user_id || '',
                nickname: rawUserData.nickname || '',
                desc: rawUserData.desc || '',
                image: rawUserData.image || '',
                red_id: rawUserData.red_id || '',
                ip_location: rawUserData.ip_location || '',
                follows: rawUserData.follows || 0,
                fans: rawUserData.fans || 0,
                interaction: rawUserData.interaction || 0,
                collected: rawUserData.collected || 0,
                tags: rawUserData.tags || [],
                level: rawUserData.level || {}
            };
        }

        /**
         * 处理笔记信息
         */
        static processNoteInfo(rawNoteData) {
            if (!rawNoteData) return {};

            return {
                note_id: rawNoteData.id || rawNoteData.note_id || '',
                title: rawNoteData.title || '',
                desc: rawNoteData.desc || '',
                user: rawNoteData.user || {},
                time: rawNoteData.time || rawNoteData.create_time || '',
                liked_count: rawNoteData.liked_count || 0,
                collected_count: rawNoteData.collected_count || 0,
                comment_count: rawNoteData.comment_count || 0,
                share_count: rawNoteData.share_count || 0,
                images: rawNoteData.image_list || rawNoteData.images || [],
                tags: rawNoteData.tag_list || rawNoteData.tags || [],
                type: rawNoteData.type || 'note'
            };
        }

        /**
         * 提取图片信息
         */
        static extractImages(noteData, userInfo) {
            const images = [];

            if (noteData.images && Array.isArray(noteData.images)) {
                noteData.images.forEach((img, index) => {
                    if (img.url || img.original || img.default) {
                        const imageUrl = img.url || img.original || img.default;
                        const fileName = `${userInfo.nickname || 'user'}_${noteData.note_id}_${index}.jpg`;

                        images.push({
                            url: imageUrl,
                            fileName: fileName,
                            noteId: noteData.note_id,
                            index: index
                        });
                    }
                });
            }

            return images;
        }

        /**
         * 构建导出数据
         */
        static buildExportData(userInfo, notes, images = []) {
            return {
                metadata: {
                    export_time: new Date().toISOString(),
                    platform: 'xiaohongshu',
                    user_id: userInfo.user_id,
                    note_count: notes.length,
                    image_count: images.length
                },
                user_info: userInfo,
                notes: notes,
                images: images
            };
        }
    }

    // 导出到全局作用域
    window.RedbookCrawlerUtils = {
        StopSignalManager,
        ImageDownloader,
        Utils,
        DataProcessor
    };

    console.log('🔧 小红书爬虫工具函数库加载完成');

    // 消息处理逻辑
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        console.log('🔧 消息监听器初始化');

        // 监听来自弹出页面的消息
        chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
            console.log('🔔 收到消息:', request);

            // 处理不同类型的消息
            if (request.action === 'debugPageInfo') {
                handleDebugPageInfo(sendResponse);
            } else if (request.action === 'executeCrawler') {
                handleExecuteCrawler(request, sendResponse);
            } else if (request.action === 'stopCrawler') {
                handleStopCrawler(sendResponse);
            } else {
                console.warn('⚠️ 未知消息类型:', request.action);
                sendResponse({ success: false, error: '未知消息类型' });
            }

            // 返回true表示异步响应
            return true;
        });
    }

    /**
     * 处理调试页面信息请求
     */
    async function handleDebugPageInfo(sendResponse) {
        try {
            console.log('🔍 开始处理调试页面信息请求...');

            const url = window.location.href;
            const title = document.title;
            const platform = Utils.detectPlatform();

            let debugInfo = `
🔍 页面调试信息：

📄 当前URL: ${url}
📝 页面标题: ${title}
🌐 平台检测: ${platform}

🔗 URL分析：
`;

            // 分析URL
            const urlObj = new URL(url);
            debugInfo += `- 域名: ${urlObj.hostname}\n`;
            debugInfo += `- 路径: ${urlObj.pathname}\n`;
            debugInfo += `- 参数: ${urlObj.search}\n\n`;

            // 尝试提取用户ID
            debugInfo += `👤 用户ID提取尝试：\n`;

            try {
                // 方法1: 从URL路径提取
                const pathParts = urlObj.pathname.split('/');
                debugInfo += `1. URL路径分析: ${JSON.stringify(pathParts)}\n`;

                for (const part of pathParts) {
                    if (/^[a-f0-9]{24}$/i.test(part)) {
                        debugInfo += `   ✅ 发现可能的用户ID: ${part}\n`;
                    }
                }

                // 方法2: 正则匹配
                const profileMatch = url.match(/xiaohongshu\.com\/user\/profile\/([a-zA-Z0-9]+)(?:\?|$)/i);
                if (profileMatch) {
                    debugInfo += `2. 正则匹配成功: ${profileMatch[1]}\n`;
                } else {
                    debugInfo += `2. 正则匹配失败\n`;
                }

                // 方法3: 页面元素提取
                debugInfo += `3. 页面元素分析:\n`;
                const userLinks = document.querySelectorAll('a[href*="/user/profile/"]');
                debugInfo += `   - 用户主页链接数量: ${userLinks.length}\n`;

                for (let i = 0; i < Math.min(userLinks.length, 5); i++) {
                    const href = userLinks[i].getAttribute('href');
                    debugInfo += `   - 链接${i + 1}: ${href}\n`;
                }

                // 方法4: 数据属性提取
                const dataElements = document.querySelectorAll('[data-user-id]');
                debugInfo += `   - data-user-id元素数量: ${dataElements.length}\n`;

                // 尝试调用extractUserID方法
                debugInfo += `\n🔧 调用extractUserID方法:\n`;
                try {
                    const userId = Utils.extractUserID();
                    debugInfo += `✅ 提取成功: ${userId}\n`;
                } catch (error) {
                    debugInfo += `❌ 提取失败: ${error.message}\n`;
                }

            } catch (error) {
                debugInfo += `❌ 分析过程中出错: ${error.message}\n`;
            }

            console.log('✅ 调试信息处理完成');
            sendResponse({ success: true, debugInfo: debugInfo });

        } catch (error) {
            console.error('❌ 处理调试页面信息失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    /**
     * 处理执行爬虫请求
     */
    async function handleExecuteCrawler(request, sendResponse) {
        try {
            console.log('🚀 开始处理执行爬虫请求...', request);

            const startPage = request.startPage || 1;

            // 执行爬虫
            const result = await redbookFullCrawler(startPage);

            if (result.success) {
                console.log('✅ 爬虫执行成功:', result);
                sendResponse({
                    success: true,
                    userInfo: result.userInfo,
                    notesCount: result.notesCount,
                    imagesCount: result.imagesCount,
                    fileName: result.fileName
                });
            } else if (result.terminated) {
                console.log('🛑 爬虫被用户终止');
                sendResponse({
                    success: false,
                    terminated: true,
                    message: '爬虫已被用户终止'
                });
            } else {
                console.error('❌ 爬虫执行失败:', result);
                sendResponse({
                    success: false,
                    error: result.message || '未知错误'
                });
            }

        } catch (error) {
            console.error('❌ 处理执行爬虫请求失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    /**
     * 处理终止爬虫请求
     */
    async function handleStopCrawler(sendResponse) {
        try {
            console.log('🛑 开始处理终止爬虫请求...');

            // 停止爬虫
            await StopSignalManager.stopCrawler();

            console.log('✅ 爬虫终止信号发送成功');
            sendResponse({ success: true, message: '爬虫终止信号已发送' });

        } catch (error) {
            console.error('❌ 处理终止爬虫请求失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    /**
     * 小红书完整爬虫主函数
     */
    async function redbookFullCrawler(startPage = 1) {
        try {
            console.log('🔧 小红书爬虫函数开始执行');

            // 提取用户ID
            const userId = Utils.extractUserID();
            console.log('👤 用户ID:', userId);

            // 提取xsec_token
            const xsecToken = Utils.extractXsecToken();
            console.log('🔑 xsec_token:', xsecToken);

            // 检测平台
            const platform = Utils.detectPlatform();
            console.log('🌐 检测到平台:', platform);

            // 构建请求头
            const headers = Utils.buildHeaders();

            /* ================== 获取用户信息 ================== */
            console.log('📋 开始获取用户信息...');

            // 小红书用户信息API - 使用edith.xiaohongshu.com域名并添加xsec_token参数
            const userApis = [
                // 使用edith.xiaohongshu.com域名的API（优先使用其他info和profile端点）
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/otherinfo?target_user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/profile?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v2/user/profile?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/info?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v2/user/info?user_id=${userId}&xsec_token=${xsecToken}`,
                
                // 新增的可能有效端点
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/detail?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v2/user/detail?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/basic?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v2/user/basic?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/stats?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v2/user/stats?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v1/user/overview?user_id=${userId}&xsec_token=${xsecToken}`,
                `https://edith.xiaohongshu.com/api/sns/web/v2/user/overview?user_id=${userId}&xsec_token=${xsecToken}`,
                
                // 备用API - 原域名（添加xsec_token参数）
                `https://www.xiaohongshu.com/api/sns/web/v1/user/otherinfo?target_user_id=${userId}&xsec_token=${xsecToken}`,
                `https://www.xiaohongshu.com/api/sns/web/v1/user/profile?user_id=${userId}&xsec_token=${xsecToken}`,
                
                // 移动端API（添加xsec_token参数）
                `https://m.xiaohongshu.com/api/sns/web/v1/user/otherinfo?target_user_id=${userId}&xsec_token=${xsecToken}`,
                `https://m.xiaohongshu.com/api/sns/web/v1/user/profile?user_id=${userId}&xsec_token=${xsecToken}`
            ];

            let userInfo = null;
            let lastError = null;

            for (let i = 0; i < userApis.length; i++) {
                const userUrl = userApis[i];

                try {
                    console.log(`🌐 尝试用户信息API ${i + 1}/${userApis.length}: ${userUrl}`);
                    await StopSignalManager.checkStopSignal();

                    // 为不同API添加不同的延迟，避免被限流
                    if (i > 0) {
                        await Utils.sleep(2000);
                    }

                    const userRes = await Utils.fetchWithRetry(userUrl, {
                        headers: headers,
                        credentials: 'include' // 包含凭证
                    });

                    const userJson = await userRes.json();

                    console.log(`📡 API返回状态: ${userRes.status}, 数据结构:`, {
                        hasData: !!userJson.data,
                        hasUser: !!userJson.user,
                        hasError: !!userJson.error,
                        errorMsg: userJson.error_msg || userJson.msg || '无'
                    });

                    // 检查不同的数据格式
                    if (userJson.data || userJson.user) {
                        userInfo = DataProcessor.processUserInfo(userJson.data || userJson.user);
                        console.log('✅ 用户信息获取成功:', userInfo);
                        break;
                    } else if (userJson.error) {
                        console.warn('⚠️ API返回错误:', userJson.error_msg || userJson.msg);
                    } else {
                        console.warn('⚠️ API返回数据格式异常:', Object.keys(userJson));
                    }

                } catch (error) {
                    lastError = error;
                    console.warn('⚠️ 用户信息API请求失败:', userUrl, error.message);

                    // 逐渐增加延迟时间
                    await Utils.sleep(3000 + i * 1000);
                }
            }

            if (!userInfo) {
                console.log('📋 所有API都失败，尝试从页面直接提取用户信息...');
                try {
                    userInfo = Utils.extractUserInfoFromPage(userId);

                    if (!userInfo) {
                        throw new Error(`❌ 所有用户信息获取方法都失败: ${lastError ? lastError.message : '未知错误'}`);
                    }
                } catch (error) {
                    console.error('❌ 页面数据提取也失败:', error);
                    throw new Error(`❌ 所有用户信息获取方法都失败: ${error.message}`);
                }
            }

            /* ================== 获取笔记列表 ================== */
            console.log('📝 开始获取笔记列表...');

            let notes = [];
            let allImages = [];
            let page = startPage;
            let hasMore = true;
            let consecutiveFailures = 0;
            const maxConsecutiveFailures = 3;

            while (hasMore && consecutiveFailures < maxConsecutiveFailures) {
                await StopSignalManager.checkStopSignal();

                console.log(`📄 获取第 ${page} 页笔记...`);

                try {
                    // 小红书笔记列表API - 使用edith.xiaohongshu.com域名并添加xsec_token参数
                    const notesApis = [
                        // 使用edith.xiaohongshu.com域名的API
                        `https://edith.xiaohongshu.com/api/sns/web/v1/user_posted?num=20&cursor=&user_id=${userId}&xsec_token=${xsecToken}&image_formats=jpg,webp,avif`,
                        `https://edith.xiaohongshu.com/api/sns/web/v1/user_posted?page=${page}&page_size=20&user_id=${userId}&xsec_token=${xsecToken}`,
                        `https://edith.xiaohongshu.com/api/sns/web/v2/user_posted?user_id=${userId}&page=${page}&page_size=20&xsec_token=${xsecToken}`,
                        `https://edith.xiaohongshu.com/api/sns/web/v1/notes/user/${userId}?page=${page}&page_size=20&xsec_token=${xsecToken}`,
                        `https://edith.xiaohongshu.com/api/sns/web/v2/notes/user/${userId}?page=${page}&page_size=20&xsec_token=${xsecToken}`,
                        `https://edith.xiaohongshu.com/api/sns/web/v1/user/notes?user_id=${userId}&page=${page}&page_size=20&xsec_token=${xsecToken}`,
                        `https://edith.xiaohongshu.com/api/sns/web/v2/user/notes?user_id=${userId}&page=${page}&page_size=20&xsec_token=${xsecToken}`,
                        `https://edith.xiaohongshu.com/api/sns/web/v1/user/content?user_id=${userId}&page=${page}&page_size=20&xsec_token=${xsecToken}`,
                        
                        // 备用API - 原域名（添加xsec_token参数）
                        `https://www.xiaohongshu.com/api/sns/web/v1/user_posted?num=20&cursor=&user_id=${userId}&xsec_token=${xsecToken}&image_formats=jpg,webp,avif`,
                        `https://www.xiaohongshu.com/api/sns/web/v1/user_posted?page=${page}&page_size=20&user_id=${userId}&xsec_token=${xsecToken}`,
                        
                        // 移动端API（添加xsec_token参数）
                        `https://m.xiaohongshu.com/api/sns/web/v1/user_posted?num=20&cursor=&user_id=${userId}&xsec_token=${xsecToken}&image_formats=jpg,webp,avif`,
                        `https://m.xiaohongshu.com/api/sns/web/v1/user_posted?page=${page}&page_size=20&user_id=${userId}&xsec_token=${xsecToken}`
                    ];

                    let notesJson = null;

                    for (let i = 0; i < notesApis.length; i++) {
                        const notesUrl = notesApis[i];

                        try {
                            console.log(`🌐 尝试笔记列表API ${i + 1}/${notesApis.length}: ${notesUrl}`);

                            // 为不同API添加不同的延迟
                            if (i > 0) {
                                await Utils.sleep(1500);
                            }

                            const notesRes = await Utils.fetchWithRetry(notesUrl, {
                                headers: headers,
                                credentials: 'include'
                            });

                            notesJson = await notesRes.json();

                            console.log(`📡 笔记API返回状态: ${notesRes.status}, 数据结构:`, {
                                hasData: !!notesJson.data,
                                hasItems: !!notesJson.items,
                                hasMore: notesJson.data?.has_more || notesJson.has_more || false,
                                itemCount: notesJson.data?.notes?.length || notesJson.data?.items?.length || notesJson.items?.length || 0
                            });

                            if (notesJson.data || notesJson.items) {
                                console.log(`✅ 笔记列表API请求成功，获取到 ${notesJson.data?.notes?.length || notesJson.data?.items?.length || notesJson.items?.length || 0} 篇笔记`);
                                consecutiveFailures = 0; // 重置失败计数器
                                break;
                            }

                        } catch (error) {
                            console.warn(`⚠️ 笔记列表API请求失败: ${notesUrl}`, error.message);
                            // 继续尝试下一个API
                        }
                    }

                    if (!notesJson) {
                        consecutiveFailures++;
                        console.warn(`⚠️ 所有笔记列表API请求失败，连续失败次数: ${consecutiveFailures}`);

                        if (consecutiveFailures >= maxConsecutiveFailures) {
                            console.error('❌ 连续多次请求失败，尝试从页面直接提取笔记...');
                            try {
                                const pageNotes = Utils.extractNotesFromPage();

                                if (pageNotes.length > 0) {
                                    console.log('✅ 从页面提取到笔记，继续处理...');
                                    notes.push(...pageNotes);
                                    hasMore = false; // 页面提取只获取当前页
                                } else {
                                    console.error('❌ 从页面也无法提取笔记，停止爬取');
                                    break;
                                }
                            } catch (error) {
                                console.error('❌ 页面笔记提取失败:', error);
                                console.error('❌ 从页面也无法提取笔记，停止爬取');
                                break;
                            }
                        } else {
                            // 失败后等待更长时间再重试
                            await Utils.sleep(5000);
                            continue;
                        }
                    }

                    // 处理笔记数据
                    const currentNotes = notesJson.data?.notes || notesJson.data?.items || notesJson.items || [];

                    if (currentNotes.length === 0) {
                        console.log('📭 第' + page + '页无数据，停止爬取');
                        hasMore = false;
                        break;
                    }

                    // 处理当前页的笔记
                    for (const rawNote of currentNotes) {
                        await StopSignalManager.checkStopSignal();

                        const processedNote = DataProcessor.processNoteInfo(rawNote);
                        notes.push(processedNote);

                        // 提取图片信息
                        const noteImages = DataProcessor.extractImages(processedNote, userInfo);
                        allImages.push(...noteImages);

                        console.log(`✅ 处理笔记: ${processedNote.note_id} (${processedNote.title || '无标题'})`);
                    }

                    console.log(`📊 第 ${page} 页处理完成，累计笔记: ${notes.length} 篇，图片: ${allImages.length} 张`);

                    // 检查是否还有更多页
                    hasMore = notesJson.data?.has_more || notesJson.has_more || false;

                    // 如果返回了cursor，说明是新的API格式
                    if (notesJson.cursor && !hasMore) {
                        hasMore = !!notesJson.cursor;
                    }

                    page++;

                    // 页面间延迟，避免请求过快
                    await Utils.sleep(3000);

                } catch (error) {
                    consecutiveFailures++;
                    console.error(`❌ 第 ${page} 页处理失败:`, error);

                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        console.error('❌ 连续多次处理失败，停止爬取');
                        break;
                    }

                    // 失败后等待更长时间再重试
                    await Utils.sleep(5000);
                }
            }

            console.log(`📚 笔记获取完成，共 ${notes.length} 篇笔记，${allImages.length} 张图片`);

            /* ================== 下载图片 ================== */
            console.log('📷 开始下载图片...');

            const imageResults = await ImageDownloader.downloadImages(allImages);

            // 过滤成功的图片
            const successfulImages = imageResults.filter(img => img.success);
            console.log(`🖼️ 图片下载完成: ${successfulImages.length}/${allImages.length} 成功`);

            /* ================== 构建导出数据 ================== */
            console.log('📦 构建导出数据...');

            const exportData = DataProcessor.buildExportData(userInfo, notes, successfulImages);

            // 添加下载统计
            exportData.metadata.download_stats = {
                total_images: allImages.length,
                successful_images: successfulImages.length,
                failed_images: allImages.length - successfulImages.length
            };

            console.log('✅ 导出数据构建完成');

            /* ================== 导出数据 ================== */
            console.log('💾 开始导出数据...');

            // 导出JSON数据
            const jsonContent = JSON.stringify(exportData, null, 2);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `redbook_${userInfo.nickname}_${userInfo.user_id}_${timestamp}.json`;

            Utils.createDownloadFile(jsonContent, fileName, 'application/json');

            console.log('🎉 小红书数据导出完成！');

            return {
                success: true,
                userInfo: userInfo,
                notesCount: notes.length,
                imagesCount: successfulImages.length,
                fileName: fileName
            };

        } catch (error) {
            console.error('❌ 小红书爬虫执行失败:', error);

            // 如果是用户终止，不显示错误提示
            if (error.message.includes('爬虫被用户终止')) {
                console.log('🛑 爬虫已被用户终止');
                return {
                    success: false,
                    terminated: true,
                    message: '爬虫已被用户终止'
                };
            }

            throw error;
        }
    }

})();