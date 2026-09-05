const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-core');

const app = express();
app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.send('Browser Relay Server Live'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const BROWSERLESS_KEY = process.env.BROWSERLESS_KEY || '2VCcBcwhj8eBb5P8215938cdf24e971e5bc92351e1b9d7739';

wss.on('connection', async (ws) => {
  console.log('Client connected. Connecting to Cloud Chrome...');

  let browser;
  try {
    // 高性能クラウドChromeへ接続
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_KEY}`
    });

    console.log('Cloud Chrome connected successfully!');
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });

    const cdp = await page.target().createCDPSession();
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
        if (action.type === 'click') {
          await page.mouse.click(action.x, action.y);
        } else if (action.type === 'type') {
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
    console.error('Cloud Chrome Error:', err);
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Relay running on port ${PORT}`));
