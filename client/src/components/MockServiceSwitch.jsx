import { useEffect, useRef, useState } from 'react';

export default function MockServiceSwitch({
  enabled,
  running,
  port,
  onToggle,
  onPortChange,
  onPortBlur,
  busy = false,
  compact = false,
}) {
  const portLocked = enabled || running;
  const [localPort, setLocalPort] = useState(port);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setLocalPort(port);
  }, [port]);

  function handlePortInput(val) {
    dirtyRef.current = true;
    setLocalPort(val);
    onPortChange?.(val);
  }

  function handlePortBlur() {
    dirtyRef.current = false;
    onPortBlur?.(localPort);
  }

  return (
    <div
      className={`mock-switch ${compact ? 'compact' : ''} ${enabled ? 'on' : ''} ${running ? 'running' : ''}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="mock-switch-btn"
        role="switch"
        aria-checked={enabled}
        disabled={busy}
        onClick={() => onToggle(!enabled)}
        title={enabled ? '关闭 Mock 服务' : '启动 Mock 服务'}
      >
        <span className="mock-switch-track">
          <span className="mock-switch-knob" />
        </span>
      </button>
      {portLocked ? (
        <span className="mock-switch-port" title="服务运行中，端口不可修改">
          :{port}
        </span>
      ) : (
        <>
          <span className="mock-switch-port-colon">:</span>
          <input
            type="number"
            className="mock-switch-port-input"
            value={localPort ?? ''}
            min={1}
            max={65535}
            disabled={busy}
            onChange={(e) => handlePortInput(Number(e.target.value))}
            onBlur={handlePortBlur}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      )}
    </div>
  );
}
