const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');

const app = express();

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Remote Browser Server is Running!'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws) => {
  console.log('Client connected');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--hide-scrollbars',
        '--mute-audio',
        '--window-size=1024,768'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });

    const cdp = await page.target().createCDPSession();
    // 画質を75に引き上げ、スムーズな描画設定に変更
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      everyNthFrame: 1
    });

    let isSending = false;
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      // ネットワーク詰まりを防ぐため、送信完了を待たずに即座に応答
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      
      if (ws.readyState === WebSocket.OPEN && !isSending) {
        isSending = true;
        ws.send(JSON.stringify({ type: 'frame', data }), () => {
          isSending = false;
        });
      }
    });

    ws.on('message', async (message) => {
      try {
        const action = JSON.parse(message);
        if (action.type === 'click') {
          await page.mouse.click(action.x, action.y);
        } else if (action.type === 'type') {
          // 日本語を含む文字列入力に対応
          await page.keyboard.type(action.text);
        } else if (action.type === 'key') {
          await page.keyboard.press(action.key);
        } else if (action.type === 'scroll') {
          await page.mouse.wheel({ deltaY: action.deltaY });
        } else if (action.type === 'navigate') {
          await page.goto(action.url, { waitUntil: 'domcontentloaded' });
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
    console.error('Launch failed:', err);
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
