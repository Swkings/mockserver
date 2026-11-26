import { useEffect, useRef, useState } from 'react';

export function useContainerWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function clampPanelWidth(width, min, max) {
  return Math.max(min, Math.min(width, max));
}

export default function PanelDivider({ className = '', label, controls, width, min, max, onResize }) {
  const dragStart = useRef(null);

  function start(event) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const divider = event.currentTarget;
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, width };
  }

  function move(event) {
    if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { x, width: startWidth } = dragStart.current;
    onResize(clampPanelWidth(startWidth + event.clientX - x, min, max));
  }

  function resizeByKey(event) {
    const step = event.shiftKey ? 40 : 10;
    const widths = { ArrowLeft: width - step, ArrowRight: width + step, Home: min, End: max };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault();
    onResize(clampPanelWidth(widths[event.key], min, max));
  }

  return (
    <div
      className={`split-handle panel-divider ${className}`}
      role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={label} aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      onPointerDown={start} onPointerMove={move} onLostPointerCapture={() => { dragStart.current = null; }}
      onKeyDown={resizeByKey}
    />
  );
}
