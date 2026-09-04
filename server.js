const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Remote Browser Server is Running!'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Chromeの実行可能パス判定
let chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
if (!fs.existsSync(chromePath)) {
  if (fs.existsSync('/usr/bin/google-chrome')) chromePath = '/usr/bin/google-chrome';
  else if (fs.existsSync('/usr/bin/chromium')) chromePath = '/usr/bin/chromium';
  else if (fs.existsSync('/usr/bin/chromium-browser')) chromePath = '/usr/bin/chromium-browser';
}

wss.on('connection', async (ws) => {
  console.log('Client connected. Starting browser...');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true, // 安定動作のためにシンプルな headless モードを指定
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--hide-scrollbars',
        '--mute-audio',
        '--window-size=1280,720'
      ]
    });

    console.log('Browser launched successfully');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Page loaded');

    // CDPセッション開始
    const cdp = await page.target().createCDPSession();
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 50,
      everyNthFrame: 1
    });

    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'frame', data }));
          await cdp.send('Page.screencastFrameAck', { sessionId });
        }
      } catch (e) {}
    });

    // 操作イベント
    ws.on('message', async (message) => {
      try {
        const action = JSON.parse(message);
        if (action.type === 'click') {
          await page.mouse.click(action.x, action.y);
        } else if (action.type === 'type') {
          await page.keyboard.type(action.text);
        } else if (action.type === 'key') {
          await page.keyboard.press(action.key);
        } else if (action.type === 'scroll') {
          await page.mouse.wheel({ deltaY: action.deltaY });
        } else if (action.type === 'navigate') {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
      } catch (err) {
        console.error('Action error:', err);
      }
    });

    ws.on('close', async () => {
      console.log('Client disconnected');
      if (browser) await browser.close();
    });

  } catch (err) {
    console.error('Puppeteer launch error:', err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
