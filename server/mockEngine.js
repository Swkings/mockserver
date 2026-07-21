import express from 'express';
import http from 'node:http';
import { matchRequest, sortApis } from './matcher.js';

function renderBody(body, bodyText) {
  if (typeof body !== 'string') {
    return JSON.stringify(body);
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const messageTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const messageGroupSysId = `${Date.now()}${Math.floor(Math.random() * 1e10)}`;

  return body
    .replace(/\{\{robotTaskCode\}\}/g, () => {
      try {
        const parsed = JSON.parse(bodyText || '{}');
        return parsed.robotTaskCode || '';
      } catch {
        return '';
      }
    })
    .replace(/\{\{MESSAGE_TIME\}\}/g, messageTime)
    .replace(/\{\{MESSAGEGROUPSYSID\}\}/g, messageGroupSysId)
    .replace(/\{\{notifyNo\}\}/g, () => {
      try {
        const parsed = JSON.parse(bodyText || '{}');
        return parsed.notifyNo || messageGroupSysId;
      } catch {
        return messageGroupSysId;
      }
    });
}

export class MockEngine {
  constructor(store) {
    this.store = store;
    this.servers = new Map();
  }

  syncAll() {
    const activeIds = new Set(this.store.projects.filter((p) => p.enabled).map((p) => p.id));
    for (const id of this.servers.keys()) {
      if (!activeIds.has(id)) {
        this.stopProject(id);
      }
    }
    for (const project of this.store.projects) {
      if (project.enabled) {
        this.startProject(project);
      } else {
        this.stopProject(project.id);
      }
    }
  }

  startProject(project) {
    this.stopProject(project.id);
    const app = express();

    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    app.use(express.raw({ type: '*/*', limit: '10mb' }));

    app.all('*', async (req, res) => {
      const startedAt = Date.now();
      const bodyText = req.body?.length ? req.body.toString('utf8') : '';
      const current = this.store.getProject(project.id) || project;
      const apis = sortApis((current.apis || []).filter((a) => a.enabled));
      const matched = apis.find((api) => matchRequest(api, req, bodyText));

      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId: current.id,
        projectName: current.name,
        direction: 'inbound',
        protocol: 'http',
        timestamp: new Date().toISOString(),
        clientIp: req.socket?.remoteAddress || req.ip || '',
        method: req.method,
        path: req.path,
        url: `http://${req.headers.host || `${project.host === '0.0.0.0' ? 'localhost' : project.host}:${project.port}`}${req.originalUrl || req.url || req.path}`,
        query: req.query,
        headers: req.headers,
        body: bodyText,
        matchedApiId: matched?.id || null,
        matchedApiName: matched?.name || null,
      };

      if (!matched) {
        record.responseStatus = 404;
        record.responseHeaders = { 'Content-Type': 'application/json' };
        record.responseBody = JSON.stringify({ error: 'No matching mock API', path: req.path });
        record.durationMs = Date.now() - startedAt;
        this.store.addRequest(record);
        res.status(404).json({ error: 'No matching mock API', path: req.path });
        return;
      }

      const response = matched.response || {};
      const delayMs = Number(response.delayMs) || 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const status = Number(response.status) || 200;
      const headers = { ...(response.headers || {}) };
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }

      const rendered = renderBody(response.body ?? '', bodyText);
      record.responseStatus = status;
      record.responseHeaders = headers;
      record.responseBody = rendered;
      record.durationMs = Date.now() - startedAt;
      this.store.addRequest(record);

      if (headers['Content-Type']?.includes('json')) {
        try {
          res.status(status).json(JSON.parse(rendered));
          return;
        } catch {
          // fall through to send raw body
        }
      }
      res.status(status).send(rendered);
    });

    const server = http.createServer(app);
    server.listen(project.port, project.host, () => {
      console.log(`[mock] ${project.name} listening on http://${project.host}:${project.port}`);
    });
    server.on('error', (err) => {
      console.error(`[mock] failed to start ${project.name} on port ${project.port}:`, err.message);
    });

    this.servers.set(project.id, { server, project });
  }

  stopProject(projectId) {
    const entry = this.servers.get(projectId);
    if (!entry) return;
    entry.server.close();
    this.servers.delete(projectId);
    console.log(`[mock] stopped project ${entry.project.name}`);
  }

  restartProject(projectId) {
    const project = this.store.getProject(projectId);
    if (project?.enabled) {
      this.startProject(project);
    }
  }

  status() {
    return this.store.projects.map((p) => ({
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      enabled: p.enabled,
      running: this.servers.has(p.id),
    }));
  }
}
