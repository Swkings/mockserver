import { useEffect, useRef, useState } from 'react';

export default function Dropdown({ trigger, label, title, items, align = 'right', disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape' && ref.current?.contains(e.target)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
      <button type="button" className="dropdown-trigger" ref={triggerRef} aria-label={label} title={title} aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
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
                  triggerRef.current?.focus();
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
