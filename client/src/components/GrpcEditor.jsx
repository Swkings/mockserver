import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { kvToObj, objToKv, prettyJson } from '../utils/format.js';
import KVEditor from './KVEditor.jsx';
import SplitPane from './SplitPane.jsx';
import EnvironmentManager from './EnvironmentManager.jsx';
import { getActiveEnvironment } from '../utils/environment.js';
import { sortGrpcMethods } from '../utils/grpc.js';
import GrpcMethodPicker from './GrpcMethodPicker.jsx';

const GRPC_CODES = [
  [0, 'OK'], [1, 'CANCELLED'], [2, 'UNKNOWN'], [3, 'INVALID_ARGUMENT'],
  [4, 'DEADLINE_EXCEEDED'], [5, 'NOT_FOUND'], [6, 'ALREADY_EXISTS'],
  [7, 'PERMISSION_DENIED'], [8, 'RESOURCE_EXHAUSTED'], [9, 'FAILED_PRECONDITION'],
  [10, 'ABORTED'], [11, 'OUT_OF_RANGE'], [12, 'UNIMPLEMENTED'], [13, 'INTERNAL'],
  [14, 'UNAVAILABLE'], [15, 'DATA_LOSS'], [16, 'UNAUTHENTICATED'],
];

function normalizeGrpcTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'http://127.0.0.1:50051';
  if (raw.includes('://')) {
    try {
      return new URL(raw).host;
    } catch {
      const schemeIndex = raw.indexOf('://');
      return raw.slice(schemeIndex + 3).split('/')[0];
    }
  }
  return raw.split('/')[0];
}

function methodType(method) {
  if (!method) return '手动方法 / 未匹配 Proto';
  if (method.requestStream && method.responseStream) return 'Bidi streaming';
  if (method.requestStream) return 'Client streaming';
  if (method.responseStream) return 'Server streaming';
  return 'Unary';
}


const INTEGER_TYPES = new Set(["int32", "uint32", "sint32", "fixed32", "sfixed32", "int64", "uint64", "sint64", "fixed64", "sfixed64"]);

function randomToken(prefix = "value") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function randomScalar(field) {
  if (field.kind === "enum") {
    const values = field.values || [];
    return values[Math.floor(Math.random() * values.length)] || "UNKNOWN";
  }
  if (field.type === "bool") return Math.random() >= 0.5;
  if (INTEGER_TYPES.has(field.type)) return Math.floor(Math.random() * 1000);
  if (field.type === "double" || field.type === "float") return Number((Math.random() * 100).toFixed(2));
  if (field.type === "bytes") return btoa(randomToken("bytes"));
  return randomToken(field.name || "value");
}

function randomFieldValue(field, depth = 0, ignoreRepeated = false) {
  if (!ignoreRepeated && field.repeated && field.kind !== "map") {
    return Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => randomFieldValue(field, depth, true));
  }
  if (field.kind === "map") {
    return { [randomToken("key")]: field.value ? randomFieldValue(field.value, depth + 1, true) : randomToken() };
  }
  if (field.kind === "message") {
    if (depth >= 6 || field.message?.recursive) return {};
    return Object.fromEntries((field.message?.fields || []).map((child) => [child.name, randomFieldValue(child, depth + 1)]));
  }
  return randomScalar(field);
}

function randomPayload(schema, streaming = false) {
  const payload = Object.fromEntries((schema?.fields || []).map((field) => [field.name, randomFieldValue(field)]));
  return streaming ? [payload] : payload;
}

function randomRequest(method) {
  return randomPayload(method?.requestSchema, method?.requestStream);
}

function randomResponse(method) {
  return randomPayload(method?.responseSchema, method?.responseStream);
}

function fieldTypeLabel(field) {
  let label = field.type || "unknown";
  if (field.kind === "message") label = String(field.type || "message").split(".").pop();
  if (field.kind === "map") label = `map<${field.key?.type || "string"}, ${field.value?.type || "unknown"}>`;
  return field.repeated && field.kind !== "map" ? `${label}[]` : label;
}

