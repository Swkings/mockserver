import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 3888;
const HEALTH_URL = `http://127.0.0.1:${CONTROL_PORT}/api/health`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return;
    } catch {
      // The server process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Server did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s: ${HEALTH_URL}`);
}

try {
  await waitForServer();
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
}

const vite = spawn(process.execPath, [
  path.join(ROOT, 'node_modules/vite/bin/vite.js'),
  '--config',
  path.join(__dirname, 'vite.config.js'),
], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => vite.kill(signal));
}

vite.on('error', (error) => {
  console.error(`[dev] Failed to start Vite: ${error.message}`);
  process.exit(1);
});

vite.on('exit', (code) => process.exit(code ?? 0));
