const express = require('express');
const httpProxy = require('http-proxy');

const app = express();
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  autoRewrite: true,
  followRedirects: true,
  secure: false
});

// iframeブロックとCORS制限の解除
proxy.on('proxyRes', function (proxyRes, req, res) {
  delete proxyRes.headers['x-frame-options'];
  delete proxyRes.headers['content-security-policy'];
  delete proxyRes.headers['content-security-policy-report-only'];

  proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
});

// プロキシ接続エラー時のハンドリング
proxy.on('error', function (err, req, res) {
  console.error('Proxy Error:', err.message);
  if (!res.headersSent) {
    res.status(500).send('Proxy Error: ' + err.message);
  }
});

// 常時稼働用の死活監視
app.get('/ping', function (req, res) {
  res.status(200).send('pong');
});

app.get('/', function (req, res) {
  res.send('Remote Browser Proxy Server is Running!');
});

// プロキシ中継ルート
app.use('/proxy', function (req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    return res.status(400).send('Invalid URL format');
  }

  // ターゲット先のパスを保持
  req.url = parsed.pathname + parsed.search;

  proxy.web(req, res, {
    target: parsed.origin,
    headers: {
      host: parsed.host,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('Server running on port ' + PORT);
});
