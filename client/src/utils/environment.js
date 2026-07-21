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
    const encoded = encodeURIComponent(String(value ?? ''));
    result = result.replaceAll(`:${key}`, encoded).replaceAll(`{${key}}`, encoded);
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
  if (!environments?.length) return null;
  return environments.find((e) => e.id === activeEnvironmentId) || environments[0];
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

export function resolveClientApiUrl({ environments, activeEnvironmentId, clientApi }) {
  const raw = clientApi?.url || '/';
  const params = clientApi?.pathParams || {};
  const queryParams = clientApi?.queryParams || {};

  let resolved;
  if (isFullUrl(raw)) {
    try {
      const u = new URL(raw);
      u.pathname = applyPathParams(u.pathname, params);
      resolved = u.toString();
    } catch {
      resolved = applyPathParams(raw, params);
    }
  } else {
    const env = getActiveEnvironment(environments, activeEnvironmentId);
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
  return [{ id: 'local', name: 'Local', host: 'http://localhost:8080', grpcTarget: 'localhost:50051' }];
}

export function migrateProjectEnvironments(project) {
  const environments = project.environments?.length
    ? project.environments
    : defaultEnvironments();

  if (!project.environments?.length) {
    const hosts = new Set();
    for (const clientApi of project.clientApis || []) {
      if (isFullUrl(clientApi.url)) {
        hosts.add(splitUrlToHostPath(clientApi.url).host);
      }
    }
    if (hosts.size === 1) {
      environments[0].host = [...hosts][0];
    } else if (hosts.size > 1) {
      let idx = 0;
      for (const host of hosts) {
        environments.push({
          id: `env-${idx += 1}`,
          name: `Env ${idx}`,
          host,
        });
      }
    }
  }

  const activeEnvironmentId = environments.some((e) => e.id === project.activeEnvironmentId)
    ? project.activeEnvironmentId
    : environments[0]?.id;

  const clientApis = (project.clientApis || []).map((clientApi) => {
    const next = { ...clientApi };
    if (isFullUrl(next.url)) {
      next.url = splitUrlToHostPath(next.url).path || '/';
    }
    syncApiPathParams(next);
    return next;
  });

  return {
    ...project,
    environments,
    activeEnvironmentId,
    clientApis,
  };
}
