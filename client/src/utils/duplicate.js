export function duplicateApi(api) {
  const copy = structuredClone(api);
  copy.id = crypto.randomUUID();
  copy.name = `${api.name} (copy)`;
  return copy;
}

export function duplicateClientApi(clientApi) {
  const copy = structuredClone(clientApi);
  copy.id = crypto.randomUUID();
  copy.name = `${clientApi.name} (copy)`;
  return copy;
}

export function duplicateGrpcItem(item) {
  const copy = structuredClone(item);
  copy.id = crypto.randomUUID();
  copy.name = `${item.name} (copy)`;
  return copy;
}
