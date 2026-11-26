import { resolveClientApiUrl as resolveUrl } from '../../shared/environment.js';

export function resolveClientApiUrl(project, clientApi, overrideUrl) {
  return resolveUrl({
    ...project,
    clientApi: overrideUrl ? { ...clientApi, url: overrideUrl } : clientApi,
  });
}
