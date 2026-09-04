const express = require('express');
const httpProxy = require('http-proxy');

const app = express();
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  autoRewrite: true,
  followRedirects: true
});

// レスポンスヘッダーの書き換え（iframe制限とCORSの解除）
proxy.on('proxyRes', (proxyRes) => {
  delete proxyRes.headers['x-frame-options'];
  delete proxyRes.headers['content-security-policy'];
  delete proxyRes.headers['content-security-policy-report-only'];

  proxyRes.headers['access-control-allow-origin'] = '*';
  proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
});

// エラーハンドリング
proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  if (!res.headersSent) {
    res.status(500).send('Proxy Error: ' + err.message);
  }
});

// 常時稼働用の死活監視
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.send('Proxy Server is Running!'));

// プロキシ中継
app.use('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  try {
    const parsed = new URL(targetUrl);

    // リクエストのURLパスを本来のパス（pathname + search）に書き換えて転送
    req.url = parsed.pathname + parsed.search;

    proxy.web(req, res, {
      target: parsed.origin,
      headers: {
        host: parsed.host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
  } catch (e) {
    res.status(400).send('Invalid URL format');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
