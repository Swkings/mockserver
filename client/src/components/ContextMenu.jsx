import { useEffect, useRef } from 'react';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }, [x, y]);

  if (!items?.length) return null;

  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map((item) => (
        item.fileInput ? (
          <label key={item.label} className={`ctx-item file-item ${item.disabled ? 'disabled' : ''}`}>
            {item.label}
            <input
              type="file"
              accept={item.accept || '*'}
              hidden
              disabled={item.disabled}
              onChange={(e) => {
                if (!item.disabled) {
                  item.onFile?.(e.target.files?.[0]);
                  onClose();
                }
                e.target.value = '';
              }}
            />
          </label>
        ) : (
          <button
            key={item.label}
            type="button"
            className={`ctx-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
          >
            {item.label}
          </button>
        )
      ))}
    </div>
  );
}
