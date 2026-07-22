import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyPresetPreview, removeBodyPreset, upsertBodyPreset } from '../../client/src/utils/bodyPresets.js';
import { normalizeBodyPresets } from '../utils/bodyPresets.js';

test('upsertBodyPreset creates, updates, and deduplicates body presets', () => {
  const created = upsertBodyPreset([], '', '{"value":1}', () => 'preset-1');
  assert.deepEqual(created, {
    presets: [{ id: 'preset-1', name: 'Body 1', body: '{"value":1}' }],
    selectedId: 'preset-1',
  });

  const updated = upsertBodyPreset(created.presets, 'preset-1', '{"value":2}');
  assert.equal(updated.presets[0].body, '{"value":2}');

  const duplicate = upsertBodyPreset(updated.presets, '', '{"value":2}', () => 'unused');
  assert.equal(duplicate.presets.length, 1);
  assert.equal(duplicate.selectedId, 'preset-1');
});

test('bodyPresetPreview compacts JSON for menu labels', () => {
  assert.equal(bodyPresetPreview('{\n  "value": 1\n}'), '{"value":1}');
  assert.equal(bodyPresetPreview(undefined), '(empty)');
});

test('removeBodyPreset removes only the requested menu item', () => {
  const presets = [
    { id: 'preset-1', name: 'Body 1', body: '{}' },
    { id: 'preset-2', name: 'Body 2', body: '[]' },
  ];

  assert.deepEqual(removeBodyPreset(presets, 'preset-1'), [presets[1]]);
  assert.equal(presets.length, 2);
});

test('normalizeBodyPresets preserves strings and object presets for persistence', () => {
  assert.equal(normalizeBodyPresets([]), undefined);
  const normalized = normalizeBodyPresets([
    'plain body',
    { id: 'saved', name: 'Example', body: { value: 1 } },
  ]);

  assert.equal(normalized[0].name, 'Body 1');
  assert.equal(normalized[0].body, 'plain body');
  assert.deepEqual(normalized[1], { id: 'saved', name: 'Example', body: '{"value":1}' });
});
