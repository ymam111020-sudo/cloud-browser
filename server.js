const express = require('express');
const httpProxy = require('http-proxy');
const cors = require('cors');

const app = express();
app.use(cors());

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  autoRewrite: true,
  followRedirects: true,
  secure: false
});

// iframeブロックとセキュリティ制限の解除
proxy.on('proxyRes', (proxyRes, req, res) => {
  delete proxyRes.headers['x-frame-options'];
  delete proxyRes.headers['content-security-policy'];
  delete proxyRes.headers['content-security-policy-report-only'];

  proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  proxyRes.headers['Access-Control-Allow-Headers'] = '*';
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  if (!res.headersSent) {
    res.status(500).send('Proxy Connection Error: ' + err.message);
  }
});

// 常時稼働用の死活監視
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.send('Cloud Proxy Browser Server is Ready!'));

// プロキシ中継ルート: /proxy?url=https://...
app.use('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing "url" query parameter');
  }

  try {
    const parsed = new URL(targetUrl);

    // パスとクエリパラメータを保持して中継
    req.url = parsed.pathname + parsed.search;

    proxy.web(req, res, {
      target: parsed.origin,
      headers: {
        host: parsed.host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
      }
    });
  } catch (e) {
    res.status(400).send('Invalid URL format. Please include https://');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
