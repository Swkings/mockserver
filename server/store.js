import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import { normalizeBodyPresets } from './utils/bodyPresets.js';
import { normalizeProjectGrpcProtos } from './utils/grpcProtos.js';

import { mergeEnvironmentLayouts, normalizeEnvironmentLayout } from '../shared/environmentLayout.js';
import { defaultEnvironments, environmentNameKey, isFullUrl, splitUrlToHostPath, syncApiPathParams } from '../shared/environment.js';

function normalizeParamDescriptions(descs) {
  if (!descs || typeof descs !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(descs)) {
    if (key.trim() && String(value ?? '').trim()) out[key.trim()] = String(value).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeClientHeaders(headers) {
  const entries = Object.entries(headers || {}).filter(([key]) => key.trim());
  return entries.length ? Object.fromEntries(entries.map(([key, value]) => [key.trim(), String(value ?? '')])) : undefined;
}

function normalizeNodePort(endpoint, serviceKey, transport) {
  const ip = String(endpoint?.ip || '').trim().replace(/^\[|\]$/g, '');
  const rawPort = String(endpoint?.port ?? '').trim();
  if (!ip && !rawPort) return null;
  const port = Number(rawPort);
  if (!ip || (isIP(ip) === 0 && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(ip))
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`服务 ${serviceKey} 的 ${transport} NodePort 需要有效的 IP 或主机名，以及 1–65535 的端口`);
  }
  return { ip, port, protocol: endpoint.protocol === 'https' ? 'https' : 'http' };
}

function normalizeEnvironment(input) {
  const name = String(input.name || '').trim();
  const host = String(input.host || '').trim().replace(/\/$/, '');
  const grpcTarget = String(input.grpcTarget || '').trim();
  if (!name) throw new Error('请输入环境名称');
  if (host) {
    const url = URL.canParse(host) && new URL(host);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('服务网关地址必须为有效的 http:// 或 https:// 地址');
    }
  }
  const nodePorts = Object.entries(input.nodePorts || {}).flatMap(([key, endpoint]) => {
    const http = normalizeNodePort(endpoint, key, 'HTTP');
    const grpc = normalizeNodePort(endpoint?.grpc, key, 'gRPC');
    if (!http && !grpc) return [];
    return [[key, grpc ? { ...http, grpc } : http]];
  });
  return {
    id: input.id || uuidv4(), name, host, grpcTarget,
    headers: normalizeClientHeaders(input.headers),
    cookies: normalizeClientHeaders(input.cookies),
    nodePorts: Object.fromEntries(nodePorts),
  };
}

function assertUniqueEnvironmentNames(environments) {
  const names = new Set();
  for (const { name } of environments) {
    const key = environmentNameKey(name);
    if (names.has(key)) {
      const error = new Error(`环境名称「${name}」已存在`);
      error.status = 409;
      throw error;
    }
    names.add(key);
  }
}

function legacyEnvironments(project) {
  if (project.environments?.length) return project.environments;
  if (Object.hasOwn(project, 'activeEnvironmentId') || project.serviceKey) return [];
  const hosts = new Set(getProjectClientApis(project).filter((api) => isFullUrl(api.url)).map((api) => splitUrlToHostPath(api.url).host));
  if (hosts.size !== 1) return [];
  const host = [...hosts][0];
  if (!URL.canParse(host)) return [];
  return [{ id: `${project.id || 'legacy'}-environment`, name: new URL(host).hostname, host }];
}

function bringLegacyEnvironments(project, environments) {
  const legacy = legacyEnvironments(project);
  if (!legacy.length) return project;
  const selected = legacy.find((env) => env.id === project.activeEnvironmentId) || legacy[0];
  let activeEnvironmentId;
  for (const source of legacy) {
    const candidate = normalizeEnvironment({ ...source, name: source.name || 'Environment', host: source.host || 'http://localhost:8080' });
    const existing = environments.find((env) => env.name === candidate.name && env.host === candidate.host
      && env.grpcTarget === candidate.grpcTarget
      && JSON.stringify(env.headers) === JSON.stringify(candidate.headers)
      && JSON.stringify(env.cookies) === JSON.stringify(candidate.cookies)
      && JSON.stringify(env.nodePorts) === JSON.stringify(candidate.nodePorts));
    if (!existing) {
      const baseId = `${candidate.id}-${project.id || 'legacy'}`;
      for (let suffix = 1; environments.some((env) => env.id === candidate.id); suffix++) {
        candidate.id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
      }
      environments.push(candidate);
    }
    if (selected === source) activeEnvironmentId = existing?.id || candidate.id;
  }
  return { ...project, activeEnvironmentId };
}

