import { v4 as uuidv4 } from 'uuid';

export function normalizeBodyPresets(presets) {
  if (!Array.isArray(presets) || presets.length === 0) return undefined;
  const normalized = presets
    .filter((preset) => typeof preset === 'string' || (preset && typeof preset === 'object'))
    .map((preset, index) => {
      const source = typeof preset === 'string' ? { body: preset } : preset;
      return {
        id: source.id || uuidv4(),
        name: source.name || `Body ${index + 1}`,
        body: source.body == null
          ? ''
          : (typeof source.body === 'string' ? source.body : JSON.stringify(source.body)),
      };
    });
  return normalized.length ? normalized : undefined;
}
