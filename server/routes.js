import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClientApiUrl } from './utils/environment.js';
import { getActiveEnvironment, mergeHttpHeaders, parseCookies, resolveHttpHeaders } from '../shared/environment.js';
import { Agent, EnvHttpProxyAgent } from 'undici';

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

function filterDisabledObject(obj = {}, disabledKeys = []) {
  const disabled = new Set(disabledKeys || []);
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (!disabled.has(key)) out[key] = value;
  }
  return out;
}

let directHttpAgent;
let insecureDirectHttpAgent;
let proxyHttpAgent;
let proxyEnvironmentKey;

function currentProxyEnvironmentKey() {
  return [
    process.env.HTTP_PROXY || "",
    process.env.HTTPS_PROXY || "",
    process.env.ALL_PROXY || "",
    process.env.NO_PROXY || "",
    process.env.http_proxy || "",
    process.env.https_proxy || "",
    process.env.all_proxy || "",
    process.env.no_proxy || "",
  ].join("\u0000");
}

function getHttpDispatcher(useProxy = false, insecureTls = false) {
  if (!useProxy) {
    if (insecureTls) {
      insecureDirectHttpAgent ||= new Agent({ connect: { rejectUnauthorized: false } });
      return insecureDirectHttpAgent;
    }
    directHttpAgent ||= new Agent();
    return directHttpAgent;
  }

  const environmentKey = currentProxyEnvironmentKey() + (insecureTls ? "-insecure" : "-secure");
  if (!proxyHttpAgent || proxyEnvironmentKey !== environmentKey) {
    proxyHttpAgent?.close().catch(() => {});
    proxyHttpAgent = new EnvHttpProxyAgent(insecureTls ? { requestTls: { rejectUnauthorized: false } } : {});
    proxyEnvironmentKey = environmentKey;
  }
  return proxyHttpAgent;
}

