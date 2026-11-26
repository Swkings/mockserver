export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const METHOD_COLORS = {
  GET: '#10b981',
  POST: '#f59e0b',
  PUT: '#3b82f6',
  PATCH: '#8b5cf6',
  DELETE: '#ef4444',
  HEAD: '#64748b',
  OPTIONS: '#64748b',
};

export function prettyJson(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
}

export function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

export function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function statusClass(code) {
  if (!code) return 'status-unknown';
  if (code >= 200 && code < 300) return 'status-2xx';
  if (code >= 400 && code < 500) return 'status-4xx';
  if (code >= 500) return 'status-5xx';
  return 'status-other';
}

export function objToKv(obj) {
  if (!obj || typeof obj !== 'object') return [{ key: '', value: '' }];
  const entries = Object.entries(obj);
  if (!entries.length) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({ key, value: String(value) }));
}

export function kvToObj(rows) {
  const out = {};
  for (const { enabled, key, value } of rows) {
    if (enabled === false) continue;
    if (key.trim()) out[key.trim()] = value;
  }
  return out;
}

export function paramsToKv(values = {}, descriptions = {}) {
  const keys = new Set([
    ...Object.keys(values || {}),
    ...Object.keys(descriptions || {}),
  ]);
  if (!keys.size) return [{ key: '', value: '', description: '' }];
  return [...keys].map((key) => ({
    key,
    value: String(values?.[key] ?? ''),
    description: String(descriptions?.[key] ?? ''),
  }));
}

export function kvToParams(rows) {
  const values = {};
  const descriptions = {};
  for (const row of rows) {
    if (row.enabled === false) continue;
    const key = row.key?.trim();
    if (!key) continue;
    values[key] = row.value ?? '';
    if (row.description?.trim()) descriptions[key] = row.description.trim();
  }
  return {
    values: Object.keys(values).length ? values : undefined,
    descriptions: Object.keys(descriptions).length ? descriptions : undefined,
  };
}

export function mergeClientHeaders(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const [key, value] of Object.entries(src)) {
      if (key.trim()) out[key.trim()] = String(value ?? '');
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function escapeShellSingleQuoted(value) {
  return String(value).replace(/'/g, "'\\''");
}

export function buildCurl({ method = 'GET', url, headers = {}, body, allowGetBody = false, bodyType = 'text', fileFieldName = 'file', fileName = 'selected-file' } = {}) {
  const m = (method || 'GET').toUpperCase();
  const target = url || 'http://localhost/';
  const lines = [`curl -X ${m} '${escapeShellSingleQuoted(target)}'`];

  for (const [key, value] of Object.entries(headers || {})) {
    if (bodyType !== 'text' && ['content-type', 'content-length'].includes(key.toLowerCase())) continue;
    if (!key.trim()) continue;
    lines.push(`  -H '${escapeShellSingleQuoted(`${key}: ${value}`)}'`);
  }

  if (m !== 'HEAD') {
    if (bodyType === 'multipart') {
      try {
        for (const [key, value] of Object.entries(JSON.parse(body || '{}'))) {
          lines.push(`  -F '${escapeShellSingleQuoted(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)}'`);
        }
      } catch { /* The editor reports invalid JSON on send. */ }
      lines.push(`  -F '${escapeShellSingleQuoted(`${fileFieldName}=@${fileName}`)}'`);
    } else if (bodyType === 'binary') {
      lines.push(`  --data-binary '@${escapeShellSingleQuoted(fileName)}'`);
    } else {
    const bodyStr = body == null || body === '' ? '' : String(body);
    if (bodyStr && (m !== 'GET' || allowGetBody)) {
      lines.push(`  -d '${escapeShellSingleQuoted(bodyStr)}'`);
    }
    }
  }

  return lines.join(' \\\n');
}


export function buildRestClientRequest({ method = 'GET', url, headers = {}, body, allowGetBody = false, bodyType = 'text', fileFieldName = 'file', fileName = 'selected-file' } = {}) {
  const m = (method || 'GET').toUpperCase();
  const target = url || 'http://localhost/';
  const lines = [`${m} ${target} HTTP/1.1`];

  for (const [key, value] of Object.entries(headers || {})) {
    if (bodyType !== 'text' && ['content-type', 'content-length'].includes(key.toLowerCase())) continue;
    if (!key.trim()) continue;
    lines.push(`${key}: ${value}`);
  }

  if (bodyType !== 'text') return lines.concat('', bodyType === 'multipart' ? `multipart/form-data: ${fileFieldName}=@${fileName}` : `binary file: ${fileName}`).join('\n');
  const bodyStr = body == null || body === '' ? '' : String(body);
  if (m !== 'HEAD' && bodyStr && (m !== 'GET' || allowGetBody)) {
    lines.push('', bodyStr);
  }

  return lines.join('\n');
}

export function jsonMatchToKv(jsonMatch) {
  if (!jsonMatch || typeof jsonMatch !== 'object') return [{ key: '', value: '' }];
  const entries = Object.entries(jsonMatch);
  if (!entries.length) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }));
}

export function kvToJsonMatch(rows) {
  const out = {};
  for (const { enabled, key, value } of rows) {
    if (enabled === false) continue;
    if (!key.trim()) continue;
    try {
      out[key.trim()] = JSON.parse(value);
    } catch {
      out[key.trim()] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}
