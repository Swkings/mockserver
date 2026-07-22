import { useEffect, useRef, useState } from 'react';
import { bodyPresetPreview, removeBodyPreset, upsertBodyPreset } from '../utils/bodyPresets.js';

export default function BodyPresetToolbar({ presets = [], body, onBodyChange, onPresetsChange, onSave }) {
  const [selectedId, setSelectedId] = useState('');
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const selectedIndex = presets.findIndex((preset) => preset.id === selectedId);
  const selectedPreset = selectedIndex >= 0 ? presets[selectedIndex] : null;

  useEffect(() => {
    if (selectedId && !selectedPreset) setSelectedId('');
  }, [selectedId, selectedPreset]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  function selectPreset(id) {
    setSelectedId(id);
    setOpen(false);
    if (!id) return;
    const preset = presets.find((candidate) => candidate.id === id);
    if (preset) onBodyChange(preset.body);
  }

  function deletePreset(event, id) {
    event.stopPropagation();
    const next = removeBodyPreset(presets, id);
    onPresetsChange(next);
    if (selectedId === id) setSelectedId('');
    window.setTimeout(() => onSave?.(), 0);
  }

  function savePreset() {
    const result = upsertBodyPreset(presets, selectedId, body);
    onPresetsChange(result.presets);
    setSelectedId(result.selectedId);
    window.setTimeout(() => onSave?.(), 0);
  }

  return (
    <div className="body-preset-toolbar">
      <div className="body-preset-picker" ref={pickerRef}>
        <button
          type="button"
          className="body-preset-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            {selectedPreset
              ? (selectedPreset.name || 'Body ' + (selectedIndex + 1)) + ' · ' + bodyPresetPreview(selectedPreset.body)
              : (presets.length ? '新建或选择 Body' : '暂无已保存 Body')}
          </span>
          <span className="body-preset-caret" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="body-preset-menu" role="menu">
            <button
              type="button"
              className={'body-preset-select ' + (selectedId ? '' : 'active')}
              role="menuitem"
              onClick={() => selectPreset('')}
            >
              新建 Body
            </button>
            {presets.map((preset, index) => (
              <div
                className={'body-preset-item ' + (selectedId === preset.id ? 'active' : '')}
                key={preset.id}
              >
                <button
                  type="button"
                  className="body-preset-select"
                  role="menuitem"
                  title={bodyPresetPreview(preset.body, 200)}
                  onClick={() => selectPreset(preset.id)}
                >
                  <span>{preset.name || 'Body ' + (index + 1)}</span>
                  <span className="body-preset-preview">{bodyPresetPreview(preset.body)}</span>
                </button>
                <button
                  type="button"
                  className="body-preset-delete"
                  aria-label={'删除 ' + (preset.name || 'Body ' + (index + 1))}
                  title="删除此 Body"
                  onClick={(event) => deletePreset(event, preset.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="ghost sm" onClick={savePreset}>保存 Body</button>
    </div>
  );
}