export function createRoutes(store, engine) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/environment-layout', (_req, res) => res.json(store.getEnvironmentLayout()));
  router.put('/environment-layout', (req, res) => {
    res.json(store.updateEnvironmentLayout(req.body.layout, req.body.revision));
  });
  router.get('/environments', (_req, res) => res.json(store.listEnvironments()));
  router.post('/environments', (req, res) => {
    res.json(store.upsertEnvironment({ ...req.body, id: undefined }));
  });
  router.put('/environments/:id', (req, res) => {
    res.json(store.upsertEnvironment({ ...req.body, id: req.params.id }));
  });
  router.delete('/environments/:id', (req, res) => {
    store.deleteEnvironment(req.params.id);
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

    const environmentId = req.body.activeEnvironmentId ?? project.activeEnvironmentId;
    const environment = environmentId ? getActiveEnvironment(store.environments, environmentId) : null;
    const connection = {
      ...project,
      environments: environment ? [environment] : [],
      activeEnvironmentId: environmentId,
      nodePortEnabled: req.body.nodePortEnabled ?? project.nodePortEnabled,
      clientHeaders: req.body.serviceHeaders ?? project.clientHeaders,
      clientCookies: req.body.serviceCookies ?? project.clientCookies,
    };
    const effectiveClientApi = {
      ...clientApi,
      url: req.body.path ?? clientApi.url,
      pathParams: req.body.path == null ? clientApi.pathParams : req.body.pathParams,
      queryParams: req.body.path == null
        ? filterDisabledObject(clientApi.queryParams, clientApi.disabledQueryParams)
        : req.body.queryParams,
    };
    const url = connection.nodePortEnabled
      ? resolveClientApiUrl(connection, effectiveClientApi, req.body.path == null ? req.body.url : undefined)
      : req.body.url || resolveClientApiUrl(connection, effectiveClientApi);
    if (environmentId && !environment) {
      res.status(400).json({ error: '所选环境不存在' });
      return;
    }
    if (!url) {
      const error = connection.nodePortEnabled ? '请为该服务配置 NodePort 地址' : '请为该环境配置服务网关地址';
      res.status(400).json({ error });
      return;
    }
    const method = (req.body.method || clientApi.method || 'POST').toUpperCase();
    let apiHeaders = req.body.apiHeaders;
    if (!apiHeaders) {
      const savedHeaders = filterDisabledObject(clientApi.headers, clientApi.disabledHeaders);
      const savedCookie = mergeHttpHeaders(savedHeaders);
      const cookieKey = Object.keys(savedCookie).find((key) => key.toLowerCase() === 'cookie');
      if (cookieKey) {
        const cookies = filterDisabledObject(parseCookies(savedCookie[cookieKey]), clientApi.disabledCookies);
        savedCookie[cookieKey] = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
      }
      apiHeaders = mergeHttpHeaders(savedCookie, req.body.headers);
    }
    const headers = resolveHttpHeaders({
      environment,
      project: connection,
      apiHeaders,
      inheritHeaders: req.body.useProjectHeaders ?? clientApi.useProjectHeaders !== false,
      inheritCookies: req.body.useProjectCookies ?? clientApi.useProjectCookies !== false,
    });
    const allowGetBody = req.body.allowGetBody ?? clientApi.allowGetBody === true;
    const body = req.body.body ?? clientApi.body ?? '';
    const bodyType = req.body.bodyType || clientApi.bodyType || 'text';
    const file = req.body.file;
    if (bodyType !== 'text' && (!file || !file.base64)) {
      res.status(400).json({ error: '请选择上传文件' });
      return;
    }
    if (file?.base64?.length > 35_000_000) {
      res.status(413).json({ error: '文件不能超过 25 MB' });
      return;
    }
    const hasBody = bodyType === 'text' ? body != null && String(body) !== '' : true;
    const shouldSendBody = method === 'GET' ? allowGetBody && hasBody : hasBody;
    let actualBody = shouldSendBody ? body : '';
    if (shouldSendBody && bodyType !== 'text') {
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.length > 25 * 1024 * 1024) {
        res.status(413).json({ error: '文件不能超过 25 MB' });
        return;
      }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-type' || key.toLowerCase() === 'content-length') delete headers[key];
      }
      if (bodyType === 'multipart') {
        const form = new FormData();
        if (String(body).trim()) {
          let fields;
          try { fields = JSON.parse(body); } catch {
            res.status(400).json({ error: 'multipart 附加字段必须是 JSON 对象' });
            return;
          }
          if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
            res.status(400).json({ error: 'multipart 附加字段必须是 JSON 对象' });
            return;
          }
          for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        form.append(req.body.fileFieldName || clientApi.fileFieldName || 'file', new Blob([bytes], { type: file.type || 'application/octet-stream' }), file.name || 'upload');
        actualBody = form;
      } else {
        actualBody = bytes;
        headers['Content-Type'] = file.type || 'application/octet-stream';
      }
    }

    const useProxy = !connection.nodePortEnabled && (req.body.proxy ?? clientApi.proxy) === true;
    const insecureTls = req.body.insecureTls === undefined ? clientApi.insecureTls === true : req.body.insecureTls === true;

    const started = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        dispatcher: getHttpDispatcher(useProxy, insecureTls),
        body: method === 'HEAD' ? undefined : (shouldSendBody ? actualBody : undefined),
      });
      const responseBytes = Buffer.from(await response.arrayBuffer());
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const contentType = response.headers.get('content-type') || '';
      const isDownload = Boolean(response.headers.get('content-disposition')) || (!/^(text\/|application\/(json|xml|javascript|.*\+json))/.test(contentType) && responseBytes.length > 0);
      const text = isDownload ? '' : responseBytes.toString('utf8');
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
        body: bodyType === 'text' ? String(actualBody) : `[file: ${file.name || 'upload'}, ${Buffer.from(file.base64, 'base64').length} bytes]`,
        responseStatus: response.status,
        responseHeaders,
        responseBody: isDownload ? `[file: ${responseBytes.length} bytes]` : text,
        durationMs: Date.now() - started,
        matchedApiId: clientApi.id,
        matchedApiName: clientApi.name,
      };
      store.addRequest(record);
      res.json({
        ok: response.ok,
        status: response.status,
        body: text,
        download: isDownload ? { base64: responseBytes.toString('base64'), contentType, contentDisposition: response.headers.get('content-disposition') || '' } : null,
        durationMs: record.durationMs,
      });
    } catch (err) {
      const errorCode = err.cause?.code;
      const errorMessage = errorCode ? err.message + " (" + errorCode + ")" : err.message;
      res.status(502).json({ error: errorMessage });
    }
  });

  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 400).json({ error: error.message });
  });

  return router;
}
