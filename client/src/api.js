const API = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) return res.json();
  return res.text();
}

export const api = {
  listProjects: () => request('/projects'),
  getProject: (id) => request(`/projects/${id}`),
  saveProject: (project) =>
    project.id
      ? request(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) })
      : request('/projects', { method: 'POST', body: JSON.stringify(project) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  restartProject: (id) => request(`/projects/${id}/restart`, { method: 'POST' }),
  listRequests: (query = '') => request(`/requests${query ? `?${query}` : ''}`),
  clearRequests: (projectId, apiId) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (apiId) params.set('apiId', apiId);
    const qs = params.toString();
    return request(`/requests${qs ? `?${qs}` : ''}`, { method: 'DELETE' });
  },
  exportConfig: () => fetch(`${API}/config/export`).then((r) => r.text()),
  exportProject: (projectId) => fetch(`${API}/config/export/${projectId}`).then((r) => r.text()),
  importConfig: (raw, merge = false) =>
    request(`/config/import?merge=${merge}`, { method: 'POST', body: JSON.stringify({ raw }) }),
  loadSample: (file, merge = true) =>
    request(`/config/samples/${file}?merge=${merge}`, { method: 'POST' }),
  listSamples: () => request('/config/samples'),
  inspectGrpc: (payload) => request('/grpc/inspect', { method: 'POST', body: JSON.stringify(payload) }),
  sendGrpcClient: (projectId, clientId, payload = {}) =>
    request(`/grpc-clients/${projectId}/${clientId}/send`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sendClientApi: (projectId, apiId, payload = {}) =>
    request(`/client-apis/${projectId}/${apiId}/send`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  projectStatus: () => request('/projects/status'),
};

export function subscribeEvents(onEvent, onStatus) {
  let es = null;
  let closed = false;
  let retryMs = 1000;

  function connect() {
    if (closed) return;
    es = new EventSource(`${API}/events`);

    es.onopen = () => {
      retryMs = 1000;
      onStatus?.(true);
    };

    es.onerror = () => {
      onStatus?.(false);
      es?.close();
      if (!closed) {
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 10000);
      }
    };

    es.onmessage = (e) => onEvent('message', JSON.parse(e.data));
    for (const name of ['request', 'projects', 'connected', 'requests_cleared']) {
      es.addEventListener(name, (e) => {
        onEvent(name, JSON.parse(e.data));
        if (name === 'connected') onStatus?.(true);
      });
    }
  }

  connect();

  return () => {
    closed = true;
    es?.close();
  };
}
