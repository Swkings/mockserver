import { useCallback, useEffect, useRef, useState } from 'react';

function useDragResize({ initialSize, minSize, maxSize, invert = false } = {}) {
  const [size, setSize] = useState(initialSize);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(initialSize);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startPos.current = e.clientX;
    startSize.current = size;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [size]);

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const delta = e.clientX - startPos.current;
      const signed = invert ? -delta : delta;
      let next = startSize.current + signed;
      if (minSize != null) next = Math.max(minSize, next);
      if (maxSize != null) next = Math.min(maxSize, next);
      setSize(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [invert, minSize, maxSize]);

  return { size, setSize, onMouseDown };
}

export { useDragResize };

export default function SplitPane({
  left,
  right,
  rightTitle,
  rightHeader,
  resizeSide = 'right',
  initialRightWidth = 420,
  initialLeftWidth = 240,
  minLeft = 280,
  minRight = 300,
  className = '',
}) {
  const containerRef = useRef(null);

  const rightResize = useDragResize({
    initialSize: initialRightWidth,
    minSize: minRight,
    invert: true,
  });

  const leftResize = useDragResize({
    initialSize: initialLeftWidth,
    minSize: minLeft,
    invert: false,
  });

  const onMouseDown = resizeSide === 'left' ? leftResize.onMouseDown : rightResize.onMouseDown;

  const containerWidth = containerRef.current?.offsetWidth || 1200;
  const handleWidth = 6;

  let leftStyle;
  let rightStyle;

  if (resizeSide === 'left') {
    const leftW = Math.min(leftResize.size, containerWidth - minRight - handleWidth);
    leftStyle = { width: leftW, flexShrink: 0 };
    rightStyle = { flex: 1, minWidth: minRight };
  } else {
    const rightW = Math.min(rightResize.size, containerWidth - minLeft - handleWidth);
    leftStyle = { flex: 1, minWidth: minLeft };
    rightStyle = { width: rightW, flexShrink: 0 };
  }

  return (
    <div className={`split-pane ${className}`} ref={containerRef}>
      <div className="split-left scroll-y" style={leftStyle}>{left}</div>
      <div
        className="split-handle"
        onMouseDown={onMouseDown}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="split-right" style={rightStyle}>
        {(rightHeader || rightTitle) && (
          <div className="split-right-head">{rightHeader || rightTitle}</div>
        )}
        <div className="split-right-body scroll-y">{right}</div>
      </div>
    </div>
  );
}
