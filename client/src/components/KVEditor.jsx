import Icon from './Icon.jsx';
import { useEffect, useRef, useState } from 'react';
import KVBulkModal from './KVBulkModal.jsx';

function normalizeRows(rows, withDescription = false) {
  const empty = withDescription
    ? { enabled: true, key: '', value: '', description: '' }
    : { enabled: true, key: '', value: '' };

  if (!rows?.length) return [empty];

  return rows.map((r) => {
    const row = { enabled: r.enabled !== false, key: r.key ?? '', value: r.value ?? '' };
    if (withDescription) row.description = r.description ?? '';
    return row;
  });
}

function rowsSignature(rows, withDescription = false) {
  const normalized = normalizeRows(rows, withDescription).map((r) => (
    withDescription
      ? { enabled: r.enabled !== false, key: r.key, value: r.value, description: r.description }
      : { enabled: r.enabled !== false, key: r.key, value: r.value }
  ));
  return JSON.stringify(normalized);
}

export default function KVEditor({
  rows,
  onChange,
  resetKey,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  descriptionPlaceholder = '说明',
  withDescription = false,
  bulkEdit = false,
}) {
  const [list, setList] = useState(() => normalizeRows(rows, withDescription));
  const [bulkOpen, setBulkOpen] = useState(false);
  const sigRef = useRef(rowsSignature(rows, withDescription));
  const resetRef = useRef(resetKey);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (resetKey !== resetRef.current) {
      resetRef.current = resetKey;
      dirtyRef.current = false;
      const next = normalizeRows(rows, withDescription);
      sigRef.current = rowsSignature(next, withDescription);
      setList(next);
      return;
    }

    const sig = rowsSignature(rows, withDescription);
    if (dirtyRef.current) {
      if (sig === sigRef.current) dirtyRef.current = false;
      return;
    }

    if (sig === sigRef.current) return;

    sigRef.current = sig;
    setList((prev) => {
      const drafts = prev.filter((r) => !r.key.trim());
      const committed = normalizeRows(rows, withDescription).filter((r) => r.key.trim());
      const merged = [...committed, ...drafts];
      return merged.length ? merged : [normalizeRows([], withDescription)[0]];
    });
  }, [rows, resetKey, withDescription]);

  function commit(next) {
    dirtyRef.current = true;
    sigRef.current = rowsSignature(next, withDescription);
    setList(next);
    onChange(next);
  }

  function update(idx, field, val) {
    const next = list.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
    commit(next);
  }

  function addRow() {
    const next = [...list, normalizeRows([], withDescription)[0]];
    dirtyRef.current = true;
    sigRef.current = rowsSignature(next, withDescription);
    setList(next);
  }

  function removeRow(idx) {
    const next = list.filter((_, i) => i !== idx);
    const normalized = next.length ? next : [normalizeRows([], withDescription)[0]];
    commit(normalized);
  }

  function applyBulk(parsed) {
    const descByKey = withDescription
      ? Object.fromEntries(list.filter((r) => r.key.trim()).map((r) => [r.key, r.description ?? '']))
      : {};
    const enabledByKey = Object.fromEntries(list.filter((r) => r.key.trim()).map((r) => [r.key, r.enabled !== false]));
    const normalized = parsed.length
      ? parsed.map((r) => {
        const row = { enabled: enabledByKey[r.key] ?? true, key: r.key, value: r.value ?? '' };
        if (withDescription) row.description = descByKey[r.key] ?? r.description ?? '';
        return row;
      })
      : [normalizeRows([], withDescription)[0]];
    commit(normalized);
  }

  return (
    <div className={`kv-editor ${withDescription ? 'with-desc' : ''}`}>
      {bulkEdit && (
        <div className="kv-toolbar">
          <button type="button" className="link" onClick={() => setBulkOpen(true)}>
            批量编辑
          </button>
        </div>
      )}
      <div className="kv-head">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        {withDescription && <span>{descriptionPlaceholder}</span>}
        <span />
      </div>
      {list.map((row, idx) => (
        <div className={`kv-row ${row.enabled === false ? 'disabled' : ''}`} key={idx}>
          <label className="kv-enable">
            <input
              type="checkbox"
              aria-label={row.key ? `启用 ${row.key}` : `启用第 ${idx + 1} 行`}
              checked={row.enabled !== false}
              onChange={(e) => update(idx, 'enabled', e.target.checked)}
            />
          </label>
          <input
            value={row.key}
            aria-label={keyPlaceholder}
            onChange={(e) => update(idx, 'key', e.target.value)}
          />
          <input
            value={row.value}
            aria-label={valuePlaceholder}
            onChange={(e) => update(idx, 'value', e.target.value)}
          />
          {withDescription && (
            <input
              className="desc-input"
              value={row.description}
              aria-label={descriptionPlaceholder}
              onChange={(e) => update(idx, 'description', e.target.value)}
            />
          )}
          <button type="button" className="icon-btn" onClick={() => removeRow(idx)} aria-label={row.key ? `删除 ${row.key}` : `删除第 ${idx + 1} 行`}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      <button type="button" className="link" onClick={addRow}>
        + 添加行
      </button>

      <KVBulkModal
        open={bulkOpen}
        rows={list.filter((r) => r.key.trim())}
        onConfirm={applyBulk}
        onClose={() => setBulkOpen(false)}
      />
    </div>
  );
}
