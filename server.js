const express = require('express');
const httpProxy = require('http-proxy');

const app = express();
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  autoRewrite: true,
  followRedirects: true
});

// レスポンスヘッダーから iframe 制限を削除
proxy.on('proxyRes', (proxyRes) => {
  delete proxyRes.headers['x-frame-options'];
  delete proxyRes.headers['content-security-policy'];
  delete proxyRes.headers['content-security-policy-report-only'];

  // どのオリジンからでもiframe埋め込みを許可
  proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
});

// エラーハンドリング
proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  if (!res.headersSent) {
    res.status(500).send('Proxy Error: ' + err.message);
  }
});

// 常時稼働監視用
app.get('/ping', (req, res) => res.status(200).send('pong'));

// プロキシ中継ルート: /proxy?url=https://example.com
app.all('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  try {
    const parsed = new URL(targetUrl);
    proxy.web(req, res, {
      target: parsed.origin,
      headers: {
        host: parsed.host
      }
    });
  } catch (e) {
    res.status(400).send('Invalid URL format');
  }
});

app.get('/', (req, res) => {
  res.send('Proxy Server is Running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
