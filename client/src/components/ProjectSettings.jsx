import KVEditor from './KVEditor.jsx';
import EnvironmentManager from './EnvironmentManager.jsx';
import MockServiceSwitch from './MockServiceSwitch.jsx';
import { kvToObj } from '../utils/format.js';

export default function ProjectSettings({
  draft,
  running,
  grpcRunning,
  busy,
  clientHeaderRows,
  clientCookieRows,
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
      <header className="settings-head">
        <div>
          <h2>项目设置</h2>
          <p className="settings-sub">配置 Mock 服务、环境与公共请求头</p>
        </div>
      </header>

      <div className="settings-action-bar">
        <div className="save-state">
          <strong>{draft.name || '未命名项目'}</strong>
          <span>{saving ? '保存中' : dirty ? '有未保存更改' : '已保存'}</span>
        </div>
        <div className="btn-row">
          <button type="button" className="primary" onClick={onSave} disabled={busy}>保存</button>
          <button type="button" className="ghost danger" onClick={onDelete}>删除项目</button>
        </div>
      </div>

      <section className="settings-card">
        <h3 className="settings-card-title">基本信息</h3>
        <div className="settings-grid">
          <label className="settings-field span-2">
            <span>名称</span>
            <input
              value={draft.name}
              onChange={(e) => onChange((d) => { d.name = e.target.value; })}
            />
          </label>
          <label className="settings-field span-2">
            <span>HTTP Host</span>
            <input
              value={draft.host}
              onChange={(e) => onChange((d) => { d.host = e.target.value; })}
            />
          </label>
          <label className="settings-field span-2">
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
        <h3 className="settings-card-title">Mock Server 运行时</h3>
        <p className="hint section-hint">
          关闭时可修改端口；开启后服务监听该端口，端口不可编辑
        </p>
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
        <EnvironmentManager
          resetKey={draft.id}
          environments={draft.environments}
          activeEnvironmentId={draft.activeEnvironmentId}
          onEnvironmentsChange={(envs) => onChange((d) => {
            d.environments = envs;
            if (!envs.some((env) => env.id === d.activeEnvironmentId)) {
              d.activeEnvironmentId = envs[0]?.id;
            }
          })}
          onActiveEnvironmentChange={(id) => onChange((d) => { d.activeEnvironmentId = id; })}
        />
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Client API 公共 Headers</h3>
        <p className="hint section-hint">配置后可应用到本项目所有 Client API，接口级同名 Header 可覆盖</p>
        <KVEditor
          resetKey={`${draft.id}-client-headers`}
          rows={clientHeaderRows}
          bulkEdit
          onChange={(rows) => onChange((d) => {
            const headers = kvToObj(rows);
            d.clientHeaders = Object.keys(headers).length ? headers : undefined;
          })}
        />
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Client API 公共 Cookies</h3>
        <p className="hint section-hint">配置后可应用到本项目所有 Client API，接口级同名 Cookie 可覆盖</p>
        <KVEditor
          resetKey={`${draft.id}-client-cookies`}
          rows={clientCookieRows}
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
