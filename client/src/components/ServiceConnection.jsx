import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { resolveNodePort } from '../utils/environment.js';

export default function ServiceConnection({ project, environments, onChange, compact = false, grpcTarget }) {
  const { activeEnvironmentId, nodePortEnabled, serviceKey } = project;
  const environment = environments.find((env) => env.id === activeEnvironmentId);
  const target = grpcTarget ?? (nodePortEnabled ? resolveNodePort(environment, serviceKey) : environment?.host);
  const warning = nodePortEnabled && !target
    ? `请为 ${serviceKey} 配置 NodePort`
    : !nodePortEnabled && environment && !target ? '请设置服务网关地址' : '';
  const connectionRef = useRef(null);

  useEffect(() => {
    if (!compact) return undefined;
    function closeOutside(event) {
      const popup = connectionRef.current;
      if (popup?.open && !popup.contains(event.target)) popup.open = false;
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [compact]);

  const fields = (
    <div className="service-connection">
      <label className="settings-field">
        <span>环境</span>
        <select value={activeEnvironmentId || ''} onChange={(e) => onChange((draft) => { draft.activeEnvironmentId = e.target.value; })}>
          <option value="">选择环境</option>
          {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
        </select>
      </label>
      <label className="settings-field">
        <span>连接模式</span>
        <select value={nodePortEnabled ? 'nodeport' : 'environment'} onChange={(e) => onChange((draft) => { draft.nodePortEnabled = e.target.value === 'nodeport'; })}>
          <option value="environment">环境网关</option>
          <option value="nodeport">NodePort 直连</option>
        </select>
      </label>
      <div className="connection-target">
        {target && <code title={target}>{target}</code>}
        {warning && <span className="connection-warning">{warning}</span>}
      </div>
    </div>
  );

  if (!compact) return fields;

  return (
    <details className="connection-popover" ref={connectionRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && connectionRef.current.open) {
        connectionRef.current.open = false;
        connectionRef.current.querySelector('summary').focus();
      }
    }}>
      <summary className={warning ? 'connection-warning' : ''} aria-label={`请求连接：${environment?.name || '未选择环境'}${nodePortEnabled ? '，NodePort 直连' : ''}`} title={warning || target}>
        <Icon name="connection" />
        <span title={environment?.name}>{environment?.name || '选择环境'}</span>
        {nodePortEnabled && <small>NodePort</small>}
        <Icon name="down" />
      </summary>
      <div className="connection-popover-panel">{fields}</div>
    </details>
  );
}
