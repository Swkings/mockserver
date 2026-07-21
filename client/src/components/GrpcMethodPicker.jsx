import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterGrpcMethods, moveGrpcMethodIndex } from '../utils/grpc.js';

function methodType(method) {
  if (method?.requestStream && method?.responseStream) return 'Bidi streaming';
  if (method?.requestStream) return 'Client streaming';
  if (method?.responseStream) return 'Server streaming';
  return 'Unary';
}

export default function GrpcMethodPicker({ methods, selectedMethod, currentMethodName, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const filterRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = useId();
  const filteredMethods = useMemo(() => filterGrpcMethods(methods, query), [methods, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    filterRef.current?.focus();
    const selectedIndex = filteredMethods.findIndex((method) => method.key === selectedMethod?.key);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : (filteredMethods.length ? 0 : -1));
  }, [open, query, filteredMethods, selectedMethod?.key]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(method) {
    if (!method) return;
    onSelect(method);
    closeMenu({ restoreFocus: true });
  }

  function handleMenuKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => moveGrpcMethodIndex(current, filteredMethods.length, offset));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(filteredMethods[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  }

  const disabled = methods.length === 0;
  const activeDescendant = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className="grpc-method-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="grpc-method-trigger"
        disabled={disabled}
        role="combobox"
        aria-label="选择 RPC Method"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="grpc-method-trigger-name">{selectedMethod?.name || currentMethodName || '暂无可用 Method'}</span>
        {selectedMethod && <span className="grpc-method-trigger-type">{methodType(selectedMethod)}</span>}
        <span className="grpc-method-trigger-caret" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="grpc-method-menu">
          <div className="grpc-method-filter">
            <input
              ref={filterRef}
              value={query}
              placeholder="筛选 Method"
              aria-label="筛选 RPC Method"
              aria-controls={listboxId}
              aria-activedescendant={activeDescendant}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleMenuKeyDown}
            />
          </div>
          <div id={listboxId} className="grpc-method-options" role="listbox">
            {filteredMethods.map((method, index) => (
              <button
                ref={(node) => { optionRefs.current[index] = node; }}
                id={`${listboxId}-option-${index}`}
                key={method.key}
                type="button"
                role="option"
                aria-selected={method.key === selectedMethod?.key}
                className={`grpc-method-option ${index === activeIndex ? 'active' : ''} ${method.key === selectedMethod?.key ? 'selected' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(method)}
              >
                <span>{method.name}</span>
                <small>{methodType(method)}</small>
              </button>
            ))}
            {filteredMethods.length === 0 && <div className="grpc-method-empty">没有匹配的方法</div>}
          </div>
        </div>
      )}
    </div>
  );
}
