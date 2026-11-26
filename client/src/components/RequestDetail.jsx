import { useState } from 'react';
import SplitPane from './SplitPane.jsx';
import {
  prettyJson,
  formatTime,
  formatDuration,
  statusClass,
} from '../utils/format.js';

function CodePanel({ title, headers, body, headersLabel = 'Headers' }) {
  const [section, setSection] = useState('body');

  return (
    <div className="code-panel">
      <div className="code-panel-head">
        <span className="code-panel-title">{title}</span>
        <div className="code-panel-tabs">
          <button type="button" className={section === 'body' ? 'active' : ''} onClick={() => setSection('body')}>Body</button>
          <button type="button" className={section === 'headers' ? 'active' : ''} onClick={() => setSection('headers')}>{headersLabel}</button>
        </div>
      </div>
      <div className="code-panel-body scroll-y">
        <pre className="code-view">
          {section === 'body'
            ? (prettyJson(body) || '(empty)')
            : (prettyJson(headers) || '(empty)')}
        </pre>
      </div>
    </div>
  );
}

function recordStatusClass(record) {
  if (record.protocol === 'grpc') return Number(record.responseStatus) === 0 ? 'status-2xx' : 'status-5xx';
  return statusClass(record.responseStatus);
}

function recordStatusLabel(record) {
  if (record.protocol === 'grpc') return Number(record.responseStatus) === 0 ? 'OK' : `RPC ${record.responseStatus}`;
  return record.responseStatus;
}

export default function RequestDetail({ record }) {
  const inbound = record.direction !== 'outbound';
  const destination = record.url || record.path;
  const metadataLabel = record.protocol === 'grpc' ? 'Metadata' : 'Headers';

  return (
    <div className="record-detail">
      {destination && <code className="record-path">{record.method} {destination}</code>}
      <div className="detail-summary">
        <span className={`detail-status ${recordStatusClass(record)}`}>{recordStatusLabel(record)}</span>
        <div className="detail-info">
          <span>{formatTime(record.timestamp)}</span>
          <span className="sep">·</span>
          <span>{formatDuration(record.durationMs)}</span>
          {record.clientIp && (<><span className="sep">·</span><span>{record.clientIp}</span></>)}
          <span className="sep">·</span>
          <span>{inbound ? '入站' : '出站'}</span>
          {record.methodType && (<><span className="sep">·</span><span>{record.methodType}</span></>)}
        </div>
      </div>

      <SplitPane
        className="detail-split"
        resizeSide="right"
        initialRightWidth={480}
        minLeft={280}
        minRight={280}
        left={<CodePanel title="Request" headers={record.headers} body={record.body} headersLabel={metadataLabel} />}
        right={<CodePanel title="Response" headers={record.responseHeaders} body={record.responseBody} headersLabel={metadataLabel} />}
      />
    </div>
  );
}
