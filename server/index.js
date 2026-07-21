import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './store.js';
import { RuntimeEngine } from './runtimeEngine.js';
import { createRoutes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 3888;
const CLIENT_DIST = path.join(ROOT, 'dist');

const app = express();
const engine = new RuntimeEngine(store);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: ['application/x-yaml', 'text/yaml', 'text/plain'], limit: '10mb' }));

app.use('/api', createRoutes(store, engine));

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      'Mockserver API running. Start frontend with: npm run dev\nAPI base: /api'
    );
  });
}

store.subscribe((event) => {
  if (event === 'projects') {
    engine.syncAll();
  }
});

const configsDir = path.join(ROOT, 'configs');
if (store.projects.length === 0 && fs.existsSync(configsDir)) {
  const samples = fs.readdirSync(configsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (samples.length) {
    store.importFromFile(path.join(configsDir, samples[0]));
    console.log(`[mockserver] loaded sample config: ${samples[0]}`);
  }
}

engine.syncAll();

app.listen(CONTROL_PORT, () => {
  console.log(`[mockserver] control UI/API on http://localhost:${CONTROL_PORT}`);
});