function defaultServiceKey(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '') || uuidv4();
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
  constructor(dataDir = process.env.MOCKSERVER_DATA_DIR || DATA_DIR) {
    this.configFile = path.join(dataDir, 'projects.yaml');
    this.backupFile = path.join(dataDir, 'projects.yaml.bak');
    this.tempConfigFile = path.join(dataDir, 'projects.yaml.tmp');
    this.projects = [];
    this.environments = defaultEnvironments().map(normalizeEnvironment);
    this.environmentLayout = [];
    this.requestHistory = [];
    this.listeners = new Set();
    fs.mkdirSync(dataDir, { recursive: true });
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
    if (!fs.existsSync(this.configFile)) {
      this.projects = [];
      return;
    }
    const raw = fs.readFileSync(this.configFile, 'utf8');
    const data = yaml.load(raw) || {};
    const { projects, environments, environmentLayout } = this.prepareConfig(data, false);
    this.projects = projects;
    this.environments = environments;
    this.environmentLayout = environmentLayout;
  }

  save() {
    this.environmentLayout = normalizeEnvironmentLayout(this.environmentLayout, this.environments);
    const payload = {
      environmentLayout: this.environmentLayout,
      environments: this.environments,
      projects: this.projects,
    };
    const raw = yaml.dump(payload, { lineWidth: 120 });
    if (fs.existsSync(this.configFile)) {
      const currentRaw = fs.readFileSync(this.configFile, 'utf8');
      try {
        const current = yaml.load(currentRaw) || {};
        const currentCount = countProjectClientApis(current.projects);
        const nextCount = countProjectClientApis(payload.projects);
        if (!fs.existsSync(this.backupFile) || currentCount > nextCount) {
          fs.copyFileSync(this.configFile, this.backupFile);
        }
      } catch {
        if (!fs.existsSync(this.backupFile)) fs.copyFileSync(this.configFile, this.backupFile);
      }
    }
    fs.writeFileSync(this.tempConfigFile, raw, 'utf8');
    fs.renameSync(this.tempConfigFile, this.configFile);
  }

  normalizeProject(project) {
    const id = project.id || uuidv4();
    const serviceKey = String(project.serviceKey || '').trim() || defaultServiceKey(id);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(serviceKey)) {
      throw new Error('服务 Key 支持小写字母、数字、连字符和下划线，须以字母或数字开头');
    }
    const grpc = normalizeProjectGrpcProtos(project);
    return {
      id,
      serviceKey,
      name: project.name || 'Untitled Project',
      host: project.host || '0.0.0.0',
      port: Number(project.port) || 3900,
      enabled: project.enabled !== false,
      grpcHost: project.grpcHost || project.host || '0.0.0.0',
      grpcPort: Number(project.grpcPort) || 50051,
      grpcEnabled: project.grpcEnabled === true,
      description: project.description || '',
      activeEnvironmentId: project.activeEnvironmentId || undefined,
      nodePortEnabled: project.nodePortEnabled === true,
      clientHeaders: normalizeClientHeaders(project.clientHeaders),
      clientCookies: normalizeClientHeaders(project.clientCookies),
      apiFolders: normalizeFolders(project.apiFolders),
      clientApiFolders: normalizeFolders(getProjectClientApiFolders(project)),
      grpcMockFolders: normalizeFolders(project.grpcMockFolders),
      grpcClientFolders: normalizeFolders(project.grpcClientFolders),
      protos: grpc.protos,
      apis: (project.apis || []).map((api) => this.normalizeApi(api)),
      clientApis: getProjectClientApis(project).map((clientApi) => this.normalizeClientApi(clientApi)),
      grpcMocks: grpc.grpcMocks.map((item) => this.normalizeGrpcMock(item)),
      grpcClients: grpc.grpcClients.map((item) => this.normalizeGrpcClient(item)),
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
      bodyPresets: normalizeBodyPresets(api.bodyPresets),
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
      proxy: clientApi.proxy === true,
      insecureTls: clientApi.insecureTls === true,
      body: clientApi.body ?? '',
      bodyType: ['text', 'multipart', 'binary'].includes(clientApi.bodyType) ? clientApi.bodyType : 'text',
      fileFieldName: clientApi.fileFieldName || 'file',
      bodyPresets: normalizeBodyPresets(clientApi.bodyPresets),
      requestSchemaLanguage: clientApi.requestSchemaLanguage || undefined,
      requestSchemaSource: clientApi.requestSchemaSource || undefined,
      requestSchemaRoot: clientApi.requestSchemaRoot || undefined,
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
      protoId: item.protoId || undefined,
      packageName: item.packageName || '',
      serviceName: item.serviceName || '',
      methodName: item.methodName || '',
      response: item.response ?? '{}',
      bodyPresets: normalizeBodyPresets(item.bodyPresets),
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
      target: item.target || 'http://127.0.0.1:50051',
      useEnvironment: item.useEnvironment !== false,
      protoId: item.protoId || undefined,
      packageName: item.packageName || '',
      serviceName: item.serviceName || '',
      methodName: item.methodName || '',
      request: item.request ?? '{}',
      bodyPresets: normalizeBodyPresets(item.bodyPresets),
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
    const environments = this.environments.filter((env) => env.id === project.activeEnvironmentId)
      .map((env) => ({ ...env, nodePorts: Object.fromEntries(Object.entries(env.nodePorts).filter(([key]) => key === project.serviceKey)) }));
    return yaml.dump({ environments, projects: [project] }, { lineWidth: 120 });
  }

  listProjects() {
    return this.projects;
  }

  getProject(id) {
    return this.projects.find((p) => p.id === id);
  }

  upsertProject(project) {
    const existing = this.projects.find((item) => item.id === project.id);
    const environments = [...this.environments];
    const input = preserveRenamedFields(existing ? {
      activeEnvironmentId: existing.activeEnvironmentId,
      serviceKey: existing.serviceKey,
      nodePortEnabled: existing.nodePortEnabled,
      ...project,
    } : project, existing);
    const normalized = this.normalizeProject(bringLegacyEnvironments(input, environments));
    assertUniqueEnvironmentNames(environments);
    if (normalized.activeEnvironmentId && !environments.some((env) => env.id === normalized.activeEnvironmentId)) {
      throw new Error('所选环境不存在');
    }
    if (this.projects.some((item) => item.id !== normalized.id && item.serviceKey === normalized.serviceKey)) {
      throw new Error('服务 Key 已被其他项目使用');
    }
    const idx = this.projects.findIndex((p) => p.id === normalized.id);
    if (idx < 0) this.projects.push(normalized);
    else this.projects[idx] = normalized;
    this.environments = environments;
    if (existing && existing.serviceKey !== normalized.serviceKey) {
      this.environments = this.environments.map((env) => {
        if (!Object.hasOwn(env.nodePorts, existing.serviceKey)) return env;
        const { [existing.serviceKey]: endpoint, ...others } = env.nodePorts;
        return { ...env, nodePorts: { ...others, [normalized.serviceKey]: endpoint } };
      });
    }
    this.save();
    this.notify('projects', this.projects);
    return normalized;
  }

  deleteProject(id) {
    const serviceKey = this.getProject(id)?.serviceKey;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (serviceKey) {
      this.environments = this.environments.map((env) => {
        const nodePorts = { ...env.nodePorts };
        delete nodePorts[serviceKey];
        return { ...env, nodePorts };
      });
    }
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

  listEnvironments() {
    return this.environments.map((env) => ({
      ...env,
      nodePorts: Object.fromEntries(this.projects.map(({ serviceKey }) => [
        serviceKey, Object.hasOwn(env.nodePorts, serviceKey) ? env.nodePorts[serviceKey] : { ip: '', port: '', protocol: 'http' },
      ])),
    }));
  }

  getEnvironmentLayout() {
    const layout = normalizeEnvironmentLayout(this.environmentLayout, this.environments);
    const revision = createHash('sha256').update(JSON.stringify(layout)).digest('hex');
    return { layout, revision };
  }

  updateEnvironmentLayout(layout, revision) {
    if (this.getEnvironmentLayout().revision !== revision) {
      const error = new Error('环境列表已更新，请重试');
      error.status = 409;
      throw error;
    }
    this.environmentLayout = normalizeEnvironmentLayout(layout, this.environments, { strict: true });
    this.save();
    this.notify('environments', null);
    return this.getEnvironmentLayout();
  }

  upsertEnvironment(input) {
    const environment = normalizeEnvironment(input);
    assertUniqueEnvironmentNames([...this.environments.filter((item) => item.id !== environment.id), environment]);
    const activeKeys = new Set(this.projects.map((project) => project.serviceKey));
    environment.nodePorts = Object.fromEntries(Object.entries(environment.nodePorts).filter(([key]) => activeKeys.has(key)));
    const idx = this.environments.findIndex((entry) => entry.id === environment.id);
    if (idx < 0) this.environments.push(environment);
    else this.environments[idx] = environment;
    this.save();
    this.notify('environments', null);
    return environment;
  }

  deleteEnvironment(id) {
    if (this.projects.some((project) => project.activeEnvironmentId === id)) {
      throw new Error('该环境仍被项目使用，请先切换这些项目的环境');
    }
    this.environments = this.environments.filter((env) => env.id !== id);
    this.save();
    this.notify('environments', null);
  }

  exportConfig() {
    return yaml.dump({ environments: this.environments, environmentLayout: this.getEnvironmentLayout().layout, projects: this.projects }, { lineWidth: 120 });
  }

  prepareConfig(data, merge) {
    const projects = new Map((merge ? this.projects : []).map((project) => [project.id, project]));
    const environments = merge ? [...this.environments] : [];
    for (const source of data?.environments ?? defaultEnvironments()) {
      const env = normalizeEnvironment(source);
      const idx = environments.findIndex((entry) => entry.id === env.id);
      if (idx < 0) environments.push(env);
      else if (data?.environments) {
        environments[idx] = { ...env, nodePorts: { ...environments[idx].nodePorts, ...env.nodePorts } };
      }
    }
    for (const source of data?.projects || []) {
      const project = this.normalizeProject(bringLegacyEnvironments(source, environments));
      const existing = [...projects.values()].find((item) => item.id !== project.id && item.serviceKey === project.serviceKey);
      if (existing) {
        if (source.serviceKey) throw new Error(`服务 Key 已被使用：${project.serviceKey}`);
        project.serviceKey = `${project.serviceKey}-${uuidv4().slice(0, 8)}`;
      }
      if (project.activeEnvironmentId && !environments.some((env) => env.id === project.activeEnvironmentId)) {
        throw new Error(`项目 ${project.name} 引用了不存在的环境`);
      }
      projects.set(project.id, project);
    }
    assertUniqueEnvironmentNames(environments);
    const incomingLayout = normalizeEnvironmentLayout(data?.environmentLayout || [], environments, { appendMissing: false });
    const environmentLayout = normalizeEnvironmentLayout(
      merge ? mergeEnvironmentLayouts(this.environmentLayout, incomingLayout) : incomingLayout,
      environments,
    );
    return { environments, environmentLayout, projects: [...projects.values()] };
  }

  importConfig(raw, { merge = false } = {}) {
    const data = typeof raw === 'string' ? yaml.load(raw) : raw;
    const { projects, environments, environmentLayout } = this.prepareConfig(data, merge);
    this.environments = environments;
    this.environmentLayout = environmentLayout;
    this.projects = projects;
    this.save();
    this.notify('projects', this.projects);
    this.notify('environments', null);
    return this.projects;
  }

  importFromFile(filePath, { merge = true } = {}) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return this.importConfig(raw, { merge });
  }
}

export const store = new Store();
