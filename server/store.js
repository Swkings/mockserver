import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';

const PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function isFullUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function splitUrlToHostPath(fullUrl) {
  try {
    const u = new URL(fullUrl);
    return {
      host: `${u.protocol}//${u.host}`,
      path: `${u.pathname}${u.search}${u.hash}` || '/',
    };
  } catch {
    return { host: '', path: fullUrl || '/' };
  }
}

function parsePathParams(path) {
  if (!path) return [];
  const names = new Set();
  let match = PARAM_RE.exec(path);
  while (match) {
    names.add(match[1] || match[2]);
    match = PARAM_RE.exec(path);
  }
  PARAM_RE.lastIndex = 0;
  return [...names];
}

function syncApiPathParams(clientApi) {
  const names = parsePathParams(clientApi.url);
  if (!names.length) {
    clientApi.pathParams = undefined;
    clientApi.pathParamDescriptions = undefined;
    return;
  }
  const params = { ...(clientApi.pathParams || {}) };
  const descriptions = { ...(clientApi.pathParamDescriptions || {}) };
  for (const name of names) {
    if (!(name in params)) params[name] = '';
  }
  for (const key of Object.keys(params)) {
    if (!names.includes(key)) delete params[key];
  }
  for (const key of Object.keys(descriptions)) {
    if (!names.includes(key)) delete descriptions[key];
  }
  clientApi.pathParams = params;
  clientApi.pathParamDescriptions = Object.keys(descriptions).length ? descriptions : undefined;
}

