import { useRef, useState } from 'react';
import Icon from './Icon.jsx';

export default function InterfaceDrawer({ open, projectName, closeRef, onClose, children }) {
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);

  function start(event) {
    suppressClick.current = false;
    if (!open || !event.isPrimary) return;
    if (event.target.closest('input, select, textarea, [contenteditable]')) return;
    if (event.pointerType === 'mouse') {
      if (event.button !== 0 || !event.target.closest('.interface-drawer-grip')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
  }

  function move(event) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.distance) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (dx <= 10 || dx <= Math.abs(dy)) return;
    }
    current.distance = Math.max(0, dx);
    suppressClick.current = true;
    setOffset(current.distance);
  }

  function end(event, dismiss) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setOffset(0);
    if (dismiss && current.distance >= 60) onClose();
  }

  return (
    <nav
      id="interface-drawer"
      className="sidebar-panel interface-drawer"
      aria-label="接口导航"
      inert={!open}
      data-open={open}
      data-dragging={offset > 0 || undefined}
      style={offset ? { '--drawer-offset': `${offset}px` } : undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onKeyDown={(event) => {
        const dropdown = event.target.closest('.dropdown');
        if (event.key === 'Escape' && !dropdown?.querySelector('[aria-expanded="true"]')) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="nav-head nav-interface-head">
        <div className="interface-drawer-grip">
          <strong title={projectName}>{projectName || '接口'}</strong>
        </div>
        <button ref={closeRef} type="button" className="icon-btn sidebar-back" aria-label="收起接口列表" title="向右收起" onClick={onClose}>
          <Icon name="forward" />
        </button>
      </div>
      {children}
    </nav>
  );
}
