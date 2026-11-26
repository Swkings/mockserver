import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { filterGrpcMethods, moveGrpcMethodIndex } from '../utils/grpc.js';

function methodType(method) {
  if (method?.requestStream && method?.responseStream) return 'Bidi streaming';
  if (method?.requestStream) return 'Client streaming';
  if (method?.responseStream) return 'Server streaming';
  return 'Unary';
}

export default function GrpcMethodPicker({
  methods, selectedMethod, currentMethodName, onSelect, pinnedMethod, inDialog = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const filterRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = useId();
  const filteredMethods = useMemo(() => {
    const matches = filterGrpcMethods(methods, query);
    return pinnedMethod && filterGrpcMethods([pinnedMethod], query).length ? [pinnedMethod, ...matches] : matches;
  }, [methods, pinnedMethod, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
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
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
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
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
    }
  }

  const disabled = !pinnedMethod && methods.length === 0;
  const activeDescendant = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className={`grpc-method-picker ${inDialog ? 'dialog-method-picker' : ''}`} ref={rootRef} onBlur={(event) => {
      if (open && !event.currentTarget.contains(event.relatedTarget)) closeMenu();
    }}>
      <button
        ref={triggerRef}
        type="button"
        className="grpc-method-trigger"
        disabled={disabled}
        autoFocus={inDialog}
        aria-haspopup="listbox"
        aria-label="选择 RPC Method"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
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
        <span className="grpc-method-choice">
          <span className="grpc-method-trigger-name">{selectedMethod?.name || currentMethodName || '暂无可用 Method'}</span>
          {selectedMethod?.detail && <small title={selectedMethod.detail}>{selectedMethod.detail}</small>}
        </span>
        {selectedMethod && selectedMethod !== pinnedMethod && <span className="grpc-method-trigger-type">{methodType(selectedMethod)}</span>}
        <span className="grpc-method-trigger-caret"><Icon name="down" /></span>
      </button>
      {open && (
        <div className="grpc-method-menu">
          <div className="grpc-method-filter">
            <input
              ref={filterRef}
              className="field"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              value={query}
              placeholder={inDialog ? '筛选方法或 Proto' : '筛选 Method'}
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
                <span className="grpc-method-choice">
                  <span>{method.name}</span>
                  {method.detail && <small title={method.detail}>{method.detail}</small>}
                </span>
                {method !== pinnedMethod && <small className="grpc-method-trigger-type">{methodType(method)}</small>}
              </button>
            ))}
            {filteredMethods.length === 0 && <div className="grpc-method-empty">没有匹配的方法</div>}
          </div>
        </div>
      )}
    </div>
  );
}
