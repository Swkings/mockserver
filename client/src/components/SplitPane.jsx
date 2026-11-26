import { useCallback, useEffect, useRef, useState } from 'react';

function useDragResize({ initialSize, minSize, maxSize, invert = false } = {}) {
  const [size, setSize] = useState(initialSize);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(initialSize);

  const onMouseDown = useCallback((e, actualSize = size) => {
    e.preventDefault();
    dragging.current = true;
    startPos.current = e.clientX;
    startSize.current = actualSize;
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
  rightFraction,
  initialLeftWidth = 240,
  minLeft = 280,
  minRight = 300,
  className = '',
}) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const [resized, setResized] = useState(false);

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

  function onMouseDown(event) {
    if (resizeSide === 'left') {
      const actualWidth = leftRef.current?.offsetWidth || initialLeftWidth;
      leftResize.setSize(actualWidth);
      leftResize.onMouseDown(event, actualWidth);
    } else {
      const actualWidth = rightRef.current?.offsetWidth || initialRightWidth;
      rightResize.setSize(actualWidth);
      rightResize.onMouseDown(event, actualWidth);
      setResized(true);
    }
  }

  const leftStyle = resizeSide === 'left'
    ? { width: leftResize.size, maxWidth: `calc(100% - ${minRight + 6}px)`, flexShrink: 0 }
    : { flex: 1, minWidth: minLeft };
  const rightStyle = resizeSide === 'left'
    ? { flex: 1, minWidth: minRight }
    : {
      width: rightFraction && !resized ? `${rightFraction * 100}%` : rightResize.size,
      minWidth: minRight,
      maxWidth: `calc(100% - ${minLeft + 6}px)`,
      flexShrink: 0,
    };

  return (
    <div className={`split-pane ${className}`}>
      <div className="split-left scroll-y" style={leftStyle} ref={leftRef}>{left}</div>
      <div
        className="split-handle"
        onMouseDown={onMouseDown}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="split-right" style={rightStyle} ref={rightRef}>
        {(rightHeader || rightTitle) && (
          <div className="split-right-head">{rightHeader || rightTitle}</div>
        )}
        <div className="split-right-body scroll-y">{right}</div>
      </div>
    </div>
  );
}
