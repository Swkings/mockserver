import { useMemo, useState } from 'react';
import {
  formatTime,
  formatDuration,
  statusClass,
} from '../utils/format.js';
import RequestDetail from './RequestDetail.jsx';
import SplitPane from './SplitPane.jsx';

function recordStatusClass(record) {
  if (record.protocol === 'grpc') return Number(record.responseStatus) === 0 ? 'status-2xx' : 'status-5xx';
  return statusClass(record.responseStatus);
}

function recordStatusLabel(record) {
  if (record.protocol === 'grpc') return Number(record.responseStatus) === 0 ? 'OK' : 'RPC ' + record.responseStatus;
  return record.responseStatus;
}

export default function RequestLogPanel({
  records,
  onRefresh,
  onClear,
  paused,
  onTogglePause,
  sseConnected,
}) {
  const [selectedId, setSelectedId] = useState(null);

  const sorted = useMemo(
    () => [...records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [records]
  );

  const selected = useMemo(
    () => sorted.find((r) => r.id === selectedId) || sorted[0] || null,
    [sorted, selectedId]
  );

  const listPanel = (
    <div className="record-list-inner scroll-y">
      {sorted.length === 0 ? (
        <div className="record-empty">暂无记录</div>
      ) : (
        sorted.map((r) => (
          <button
            type="button"
            key={r.id}
            className={`record-item ${selected?.id === r.id ? 'selected' : ''}`}
            aria-pressed={selected?.id === r.id}
            onClick={() => setSelectedId(r.id)}
          >
            <span className="record-time">{formatTime(r.timestamp)}</span>
            <span className={`record-status ${recordStatusClass(r)}`}>
              {recordStatusLabel(r)}
            </span>
            <span className="record-duration">{formatDuration(r.durationMs)}</span>
            {r.clientIp && <span className="record-ip">{r.clientIp}</span>}
          </button>
        ))
      )}
    </div>
  );

  return (
    <div className="record-page">
      <div className="record-header">
        <div className="record-toolbar">
          {!paused && <span className="record-update-mode"><span className={`live-dot ${sseConnected ? 'on' : ''}`} aria-hidden="true" />{sseConnected ? '实时' : '轮询'}</span>}
          <button type="button" className="ghost" onClick={onTogglePause}>
            {paused ? '继续' : '暂停'}
          </button>
          <button type="button" className="ghost" onClick={onRefresh}>刷新</button>
          <button type="button" className="ghost danger" disabled={!sorted.length} onClick={onClear}>清空</button>
        </div>
      </div>

      <SplitPane
        className={`record-split ${selected ? '' : 'record-split-empty'}`}
        resizeSide="left"
        initialLeftWidth={220}
        minLeft={160}
        minRight={400}
        left={listPanel}
        right={selected && <RequestDetail record={selected} />}
      />
    </div>
  );
}
