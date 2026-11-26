import KVEditor from './KVEditor.jsx';
import ServiceConnection from './ServiceConnection.jsx';
import MockServiceSwitch from './MockServiceSwitch.jsx';
import { kvToObj, objToKv } from '../utils/format.js';

export default function ProjectSettings({
  draft,
  running,
  grpcRunning,
  busy,
  environments,
  onChange,
  onToggleService,
  onToggleGrpcService,
  onSave,
  onDelete,
  dirty,
  saving,
}) {
  return (
    <div className="settings">
      <header className="settings-action-bar">
        <div className="save-state">
          <h2>项目设置</h2>
          <span role="status">{saving ? '保存中…' : dirty ? '未保存' : ''}</span>
        </div>
        <div className="btn-row">
          <button type="button" className="primary" onClick={onSave} disabled={busy}>保存</button>
          <button type="button" className="ghost danger" onClick={onDelete}>删除项目</button>
        </div>
      </header>

      <section className="settings-card">
        <h3 className="settings-card-title">基本信息</h3>
        <div className="settings-grid">
          <label className="settings-field">
            <span>名称</span>
            <input
              value={draft.name}
              onChange={(e) => onChange((d) => { d.name = e.target.value; })}
            />
          </label>
          <label className="settings-field">
            <span>服务 Key</span>
            <input
              value={draft.serviceKey || ''}
              onChange={(e) => onChange((d) => { d.serviceKey = e.target.value; })}
            />
          </label>
          <label className="settings-field">
            <span>HTTP Host</span>
            <input
              value={draft.host}
              onChange={(e) => onChange((d) => { d.host = e.target.value; })}
            />
          </label>
          <label className="settings-field">
            <span>gRPC Host</span>
            <input
              value={draft.grpcHost || '0.0.0.0'}
              onChange={(e) => onChange((d) => { d.grpcHost = e.target.value; })}
            />
          </label>
          <label className="settings-field span-2">
            <span>描述</span>
            <textarea
              value={draft.description || ''}
              rows={3}
              onChange={(e) => onChange((d) => { d.description = e.target.value; })}
            />
          </label>
        </div>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Mock 服务</h3>
        <div className="mock-service-row">
          <strong className="mock-service-label">HTTP</strong>
          <MockServiceSwitch
            enabled={draft.enabled === true}
            running={running}
            port={draft.port}
            busy={busy}
            onToggle={onToggleService}
            onPortChange={(port) => onChange((d) => { d.port = port; })}
            onPortBlur={(port) => onChange((d) => { d.port = port; })}
          />
          <span className={`mock-service-status ${running ? 'on' : 'off'}`}>
            {running ? '运行中' : '已停止'}
          </span>
        </div>
        <div className="mock-service-row">
          <strong className="mock-service-label">gRPC</strong>
          <MockServiceSwitch
            enabled={draft.grpcEnabled === true}
            running={grpcRunning}
            port={draft.grpcPort || 50051}
            busy={busy}
            onToggle={onToggleGrpcService}
            onPortChange={(port) => onChange((d) => { d.grpcPort = port; })}
            onPortBlur={(port) => onChange((d) => { d.grpcPort = port; })}
          />
          <span className={'mock-service-status ' + (grpcRunning ? 'on' : 'off')}>
            {grpcRunning ? '运行中' : '已停止'}
          </span>
        </div>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Client 连接</h3>
        <ServiceConnection project={draft} environments={environments} onChange={onChange} />
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">服务 Headers</h3>
        <KVEditor
          resetKey={`${draft.id}-client-headers`}
          rows={objToKv(draft.clientHeaders)}
          bulkEdit
          onChange={(rows) => onChange((d) => {
            const headers = kvToObj(rows);
            d.clientHeaders = Object.keys(headers).length ? headers : undefined;
          })}
        />
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">服务 Cookies</h3>
        <KVEditor
          resetKey={`${draft.id}-client-cookies`}
          rows={objToKv(draft.clientCookies)}
          keyPlaceholder="Name"
          valuePlaceholder="Value"
          bulkEdit
          onChange={(rows) => onChange((d) => {
            const cookies = kvToObj(rows);
            d.clientCookies = Object.keys(cookies).length ? cookies : undefined;
          })}
        />
      </section>
    </div>
  );
}
