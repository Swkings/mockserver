export function findEnvironmentEntry(layout, id) {
  for (let index = 0; index < layout.length; index++) {
    const entry = layout[index];
    if (entry.id === id) return { entry, siblings: layout, index };
    if (entry.type === 'folder') {
      const nested = findEnvironmentEntry(entry.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

export function normalizeEnvironmentLayout(layout, environments, { strict = false, appendMissing = true } = {}) {
  const environmentIds = new Set(environments.map(({ id }) => id));
  const seen = new Set();

  function invalid() {
    if (strict) throw new Error('环境列表结构无效');
  }

  function visit(entries) {
    if (!Array.isArray(entries)) {
      invalid();
      return [];
    }
    return entries.flatMap((entry) => {
      if (typeof entry?.id !== 'string' || !entry.id || seen.has(entry.id)) {
        invalid();
        return [];
      }
      if (entry.type === 'environment' && environmentIds.has(entry.id)) {
        seen.add(entry.id);
        return [{ type: 'environment', id: entry.id }];
      }
      if (entry.type === 'folder' && !environmentIds.has(entry.id) && typeof entry.name === 'string' && entry.name.trim()) {
        seen.add(entry.id);
        return [{ type: 'folder', id: entry.id, name: entry.name.trim(), children: visit(entry.children) }];
      }
      invalid();
      return [];
    });
  }

  const normalized = visit(layout);
  if (appendMissing) {
    for (const id of environmentIds) {
      if (seen.has(id)) continue;
      invalid();
      normalized.push({ type: 'environment', id });
    }
  }
  return normalized;
}

export function mergeEnvironmentLayouts(previous, incoming) {
  const importedIds = new Set();
  function collect(entries) {
    for (const entry of entries) {
      importedIds.add(entry.id);
      if (entry.type === 'folder') collect(entry.children);
    }
  }
  collect(incoming);

  function keepLocal(entries) {
    return entries.filter((entry) => !importedIds.has(entry.id)).map((entry) => (
      entry.type === 'folder' ? { ...entry, children: keepLocal(entry.children) } : entry
    ));
  }

  function appendLocalToImported(entries) {
    return entries.map((entry) => {
      if (entry.type !== 'folder') return entry;
      const original = findEnvironmentEntry(previous, entry.id)?.entry;
      return {
        ...entry,
        children: [...appendLocalToImported(entry.children), ...keepLocal(original?.children || [])],
      };
    });
  }

  return [...appendLocalToImported(incoming), ...keepLocal(previous)];
}

export function moveEnvironmentEntry(layout, id, targetId, placement) {
  const next = structuredClone(layout);
  const source = findEnvironmentEntry(next, id);
  if (!source) return null;
  source.siblings.splice(source.index, 1);

  if (!targetId && placement === 'inside') {
    next.push(source.entry);
    return next;
  }

  const target = findEnvironmentEntry(next, targetId);
  if (!target) return null;
  if (placement === 'inside' && target.entry.type === 'folder') {
    target.entry.children.push(source.entry);
  } else if (placement === 'before' || placement === 'after') {
    target.siblings.splice(target.index + (placement === 'after' ? 1 : 0), 0, source.entry);
  } else {
    return null;
  }
  return next;
}
