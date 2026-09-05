const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.send('Proxy is live'));

app.all('/proxy', async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL missing');

  try {
    const urlObj = new URL(targetUrl);

    // フォーム送信時などの付加クエリ（例: q=検索ワード）をターゲットURLへ自動マージ
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'url') {
        urlObj.searchParams.set(key, value);
      }
    }
    const finalUrl = urlObj.href;

    // 目的のサーバーへリクエスト送信
    const response = await axios({
      method: req.method,
      url: finalUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8',
        'Referer': urlObj.origin
      },
      responseType: 'arraybuffer',
      validateStatus: () => true
    });

    // セキュリティ制約・iframeブロックを解除
    res.removeHeader('x-frame-options');
    res.removeHeader('content-security-policy');
    res.removeHeader('content-security-policy-report-only');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');

    const contentType = response.headers['content-type'] || '';

    // HTMLの場合: リンク・フォーム・JavaScript内部通信の書き換え
    if (contentType.includes('text/html')) {
      const html = response.data.toString('utf-8');
      const $ = cheerio.load(html);

      // 相対パス解決用のベースタグ
      $('head').prepend(`<base href="${urlObj.origin}/">`);

      // YouTubeやGoogleの非同期通信(Fetch / XHR)をプロキシ経由にフックするスクリプトを注入
      const proxyHookScript = `
        <script>
          (function() {
            const originBase = "${urlObj.origin}";
            function toProxyUrl(url) {
              try {
                const absolute = new URL(url, originBase).href;
                return '/proxy?url=' + encodeURIComponent(absolute);
              } catch(e) {
                return url;
              }
            }

            // fetch をフック
            const originalFetch = window.fetch;
            window.fetch = function(input, init) {
              if (typeof input === 'string') {
                input = toProxyUrl(input);
              } else if (input instanceof Request) {
                input = new Request(toProxyUrl(input.url), input);
              }
              return originalFetch.call(this, input, init);
            };

            // XMLHttpRequest をフック
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              return originalOpen.call(this, method, toProxyUrl(url), ...rest);
            };
          })();
        </script>
      `;
      $('head').prepend(proxyHookScript);

      // 通常リンクの書き換え
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          try {
            const absoluteUrl = new URL(href, urlObj.origin).href;
            $(el).attr('href', `/proxy?url=${encodeURIComponent(absoluteUrl)}`);
          } catch (e) {}
        }
      });

      // 検索フォームの書き換え
      $('form').each((_, el) => {
        const action = $(el).attr('action') || '';
        try {
          const absoluteAction = new URL(action, urlObj.origin).href;
          $(el).attr('action', '/proxy');
          $(el).prepend(`<input type="hidden" name="url" value="${absoluteAction}">`);
        } catch (e) {}
      });

      res.set('content-type', 'text/html; charset=utf-8');
      return res.send($.html());
    }

    // 画像・JS・CSS・API応答はそのまま配信
    res.set('content-type', contentType);
    res.status(response.status).send(response.data);

  } catch (err) {
    res.status(500).send('Proxy Routing Error: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
