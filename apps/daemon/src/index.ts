import path from 'node:path';
import { createServer } from './server.js';
import { openDb } from './db.js';

const PORT = Number(process.env.OGF_DAEMON_PORT ?? 7621);
const HOST = process.env.OGF_DAEMON_HOST ?? '127.0.0.1';

const dbPath =
  process.env.OGF_DB_PATH ??
  path.resolve(process.cwd(), '.ogf', 'app.sqlite');

openDb({ filePath: dbPath });
console.log(`[ogf-daemon] db: ${dbPath}`);

const app = createServer();
app.listen(PORT, HOST, () => {
  console.log(`[ogf-daemon] listening on http://${HOST}:${PORT}`);
});
