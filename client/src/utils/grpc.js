const methodCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function methodLabel(method) {
  return String(method?.methodName || method?.name || method?.key || '');
}

function sameText(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

export function sortGrpcMethods(methods = []) {
  return [...methods].sort((left, right) => (
    methodCollator.compare(methodLabel(left), methodLabel(right))
    || methodCollator.compare(String(left?.serviceName || ''), String(right?.serviceName || ''))
    || methodCollator.compare(String(left?.packageName || ''), String(right?.packageName || ''))
  ));
}

export function filterGrpcMethods(methods = [], query = '') {
  const normalized = String(query || '').trim().toLowerCase();
  const sorted = sortGrpcMethods(methods);
  if (!normalized) return sorted;
  return sorted.filter((method) => [method.name, method.key, method.path]
    .some((value) => String(value || '').toLowerCase().includes(normalized)));
}

export function moveGrpcMethodIndex(currentIndex, itemCount, offset) {
  if (itemCount <= 0) return -1;
  const current = currentIndex >= 0 ? currentIndex : (offset > 0 ? -1 : 0);
  return (current + offset + itemCount) % itemCount;
}

export function findMatchingGrpcItem(items = [], source, preferredId) {
  if (!source?.methodName) return null;

  const preferred = preferredId
    ? items.find((candidate) => candidate.id === preferredId)
    : null;
  if (preferred && (
    sameText(preferred.packageName, source.packageName)
    && sameText(preferred.serviceName, source.serviceName)
    && sameText(preferred.methodName, source.methodName)
  )) return preferred;

  const sameProto = source.protoId
    ? items.find((candidate) => (
      candidate.protoId === source.protoId
      && sameText(candidate.packageName, source.packageName)
      && sameText(candidate.serviceName, source.serviceName)
      && sameText(candidate.methodName, source.methodName)
    ))
    : null;
  if (sameProto) return sameProto;

  const exact = items.find((candidate) => (
    sameText(candidate.packageName, source.packageName)
    && sameText(candidate.serviceName, source.serviceName)
    && sameText(candidate.methodName, source.methodName)
  ));
  if (exact) return exact;

  const sameService = items.find((candidate) => (
    sameText(candidate.serviceName, source.serviceName)
    && sameText(candidate.methodName, source.methodName)
  ));
  if (sameService) return sameService;

  const sameMethod = items.filter((candidate) => sameText(candidate.methodName, source.methodName));
  return sameMethod.length === 1 ? sameMethod[0] : null;
}
