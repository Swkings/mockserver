const PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function parsePathParams(path) {
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

export function applyPathParams(path, params = {}) {
  if (!path) return '/';
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    const raw = String(value ?? '');
    const encoded = raw === '' || raw === `:${key}`
      ? `:${key}`
      : encodeURIComponent(raw);
    result = result.replaceAll(`:${key}`, encoded).replaceAll(`{${key}}`, encoded).replaceAll(`%7B${key}%7D`, encoded);
  }
  return result;
}

export function joinUrl(host, path) {
  const base = String(host || '').replace(/\/$/, '');
  if (!base) return path || '/';
  const segment = path?.startsWith('/') ? path : `/${path || ''}`;
  return `${base}${segment}`;
}

export function splitUrlToHostPath(fullUrl) {
  if (!fullUrl || !/^https?:\/\//i.test(fullUrl)) {
    return { host: '', path: fullUrl || '/' };
  }
  try {
    const u = new URL(fullUrl);
    return {
      host: `${u.protocol}//${u.host}`,
      path: `${u.pathname}${u.search}${u.hash}` || '/',
    };
  } catch {
    return { host: '', path: fullUrl };
  }
}

export function isFullUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

export function getActiveEnvironment(environments, activeEnvironmentId) {
  return environments?.find((env) => env.id === activeEnvironmentId) || null;
}

export function applyQueryParams(url, queryParams = {}) {
  const entries = Object.entries(queryParams || {}).filter(([key]) => key.trim());
  if (!entries.length) return url;

  try {
    const u = new URL(url);
    for (const [key, value] of entries) {
      u.searchParams.set(key.trim(), String(value ?? ''));
    }
    return u.toString();
  } catch {
    const qs = new URLSearchParams();
    for (const [key, value] of entries) qs.set(key.trim(), String(value ?? ''));
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${qs.toString()}`;
  }
}

export function resolveClientApiUrl({ environments, activeEnvironmentId, clientApi, serviceKey, nodePortEnabled }) {
  const env = getActiveEnvironment(environments, activeEnvironmentId);
  const direct = nodePortEnabled ? resolveNodePort(env, serviceKey) : null;
  if (nodePortEnabled && !direct) return '';
  const raw = clientApi?.url || '/';
  const params = clientApi?.pathParams || {};
  const queryParams = clientApi?.queryParams || {};

  let resolved;
  if (direct) {
    resolved = joinUrl(direct, applyPathParams(splitUrlToHostPath(raw).path, params));
  } else if (isFullUrl(raw)) {
    try {
      const u = new URL(raw);
      u.pathname = applyPathParams(u.pathname, params);
      resolved = u.toString();
    } catch {
      resolved = applyPathParams(raw, params);
    }
  } else {
    if (env && !env.host) return '';
    const host = env?.host || 'http://localhost:8080';
    const resolvedPath = applyPathParams(raw.startsWith('/') ? raw : `/${raw}`, params);
    resolved = joinUrl(host, resolvedPath);
  }

  return applyQueryParams(resolved, queryParams);
}

export function syncApiPathParams(clientApi) {
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

export function defaultEnvironments() {
  return [{ id: 'local', name: 'Local', host: 'http://localhost:8080', grpcTarget: 'http://127.0.0.1:50051' }];
}

export function resolveNodePort(environment, serviceKey, transport = 'http') {
  const nodePorts = environment?.nodePorts;
  const service = nodePorts && Object.hasOwn(nodePorts, serviceKey) ? nodePorts[serviceKey] : null;
  const endpoint = transport === 'grpc' ? service?.grpc || service : service;
  if (!endpoint?.ip || !Number.isInteger(Number(endpoint.port)) || endpoint.port < 1 || endpoint.port > 65535) return '';
  const ip = endpoint.ip.replace(/^\[|\]$/g, '');
  return `${endpoint.protocol === 'https' ? 'https' : 'http'}://${ip.includes(':') ? `[${ip}]` : ip}:${endpoint.port}`;
}

export function grpcTargetAuthority(value) {
  const target = String(value ?? '').trim();
  const schemeEnd = target.indexOf('://');
  return (schemeEnd < 0 ? target : target.slice(schemeEnd + 3)).split('/')[0];
}

export function resolveGrpcTarget({ environment, serviceKey, nodePortEnabled, item }) {
  if (nodePortEnabled) return resolveNodePort(environment, serviceKey, 'grpc');
  return (item.useEnvironment !== false && environment?.grpcTarget) || item.target || 'http://127.0.0.1:50051';
}

export function parseCookies(value = '') {
  return Object.fromEntries(String(value || '').split(';').map((part) => {
    const [name, ...valueParts] = part.trim().split('=');
    return [name.trim(), valueParts.join('=').trim()];
  }).filter(([name]) => name));
}

export function mergeHttpHeaders(...sources) {
  const values = new Map();
  for (const source of sources) {
    for (const [name, value] of Object.entries(source || {})) {
      const key = name.trim();
      if (key) values.set(key.toLowerCase(), [key, String(value ?? '')]);
    }
  }
  return Object.fromEntries(values.values());
}

export function resolveHttpHeaders({ environment, project, apiHeaders, inheritHeaders = true, inheritCookies = true }) {
  const headers = new Map();
  const cookies = new Map();
  const sources = [
    [inheritHeaders && environment?.headers, inheritCookies && !project.nodePortEnabled && environment?.cookies, inheritCookies && !project.nodePortEnabled],
    [inheritHeaders && project.clientHeaders, inheritCookies && project.clientCookies, inheritCookies],
    [apiHeaders, null, true],
  ];
  for (const [source, cookieFields, includeCookieHeader] of sources) {
    for (const [name, value] of Object.entries(source || {})) {
      const key = name.trim();
      if (!key) continue;
      if (key.toLowerCase() === 'cookie') {
        if (includeCookieHeader) {
          for (const [cookieName, cookieValue] of Object.entries(parseCookies(value))) cookies.set(cookieName, cookieValue);
        }
      } else {
        headers.set(key.toLowerCase(), [key, String(value ?? '')]);
      }
    }
    for (const [name, value] of Object.entries(cookieFields || {})) cookies.set(name, value);
  }
  if (cookies.size) {
    headers.set('cookie', ['Cookie', [...cookies].map(([name, value]) => `${name}=${value ?? ''}`).join('; ')]);
  }
  return Object.fromEntries(headers.values());
}

export function environmentNameKey(value) {
  return String(value ?? '').trim().normalize('NFC').toLowerCase();
}
