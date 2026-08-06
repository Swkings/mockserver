import { useEffect, useMemo, useRef, useState } from 'react';
import KVEditor from './KVEditor.jsx';
import SplitPane from './SplitPane.jsx';
import EnvironmentManager from './EnvironmentManager.jsx';
import BodyPresetToolbar from './BodyPresetToolbar.jsx';
import SchemaFieldRows from './SchemaFieldRows.jsx';
import { api } from '../api.js';
import { parseHttpRequestSchema, schemaExample } from '../utils/httpRequestSchema.js';
import {
  HTTP_METHODS,
  objToKv,
  kvToObj,
  paramsToKv,
  kvToParams,
  mergeClientHeaders,
  buildCurl,
  buildRestClientRequest,
  prettyJson,
  statusClass,
  formatDuration,
} from '../utils/format.js';
import {
  parsePathParams,
  resolveClientApiUrl,
  syncApiPathParams,
} from '../utils/environment.js';

function cookieStringToRows(cookie = '') {
  const pairs = String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!pairs.length) return [{ key: '', value: '' }];
  return pairs.map((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return { key: part, value: '' };
    return { key: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
  });
}

function cookieRowsToString(rows = []) {
  return rows
    .map((row) => ({ key: row.key?.trim(), value: row.value ?? '' }))
    .filter((row) => row.key)
    .map((row) => `${row.key}=${row.value}`)
    .join('; ');
}

function cookieRowsToObj(rows = []) {
  const out = {};
  for (const row of rows || []) {
    const key = row.key?.trim();
    if (key) out[key] = row.value ?? '';
  }
  return out;
}

function objToCookieRows(obj = {}) {
  return objToKv(obj).map((row) => ({ key: row.key, value: row.value }));
}

function mergeCookieValues(projectCookies = {}, actionCookie = '', useProjectCookies = true) {
  const merged = {
    ...(useProjectCookies ? projectCookies : {}),
    ...cookieRowsToObj(cookieStringToRows(actionCookie)),
  };
  return cookieRowsToString(objToCookieRows(merged));
}


function rowsToObjectAll(rows = []) {
  const out = {};
  for (const row of rows || []) {
    const key = row.key?.trim();
    if (key) out[key] = row.value ?? '';
  }
  return out;
}

function rowsToParamsAll(rows = []) {
  const values = {};
  const descriptions = {};
  for (const row of rows || []) {
    const key = row.key?.trim();
    if (!key) continue;
    values[key] = row.value ?? '';
    if (row.description?.trim()) descriptions[key] = row.description.trim();
  }
  return {
    values: Object.keys(values).length ? values : undefined,
    descriptions: Object.keys(descriptions).length ? descriptions : undefined,
  };
}

function disabledKeysFromRows(rows = []) {
  return rows.filter((row) => row.enabled === false && row.key?.trim()).map((row) => row.key.trim());
}

function withDisabledRows(rows = [], disabledKeys = []) {
  const disabled = new Set(disabledKeys || []);
  return rows.map((row) => ({ ...row, enabled: !disabled.has(row.key) }));
}

function filterDisabledObject(obj = {}, disabledKeys = []) {
  const disabled = new Set(disabledKeys || []);
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (!disabled.has(key)) out[key] = value;
  }
  return out;
}

function headersWithoutCookie(headers = {}) {
  const next = { ...(headers || {}) };
  delete next.Cookie;
  delete next.cookie;
  return next;
}

