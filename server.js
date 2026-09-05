const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Bandwidth Optimized Relay Live'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const BROWSERLESS_KEY = '2VCcBcwhj8eBb5P8215938cdf24e971e5bc92351e1b9d7739';
const SESSION_ID = 'user-auth-session-v1';
const BROWSERLESS_ENDPOINT = `wss://chrome.browserless.io?token=${BROWSERLESS_KEY}&session=${SESSION_ID}&stealth=true&--disable-blink-features=AutomationControlled`;

let globalBrowser = null;

async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  globalBrowser = await puppeteer.connect({
    browserWSEndpoint: BROWSERLESS_ENDPOINT
  });
  return globalBrowser;
}

wss.on('connection', async (ws) => {
  console.log('Device connected. Initializing bandwidth-optimized session...');

  let page = null;
  let cdp = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // 転送バイト数を減らすためビューポートを最適化 (960x640)
    await page.setViewport({ width: 960, height: 640 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
    });
    await page.emulateTimezone('Asia/Tokyo');

    await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    cdp = await page.target().createCDPSession();
    
    // everyNthFrame: 3 で生成フレーム自体を 1/3 に間引く
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 50,
      everyNthFrame: 3
    });

    let isSending = false;
    let lastSentTime = 0;
    const MIN_INTERVAL_MS = 100; // 最短でも 100ms（最大 10 FPS）に制限

    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      
      const now = Date.now();
      // インターバル制限と送信中ロックの二重チェック
      if (ws.readyState === WebSocket.OPEN && !isSending && (now - lastSentTime >= MIN_INTERVAL_MS)) {
        isSending = true;
        lastSentTime = now;
        ws.send(JSON.stringify({ type: 'frame', data }), () => {
          isSending = false;
        });
      }
    });

    ws.on('message', async (message) => {
      try {
        const action = JSON.parse(message);
        if (!page || page.isClosed()) return;

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

    ws.on('close', async () => {
      console.log('Device disconnected. Cleaning up tab...');
      try {
        if (cdp) await cdp.detach();
        if (page && !page.isClosed()) await page.close();
      } catch (e) {}
    });

    ws.on('error', async () => {
      try {
        if (page && !page.isClosed()) await page.close();
      } catch (e) {}
    });

  } catch (err) {
    console.error('Session error:', err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Optimized server live on port ${PORT}`));