function SchemaFieldRows({ fields, depth = 0 }) {
  return (fields || []).map((field) => {
    const children = field.kind === "message"
      ? field.message?.fields
      : (field.kind === "map" && field.value?.kind === "message" ? field.value.message?.fields : null);
    return (
      <div className="grpc-schema-node" key={`${depth}-${field.number}-${field.name}`}>
        <div className="grpc-schema-row" style={{ paddingLeft: `${10 + depth * 16}px` }}>
          <span className="grpc-schema-name">{field.name}</span>
          <span className={`grpc-schema-type ${field.kind}`}>{fieldTypeLabel(field)}</span>
        </div>
        {children?.length > 0 && <SchemaFieldRows fields={children} depth={depth + 1} />}
      </div>
    );
  });
}

export default function GrpcEditor({
  mode,
  openVersion,
  projectId,
  item,
  itemIndex,
  environments,
  activeEnvironmentId,
  onProjectPatch,
  onChange,
  onRemove,
  onSave,
  onSent,
  busy,
}) {
  const isMock = mode === 'mock';
  const collectionKey = isMock ? 'grpcMocks' : 'grpcClients';
  const [tab, setTab] = useState(isMock ? 'mock' : 'body');
  const [services, setServices] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [rightTab, setRightTab] = useState('response');
  const [showEnvEditor, setShowEnvEditor] = useState(false);

  useEffect(() => {
    setTab(isMock ? 'mock' : 'body');
  }, [openVersion, isMock]);

  const selectedService = useMemo(() => services.find((service) => (
    service.packageName === item.packageName && service.serviceName === item.serviceName
  )) || services.find((service) => service.serviceName === item.serviceName), [services, item.packageName, item.serviceName]);
  const selectedMethod = useMemo(() => selectedService?.methods.find((method) => (
    method.name.toLowerCase() === String(item.methodName || '').toLowerCase()
    || method.key.toLowerCase() === String(item.methodName || '').toLowerCase()
  )), [selectedService, item.methodName]);
  const sortedMethods = useMemo(
    () => sortGrpcMethods(selectedService?.methods || []),
    [selectedService]
  );
  const metadataRows = useMemo(() => objToKv(item.metadata), [item.metadata]);
  const activeEnvironment = useMemo(
    () => getActiveEnvironment(environments, activeEnvironmentId),
    [environments, activeEnvironmentId]
  );
  const useEnvironment = item.useEnvironment !== false;
  const resolvedTarget = normalizeGrpcTarget(useEnvironment
    ? (activeEnvironment?.grpcTarget || item.target || 'http://127.0.0.1:50051')
    : (item.target || 'http://127.0.0.1:50051'));


  const actualRequestPath = `${[item.packageName, item.serviceName].filter(Boolean).join(".")}/${item.methodName || "Method"}`;
  const actualRequestBody = typeof item.request === "string"
    ? (item.request || "{}")
    : JSON.stringify(item.request || {});
  const grpcurlCommand = [
    "grpcurl",
    item.useTls === true ? null : "-plaintext",
    `-max-time ${Math.max(1, Number(item.timeoutMs) || 10000) / 1000}`,
    ...Object.entries(item.metadata || {}).map(([key, value]) => `-H ${JSON.stringify(`${key}: ${value}`)}`),
    `-d ${JSON.stringify(actualRequestBody)}`,
    resolvedTarget,
    actualRequestPath,
  ].filter(Boolean).join(" ");

  function patch(updater) {
    onChange((draft) => {
      const next = structuredClone(draft);
      updater(next[collectionKey][itemIndex]);
      return next;
    });
  }

  function applyParsedServices(nextServices) {
    setServices(nextServices);
    const service = nextServices.find((candidate) => (
      candidate.packageName === item.packageName && candidate.serviceName === item.serviceName
    )) || nextServices.find((candidate) => candidate.serviceName === item.serviceName) || nextServices[0];
    if (!service) return;
    const serviceMatches = service.packageName === item.packageName && service.serviceName === item.serviceName;
    const matchedMethod = service.methods.find((candidate) => (
      candidate.name.toLowerCase() === String(item.methodName || '').toLowerCase()
    ));
    const firstMethod = sortGrpcMethods(service.methods)[0];
    const nextMethodName = matchedMethod?.name || firstMethod?.name || item.methodName;
    if (serviceMatches && nextMethodName === item.methodName) return;
    patch((target) => {
      target.packageName = service.packageName;
      target.serviceName = service.serviceName;
      target.methodName = nextMethodName;
    });
  }

  async function inspectProto({ silent = false } = {}) {
    if (!String(item.proto || '').trim()) return;
    setParsing(true);
    if (!silent) setError('');
    try {
      const response = await api.inspectGrpc({ proto: item.proto, protoFilename: item.protoFilename });
      applyParsedServices(response.services || []);
    } catch (inspectError) {
      if (!silent) setError(inspectError.message);
    } finally {
      setParsing(false);
    }
  }

  useEffect(() => {
    if (!String(item.proto || '').trim()) {
      setServices([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setParsing(true);
      try {
        const response = await api.inspectGrpc({ proto: item.proto, protoFilename: item.protoFilename });
        if (active) applyParsedServices(response.services || []);
      } catch {
        if (active) setServices([]);
      } finally {
        if (active) setParsing(false);
      }
    }, 650);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [item.proto, item.protoFilename]);

  async function importProto(file) {
    if (!file) return;
    setParsing(true);
    setError('');
    try {
      const proto = await file.text();
      const response = await api.inspectGrpc({ proto, protoFilename: file.name });
      const nextServices = response.services || [];
      const service = nextServices[0];
      const method = sortGrpcMethods(service?.methods || [])[0];
      setServices(nextServices);
      patch((target) => {
        target.proto = proto;
        target.protoFilename = file.name;
        if (service && method) {
          target.packageName = service.packageName;
          target.serviceName = service.serviceName;
          target.methodName = method.name;
        }
      });
      setTab('definition');
    } catch (importError) {
      setError(importError.message);
    } finally {
      setParsing(false);
    }
  }

  function handleProtoPaste(event) {
    const protoFile = [...(event.clipboardData?.files || [])]
      .find((file) => file.name?.toLowerCase().endsWith('.proto'));
    if (!protoFile) return;
    event.preventDefault();
    importProto(protoFile);
  }

  async function sendRequest() {
    setSending(true);
    setError('');
    setResult(null);
    try {
      const response = await api.sendGrpcClient(projectId, item.id, { ...item, target: resolvedTarget });
      setResult(response);
      setRightTab('response');
      onSent?.(response);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  const left = (
    <>
      <div className="tabs">
        <button type="button" className={`tab ${tab === 'definition' ? 'active' : ''}`} onClick={() => setTab('definition')}>服务定义</button>
        <button type="button" className={`tab ${tab === 'proto' ? 'active' : ''}`} onClick={() => setTab('proto')}>Proto</button>
        <button type="button" className={`tab ${tab === 'options' ? 'active' : ''}`} onClick={() => setTab('options')}>高级</button>
        {isMock && <button type="button" className={`tab ${tab === 'mock' ? 'active' : ''}`} onClick={() => setTab('mock')}>Mock</button>}
        {!isMock && <button type="button" className={`tab ${tab === 'body' ? 'active' : ''}`} onClick={() => setTab('body')}>Body</button>}
      </div>

      {tab === 'definition' && (
        <div className="panel grpc-definition-panel">
          <section>
            <div className="grpc-section-head">
              <h4>Service</h4>
              <button type="button" className="ghost sm" disabled={parsing || !item.proto} onClick={() => inspectProto()}>{parsing ? '解析中…' : '重新解析'}</button>
            </div>
            {services.length > 0 ? (
              <div className="grpc-select-grid grpc-service-grid">
                <label>
                  <span>Service</span>
                  <select value={`${item.packageName}.${item.serviceName}`} onChange={(event) => {
                    const service = services.find((candidate) => candidate.fullName === event.target.value);
                    if (!service) return;
                    const firstMethod = sortGrpcMethods(service.methods)[0];
                    patch((target) => {
                      target.packageName = service.packageName;
                      target.serviceName = service.serviceName;
                      target.methodName = firstMethod?.name || target.methodName;
                    });
                  }}>
                    {services.map((service) => <option key={service.fullName} value={service.fullName}>{service.fullName}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <div className="grpc-select-grid">
                <label><span>Package</span><input value={item.packageName || ''} onChange={(e) => patch((target) => { target.packageName = e.target.value; })} /></label>
                <label><span>Service</span><input value={item.serviceName || ''} onChange={(e) => patch((target) => { target.serviceName = e.target.value; })} /></label>
              </div>
            )}
            <p className="hint">当前方法类型：<strong>{methodType(selectedMethod)}</strong>。方法在上方 RPC 路径栏选择或手动输入。</p>
          </section>
          <section>
            <h4>说明</h4>
            <textarea className="field grpc-description" value={item.description || ''} onChange={(e) => patch((target) => { target.description = e.target.value; })} />
          </section>
        </div>
      )}

      {!isMock && tab === "body" && (
        <div className="panel fill-panel grpc-request-body">
          <div className="grpc-body-grid">
            <section className="grpc-schema-panel">
              <div className="grpc-body-pane-head">
                <strong>请求参数结构</strong>
                {selectedMethod?.requestSchema && <code>{selectedMethod.requestSchema.typeName}{selectedMethod.requestStream ? "[]" : ""}</code>}
              </div>
              {selectedMethod?.requestSchema ? (
                <div className="grpc-schema-tree">
                  {selectedMethod.requestSchema.fields?.length > 0
                    ? <SchemaFieldRows fields={selectedMethod.requestSchema.fields} />
                    : <div className="record-empty grpc-schema-empty">该请求消息没有参数</div>}
                </div>
              ) : (
                <div className="record-empty grpc-schema-empty">请先导入 Proto 并选择其中的方法</div>
              )}
            </section>
            <section className="grpc-request-json-panel">
              <div className="body-toolbar grpc-body-json-toolbar">
                <strong>请求 JSON</strong>
                <div className="grpc-body-actions">
                  <button
                    type="button"
                    className="ghost sm"
                    disabled={!selectedMethod?.requestSchema}
                    onClick={() => patch((target) => { target.request = JSON.stringify(randomRequest(selectedMethod), null, 2); })}
                  >随机生成</button>
                  <button type="button" className="link" onClick={() => patch((target) => { target.request = prettyJson(target.request); })}>格式化</button>
                </div>
              </div>
              <textarea className="code-input fill" value={item.request ?? ""} spellCheck={false} onChange={(e) => patch((target) => { target.request = e.target.value; })} />
            </section>
          </div>
        </div>
      )}

      {isMock && tab === "mock" && (
        <div className="panel fill-panel grpc-request-body grpc-mock-workspace">
          <div className="grpc-body-grid">
            <section className="grpc-schema-panel">
              <div className="grpc-body-pane-head">
                <strong>响应参数结构</strong>
                {selectedMethod?.responseSchema && <code>{selectedMethod.responseSchema.typeName}{selectedMethod.responseStream ? "[]" : ""}</code>}
              </div>
              {selectedMethod?.responseSchema ? (
                <div className="grpc-schema-tree">
                  {selectedMethod.responseSchema.fields?.length > 0
                    ? <SchemaFieldRows fields={selectedMethod.responseSchema.fields} />
                    : <div className="record-empty grpc-schema-empty">该响应消息没有参数</div>}
                </div>
              ) : (
                <div className="record-empty grpc-schema-empty">请先导入 Proto 并选择其中的方法</div>
              )}
            </section>
            <section className="grpc-request-json-panel">
              <div className="body-toolbar grpc-body-json-toolbar">
                <strong>Mock 响应 JSON</strong>
                <div className="grpc-body-actions">
                  <button
                    type="button"
                    className="ghost sm"
                    disabled={!selectedMethod?.responseSchema}
                    onClick={() => patch((target) => { target.response = JSON.stringify(randomResponse(selectedMethod), null, 2); })}
                  >随机生成</button>
                  <button type="button" className="link" onClick={() => patch((target) => { target.response = prettyJson(target.response); })}>格式化</button>
                </div>
              </div>
              <textarea className="code-input fill" value={item.response ?? ""} spellCheck={false} onChange={(e) => patch((target) => { target.response = e.target.value; })} />
            </section>
          </div>
          {error && <div className="grpc-error">{error}</div>}
        </div>
      )}

      {tab === 'proto' && (
        <div className="panel fill-panel">
          <div className="grpc-section-head">
            <div>
              <strong>{item.protoFilename || 'service.proto'}</strong>
              <p className="hint">可粘贴 Proto 文本或 Proto 文件；停止输入后自动解析 Service 和 Method。</p>
            </div>
            <div className="grpc-proto-actions">
              <span className={`grpc-parse-state ${parsing ? 'busy' : ''}`}>{parsing ? '解析中…' : services.length ? `已解析 ${services.length} 个 Service` : '等待 Proto'}</span>
              <label className="ghost file-btn">导入 .proto<input type="file" accept=".proto" hidden onChange={(e) => importProto(e.target.files?.[0])} /></label>
            </div>
          </div>
          <textarea
            className="code-input fill"
            value={item.proto || ''}
            spellCheck={false}
            placeholder={'粘贴 Proto 内容，或粘贴/导入 .proto 文件\n\nsyntax = "proto3";\npackage demo;'}
            onPaste={handleProtoPaste}
            onChange={(e) => {
              patch((target) => { target.proto = e.target.value; });
              setServices([]);
            }}
          />
        </div>
      )}

      {tab === 'options' && (
        <div className="panel">
          {isMock ? (
            <>
              <div className="inline-row">
                <label>Delay (ms)<input type="number" min={0} value={item.delayMs ?? 0} onChange={(e) => patch((target) => { target.delayMs = Number(e.target.value); })} /></label>
                <label>gRPC Status<select value={item.errorCode ?? 0} onChange={(e) => patch((target) => { target.errorCode = Number(e.target.value) || undefined; })}>{GRPC_CODES.map(([code, name]) => <option key={code} value={code}>{code} {name}</option>)}</select></label>
              </div>
              <section><h4>错误信息</h4><input className="field" value={item.errorMessage || ''} onChange={(e) => patch((target) => { target.errorMessage = e.target.value; })} /></section>
            </>
          ) : (
            <>
              <div className="inline-row">
                <label>Timeout (ms)<input type="number" min={1} value={item.timeoutMs ?? 10000} onChange={(e) => patch((target) => { target.timeoutMs = Number(e.target.value); })} /></label>
                <label className="check"><input type="checkbox" checked={item.useTls === true} onChange={(e) => patch((target) => { target.useTls = e.target.checked; })} />TLS</label>
              </div>
              <section>
                <h4>Target</h4>
                <input className="field mono-field" value={item.target || ''} disabled={useEnvironment} placeholder="http://127.0.0.1:50051" onChange={(e) => patch((target) => { target.target = e.target.value; })} />
                <p className="hint">启用环境时使用当前环境的 gRPC Target；关闭后使用这里的地址。</p>
              </section>
              <section><h4>Metadata</h4><KVEditor resetKey={`${item.id}-metadata`} rows={metadataRows} bulkEdit onChange={(rows) => patch((target) => { const values = kvToObj(rows); target.metadata = Object.keys(values).length ? values : undefined; })} /></section>
            </>
          )}
        </div>
      )}
    </>
  );

  const right = rightTab === "request" ? (
    <div className="side-panel grpc-actual-request">
      <div className="request-meta">
        <span className="hint">环境：{useEnvironment ? (activeEnvironment?.name || "默认") : "接口配置"}</span>
        <span className="hint">{methodType(selectedMethod)}</span>
      </div>
      <div className="request-params">
        <span className="hint">Target</span>
        <span className="param-chip">{resolvedTarget}</span>
        <span className="param-chip">{item.useTls === true ? "TLS" : "Plaintext"}</span>
      </div>
      <div className="request-params">
        <span className="hint">RPC</span>
        <span className="param-chip">/{actualRequestPath}</span>
      </div>
      {Object.keys(item.metadata || {}).length > 0 && (
        <div className="request-params">
          <span className="hint">Metadata</span>
          {Object.entries(item.metadata).map(([key, value]) => (
            <span key={key} className="param-chip">{key}={String(value)}</span>
          ))}
        </div>
      )}
      <div className="request-format-toolbar">
        <div className="request-format-tabs">
          <button type="button" className="active">grpcurl</button>
        </div>
        <button type="button" className="ghost copy-curl-btn" onClick={() => navigator.clipboard.writeText(grpcurlCommand)}>复制 grpcurl</button>
      </div>
      <pre className="code-block fill">{grpcurlCommand}</pre>
    </div>
  ) : (
    <div className="side-panel grpc-response-panel">
      {error && <div className="grpc-error">{error}</div>}
      {!result && !error && <div className="record-empty side-empty">点击「调用」执行请求，响应将显示在这里</div>}
      {result && (
        <>
          <div className="response-meta">
            <span className="detail-status status-2xx">OK</span>
            <span className="hint">{result.methodType} · {result.durationMs} ms</span>
          </div>
          <pre className="code-block fill">{prettyJson(JSON.stringify(result.response)) || '(empty)'}</pre>
        </>
      )}
    </div>
  );


  const rightHeader = (
    <div className="split-right-tabs">
      <button type="button" className={rightTab === "response" ? "active" : ""} onClick={() => setRightTab("response")}>响应</button>
      <button type="button" className={rightTab === "request" ? "active" : ""} onClick={() => setRightTab("request")}>实际请求</button>
    </div>
  );

  return (
    <div className="editor-page grpc-editor">
      <div className="editor-head">
        <div className="editor-title">
          {isMock && <label className="toggle-switch" title="启用"><input type="checkbox" checked={item.enabled !== false} onChange={(e) => patch((target) => { target.enabled = e.target.checked; })} /><span className="toggle-track" /></label>}
          <span className="protocol-badge grpc">gRPC</span>
          <input className="title-input" value={item.name} onChange={(e) => patch((target) => { target.name = e.target.value; })} />
        </div>
      </div>
      {!isMock && (<>
        <div className="env-toolbar grpc-env-toolbar">
          <div className="env-summary">
            <span>环境</span>
            <strong>{activeEnvironment?.name || '默认'}</strong>
            <code>{resolvedTarget}</code>
          </div>
          <div className="env-controls">
            <select className="env-inline-select" value={activeEnvironmentId || environments?.[0]?.id || ''} disabled={!useEnvironment} onChange={(e) => onProjectPatch?.((draft) => { draft.activeEnvironmentId = e.target.value; })}>
              {(environments || []).map((env) => <option key={env.id} value={env.id}>{env.name || '未命名'}</option>)}
            </select>
            <label className="inherit-switch grpc-env-switch">
              <input type="checkbox" checked={useEnvironment} onChange={(e) => patch((target) => { target.useEnvironment = e.target.checked; })} />
              <span>使用环境</span>
            </label>
            <button type="button" className="ghost" onClick={() => setShowEnvEditor((value) => !value)}>{showEnvEditor ? '收起' : '管理环境'}</button>
          </div>
        </div>
        {showEnvEditor && (
          <EnvironmentManager
            compact
            resetKey={projectId}
            environments={environments}
            activeEnvironmentId={activeEnvironmentId}
            onEnvironmentsChange={(next) => onProjectPatch?.((draft) => {
              draft.environments = next;
              if (!next.some((env) => env.id === draft.activeEnvironmentId)) draft.activeEnvironmentId = next[0]?.id;
            })}
            onActiveEnvironmentChange={(id) => onProjectPatch?.((draft) => { draft.activeEnvironmentId = id; })}
          />
        )}
      </>)}
      <div className="url-bar grpc-rpc-bar">
        <span className="method-select grpc-method-select">RPC</span>
        <div className="grpc-rpc-path-editor">
          <code>/{[item.packageName, item.serviceName].filter(Boolean).join(".")}/</code>
          <GrpcMethodPicker
            methods={sortedMethods}
            selectedMethod={selectedMethod}
            currentMethodName={item.methodName}
            onSelect={(method) => {
              patch((target) => { target.methodName = method.name; });
              setTab(isMock ? 'mock' : 'body');
            }}
          />
        </div>
        <div className="url-actions">
          {!isMock && <button type="button" className="primary" disabled={sending || busy || !item.proto} onClick={sendRequest}>{sending ? '调用中…' : '调用'}</button>}
          <button type="button" className={isMock ? 'primary' : 'ghost'} onClick={onSave} disabled={busy}>保存</button>
          <button type="button" className="ghost danger" onClick={onRemove}>删除</button>
        </div>
      </div>
      {isMock
        ? <div className="grpc-editor-single">{left}</div>
        : <SplitPane className="editor-split" rightHeader={rightHeader} initialRightWidth={460} minLeft={380} minRight={340} left={left} right={right} />}
    </div>
  );
}
