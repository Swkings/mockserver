import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClientApiUrl } from './utils/environment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = path.resolve(__dirname, '../configs');

function formatExportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function cookieStringToObject(cookie = '') {
  const out = {};
  for (const part of String(cookie || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    const key = (idx < 0 ? trimmed : trimmed.slice(0, idx)).trim();
    if (!key) continue;
    out[key] = idx < 0 ? '' : trimmed.slice(idx + 1).trim();
  }
  return out;
}

function cookieObjectToString(cookies = {}) {
  return Object.entries(cookies || {})
    .filter(([key]) => key.trim())
    .map(([key, value]) => `${key.trim()}=${value ?? ''}`)
    .join('; ');
}


function filterDisabledObject(obj = {}, disabledKeys = []) {
  const disabled = new Set(disabledKeys || []);
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (!disabled.has(key)) out[key] = value;
  }
  return out;
}

function filterDisabledCookieString(cookie = '', disabledKeys = []) {
  return cookieObjectToString(filterDisabledObject(cookieStringToObject(cookie), disabledKeys));
}

function headersWithoutCookie(headers = {}) {
  const out = { ...(headers || {}) };
  delete out.Cookie;
  delete out.cookie;
  return out;
}

export function createRoutes(store, engine) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/projects', (_req, res) => {
    res.json(store.listProjects());
  });

  router.get('/projects/status', (_req, res) => {
    res.json(engine.status());
  });

  router.get('/projects/:id', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  });

  router.post('/projects', (req, res) => {
    const project = store.upsertProject(req.body);
    engine.syncAll();
    res.json(project);
  });

  router.put('/projects/:id', (req, res) => {
    const project = store.upsertProject({ ...req.body, id: req.params.id });
    engine.syncAll();
    res.json(project);
  });

  router.delete('/projects/:id', (req, res) => {
    engine.stopProject(req.params.id);
    store.deleteProject(req.params.id);
    res.json({ ok: true });
  });

  router.post('/projects/:id/restart', (req, res) => {
    engine.restartProject(req.params.id);
    res.json({ ok: true });
  });

  router.get('/requests', (req, res) => {
    const { projectId, limit, method, status, direction, apiId } = req.query;
    res.json(store.listRequests({
      projectId,
      limit: Number(limit) || 200,
      method,
      status,
      direction,
      apiId,
    }));
  });

  router.get('/requests/:id', (req, res) => {
    const record = store.getRequest(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    res.json(record);
  });

  router.delete('/requests', (req, res) => {
    store.clearRequests(req.query.projectId, req.query.apiId);
    res.json({ ok: true });
  });

  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event, payload) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    send('connected', { ok: true });
    const unsubscribe = store.subscribe((event, payload) => send(event, payload));
    req.on('close', () => unsubscribe());
  });

  router.get('/config/export', (_req, res) => {
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="mockserver-config-' + formatExportTimestamp() + '.yaml"');
    res.send(store.exportConfig());
  });

  router.get('/config/export/:projectId', (req, res) => {
    const raw = store.exportProject(req.params.projectId);
    if (!raw) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = store.getProject(req.params.projectId);
    const filename = (project.id || 'project') + '-' + formatExportTimestamp() + '.yaml';
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(raw);
  });

  router.post('/config/import', (req, res) => {
    const merge = req.query.merge === 'true';
    const projects = store.importConfig(req.body.raw || req.body, { merge });
    engine.syncAll();
    res.json({ projects });
  });

  router.get('/config/samples', (_req, res) => {
    const files = fs.existsSync(CONFIGS_DIR)
      ? fs.readdirSync(CONFIGS_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
      : [];
    res.json(files);
  });

  router.post('/config/samples/:file', (req, res) => {
    const filePath = path.join(CONFIGS_DIR, path.basename(req.params.file));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Sample config not found' });
      return;
    }
    const merge = req.query.merge !== 'false';
    const projects = store.importFromFile(filePath, { merge });
    engine.syncAll();
    res.json({ projects, file: req.params.file });
  });

  router.post('/grpc/inspect', (req, res) => {
    try {
      res.json({ services: engine.inspectGrpc(req.body || {}) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/grpc-clients/:projectId/:clientId/send', async (req, res) => {
    try {
      res.json(await engine.sendGrpcClient(req.params.projectId, req.params.clientId, req.body || {}));
    } catch (error) {
      const status = error.message === 'Project not found' || error.message === 'gRPC Client not found' ? 404 : 502;
      res.status(status).json({ error: error.details || error.message, grpcCode: error.grpcCode ?? error.code });
    }
  });

  router.post('/client-apis/:projectId/:apiId/send', async (req, res) => {
    const project = store.getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const clientApi = (project.clientApis || []).find((a) => a.id === req.params.apiId);
    if (!clientApi) {
      res.status(404).json({ error: 'API not found' });
      return;
    }

    const effectiveClientApi = {
      ...clientApi,
      queryParams: filterDisabledObject(clientApi.queryParams, clientApi.disabledQueryParams),
    };
    const url = req.body.url || resolveClientApiUrl(project, effectiveClientApi);
    const method = (req.body.method || clientApi.method || 'POST').toUpperCase();
    const useProjectHeaders = req.body.useProjectHeaders ?? clientApi.useProjectHeaders !== false;
    const useProjectCookies = req.body.useProjectCookies ?? clientApi.useProjectCookies !== false;
    const apiHeaders = filterDisabledObject(headersWithoutCookie(clientApi.headers || {}), clientApi.disabledHeaders);
    const requestHeaders = headersWithoutCookie(req.body.headers || {});
    const sourceCookieHeader = req.body.headers?.Cookie ?? req.body.headers?.cookie ?? clientApi.headers?.Cookie ?? clientApi.headers?.cookie ?? '';
    const cookieHeader = req.body.headers ? sourceCookieHeader : filterDisabledCookieString(sourceCookieHeader, clientApi.disabledCookies);
    const cookies = {
      ...(useProjectCookies ? (project.clientCookies || {}) : {}),
      ...cookieStringToObject(cookieHeader),
    };
    const cookieString = cookieObjectToString(cookies);
    const headers = {
      ...(useProjectHeaders ? (project.clientHeaders || {}) : {}),
      ...apiHeaders,
      ...requestHeaders,
      ...(cookieString ? { Cookie: cookieString } : {}),
    };
    const allowGetBody = req.body.allowGetBody ?? clientApi.allowGetBody === true;
    const body = req.body.body ?? clientApi.body ?? '';
    const hasBody = body != null && String(body) !== '';
    const shouldSendBody = method === 'GET' ? allowGetBody && hasBody : hasBody;
    const actualBody = shouldSendBody ? body : '';

    const started = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'HEAD' ? undefined : (shouldSendBody ? body : undefined),
      });
      const text = await response.text();
      const record = {
        id: `${Date.now()}-client-${Math.random().toString(36).slice(2, 8)}`,
        projectId: project.id,
        projectName: project.name,
        timestamp: new Date().toISOString(),
        direction: 'outbound',
        protocol: 'http',
        method,
        path: url,
        url,
        headers,
        body: typeof actualBody === 'string' ? actualBody : JSON.stringify(actualBody),
        responseStatus: response.status,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseBody: text,
        durationMs: Date.now() - started,
        matchedApiId: clientApi.id,
        matchedApiName: clientApi.name,
      };
      store.addRequest(record);
      res.json({
        ok: response.ok,
        status: response.status,
        body: text,
        durationMs: record.durationMs,
      });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
