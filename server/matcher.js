function normalizePath(path) {
  if (!path) return '/';
  const p = path.split('?')[0];
  return p.startsWith('/') ? p : `/${p}`;
}

function templatePathRegex(path) {
  const parts = path.split(/(\{[a-zA-Z_][a-zA-Z0-9_]*\}|\/:[a-zA-Z_][a-zA-Z0-9_]*)/g);
  const pattern = parts.map((part) => {
    if (/^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(part)) {
      return '[^/]+';
    }
    if (/^\/:([a-zA-Z_][a-zA-Z0-9_]*)$/.test(part)) return '/[^/]+';
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${pattern}$`);
}

function pathMatches(rule, requestPath) {
  const path = normalizePath(requestPath);
  const pattern = rule.path || rule.pathPattern;
  if (!pattern) return true;

  if (rule.pathExact === false || pattern.includes('*') || pattern.includes('(')) {
    const regex = pattern.startsWith('^')
      ? new RegExp(pattern)
      : new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    return regex.test(path);
  }

  const normalized = normalizePath(pattern);
  if (/\{[a-zA-Z_][a-zA-Z0-9_]*\}|\/:([a-zA-Z_][a-zA-Z0-9_]*)/.test(normalized)) {
    return templatePathRegex(normalized).test(path);
  }
  if (rule.pathPrefix) {
    return path.startsWith(normalized);
  }
  return path === normalized;
}

function headerMatches(rules, headers) {
  if (!rules || Object.keys(rules).length === 0) return true;
  const lower = Object.fromEntries(
    Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
  return Object.entries(rules).every(([key, value]) => {
    const actual = lower[key.toLowerCase()];
    if (value.startsWith('~')) {
      return new RegExp(value.slice(1)).test(actual || '');
    }
    return actual === value;
  });
}

function bodyContains(bodyText, contains) {
  if (!contains) return true;
  if (!bodyText) return false;
  if (Array.isArray(contains)) {
    return contains.every((item) => bodyText.includes(item));
  }
  return bodyText.includes(contains);
}

function jsonMatch(bodyText, jsonRules) {
  if (!jsonRules || Object.keys(jsonRules).length === 0) return true;
  let parsed;
  try {
    parsed = JSON.parse(bodyText || '{}');
  } catch {
    return false;
  }
  return Object.entries(jsonRules).every(([path, expected]) => {
    const value = getByPath(parsed, path);
    if (expected && typeof expected === 'object' && expected.$regex) {
      return new RegExp(expected.$regex).test(String(value ?? ''));
    }
    return String(value ?? '') === String(expected);
  });
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function matchRequest(api, req, bodyText) {
  const match = api.match || {};
  if (match.method && match.method.toUpperCase() !== req.method.toUpperCase()) {
    return false;
  }
  if (!pathMatches(match, req.path)) {
    return false;
  }
  if (!headerMatches(match.headers, req.headers)) {
    return false;
  }
  if (!bodyContains(bodyText, match.bodyContains)) {
    return false;
  }
  if (!jsonMatch(bodyText, match.jsonMatch)) {
    return false;
  }
  return true;
}

export function sortApis(apis) {
  return [...apis].sort((a, b) => (b.priority || 0) - (a.priority || 0));
}
