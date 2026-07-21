export function rowsToBulkText(rows, mode = 'colon') {
  const sep = mode === 'comma' ? ',' : ':';
  return (rows || [])
    .filter((r) => r.key?.trim())
    .map((r) => `${r.key}${sep}${r.value ?? ''}`)
    .join('\n');
}

export function parseBulkText(text, mode = 'colon') {
  const sep = mode === 'comma' ? ',' : ':';
  const rows = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const idx = line.indexOf(sep);
    if (idx < 0) {
      rows.push({ key: line, value: '' });
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    rows.push({ key, value });
  }

  return rows.length ? rows : [{ key: '', value: '' }];
}
