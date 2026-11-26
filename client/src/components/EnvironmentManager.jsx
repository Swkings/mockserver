import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { environmentNameKey } from '../utils/environment.js';
import { kvToObj, objToKv } from '../utils/format.js';
import KVEditor from './KVEditor.jsx';
import EnvironmentTree from './EnvironmentTree.jsx';
import PanelDivider, { clampPanelWidth, useContainerWidth } from './PanelDivider.jsx';

const emptyEnvironment = () => ({ name: '', host: '', grpcTarget: '', headers: {}, cookies: {}, nodePorts: {} });
const minEnvironmentWidth = 166;
const minServiceWidth = 152;

function NodePortFields({ label, endpoint, onChange }) {
  return (
    <fieldset className="nodeport-fields">
      <legend>{label}</legend>
      <label className="settings-field"><span>协议</span>
        <select value={endpoint.protocol || 'http'} onChange={(event) => onChange({ protocol: event.target.value })}>
          <option value="http">{label === 'gRPC' ? '明文' : 'HTTP'}</option>
          <option value="https">{label === 'gRPC' ? 'TLS' : 'HTTPS'}</option>
        </select>
      </label>
      <label className="settings-field"><span>IP 或主机名</span><input value={endpoint.ip || ''} placeholder="127.0.0.1" onChange={(event) => onChange({ ip: event.target.value })} /></label>
      <label className="settings-field"><span>端口</span><input type="number" min="1" max="65535" value={endpoint.port ?? ''} placeholder={label === 'gRPC' ? '30551' : '30080'} onChange={(event) => onChange({ port: event.target.value })} /></label>
    </fieldset>
  );
}

