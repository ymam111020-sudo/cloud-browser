const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.send('Proxy is live'));

app.all('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL missing');

  try {
    const urlObj = new URL(targetUrl);

    // 目的のサイトへリクエスト
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
      },
      responseType: 'arraybuffer',
      validateStatus: () => true
    });

    // レスポンスヘッダーのセキュリティ制限を解除
    res.removeHeader('x-frame-options');
    res.removeHeader('content-security-policy');
    res.set('Access-Control-Allow-Origin', '*');

    const contentType = response.headers['content-type'] || '';

    // HTMLページの場合は、リンクとフォームの飛び先をプロキシ経由に書き換える
    if (contentType.includes('text/html')) {
      const html = response.data.toString('utf-8');
      const $ = cheerio.load(html);

      // 相対パスの画像やCSSが壊れないように <base> を先頭に注入
      $('head').prepend(`<base href="${urlObj.origin}/">`);

      // リンクの書き換え (クリックしてもプロキシを維持)
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          try {
            const absoluteUrl = new URL(href, urlObj.origin).href;
            $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      // 検索フォームの書き換え (Google検索などで /search に飛んでもプロキシを維持)
      $('form').each((_, el) => {
        const action = $(el).attr('action') || '';
        try {
          const absoluteAction = new URL(action, urlObj.origin).href;
          $(el).attr('action', `/proxy`);
          $(el).prepend(`<input type="hidden" name="url" value="${absoluteAction}">`);
        } catch (e) {}
      });

      res.set('content-type', 'text/html; charset=utf-8');
      return res.send($.html());
    }

    // 画像やJS、CSSなどはそのまま流す
    res.set('content-type', contentType);
    res.send(response.data);

  } catch (err) {
    res.status(500).send('Proxy Error: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
