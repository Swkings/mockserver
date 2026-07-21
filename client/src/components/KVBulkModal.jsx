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
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
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
          </div>
          <span className="bulk-hint">
            格式：{mode === 'comma' ? '参数名,参数值' : '参数名:参数值'}
          </span>
        </div>

        <textarea
          className="bulk-textarea"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'comma' ? 'key,value' : 'key:value'}
        />

        <p className="bulk-footer">
          {mode === 'comma'
            ? '字段之间以英文逗号(,)分隔，多条记录以换行分隔'
            : '字段之间以英文冒号(:)分隔，多条记录以换行分隔'}
        </p>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="button" className="primary" onClick={handleConfirm}>确定</button>
        </div>
      </div>
    </div>
  );
}
