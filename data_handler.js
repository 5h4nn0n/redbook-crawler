// redbook-crawler/data_handler.js
(function () {
  'use strict';

  class DataHandler {
    /**
     * 导出JSON数据
     * @param {object} data - The data to be exported.
     * @param {string} fileName - The name of the file.
     * @returns {boolean} - True if successful, false otherwise.
     */
    static downloadMedia(notes) {
      console.log("Placeholder for downloading media:", notes);
      // Actual download logic will be implemented in popup.js
    }

    static saveAsJson(data, fileName) {
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
        console.error("❌ JSON export failed:", error);
        return false;
      }
    }

    /**
     * 将数据发送到API
     * @param {object} data - The data to be sent.
     * @param {string} apiUrl - The API endpoint URL.
     * @param {number} batchSize - The size of each batch.
     * @returns {Promise<boolean>} - True if successful, false otherwise.
     */
    static async sendToApi(data, apiUrl, batchSize = 1000) {
      try {
        // 检查是否需要分批发送
        if (data.data && data.data.notes && data.data.notes.length > batchSize) {
          console.log(`📊 数据量较大 (${data.data.notes.length} 条)，开始分批发送...`);
          return await this.sendDataInBatches(data, apiUrl, batchSize);
        } else {
          // 数据量较小，直接发送
          return await this.sendSingleBatch(data, apiUrl);
        }
      } catch (error) {
        console.error("❌ Error sending data to API:", error);
        return false;
      }
    }

    /**
     * 分批发送数据
     * @param {object} data - The data to be sent.
     * @param {string} apiUrl - The API endpoint URL.
     * @param {number} batchSize - The size of each batch.
     * @returns {Promise<boolean>} - True if all batches were successful, false otherwise.
     */
    static async sendDataInBatches(data, apiUrl, batchSize = 1000) {
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

        const success = await this.sendSingleBatch(batchData, apiUrl);
        if (!success) {
          allSuccessful = false;
          console.error(`❌ 第 ${i + 1} 批发送失败`);
        } else {
          console.log(`✅ 第 ${i + 1} 批发送成功`);
        }

        // 每批之间添加延迟，避免请求过于频繁
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      return allSuccessful;
    }

    /**
     * 发送单个批次的数据
     * @param {object} data - The data to be sent.
     * @param {string} apiUrl - The API endpoint URL.
     * @returns {Promise<boolean>} - True if successful, false otherwise.
     */
    static async sendSingleBatch(data, apiUrl) {
      try {
        // 检查是否在Chrome扩展环境中
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          // 使用Chrome扩展的消息传递机制，让Background Script处理API请求
          return new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'sendToApi',
              data: data,
              apiUrl: apiUrl
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("❌ Chrome runtime error:", chrome.runtime.lastError);
                resolve(false);
              } else {
                if (response && response.success) {
                  console.log("✅ Data sent to API successfully.");
                  console.log("📡 API response:", response.data);
                  resolve(true);
                } else {
                  console.error("❌ API request failed:", response && response.error);
                  console.error("📡 API error details:", response && response.errorDetails);
                  resolve(false);
                }
              }
            });
          });
        } else {
          // 非Chrome扩展环境，直接使用fetch（可能会遇到CORS问题）
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          });

          if (response.ok) {
            console.log("✅ Data sent to API successfully.");
            const responseData = await response.json();
            console.log("📡 API response:", responseData);
            return true;
          } else {
            console.error("❌ Failed to send data to API:", response.status, response.statusText);
            const responseBody = await response.text();
            console.error("❌ API response:", responseBody);
            return false;
          }
        }
      } catch (error) {
        console.error("❌ Error sending single batch:", error);
        return false;
      }
    }

    /**
     * 分批保存JSON数据
     * @param {object} data - The data to be saved.
     * @param {string} fileName - The name of the file.
     * @param {number} batchSize - The size of each batch.
     * @returns {Promise<boolean>} - True if all batches were successful, false otherwise.
     */
    static async saveAsJsonInBatches(data, fileName, batchSize = 1000) {
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
          const batchFileName = fileName.replace('.json', `_batch${i + 1}_${totalBatches}.json`);
          const success = this.saveAsJson(batchData.data, batchFileName);
          if (!success) {
            allSuccessful = false;
            console.error(`❌ 第 ${i + 1} 批保存失败`);
          } else {
            console.log(`✅ 第 ${i + 1} 批保存成功`);
          }

          // 每批之间添加延迟，避免操作过于频繁
          if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        return allSuccessful;
      } catch (error) {
        console.error("❌ Error saving data in batches:", error);
        return false;
      }
    }
  }

  // Export the DataHandler class
  if (typeof window.RedBookCrawlerUtils === 'undefined') {
    window.RedBookCrawlerUtils = {};
  }
  window.RedBookCrawlerUtils.DataHandler = DataHandler;
})();
