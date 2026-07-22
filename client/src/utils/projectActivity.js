export const PROJECT_ACTIVITY_STORAGE_KEY = 'mockserver-project-activity-v1';

const ITEM_KEYS = {
  api: 'apis',
  'client-api': 'clientApis',
  'grpc-mock': 'grpcMocks',
  'grpc-client': 'grpcClients',
};

const DEFAULT_TYPE_ORDER = ['api', 'client-api', 'grpc-mock', 'grpc-client'];

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

function readActivityMap(storage) {
  try {
    const parsed = JSON.parse(storageOrDefault(storage).getItem(PROJECT_ACTIVITY_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readProjectActivity(projectId, storage) {
  if (!projectId) return null;
  const activity = readActivityMap(storage)[projectId];
  return activity && typeof activity === 'object' && !Array.isArray(activity) ? activity : null;
}

export function writeProjectActivity(projectId, activity, storage) {
  if (!projectId || !activity) return;
  try {
    const target = storageOrDefault(storage);
    const activities = readActivityMap(target);
    activities[projectId] = activity;
    target.setItem(PROJECT_ACTIVITY_STORAGE_KEY, JSON.stringify(activities));
  } catch {
    // UI navigation persistence must never block the editor.
  }
}

export function removeProjectActivity(projectId, storage) {
  if (!projectId) return;
  try {
    const target = storageOrDefault(storage);
    const activities = readActivityMap(target);
    delete activities[projectId];
    target.setItem(PROJECT_ACTIVITY_STORAGE_KEY, JSON.stringify(activities));
  } catch {
    // Ignore unavailable or full browser storage.
  }
}

export function resolveProjectActivity(project, activity = {}) {
  const requestedType = Object.hasOwn(ITEM_KEYS, activity?.type) ? activity.type : 'api';
  const typeOrder = [requestedType, ...DEFAULT_TYPE_ORDER.filter((type) => type !== requestedType)];

  let type = requestedType;
  let itemId = null;

  for (const candidateType of typeOrder) {
    const items = Array.isArray(project?.[ITEM_KEYS[candidateType]])
      ? project[ITEM_KEYS[candidateType]]
      : [];
    const exact = candidateType === requestedType
      ? items.find((item) => item.id === activity?.itemId)
      : null;
    const item = exact || items[0];
    if (item) {
      type = candidateType;
      itemId = item.id;
      break;
    }
  }

  const location = activity?.location === 'settings' || activity?.location === 'protos'
    ? activity.location
    : itemId ? 'item' : 'empty';

  return {
    type,
    itemId,
    location,
    mainView: activity?.mainView === 'record' ? 'record' : 'edit',
  };
}
