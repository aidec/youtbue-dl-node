const express = require('express');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs').promises;
const app = express();

// 設定預設配置
let config = {
    downloadPath: path.join(__dirname, 'downloads')
};

// 在全局範圍添加一個 Map 來存儲所有下載狀態
const downloadStatus = new Map();
let statusConnections = new Set();

// 讀取配置檔案
async function loadConfig() {
    try {
        const data = await fs.readFile('config.json', 'utf8');
        config = JSON.parse(data);
    } catch (err) {
        // 如果檔案不存在，建立預設配置
        await fs.writeFile('config.json', JSON.stringify(config, null, 2));
    }
}

// 儲存配置
async function saveConfig() {
    await fs.writeFile('config.json', JSON.stringify(config, null, 2));
}

app.use(express.json());
app.use(express.static('public'));

// API 端點處理下載請求
app.post('/api/download', async (req, res) => {
    const { urls } = req.body;

    // 立即回應請求
    res.json({ success: true });

    for (const url of urls) {
        try {
            // 初始化狀態
            downloadStatus.set(url, {
                url,
                status: 'preparing',
                title: '準備中...',
                progress: 0
            });
            broadcastStatus();

            // 獲取影片資訊
            const info = await youtubedl(url, {
                dumpSingleJson: true,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                addHeader: ['referer:youtube.com', 'user-agent:googlebot']
            });

            // 更新狀態
            downloadStatus.set(url, {
                url,
                status: 'downloading',
                title: info.title,
                progress: 0
            });
            broadcastStatus();

            // 開始下載
            const downloadProcess = youtubedl.exec(url, {
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
                output: path.join(config.downloadPath, '%(title)s.%(ext)s'),
                progress: true
            });

            downloadProcess.stdout.on('data', (data) => {
                const progressMatch = data.toString().match(/(\d+\.\d+)%/);
                if (progressMatch) {
                    const progress = parseFloat(progressMatch[1]);
                    downloadStatus.set(url, {
                        url,
                        status: 'downloading',
                        title: info.title,
                        progress: progress
                    });
                    broadcastStatus();
                }
            });

            await new Promise((resolve, reject) => {
                downloadProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error('下載失敗'));
                    }
                });
            });

            downloadStatus.set(url, {
                url,
                status: 'success',
                title: info.title,
                progress: 100
            });

        } catch (err) {
            downloadStatus.set(url, {
                url,
                status: 'error',
                title: '錯誤',
                message: err.message
            });
        }
        
        broadcastStatus();
    }
});

// 添加廣播函數
function broadcastStatus() {
    const statusData = JSON.stringify(Array.from(downloadStatus.values()));
    for (const client of statusConnections) {
        client.write(`data: ${statusData}\n\n`);
    }
}

// 更新配置
app.post('/api/config', async (req, res) => {
    const { downloadPath } = req.body;
    config.downloadPath = downloadPath;
    await saveConfig();
    res.json({ success: true });
});

// 獲取當前配置
app.get('/api/config', (req, res) => {
    res.json(config);
});

// 添加狀態更新的 SSE 端點
app.get('/api/download-status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 將此連接添加到活動連接集合中
    statusConnections.add(res);

    // 當客戶端斷開連接時，從集合中移除
    req.on('close', () => {
        statusConnections.delete(res);
    });

    // 發送初始狀態
    res.write(`data: ${JSON.stringify(Array.from(downloadStatus.values()))}\n\n`);
});

// 啟動伺服器
async function start() {
    await loadConfig();
    // 確保下載目錄存在
    await fs.mkdir(config.downloadPath, { recursive: true });
    app.listen(3001, () => {
        console.log('Server running at http://localhost:3001');
    });
}

start();