import Icon from './Icon.jsx';
import Dropdown from './Dropdown.jsx';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { kvToObj, objToKv, prettyJson } from '../utils/format.js';
import KVEditor from './KVEditor.jsx';
import SplitPane from './SplitPane.jsx';
import RequestAddress from './RequestAddress.jsx';
import ServiceConnection from './ServiceConnection.jsx';
import { getActiveEnvironment, grpcTargetAuthority, resolveGrpcTarget } from '../utils/environment.js';
import { sortGrpcMethods } from '../utils/grpc.js';
import GrpcMethodPicker from './GrpcMethodPicker.jsx';
import BodyPresetToolbar from './BodyPresetToolbar.jsx';
import SchemaFieldRows from './SchemaFieldRows.jsx';

const GRPC_CODES = [
  [0, 'OK'], [1, 'CANCELLED'], [2, 'UNKNOWN'], [3, 'INVALID_ARGUMENT'],
  [4, 'DEADLINE_EXCEEDED'], [5, 'NOT_FOUND'], [6, 'ALREADY_EXISTS'],
  [7, 'PERMISSION_DENIED'], [8, 'RESOURCE_EXHAUSTED'], [9, 'FAILED_PRECONDITION'],
  [10, 'ABORTED'], [11, 'OUT_OF_RANGE'], [12, 'UNIMPLEMENTED'], [13, 'INTERNAL'],
  [14, 'UNAVAILABLE'], [15, 'DATA_LOSS'], [16, 'UNAUTHENTICATED'],
];

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

