import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
// When running from dist/server/server/index.js the root is 3 levels up.
const projectRoot = root.endsWith('dist') ? path.resolve(root, '..') : root;

const app = new App({
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(projectRoot, 'data'),
  contentDir: process.env.CONTENT_DIR ?? path.join(projectRoot, 'content/questions'),
  consoleToken: process.env.CONSOLE_TOKEN,
  publicUrl: process.env.PUBLIC_URL?.trim() || undefined,
  publicPort: process.env.PUBLIC_PORT ? Number(process.env.PUBLIC_PORT) : undefined,
  blockSource: (process.env.BLOCK_SOURCE as 'real' | 'off' | undefined) ?? 'real',
  mempoolBaseUrl: process.env.MEMPOOL_URL,
  clientDist: path.join(projectRoot, 'dist/client'),
});

app.listen().then((port) => {
  if (!app.game) app.newSession(null);
  console.log(`[quiz] server listening on http://0.0.0.0:${port}`);
  console.log(`[quiz] console token: ${app.consoleToken}`);
  console.log(`[quiz] console: ${app.lanUrls()[0] ?? 'http://localhost:' + port}/console`);
  console.log(`[quiz] board:   ${app.lanUrls()[0] ?? 'http://localhost:' + port}/board`);
  console.log(`[quiz] join:    ${app.joinUrl()}`);
});

const shutdown = () => {
  app.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