export default function ClientApiEditor({
  projectId,
  projectResetKey,
  projectHeaders,
  projectCookies,
  environments,
  activeEnvironmentId,
  onProjectPatch,
  clientApi,
  clientApiIndex,
  onChange,
  onRemove,
  onSave,
  busy,
  onSent,
}) {
  const [tab, setTab] = useState('body');
  const [schemaView, setSchemaView] = useState(clientApi.requestSchemaSource ? 'structure' : 'source');
  const [requestFormat, setRequestFormat] = useState('curl');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [sendError, setSendError] = useState('');
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [envMenuOpen, setEnvMenuOpen] = useState(false);
  const [rightTab, setRightTab] = useState('response');
  const envPickerRef = useRef(null);
  const requestSchema = useMemo(
    () => parseHttpRequestSchema(
      clientApi.requestSchemaSource,
      clientApi.requestSchemaLanguage || 'auto',
      clientApi.requestSchemaRoot
    ),
    [clientApi.requestSchemaSource, clientApi.requestSchemaLanguage, clientApi.requestSchemaRoot]
  );

  const useProjectHeaders = clientApi.useProjectHeaders !== false;
  const useProjectCookies = clientApi.useProjectCookies !== false;
  const apiHeaders = useMemo(() => headersWithoutCookie(clientApi.headers), [clientApi.headers]);
  const headerRows = useMemo(
    () => withDisabledRows(objToKv(apiHeaders), clientApi.disabledHeaders),
    [apiHeaders, clientApi.disabledHeaders]
  );
  const queryParamRows = useMemo(
    () => withDisabledRows(paramsToKv(clientApi.queryParams, clientApi.queryParamDescriptions), clientApi.disabledQueryParams),
    [clientApi.queryParams, clientApi.queryParamDescriptions, clientApi.disabledQueryParams]
  );
  const projectHeaderRows = useMemo(() => objToKv(projectHeaders), [projectHeaders]);
  const projectCookieRows = useMemo(() => objToCookieRows(projectCookies), [projectCookies]);
  const cookieValue = clientApi.headers?.Cookie ?? clientApi.headers?.cookie ?? '';
  const cookieRows = useMemo(
    () => withDisabledRows(cookieStringToRows(cookieValue), clientApi.disabledCookies),
    [cookieValue, clientApi.disabledCookies]
  );
  const effectiveClientApiHeaders = useMemo(
    () => filterDisabledObject(apiHeaders, clientApi.disabledHeaders),
    [apiHeaders, clientApi.disabledHeaders]
  );
  const effectiveClientApiCookies = useMemo(
    () => cookieRowsToString(cookieRows),
    [cookieRows]
  );
  const effectiveQueryParams = useMemo(
    () => filterDisabledObject(clientApi.queryParams, clientApi.disabledQueryParams),
    [clientApi.queryParams, clientApi.disabledQueryParams]
  );
  const effectiveClientApi = useMemo(
    () => ({ ...clientApi, queryParams: effectiveQueryParams }),
    [clientApi, effectiveQueryParams]
  );
  const mergedCookieValue = useMemo(
    () => mergeCookieValues(projectCookies, effectiveClientApiCookies, useProjectCookies),
    [projectCookies, effectiveClientApiCookies, useProjectCookies]
  );
  const mergedHeaders = useMemo(
    () => mergeClientHeaders(
      useProjectHeaders ? projectHeaders : undefined,
      effectiveClientApiHeaders,
      mergedCookieValue ? { Cookie: mergedCookieValue } : undefined
    ) || {},
    [useProjectHeaders, projectHeaders, effectiveClientApiHeaders, mergedCookieValue]
  );
  const pathParamNames = useMemo(() => parsePathParams(clientApi.url), [clientApi.url]);
  const resolvedUrl = useMemo(
    () => resolveClientApiUrl({ environments, activeEnvironmentId, clientApi: effectiveClientApi }),
    [environments, activeEnvironmentId, effectiveClientApi]
  );
  const curlCommand = useMemo(
    () => buildCurl({
      method: clientApi.method,
      url: resolvedUrl,
      headers: mergedHeaders,
      body: clientApi.body,
      allowGetBody: clientApi.allowGetBody === true,
    }),
    [clientApi.method, resolvedUrl, mergedHeaders, clientApi.body, clientApi.allowGetBody]
  );
  const restClientRequest = useMemo(
    () => buildRestClientRequest({
      method: clientApi.method,
      url: resolvedUrl,
      headers: mergedHeaders,
      body: clientApi.body,
      allowGetBody: clientApi.allowGetBody === true,
    }),
    [clientApi.method, resolvedUrl, mergedHeaders, clientApi.body, clientApi.allowGetBody]
  );
  const requestText = requestFormat === 'curl' ? curlCommand : restClientRequest;
  const paramsCount = Object.keys(effectiveQueryParams || {}).filter(Boolean).length;
  const headersCount = Object.keys(headersWithoutCookie(mergedHeaders)).filter(Boolean).length;
  const cookiesCount = cookieStringToRows(mergedCookieValue).filter((row) => row.key?.trim()).length;
  const activeEnv = useMemo(
    () => environments?.find((e) => e.id === activeEnvironmentId) || environments?.[0],
    [environments, activeEnvironmentId]
  );
  const activeEnvName = activeEnv?.name || '默认';
  const activeEnvHost = activeEnv?.host || '';

  useEffect(() => {
    if (!envMenuOpen) return undefined;
    function handlePointerDown(e) {
      if (envPickerRef.current && !envPickerRef.current.contains(e.target)) {
        setEnvMenuOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setEnvMenuOpen(false);
    }
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [envMenuOpen]);

  function patch(updater) {
    onChange((prev) => {
      const next = structuredClone(prev);
      updater(next.clientApis[clientApiIndex]);
      return next;
    });
  }

  function updateUrl(value) {
    onChange((prev) => {
      const next = structuredClone(prev);
      const item = next.clientApis[clientApiIndex];
      item.url = value;
      syncApiPathParams(item);
      return next;
    });
  }

  function updatePathParam(name, value) {
    patch((a) => {
      a.pathParams = { ...(a.pathParams || {}), [name]: value };
    });
  }

  function updatePathParamDescription(name, description) {
    patch((a) => {
      const descs = { ...(a.pathParamDescriptions || {}) };
      if (description.trim()) descs[name] = description.trim();
      else delete descs[name];
      a.pathParamDescriptions = Object.keys(descs).length ? descs : undefined;
    });
  }

  function updateActionHeaders(rows) {
    patch((a) => {
      const cookie = a.headers?.Cookie ?? a.headers?.cookie;
      const headers = rowsToObjectAll(rows);
      if (cookie) headers.Cookie = cookie;
      a.headers = headers;
      const disabled = disabledKeysFromRows(rows);
      a.disabledHeaders = disabled.length ? disabled : undefined;
    });
  }

  function updateCookie(value) {
    patch((a) => {
      const headers = headersWithoutCookie(a.headers);
      if (value.trim()) headers.Cookie = value;
      a.headers = headers;
    });
  }

  function updateCookieRows(rows) {
    patch((a) => {
      const headers = headersWithoutCookie(a.headers);
      const cookie = cookieRowsToString(rows.map((row) => ({ ...row, enabled: true })));
      if (cookie.trim()) headers.Cookie = cookie;
      a.headers = headers;
      const disabled = disabledKeysFromRows(rows);
      a.disabledCookies = disabled.length ? disabled : undefined;
    });
  }

  function formatBodyJson() {
    patch((a) => {
      a.body = prettyJson(a.body);
    });
  }

  function generateBodyFromSchema() {
    patch((a) => {
      a.body = JSON.stringify(schemaExample(requestSchema), null, 2);
    });
  }

  function inferSchemaFromBody() {
    patch((a) => {
      a.requestSchemaLanguage = 'json';
      a.requestSchemaSource = a.body || '{}';
      a.requestSchemaRoot = undefined;
    });
    setSchemaView('structure');
  }

  async function handleSend() {
    setSending(true);
    setSendError('');
    setSendResult(null);
    try {
      const result = await api.sendClientApi(projectId, clientApi.id, {
        url: resolvedUrl,
        method: clientApi.method,
        headers: mergedHeaders,
        body: clientApi.body,
        allowGetBody: clientApi.allowGetBody === true,
        useProjectHeaders,
        useProjectCookies,
        proxy: clientApi.proxy === true,
        insecureTls: clientApi.insecureTls === true,
      });
      setSendResult(result);
      setRightTab('response');
      onSent?.(result);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  const leftPanel = (
    <>
      <div className="tabs">
        {[
          { id: 'params', label: 'Params', count: paramsCount },
          { id: 'headers', label: 'Headers', count: headersCount },
          { id: 'cookies', label: 'Cookies', count: cookiesCount },
          { id: 'body', label: 'Body', count: 0 },
          { id: 'setting', label: 'Setting', count: 0 },
        ].map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span>{t.label}</span>
            {t.count > 0 && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'params' && (
        <div className="panel">
          <section>
            <h4>Query Params</h4>
            <p className="hint section-hint">追加到 URL 的查询参数（?key=value）</p>
            <KVEditor
              resetKey={`${clientApi.id}-params`}
              rows={queryParamRows}
              keyPlaceholder="参数名"
              valuePlaceholder="参数值"
              descriptionPlaceholder="说明"
              withDescription
              bulkEdit
              onChange={(rows) => patch((a) => {
                const { values, descriptions } = rowsToParamsAll(rows);
                a.queryParams = values;
                a.queryParamDescriptions = descriptions;
                const disabled = disabledKeysFromRows(rows);
                a.disabledQueryParams = disabled.length ? disabled : undefined;
              })}
            />
          </section>
        </div>
      )}

      {tab === 'headers' && (
        <div className="panel">
          <label className="inherit-switch">
            <input
              type="checkbox"
              checked={useProjectHeaders}
              onChange={(e) => patch((a) => { a.useProjectHeaders = e.target.checked; })}
            />
            <span>启用项目 Headers</span>
          </label>
          {useProjectHeaders && projectHeaderRows.some((r) => r.key.trim()) && (
            <section className="inherited-headers">
              <h4>项目 Headers</h4>
              <p className="hint section-hint">继承自项目设置，所有 Client API 自动携带</p>
              <div className="kv-readonly">
                <div className="kv-head">
                  <span>Key</span>
                  <span>Value</span>
                </div>
                {projectHeaderRows.filter((r) => r.key.trim()).map((row) => (
                  <div className="kv-row readonly" key={row.key}>
                    <span>{row.key}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section>
            <h4>API Headers</h4>
            <p className="hint section-hint">仅本 API 生效，同名 Header 覆盖项目配置</p>
            <KVEditor
              resetKey={clientApi.id}
              rows={headerRows}
              bulkEdit
              onChange={updateActionHeaders}
            />
          </section>
          {Object.keys(mergedHeaders).length > 0 && (
            <p className="hint merged-headers-hint">
              实际发送 Headers：{Object.entries(mergedHeaders).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {tab === 'cookies' && (
        <div className="panel cookies-panel">
          <label className="inherit-switch">
            <input
              type="checkbox"
              checked={useProjectCookies}
              onChange={(e) => patch((a) => { a.useProjectCookies = e.target.checked; })}
            />
            <span>启用项目 Cookies</span>
          </label>
          {useProjectCookies && projectCookieRows.some((r) => r.key.trim()) && (
            <section className="inherited-headers">
              <h4>项目 Cookies</h4>
              <p className="hint section-hint">继承自项目设置，接口级同名 Cookie 可覆盖</p>
              <div className="kv-readonly">
                <div className="kv-head">
                  <span>Name</span>
                  <span>Value</span>
                </div>
                {projectCookieRows.filter((r) => r.key.trim()).map((row) => (
                  <div className="kv-row readonly" key={row.key}>
                    <span>{row.key}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section>
            <h4>Cookies</h4>
            <p className="hint section-hint">以 Cookie 请求头发送，支持多个 name/value 项。</p>
            <KVEditor
              resetKey={`${clientApi.id}-cookies`}
              rows={cookieRows}
              keyPlaceholder="Name"
              valuePlaceholder="Value"
              bulkEdit
              onChange={updateCookieRows}
            />
          </section>
        </div>
      )}

      {tab === 'body' && (
        <div className="panel fill-panel http-request-body">
          <div className="grpc-body-grid http-body-grid">
            <section className="grpc-schema-panel http-schema-panel">
              <div className="grpc-body-pane-head">
                <strong>请求参数结构</strong>
                <code>{requestSchema.typeName || requestSchema.language}</code>
              </div>
              <div className="http-schema-toolbar">
                <select
                  className="field"
                  aria-label="结构代码语言"
                  value={clientApi.requestSchemaLanguage || 'auto'}
                  onChange={(event) => patch((a) => {
                    a.requestSchemaLanguage = event.target.value;
                    a.requestSchemaRoot = undefined;
                  })}
                >
                  <option value="auto">自动识别</option>
                  <option value="go">Go</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="json">JSON</option>
                </select>
                {requestSchema.availableTypes.length > 1 && (
                  <select
                    className="field"
                    aria-label="根类型"
                    value={requestSchema.typeName}
                    onChange={(event) => patch((a) => { a.requestSchemaRoot = event.target.value; })}
                  >
                    {requestSchema.availableTypes.map((typeName) => (
                      <option value={typeName} key={typeName}>{typeName}</option>
                    ))}
                  </select>
                )}
                <div className="mini-tabs http-schema-tabs">
                  <button type="button" className={schemaView === 'source' ? 'active' : ''} onClick={() => setSchemaView('source')}>源码</button>
                  <button type="button" className={schemaView === 'structure' ? 'active' : ''} onClick={() => setSchemaView('structure')}>结构</button>
                </div>
                <button type="button" className="ghost sm" onClick={inferSchemaFromBody}>从 Body</button>
              </div>
              {schemaView === 'source' ? (
                <textarea
                  className="http-schema-source"
                  value={clientApi.requestSchemaSource || ''}
                  spellCheck={false}
                  placeholder="粘贴 Go struct、JavaScript 对象、TypeScript interface、Python dataclass/Pydantic、Java class 或 JSON"
                  onChange={(event) => patch((a) => {
                    a.requestSchemaSource = event.target.value;
                    a.requestSchemaRoot = undefined;
                  })}
                />
              ) : requestSchema.error ? (
                <div className="http-schema-message error">{requestSchema.error}</div>
              ) : requestSchema.fields.length ? (
                <div className="grpc-schema-tree">
                  <SchemaFieldRows fields={requestSchema.fields} />
                </div>
              ) : (
                <div className="http-schema-message">请先粘贴代码结构，或从当前 Body 推断。</div>
              )}
            </section>
            <section className="grpc-request-json-panel">
              <div className="body-toolbar grpc-body-json-toolbar">
                <strong>请求 Body</strong>
                <BodyPresetToolbar
                  presets={clientApi.bodyPresets}
                  body={clientApi.body}
                  onBodyChange={(body) => patch((a) => { a.body = body; })}
                  onPresetsChange={(bodyPresets) => patch((a) => { a.bodyPresets = bodyPresets; })}
                  onSave={onSave}
                />
                <div className="grpc-body-actions">
                  <button type="button" className="ghost sm" disabled={!requestSchema.fields.length} onClick={generateBodyFromSchema}>生成示例</button>
                  <button type="button" className="ghost sm" onClick={formatBodyJson}>格式化</button>
                  <label className="body-get-switch" title="GET 请求携带 Body">
                    <input
                      type="checkbox"
                      checked={clientApi.allowGetBody === true}
                      onChange={(e) => patch((a) => { a.allowGetBody = e.target.checked; })}
                    />
                    <span>GET Body</span>
                  </label>
                </div>
              </div>
              <textarea
                className="code-input fill"
                value={clientApi.body ?? ''}
                spellCheck={false}
                onChange={(e) => patch((a) => { a.body = e.target.value; })}
              />
            </section>
          </div>
        </div>
      )}
      {tab === "setting" && (
        <div className="panel settings-panel">
          <section>
            <h4>Request Settings</h4>
            <label className="inherit-switch setting-option" title="Uses HTTP_PROXY, HTTPS_PROXY and NO_PROXY from the server environment">
              <input
                type="checkbox"
                checked={clientApi.proxy === true}
                onChange={(e) => patch((a) => { a.proxy = e.target.checked; })}
              />
              <span>Proxy</span>
            </label>
            <p className="hint setting-hint">
              {clientApi.proxy === true ? "Uses the server proxy environment" : "Direct connection; proxy disabled by default"}
            </p>
            <label className="inherit-switch setting-option" title="Disables TLS certificate verification for this API">
              <input
                type="checkbox"
                checked={clientApi.insecureTls === true}
                onChange={(e) => patch((a) => { a.insecureTls = e.target.checked; })}
              />
              <span>Skip TLS verify</span>
            </label>
            <p className="hint setting-hint">
              {clientApi.insecureTls === true ? "TLS certificate verification is disabled" : "TLS certificate verification is enabled by default"}
            </p>
          </section>
        </div>
      )}
    </>
  );

  const rightPanel = rightTab === 'request' ? (
    <div className="side-panel">
      <div className="request-meta">
        <span className="hint">环境：{activeEnvName}</span>
        <span className="hint">{(clientApi.method || 'POST').toUpperCase()}</span>
      </div>
      {pathParamNames.length > 0 && (
        <div className="request-params">
          <span className="hint">路径参数</span>
          {pathParamNames.map((name) => (
            <span key={name} className="param-chip" title={clientApi.pathParamDescriptions?.[name]}>
              {name}={clientApi.pathParams?.[name] ?? ''}
              {clientApi.pathParamDescriptions?.[name] && (
                <em className="param-chip-desc">{clientApi.pathParamDescriptions[name]}</em>
              )}
            </span>
          ))}
        </div>
      )}
      {Object.keys(effectiveQueryParams || {}).length > 0 && (
        <div className="request-params">
          <span className="hint">Query</span>
          {Object.entries(effectiveQueryParams).map(([key, value]) => (
            <span key={key} className="param-chip" title={clientApi.queryParamDescriptions?.[key]}>
              {key}={value}
              {clientApi.queryParamDescriptions?.[key] && (
                <em className="param-chip-desc">{clientApi.queryParamDescriptions[key]}</em>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="request-format-toolbar">
        <div className="request-format-tabs">
          <button
            type="button"
            className={requestFormat === 'curl' ? 'active' : ''}
            onClick={() => setRequestFormat('curl')}
          >
            curl
          </button>
          <button
            type="button"
            className={requestFormat === 'rest' ? 'active' : ''}
            onClick={() => setRequestFormat('rest')}
          >
            REST Client
          </button>
        </div>
        <button
          type="button"
          className="ghost copy-curl-btn"
          onClick={() => navigator.clipboard.writeText(requestText)}
        >
          复制{requestFormat === 'curl' ? ' curl' : ' REST'}
        </button>
      </div>
      <pre className="code-block fill">{requestText}</pre>
    </div>
  ) : (
    <div className="side-panel">
      {sendError && <div className="alert error">{sendError}</div>}
      {!sendResult && !sendError && (
        <div className="record-empty side-empty">点击「发送」执行请求，响应将显示在这里</div>
      )}
      {sendResult && (
        <>
          <div className="response-meta">
            <span className={`detail-status ${statusClass(sendResult.status)}`}>{sendResult.status}</span>
            <span className="hint">{formatDuration(sendResult.durationMs)}</span>
          </div>
          <pre className="code-block fill">{prettyJson(sendResult.body) || sendResult.body || '(empty)'}</pre>
        </>
      )}
    </div>
  );

  const rightHeader = (
    <div className="split-right-tabs">
      <button
        type="button"
        className={rightTab === 'response' ? 'active' : ''}
        onClick={() => setRightTab('response')}
      >
        响应
      </button>
      <button
        type="button"
        className={rightTab === 'request' ? 'active' : ''}
        onClick={() => setRightTab('request')}
      >
        实际请求
      </button>
    </div>
  );

  return (
    <div className="editor-page">
      <div className="editor-head">
        <div className="editor-title">
          <input
            className="title-input"
            value={clientApi.name}
            placeholder="API 名称"
            onChange={(e) => patch((a) => { a.name = e.target.value; })}
          />
        </div>
        <div className="env-toolbar">
        <div className="env-summary">
          <span>环境</span>
          <strong>{activeEnvName}</strong>
          {activeEnvHost && <code>{activeEnvHost}</code>}
        </div>
        <div className="env-controls">
          <div className="env-picker" ref={envPickerRef}>
            <button
              type="button"
              className={`env-picker-trigger ${envMenuOpen ? 'active' : ''}`}
              onClick={() => setEnvMenuOpen((value) => !value)}
              aria-haspopup="listbox"
              aria-expanded={envMenuOpen}
            >
              <span className="env-picker-title">{activeEnvName}</span>
              {activeEnvHost && <span className="env-picker-host">{activeEnvHost}</span>}
              <span className="env-picker-caret">⌄</span>
            </button>
            {envMenuOpen && (
              <div className="env-picker-menu" role="listbox">
                {(environments || []).map((env) => {
                  const selected = env.id === (activeEnvironmentId || environments?.[0]?.id);
                  return (
                    <button
                      key={env.id}
                      type="button"
                      className={`env-picker-option ${selected ? 'selected' : ''}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onProjectPatch((d) => { d.activeEnvironmentId = env.id; });
                        setEnvMenuOpen(false);
                      }}
                    >
                      <span>{env.name || '未命名环境'}</span>
                      <code>{env.host}</code>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`ghost env-edit-btn ${showEnvEditor ? 'active' : ''}`}
            onClick={() => setShowEnvEditor((v) => !v)}
            title="管理环境"
          >
            管理环境
          </button>
        </div>
      </div>
      </div>

      <div className="url-bar">
        <select
          className="method-select"
          value={(clientApi.method || 'POST').toUpperCase()}
          onChange={(e) => patch((a) => { a.method = e.target.value; })}
        >
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          className="url-input"
          value={clientApi.url || ''}
          placeholder="/api/path/:id"
          onChange={(e) => updateUrl(e.target.value)}
        />
        <div className="url-actions">
          <button type="button" className="primary" onClick={handleSend} disabled={sending || busy}>
            {sending ? '发送中…' : '发送'}
          </button>
          <button type="button" className="ghost" onClick={onSave} disabled={busy}>保存</button>
          <button type="button" className="ghost danger" onClick={onRemove}>删除</button>
        </div>
      </div>

      {showEnvEditor && (
        <EnvironmentManager
          compact
          resetKey={projectResetKey}
          environments={environments}
          activeEnvironmentId={activeEnvironmentId}
          onEnvironmentsChange={(envs) => onProjectPatch((d) => {
            d.environments = envs;
            if (!envs.some((env) => env.id === d.activeEnvironmentId)) {
              d.activeEnvironmentId = envs[0]?.id;
            }
          })}
          onActiveEnvironmentChange={(id) => onProjectPatch((d) => { d.activeEnvironmentId = id; })}
        />
      )}

      {pathParamNames.length > 0 && (
        <div className="path-params">
          <span className="path-params-label">路径参数</span>
          <div className="param-fields">
            <div className="param-fields-head">
              <span>参数名</span>
              <span>参数值</span>
              <span>说明</span>
            </div>
            {pathParamNames.map((name) => (
              <div className="param-fields-row" key={name}>
                <span className="param-name">{name}</span>
                <input
                  value={clientApi.pathParams?.[name] ?? ''}
                  placeholder={`${name}`}
                  onChange={(e) => updatePathParam(name, e.target.value)}
                />
                <input
                  className="desc-input"
                  value={clientApi.pathParamDescriptions?.[name] ?? ''}
                  placeholder={`${name}`}
                  onChange={(e) => updatePathParamDescription(name, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <SplitPane
        className="editor-split"
        rightHeader={rightHeader}
        initialRightWidth={400}
        minLeft={360}
        minRight={300}
        left={leftPanel}
        right={rightPanel}
      />
    </div>
  );
}
