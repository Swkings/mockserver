export const REQUEST_RECORD_LIMIT = 200;
export const REQUEST_RECORD_STORAGE_PREFIX = 'mockserver-request-records-v1:';

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

function storageKey(projectId) {
  return REQUEST_RECORD_STORAGE_PREFIX + projectId;
}

function recordKey(record) {
  return record.id || [record.timestamp, record.projectId, record.matchedApiId, record.direction].join(':');
}

export function mergeRequestRecords(cached = [], incoming = [], limit = REQUEST_RECORD_LIMIT) {
  const records = new Map();
  for (const record of [...cached, ...incoming]) {
    if (record && typeof record === 'object') records.set(recordKey(record), record);
  }
  return [...records.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function readProjectRequestRecords(projectId, storage) {
  if (!projectId) return [];
  try {
    const parsed = JSON.parse(storageOrDefault(storage).getItem(storageKey(projectId)) || '[]');
    return mergeRequestRecords([], Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function writeProjectRequestRecords(projectId, records, storage) {
  if (!projectId) return [];
  let target;
  try {
    target = storageOrDefault(storage);
  } catch {
    return [];
  }

  let next = mergeRequestRecords([], records);
  while (next.length) {
    try {
      target.setItem(storageKey(projectId), JSON.stringify(next));
      return next;
    } catch {
      next = next.slice(0, Math.floor(next.length * 0.75));
    }
  }
  try { target.removeItem(storageKey(projectId)); } catch { /* ignore */ }
  return [];
}

export function clearProjectRequestRecords(projectId, apiId, storage) {
  if (!projectId) return;
  try {
    const target = storageOrDefault(storage);
    if (!apiId) {
      target.removeItem(storageKey(projectId));
      return;
    }
    const remaining = readProjectRequestRecords(projectId, target)
      .filter((record) => record.matchedApiId !== apiId);
    if (remaining.length) writeProjectRequestRecords(projectId, remaining, target);
    else target.removeItem(storageKey(projectId));
  } catch {
    // Ignore unavailable browser storage.
  }
}

export function clearAllRequestRecords(storage) {
  try {
    const target = storageOrDefault(storage);
    const keys = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key?.startsWith(REQUEST_RECORD_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) target.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
}