export default function EnvironmentManager({
  environments, layout, projects, onRefresh, onNotify, onMenu, promptDialog, selectDialog, confirmDialog,
}) {
  const [selection, setSelection] = useState(null);
  const [tab, setTab] = useState('config');
  const [serviceQuery, setServiceQuery] = useState('');
  const [serviceTarget, setServiceTarget] = useState(null);
  const [changes, setChanges] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workspaceRef, workspaceWidth] = useContainerWidth();
  const [preferredEnvironmentWidth, setEnvironmentWidth] = useState(null);
  const [preferredServiceWidth, setServiceWidth] = useState(null);
  const nameRef = useRef(null);
  const current = selection === 'new' ? null : environments.find((env) => env.id === selection) || environments[0];
  const draft = changes || current;
  const key = selection || current?.id || 'empty';
  const nameKey = environmentNameKey(draft?.name);
  const duplicateName = nameKey && environments.some((env) => env.id !== draft?.id && environmentNameKey(env.name) === nameKey);
  const query = serviceQuery.trim().toLowerCase();
  const matchingServices = projects.filter(({ name, serviceKey }) => name.toLowerCase().includes(query) || serviceKey.includes(query));
  const sidebarLimit = Math.max(minEnvironmentWidth, Math.min(480, Math.floor((workspaceWidth || 1440) * 0.28)));
  const defaultEnvironmentWidth = Math.min(256, Math.round((workspaceWidth || 1440) * 0.18));
  const defaultServiceWidth = Math.min(224, Math.round((workspaceWidth || 1440) * 0.16));
  const environmentWidth = clampPanelWidth(preferredEnvironmentWidth ?? defaultEnvironmentWidth, minEnvironmentWidth, sidebarLimit);
  const serviceWidth = clampPanelWidth(preferredServiceWidth ?? defaultServiceWidth, minServiceWidth, sidebarLimit);

  useEffect(() => {
    if (selection === 'new') nameRef.current?.focus();
  }, [selection]);

  useEffect(() => {
    if (!serviceTarget) return;
    const row = document.getElementById(`environment-nodeport-${serviceTarget.serviceKey}`);
    row?.scrollIntoView({ block: 'start', inline: 'nearest' });
    row?.focus({ preventScroll: true });
  }, [serviceTarget]);

  function patch(fields) {
    setChanges({ ...draft, ...fields });
    setError('');
  }

  async function choose(id) {
    if (busy || selection === id || current?.id === id) return;
    if (changes && !await confirmDialog({ title: '切换环境', message: '当前环境有未保存的更改。', confirmLabel: '放弃更改' })) return;
    setSelection(id);
    setChanges(id === 'new' ? emptyEnvironment() : null);
    setTab('config');
    setServiceTarget(null);
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    if (!draft || busy) return;
    if (!nameKey || duplicateName) {
      setError(duplicateName ? '环境名称已存在' : '请输入环境名称');
      setTab('config');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await api.saveEnvironment(draft);
      await onRefresh();
      setSelection(saved.id);
      setChanges(null);
      onNotify('环境已保存');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current || !await confirmDialog({
      title: '删除环境',
      message: `确定删除 ${current.name} 及其 NodePort 配置？`,
      danger: true,
      confirmLabel: '删除',
    })) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteEnvironment(current.id);
      await onRefresh();
      setSelection(null);
      setChanges(null);
      setServiceTarget(null);
      onNotify('环境已删除');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateEndpoint(serviceKey, fields, transport) {
    const nodePorts = { ...draft.nodePorts };
    const current = Object.hasOwn(nodePorts, serviceKey) ? nodePorts[serviceKey] : {};
    nodePorts[serviceKey] = transport === 'grpc'
      ? { ...current, grpc: { ...current.grpc, ...fields } }
      : { ...current, ...fields };
    patch({ nodePorts });
  }

  function jumpToService(serviceKey) {
    setTab('nodeports');
    setServiceTarget({ serviceKey });
  }

  return (
    <div className="page-scroll scroll-y environment-page">
      <div ref={workspaceRef} className="environment-workspace" style={{ '--environment-list-width': `${environmentWidth}px`, '--environment-service-width': `${serviceWidth}px` }}>
        <EnvironmentTree
          snapshot={layout}
          environments={environments}
          projects={projects}
          currentId={current?.id}
          disabled={busy}
          onSelect={choose}
          onCreate={() => choose('new')}
          onRefresh={onRefresh}
          onMenu={onMenu}
          promptDialog={promptDialog}
          selectDialog={selectDialog}
          confirmDialog={confirmDialog}
        />
        <PanelDivider label="调整环境列表宽度" controls="environment-list" width={environmentWidth} min={minEnvironmentWidth} max={sidebarLimit} onResize={setEnvironmentWidth} />
        <nav id="environment-service-list" className="environment-service-list" aria-labelledby="environment-services-label">
          <div className="environment-service-head">
            <h2 id="environment-services-label">服务列表</h2>
            {projects.length > 0 && (
              <input type="search" className="field" aria-label="搜索服务" placeholder="搜索服务" value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} />
            )}
          </div>
          <div className="environment-service-items scroll-y">
            {matchingServices.map(({ id, name, serviceKey }) => {
              const active = tab === 'nodeports' && serviceTarget?.serviceKey === serviceKey;
              return (
                <button key={id} type="button" className={`nav-item environment-service-item${active ? ' active' : ''}`} aria-current={active ? 'location' : undefined} disabled={!draft || busy} onClick={() => jumpToService(serviceKey)}>
                  <span className="nav-item-name" title={name}>{name}</span>
                </button>
              );
            })}
            {matchingServices.length === 0 && <p className="nav-list-empty">{projects.length ? '未找到匹配的服务' : '暂无服务'}</p>}
          </div>
        </nav>
        <PanelDivider label="调整服务列表宽度" controls="environment-service-list" width={serviceWidth} min={minServiceWidth} max={sidebarLimit} onResize={setServiceWidth} />
        {draft ? (
          <form className="environment-detail" onSubmit={save}>
            <div className="environment-detail-head">
              <nav className="tabs environment-tabs" aria-label="环境设置">
                {[['config', '配置'], ['nodeports', 'NodePort']].map(([id, label]) => (
                  <button key={id} type="button" aria-current={tab === id ? 'true' : undefined} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
                ))}
              </nav>
              <div className="btn-row environment-actions">
                <span className="environment-save-state" role="status">{busy ? '处理中…' : selection === 'new' ? '新环境' : changes ? '未保存' : ''}</span>
                {current && <button type="button" className="ghost danger" disabled={busy} onClick={remove}>删除</button>}
                <button type="submit" className="primary" disabled={!changes || busy}>保存环境</button>
              </div>
            </div>
            {error && <div className="alert error" role="alert">{error}</div>}
            <fieldset className="environment-fields scroll-y" disabled={busy}>
              {tab === 'config' && (
                <div className="environment-config">
                  <section aria-labelledby="environment-basics">
                    <h2 id="environment-basics">基本信息</h2>
                    <div className="environment-form-grid">
                      <label className="settings-field"><span>环境名称</span><input ref={nameRef} value={draft.name} onChange={(e) => patch({ name: e.target.value })} /></label>
                      <label className="settings-field"><span>服务网关地址</span><input placeholder="https://gateway.example.com" value={draft.host} onChange={(e) => patch({ host: e.target.value })} /></label>
                      <label className="settings-field"><span>gRPC 网关地址</span><input placeholder="127.0.0.1:50051" value={draft.grpcTarget} onChange={(e) => patch({ grpcTarget: e.target.value })} /></label>
                    </div>
                  </section>
                  <section aria-labelledby="environment-headers">
                    <h2 id="environment-headers">Headers</h2>
                    <KVEditor resetKey={`${key}-headers`} rows={objToKv(draft.headers)} bulkEdit onChange={(rows) => patch({ headers: kvToObj(rows) })} />
                  </section>
                  <section aria-labelledby="environment-cookies">
                    <h2 id="environment-cookies">Cookies</h2>
                    <KVEditor resetKey={`${key}-cookies`} rows={objToKv(draft.cookies)} keyPlaceholder="Name" bulkEdit onChange={(rows) => patch({ cookies: kvToObj(rows) })} />
                  </section>
                </div>
              )}
              {tab === 'nodeports' && (
                <div className="nodeport-list">
                  {!projects.length && <p className="hint">暂无服务</p>}
                  {projects.map(({ id, name, serviceKey }) => {
                    const endpoint = Object.hasOwn(draft.nodePorts || {}, serviceKey) ? draft.nodePorts[serviceKey] : {};
                    return (
                      <div
                        key={id} id={`environment-nodeport-${serviceKey}`} tabIndex={-1}
                        className={`nodeport-row${serviceTarget?.serviceKey === serviceKey ? ' nodeport-row-target' : ''}`}
                        role="group" aria-labelledby={`environment-nodeport-name-${serviceKey}`}
                      >
                        <strong className="nodeport-identity" id={`environment-nodeport-name-${serviceKey}`}>{name}</strong>
                        <div className="nodeport-addresses">
                          <NodePortFields label="HTTP" endpoint={endpoint} onChange={(fields) => updateEndpoint(serviceKey, fields, 'http')} />
                          <NodePortFields label="gRPC" endpoint={endpoint.grpc || {}} onChange={(fields) => updateEndpoint(serviceKey, fields, 'grpc')} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </form>
        ) : <div className="environment-detail placeholder">暂无环境</div>}
      </div>
    </div>
  );
}
