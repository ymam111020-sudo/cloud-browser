const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Relay Live'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const BROWSERLESS_KEY = '2VCcBcwhj8eBb5P8215938cdf24e971e5bc92351e1b9d7739';
// セッションIDを固定して、クラウド側にプロファイル（ログイン状態）を永続化
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
  console.log('Client connected to session');

  let page = null;
  let cdp = null;

  try {
    const browser = await getBrowser();
    const pages = await browser.pages();
    page = pages.length > 0 ? pages[0] : await browser.newPage();

    await page.setViewport({ width: 1024, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
    });
    await page.emulateTimezone('Asia/Tokyo');

    const currentUrl = page.url();
    if (!currentUrl || currentUrl === 'about:blank') {
      await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

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

    ws.on('close', () => {
      console.log('Client disconnected (Session preserved on cloud)');
      if (cdp) {
        try { cdp.detach(); } catch (e) {}
      }
    });

  } catch (err) {
    console.error('Session Error:', err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server live on port ${PORT}`));
