import { createBareServer } from 'bare-server-node';
import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const app = express();
const bareServer = createBareServer('/bare/');
const server = createServer();

// 常時稼働用の死活監視
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Ultraviolet のクライアント側スクリプト群を静的配信
app.use('/uv/', express.static(uvPath));

// フロントエンド画面（検索バー・iframe UI）
app.use(express.static(join(__dirname, 'public')));

server.on('request', (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ultraviolet server running on port ${PORT}`);
});
