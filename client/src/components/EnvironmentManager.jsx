import { useEffect, useRef, useState } from 'react';

const defaultEnvironment = () => ({
  id: 'local',
  name: 'Local',
  host: 'http://localhost:8080',
  grpcTarget: 'http://127.0.0.1:50051',
});

function normalizeList(environments) {
  return environments?.length
    ? environments.map((env) => ({
      id: env.id,
      name: env.name ?? '',
      host: env.host ?? '',
      grpcTarget: env.grpcTarget ?? '',
    }))
    : [defaultEnvironment()];
}

function listSignature(list) {
  return JSON.stringify(list.map((env) => ({
    id: env.id,
    name: env.name,
    host: env.host,
    grpcTarget: env.grpcTarget,
  })));
}

export default function EnvironmentManager({
  environments,
  activeEnvironmentId,
  resetKey,
  onEnvironmentsChange,
  onActiveEnvironmentChange,
  compact = false,
}) {
  const [list, setList] = useState(() => normalizeList(environments));
  const sigRef = useRef(listSignature(normalizeList(environments)));
  const resetRef = useRef(resetKey);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (resetKey !== resetRef.current) {
      resetRef.current = resetKey;
      dirtyRef.current = false;
      const next = normalizeList(environments);
      sigRef.current = listSignature(next);
      setList(next);
      return;
    }

    const sig = listSignature(normalizeList(environments));
    if (dirtyRef.current) {
      if (sig === sigRef.current) dirtyRef.current = false;
      return;
    }
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setList(normalizeList(environments));
  }, [environments, resetKey]);

  function commit(next) {
    dirtyRef.current = true;
    sigRef.current = listSignature(next);
    setList(next);
    onEnvironmentsChange(next);
  }

  function updateEnv(idx, field, value) {
    commit(list.map((env, i) => (i === idx ? { ...env, [field]: value } : env)));
  }

  function addEnv() {
    const id = `env-${crypto.randomUUID().slice(0, 8)}`;
    commit([...list, {
      id,
      name: `Env ${list.length + 1}`,
      host: 'http://localhost:8080',
      grpcTarget: 'http://127.0.0.1:50051',
    }]);
  }

  function removeEnv(idx) {
    const removed = list[idx];
    const next = list.filter((_, i) => i !== idx);
    const fallback = next.length ? next : [defaultEnvironment()];
    commit(fallback);
    if (removed?.id === activeEnvironmentId) onActiveEnvironmentChange(fallback[0].id);
  }

  return (
    <section className={`env-manager ${compact ? 'compact' : ''}`}>
      <div className="env-manager-head">
        <h4>环境管理</h4>
        <label className="env-active-select">
          当前环境
          <select value={activeEnvironmentId || list[0]?.id || ''} onChange={(e) => onActiveEnvironmentChange(e.target.value)}>
            {list.map((env) => <option key={env.id} value={env.id}>{env.name || '未命名'}</option>)}
          </select>
        </label>
      </div>
      <div className="env-table">
        <div className="env-row env-head">
          <span>名称</span>
          <span>HTTP Host (Base URL)</span>
          <span>gRPC Target</span>
          <span />
        </div>
        {list.map((env, idx) => (
          <div className="env-row" key={env.id}>
            <input className="env-input" value={env.name} placeholder="环境名称" onChange={(e) => updateEnv(idx, 'name', e.target.value)} />
            <input className="env-input mono" value={env.host} placeholder="http://localhost:8080" onChange={(e) => updateEnv(idx, 'host', e.target.value)} />
            <input className="env-input mono" value={env.grpcTarget} placeholder="http://127.0.0.1:50051" onChange={(e) => updateEnv(idx, 'grpcTarget', e.target.value)} />
            <button type="button" className="icon-btn" title="删除环境" disabled={list.length <= 1} onClick={() => removeEnv(idx)}>×</button>
          </div>
        ))}
      </div>
      <button type="button" className="link" onClick={addEnv}>+ 添加环境</button>
    </section>
  );
}
