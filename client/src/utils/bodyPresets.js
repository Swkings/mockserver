function bodyText(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function bodyPresetPreview(value, maxLength = 56) {
  const raw = bodyText(value).trim();
  if (!raw) return '(empty)';
  let preview = raw.replace(/\s+/g, ' ');
  try {
    preview = JSON.stringify(JSON.parse(raw));
  } catch {
    // Keep the compact plain-text preview.
  }
  return preview.length > maxLength ? preview.slice(0, maxLength - 1) + '…' : preview;
}

export function upsertBodyPreset(presets = [], selectedId, body, createId = () => crypto.randomUUID()) {
  const current = Array.isArray(presets) ? presets : [];
  const text = bodyText(body);
  const selectedIndex = current.findIndex((preset) => preset.id === selectedId);

  if (selectedIndex >= 0) {
    const next = current.map((preset, index) => (
      index === selectedIndex ? { ...preset, body: text } : preset
    ));
    return { presets: next, selectedId: next[selectedIndex].id };
  }

  const duplicate = current.find((preset) => bodyText(preset.body) === text);
  if (duplicate) return { presets: current, selectedId: duplicate.id };

  const preset = {
    id: createId(),
    name: 'Body ' + (current.length + 1),
    body: text,
  };
  return { presets: [...current, preset], selectedId: preset.id };
}

export function removeBodyPreset(presets = [], id) {
  if (!Array.isArray(presets)) return [];
  return presets.filter((preset) => preset.id !== id);
}