function normalizeParamDescriptions(descs) {
  if (!descs || typeof descs !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(descs)) {
    if (key.trim() && String(value ?? '').trim()) out[key.trim()] = String(value).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function defaultEnvironments() {
  return [{ id: 'local', name: 'Local', host: 'http://localhost:8080', grpcTarget: 'localhost:50051' }];
}

function normalizeEnvironments(project) {
  let environments = (project.environments || []).map((env) => ({
    id: env.id || uuidv4(),
    name: env.name || 'Environment',
    host: env.host || 'http://localhost:8080',
    grpcTarget: env.grpcTarget || undefined,
  }));

  if (!environments.length) {
    environments = defaultEnvironments();
    const hosts = new Set();
    for (const clientApi of getProjectClientApis(project)) {
      if (isFullUrl(clientApi.url)) hosts.add(splitUrlToHostPath(clientApi.url).host);
    }
    if (hosts.size === 1) {
      environments[0].host = [...hosts][0];
    }
  }

  const activeEnvironmentId = environments.some((e) => e.id === project.activeEnvironmentId)
    ? project.activeEnvironmentId
    : environments[0].id;

  return { environments, activeEnvironmentId };
}

function normalizeClientHeaders(headers) {
  if (!headers || typeof headers !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.trim()) out[key.trim()] = String(value ?? '');
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeFolders(folders) {
  if (!Array.isArray(folders)) return [];
  const normalized = folders.map((folder) => ({
    id: folder.id || uuidv4(),
    name: folder.name || 'Untitled Folder',
    parentId: folder.parentId || undefined,
  }));
  const ids = new Set(normalized.map((folder) => folder.id));
  return normalized.map((folder) => ({
    ...folder,
    parentId: ids.has(folder.parentId) ? folder.parentId : undefined,
  }));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'projects.yaml');
const BACKUP_FILE = path.join(DATA_DIR, 'projects.yaml.bak');
const TEMP_CONFIG_FILE = path.join(DATA_DIR, 'projects.yaml.tmp');

const MAX_HISTORY = 500;
// Keep persisted configs readable; normalized saves emit only the API field names.
const LEGACY_CLIENT_APIS_KEY = 'client' + 'Actions';
const LEGACY_CLIENT_API_FOLDERS_KEY = 'action' + 'Folders';

function getProjectClientApis(project) {
  return project.clientApis || project[LEGACY_CLIENT_APIS_KEY] || [];
}

function getProjectClientApiFolders(project) {
  return project.clientApiFolders || project[LEGACY_CLIENT_API_FOLDERS_KEY] || [];
}

function countProjectClientApis(projects) {
  return (projects || []).reduce((count, project) => count + getProjectClientApis(project).length, 0);
}

function preserveRenamedFields(project, existing) {
  if (!existing) return project;
  const next = { ...project };
  const hasClientApis = Object.hasOwn(next, 'clientApis');
  const legacyClientApis = next[LEGACY_CLIENT_APIS_KEY];
  if (!hasClientApis && (!Array.isArray(legacyClientApis) || legacyClientApis.length === 0)) {
    next.clientApis = existing.clientApis;
  }

  const hasClientApiFolders = Object.hasOwn(next, 'clientApiFolders');
  const legacyClientApiFolders = next[LEGACY_CLIENT_API_FOLDERS_KEY];
  if (!hasClientApiFolders && (!Array.isArray(legacyClientApiFolders) || legacyClientApiFolders.length === 0)) {
    next.clientApiFolders = existing.clientApiFolders;
  }
  return next;
}

export class Store {
  constructor() {
    this.projects = [];
    this.requestHistory = [];
    this.listeners = new Set();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.load();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(event, payload) {
    for (const fn of this.listeners) {
      fn(event, payload);
    }
  }

  load() {
    if (!fs.existsSync(CONFIG_FILE)) {
      this.projects = [];
      return;
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const data = yaml.load(raw) || {};
    this.projects = (data.projects || []).map((p) => this.normalizeProject(p));
  }

  save() {
    const payload = {
      projects: this.projects,
    };
    const raw = yaml.dump(payload, { lineWidth: 120 });
    if (fs.existsSync(CONFIG_FILE)) {
      const currentRaw = fs.readFileSync(CONFIG_FILE, 'utf8');
      try {
        const current = yaml.load(currentRaw) || {};
        const currentCount = countProjectClientApis(current.projects);
        const nextCount = countProjectClientApis(payload.projects);
        if (!fs.existsSync(BACKUP_FILE) || currentCount > nextCount) {
          fs.copyFileSync(CONFIG_FILE, BACKUP_FILE);
        }
      } catch {
        if (!fs.existsSync(BACKUP_FILE)) fs.copyFileSync(CONFIG_FILE, BACKUP_FILE);
      }
    }
    fs.writeFileSync(TEMP_CONFIG_FILE, raw, 'utf8');
    fs.renameSync(TEMP_CONFIG_FILE, CONFIG_FILE);
  }

  normalizeProject(project) {
    const { environments, activeEnvironmentId } = normalizeEnvironments(project);
    return {
      id: project.id || uuidv4(),
      name: project.name || 'Untitled Project',
      host: project.host || '0.0.0.0',
      port: Number(project.port) || 3900,
      enabled: project.enabled !== false,
      grpcHost: project.grpcHost || project.host || '0.0.0.0',
      grpcPort: Number(project.grpcPort) || 50051,
      grpcEnabled: project.grpcEnabled === true,
      description: project.description || '',
      environments,
      activeEnvironmentId,
      clientHeaders: normalizeClientHeaders(project.clientHeaders),
      clientCookies: normalizeClientHeaders(project.clientCookies),
      apiFolders: normalizeFolders(project.apiFolders),
      clientApiFolders: normalizeFolders(getProjectClientApiFolders(project)),
      grpcMockFolders: normalizeFolders(project.grpcMockFolders),
      grpcClientFolders: normalizeFolders(project.grpcClientFolders),
      apis: (project.apis || []).map((api) => this.normalizeApi(api)),
      clientApis: getProjectClientApis(project).map((clientApi) => this.normalizeClientApi(clientApi)),
      grpcMocks: (project.grpcMocks || []).map((item) => this.normalizeGrpcMock(item)),
      grpcClients: (project.grpcClients || []).map((item) => this.normalizeGrpcClient(item)),
    };
  }

  normalizeApi(api) {
    return {
      id: api.id || uuidv4(),
      name: api.name || 'Untitled API',
      enabled: api.enabled !== false,
      priority: Number(api.priority) || 0,
      match: api.match || { method: 'GET', path: '/' },
      folderId: api.folderId || undefined,
      response: {
        status: api.response?.status ?? 200,
        headers: api.response?.headers || { 'Content-Type': 'application/json' },
        body: api.response?.body ?? '',
        delayMs: Number(api.response?.delayMs) || 0,
      },
    };
  }

  normalizeClientApi(clientApi) {
    let url = clientApi.url || '/';
    if (isFullUrl(url)) {
      url = splitUrlToHostPath(url).path || '/';
    }
    const normalized = {
      id: clientApi.id || uuidv4(),
      name: clientApi.name || 'Untitled API',
      method: (clientApi.method || 'POST').toUpperCase(),
      url,
      headers: clientApi.headers || { 'Content-Type': 'application/json' },
      useProjectHeaders: clientApi.useProjectHeaders !== false,
      useProjectCookies: clientApi.useProjectCookies !== false,
      body: clientApi.body ?? '',
      allowGetBody: clientApi.allowGetBody === true,
      description: clientApi.description || '',
      folderId: clientApi.folderId || undefined,
      pathParams: clientApi.pathParams || undefined,
      pathParamDescriptions: normalizeParamDescriptions(clientApi.pathParamDescriptions),
      queryParams: clientApi.queryParams || undefined,
      disabledHeaders: Array.isArray(clientApi.disabledHeaders) ? clientApi.disabledHeaders : undefined,
      disabledCookies: Array.isArray(clientApi.disabledCookies) ? clientApi.disabledCookies : undefined,
      disabledQueryParams: Array.isArray(clientApi.disabledQueryParams) ? clientApi.disabledQueryParams : undefined,
      queryParamDescriptions: normalizeParamDescriptions(clientApi.queryParamDescriptions),
    };
    syncApiPathParams(normalized);
    return normalized;
  }

  normalizeGrpcMock(item) {
    return {
      id: item.id || uuidv4(),
      name: item.name || 'New gRPC Mock',
      enabled: item.enabled !== false,
      proto: item.proto || '',
      protoFilename: item.protoFilename || 'service.proto',
      packageName: item.packageName || '',
      serviceName: item.serviceName || '',
      methodName: item.methodName || '',
      response: item.response ?? '{}',
      delayMs: Number(item.delayMs) || 0,
      errorCode: item.errorCode === '' || item.errorCode == null ? undefined : Number(item.errorCode),
      errorMessage: item.errorMessage || '',
      description: item.description || '',
      folderId: item.folderId || undefined,
    };
  }

  normalizeGrpcClient(item) {
    return {
      id: item.id || uuidv4(),
      name: item.name || 'New gRPC Client',
      target: item.target || 'localhost:50051',
      useEnvironment: item.useEnvironment !== false,
      proto: item.proto || '',
      protoFilename: item.protoFilename || 'service.proto',
      packageName: item.packageName || '',
      serviceName: item.serviceName || '',
      methodName: item.methodName || '',
      request: item.request ?? '{}',
      metadata: normalizeClientHeaders(item.metadata),
      timeoutMs: Number(item.timeoutMs) || 10000,
      useTls: item.useTls === true,
      description: item.description || '',
      folderId: item.folderId || undefined,
    };
  }

  exportProject(id) {
    const project = this.getProject(id);
    if (!project) return null;
    return yaml.dump({ projects: [project] }, { lineWidth: 120 });
  }

  listProjects() {
    return this.projects;
  }

  getProject(id) {
    return this.projects.find((p) => p.id === id);
  }

  upsertProject(project) {
    const existing = this.projects.find((item) => item.id === project.id);
    const normalized = this.normalizeProject(preserveRenamedFields(project, existing));
    const idx = this.projects.findIndex((p) => p.id === normalized.id);
    if (idx >= 0) {
      this.projects[idx] = normalized;
    } else {
      this.projects.push(normalized);
    }
    this.save();
    this.notify('projects', this.projects);
    return normalized;
  }

  deleteProject(id) {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.save();
    this.notify('projects', this.projects);
  }

  addRequest(record) {
    this.requestHistory.unshift(record);
    if (this.requestHistory.length > MAX_HISTORY) {
      this.requestHistory.length = MAX_HISTORY;
    }
    this.notify('request', record);
  }

  listRequests({ projectId, limit = 100, method, status, direction, apiId } = {}) {
    let rows = this.requestHistory;
    if (projectId) {
      rows = rows.filter((r) => r.projectId === projectId);
    }
    if (apiId) {
      rows = rows.filter((r) => r.matchedApiId === apiId);
    }
    if (method) {
      rows = rows.filter((r) => r.method?.toUpperCase() === method.toUpperCase());
    }
    if (status) {
      const code = Number(status);
      rows = rows.filter((r) => Number(r.responseStatus) === code);
    }
    if (direction) {
      rows = rows.filter((r) => (r.direction || 'inbound') === direction);
    }
    return rows.slice(0, limit);
  }

  getRequest(id) {
    return this.requestHistory.find((r) => r.id === id) || null;
  }

  clearRequests(projectId, apiId) {
    if (apiId) {
      this.requestHistory = this.requestHistory.filter(
        (r) => !(r.projectId === projectId && r.matchedApiId === apiId)
      );
    } else if (projectId) {
      this.requestHistory = this.requestHistory.filter((r) => r.projectId !== projectId);
    } else {
      this.requestHistory = [];
    }
    this.notify('requests_cleared', { projectId, apiId });
  }

  exportConfig() {
    return yaml.dump({ projects: this.projects }, { lineWidth: 120 });
  }

  importConfig(raw, { merge = false } = {}) {
    const data = typeof raw === 'string' ? yaml.load(raw) : raw;
    const incoming = (data?.projects || []).map((p) => this.normalizeProject(p));
    if (merge) {
      for (const project of incoming) {
        const idx = this.projects.findIndex((p) => p.id === project.id);
        if (idx >= 0) {
          this.projects[idx] = project;
        } else {
          this.projects.push(project);
        }
      }
    } else {
      this.projects = incoming;
    }
    this.save();
    this.notify('projects', this.projects);
    return this.projects;
  }

  importFromFile(filePath, { merge = true } = {}) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return this.importConfig(raw, { merge });
  }
}

export const store = new Store();
