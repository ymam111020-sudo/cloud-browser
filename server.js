const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-core');

const app = express();

// 死活監視用エンドポイント
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Browser Relay Server Live'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Browserlessの接続先エンドポイント
const BROWSERLESS_ENDPOINT = 'wss://chrome.browserless.io?token=2VCcBcwhj8eBb5P8215938cdf24e971e5bc92351e1b9d7739';

wss.on('connection', async (ws) => {
  console.log('Client connected. Connecting to Cloud Chrome...');

  let browser = null;
  let page = null;
  let cdp = null;

  try {
    // 外部クラウドChromeへ接続
    browser = await puppeteer.connect({
      browserWSEndpoint: BROWSERLESS_ENDPOINT
    });

    console.log('Cloud Chrome connected successfully!');

    page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    cdp = await page.target().createCDPSession();
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      everyNthFrame: 1
    });

    let isSending = false;
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
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
        if (!page) return;

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
        console.error('Action error:', err.message);
      }
    });

    const cleanup = async () => {
      console.log('Cleaning up session...');
      try {
        if (page) await page.close();
        if (browser) await browser.close();
      } catch (e) {}
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);

  } catch (err) {
    console.error('Cloud Chrome connection failed:', err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay server running on port ${PORT}`);
});
