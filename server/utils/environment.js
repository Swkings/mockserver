const PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function applyPathParams(path, params = {}) {
  if (!path) return '/';
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    const encoded = encodeURIComponent(String(value ?? ''));
    result = result.split(`:${key}`).join(encoded);
    result = result.split(`{${key}}`).join(encoded);
  }
  return result;
}

function joinUrl(host, path) {
  const base = String(host || '').replace(/\/$/, '');
  if (!base) return path || '/';
  const segment = path?.startsWith('/') ? path : `/${path || ''}`;
  return `${base}${segment}`;
}

function isFullUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function getActiveEnvironment(environments, activeEnvironmentId) {
  if (!environments?.length) return null;
  return environments.find((e) => e.id === activeEnvironmentId) || environments[0];
}

function applyQueryParams(url, queryParams = {}) {
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

export function resolveClientApiUrl(project, clientApi, overrideUrl) {
  const raw = overrideUrl || clientApi?.url || '/';
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
    const env = getActiveEnvironment(project.environments, project.activeEnvironmentId);
    const host = env?.host || 'http://localhost:8080';
    const resolvedPath = applyPathParams(raw.startsWith('/') ? raw : `/${raw}`, params);
    resolved = joinUrl(host, resolvedPath);
  }

  return applyQueryParams(resolved, queryParams);
}