export default function GrpcEditor({
  mode,
  openVersion,
  projectId,
  protos,
  item,
  itemIndex,
  environments,
  project,
  onProjectPatch,
  onChange,
  actions,
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

  useEffect(() => {
    setTab(isMock ? 'mock' : 'body');
  }, [openVersion, isMock]);

  const selectedProto = useMemo(
    () => (protos || []).find((proto) => proto.id === item.protoId) || null,
    [protos, item.protoId]
  );
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
  const { activeEnvironmentId, nodePortEnabled, serviceKey } = project || {};
  const environment = activeEnvironmentId ? getActiveEnvironment(environments, activeEnvironmentId) : null;
  const useEnvironment = item.useEnvironment !== false;
  const target = activeEnvironmentId && !environment
    ? ''
    : resolveGrpcTarget({ environment, serviceKey, nodePortEnabled, item });
  const resolvedTarget = grpcTargetAuthority(target);
  const useTls = nodePortEnabled ? target.startsWith('https:') : item.useTls === true;

  const actualRequestPath = `${[item.packageName, item.serviceName].filter(Boolean).join(".")}/${item.methodName || "Method"}`;
  const requestAddress = /^(?:\[[^\]]+\]|[^:]+)$/.test(resolvedTarget)
    ? `${resolvedTarget}:443`
    : resolvedTarget;
  const actualRequestBody = typeof item.request === "string"
    ? (item.request || "{}")
    : JSON.stringify(item.request || {});
  const grpcurlCommand = [
    "grpcurl",
    useTls ? null : "-plaintext",
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
    if (!String(selectedProto?.content || '').trim()) return;
    setParsing(true);
    if (!silent) setError('');
    try {
      const response = await api.inspectGrpc({
        proto: selectedProto.content,
        protoFilename: selectedProto.filename,
      });
      applyParsedServices(response.services || []);
    } catch (inspectError) {
      if (!silent) setError(inspectError.message);
    } finally {
      setParsing(false);
    }
  }

  useEffect(() => {
    if (!String(selectedProto?.content || '').trim()) {
      setServices([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setParsing(true);
      try {
        const response = await api.inspectGrpc({
          proto: selectedProto.content,
          protoFilename: selectedProto.filename,
        });
        if (active) {
          applyParsedServices(response.services || []);
          setError('');
        }
      } catch (inspectError) {
        if (active) {
          setServices([]);
          setError(inspectError.message);
        }
      } finally {
        if (active) setParsing(false);
      }
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedProto?.content, selectedProto?.filename]);

  function changeProto(protoId) {
    setServices([]);
    setError('');
    patch((target) => {
      target.protoId = protoId || undefined;
      target.packageName = '';
      target.serviceName = '';
      target.methodName = '';
    });
  }

  async function sendRequest() {
    setSending(true);
    setError('');
    setResult(null);
    try {
      const response = await api.sendGrpcClient(projectId, item.id, { ...item, activeEnvironmentId: activeEnvironmentId || "", nodePortEnabled });
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
        <button type="button" className={`tab ${tab === 'options' ? 'active' : ''}`} onClick={() => setTab('options')}>高级</button>
        {isMock && <button type="button" className={`tab ${tab === 'mock' ? 'active' : ''}`} onClick={() => setTab('mock')}>Mock</button>}
        {!isMock && <>
          <button type="button" className={`tab ${tab === 'body' ? 'active' : ''}`} onClick={() => setTab('body')}>Body</button>
          <button type="button" className={`tab ${tab === 'schema' ? 'active' : ''}`} onClick={() => setTab('schema')}>结构</button>
        </>}
      </div>

      {tab === 'definition' && (
        <div className="panel grpc-definition-panel">
          <section>
            <h4>Proto</h4>
            <select className="field mono-field" aria-label="Proto" value={item.protoId || ''} onChange={(event) => changeProto(event.target.value)}>
              <option value="">未关联 Proto</option>
              {(protos || []).map((proto) => (
                <option value={proto.id} key={proto.id}>{proto.name || proto.filename} · {proto.filename}</option>
              ))}
            </select>
          </section>
          <section>
            <div className="grpc-section-head">
              <h4>Service</h4>
              <button type="button" className="ghost sm" disabled={parsing || !selectedProto} onClick={() => inspectProto()}>{parsing ? '解析中…' : '重新解析'}</button>
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
            {selectedMethod && <p className="hint">{methodType(selectedMethod)}</p>}
          </section>
          <section>
            <h4>说明</h4>
            <textarea className="field grpc-description" value={item.description || ''} onChange={(e) => patch((target) => { target.description = e.target.value; })} />
          </section>
        </div>
      )}

      {!isMock && tab === 'schema' && (
        <div className="panel fill-panel editor-schema-panel">
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
              <div className="record-empty grpc-schema-empty">请先关联项目 Proto 并选择其中的方法</div>
            )}
          </section>
        </div>
      )}

      {!isMock && tab === 'body' && (
        <div className="panel fill-panel grpc-request-body">
          <section className="grpc-request-json-panel editor-body-panel">
            <div className="body-toolbar grpc-body-json-toolbar">
              <BodyPresetToolbar
                presets={item.bodyPresets}
                body={item.request}
                onBodyChange={(body) => patch((target) => { target.request = body; })}
                onPresetsChange={(bodyPresets) => patch((target) => { target.bodyPresets = bodyPresets; })}
                onSave={onSave}
              />
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
            <textarea className="code-input fill" aria-label="请求 JSON" value={item.request ?? ""} spellCheck={false} onChange={(e) => patch((target) => { target.request = e.target.value; })} />
          </section>
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
                <div className="record-empty grpc-schema-empty">请先关联项目 Proto 并选择其中的方法</div>
              )}
            </section>
            <section className="grpc-request-json-panel">
              <div className="body-toolbar grpc-body-json-toolbar">
                <strong>Mock 响应 JSON</strong>
                <BodyPresetToolbar
                  presets={item.bodyPresets}
                  body={item.response}
                  onBodyChange={(body) => patch((target) => { target.response = body; })}
                  onPresetsChange={(bodyPresets) => patch((target) => { target.bodyPresets = bodyPresets; })}
                  onSave={onSave}
                />
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
                <label className="check"><input type="checkbox" checked={useTls} disabled={nodePortEnabled} onChange={(e) => patch((target) => { target.useTls = e.target.checked; })} />TLS</label>
              </div>
              <section>
                <label className="inherit-switch">
                  <input type="checkbox" checked={useEnvironment} disabled={nodePortEnabled} onChange={(e) => patch((target) => { target.useEnvironment = e.target.checked; })} />
                  <span>使用环境的 gRPC 地址</span>
                </label>
                <input className="field mono-field" aria-label="自定义 gRPC 地址" value={item.target || ''} disabled={useEnvironment || nodePortEnabled} placeholder="http://127.0.0.1:50051" onChange={(e) => patch((target) => { target.target = e.target.value; })} />
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
      <div className="request-format-toolbar">
        <code>grpcurl</code>
        <button type="button" className="ghost copy-curl-btn" disabled={!resolvedTarget} onClick={() => navigator.clipboard.writeText(grpcurlCommand)}>复制</button>
      </div>
      <pre className="code-block fill">{resolvedTarget ? grpcurlCommand : '请配置连接地址'}</pre>
    </div>
  ) : (
    <div className="side-panel grpc-response-panel">
      {error && <div className="grpc-error">{error}</div>}
      {!result && !error && <div className="record-empty side-empty">暂无响应</div>}
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
      <div className="url-bar grpc-rpc-bar">
        <div className="request-line">
          <span className="method-select grpc-method-select">RPC</span>
          {!isMock && <RequestAddress address={requestAddress} />}
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
        </div>
        {!isMock && (
          <ServiceConnection compact grpcTarget={resolvedTarget} project={project} environments={environments} onChange={onProjectPatch} />
        )}
        <div className="url-actions">
          {!isMock && <button type="button" className="primary" disabled={sending || busy || !selectedMethod || !resolvedTarget} onClick={sendRequest}>{sending ? '调用中…' : '调用'}</button>}
          <button type="button" className={isMock ? 'primary' : 'ghost'} onClick={onSave} disabled={busy}>保存</button>
          <Dropdown trigger={<Icon name="more" />} label="接口操作" items={actions} disabled={busy} />
        </div>
      </div>
      {isMock
        ? <div className="grpc-editor-single">{left}</div>
        : <SplitPane className="editor-split" rightHeader={rightHeader} rightFraction={0.43} minLeft={380} minRight={340} left={left} right={right} />}
    </div>
  );
}
