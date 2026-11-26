import Icon from './Icon.jsx';
import { useEffect, useRef, useState } from 'react';
import { parseBulkText, rowsToBulkText } from '../utils/kvBulk.js';

export default function KVBulkModal({ open, rows, onConfirm, onClose }) {
  const [mode, setMode] = useState('colon');
  const [text, setText] = useState('');
  const rowsRef = useRef(rows);

  rowsRef.current = rows;

  useEffect(() => {
    if (!open) return;
    setMode('colon');
    setText(rowsToBulkText(rowsRef.current, 'colon'));
  }, [open]);

  if (!open) return null;

  const separator = mode === 'comma' ? ',' : mode === 'equals' ? '=' : ':';
  const separatorLabel = mode === 'comma' ? '英文逗号(,)' : mode === 'equals' ? '等号(=)' : '英文冒号(:)';

  function switchMode(nextMode) {
    if (nextMode === mode) return;
    const parsed = parseBulkText(text, mode);
    setText(rowsToBulkText(parsed, nextMode));
    setMode(nextMode);
  }

  function handleConfirm() {
    const parsed = parseBulkText(text, mode);
    onConfirm(parsed);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bulk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>批量编辑</h3>
          <button type="button" className="icon-btn" aria-label="关闭批量编辑" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div className="bulk-toolbar">
          <div className="bulk-mode">
            <button
              type="button"
              className={mode === 'comma' ? 'active' : ''}
              onClick={() => switchMode('comma')}
            >
              逗号模式
            </button>
            <button
              type="button"
              className={mode === 'colon' ? 'active' : ''}
              onClick={() => switchMode('colon')}
            >
              冒号模式
            </button>
            <button
              type="button"
              className={mode === 'equals' ? 'active' : ''}
              onClick={() => switchMode('equals')}
            >
              等号模式
            </button>
          </div>
        </div>

        <textarea
          className="bulk-textarea"
          aria-label="键值文本"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          placeholder={'key' + separator + 'value'}
        />

        <p className="bulk-footer">
          使用{separatorLabel}分隔键值，换行或分号分隔记录
        </p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" onClick={handleConfirm}>确定</button>
        </div>
      </div>
    </div>
  );
}
