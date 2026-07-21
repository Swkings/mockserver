import { useEffect, useRef, useState } from 'react';

export default function Dropdown({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={`dropdown ${align}`} ref={ref}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((v) => !v)}>
        {trigger}
      </button>
      {open && (
        <div className="dropdown-menu">
          {items.map((item) => (
            item.fileInput ? (
              <label key={item.label} className="dropdown-item file-item">
                {item.label}
                <input
                  type="file"
                  accept={item.accept || '*'}
                  hidden
                  onChange={(e) => {
                    setOpen(false);
                    item.onFile?.(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            ) : (
              <button
                key={item.label}
                type="button"
                className={`dropdown-item ${item.danger ? 'danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}
