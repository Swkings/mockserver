import Icon from './Icon.jsx';
import Dropdown from './Dropdown.jsx';
import { useEffect, useMemo, useState } from 'react';
import KVEditor from './KVEditor.jsx';
import SplitPane from './SplitPane.jsx';
import RequestAddress from './RequestAddress.jsx';
import ServiceConnection from './ServiceConnection.jsx';
import BodyPresetToolbar from './BodyPresetToolbar.jsx';
import SchemaFieldRows from './SchemaFieldRows.jsx';
import { api } from '../api.js';
import { parseHttpRequestSchema, schemaExample } from '../utils/httpRequestSchema.js';
import {
  HTTP_METHODS,
  objToKv,
  paramsToKv,
  kvToParams,
  buildCurl,
  buildRestClientRequest,
  prettyJson,
  statusClass,
  formatDuration,
} from '../utils/format.js';
import {
  getActiveEnvironment,
  parsePathParams,
  resolveHttpHeaders,
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
    .filter((row) => row.enabled !== false)
    .map((row) => ({ key: row.key?.trim(), value: row.value ?? '' }))
    .filter((row) => row.key)
    .map((row) => `${row.key}=${row.value}`)
    .join('; ');
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

function cookieHeader(headers) {
  return Object.entries(headers || {}).find(([name]) => name.toLowerCase() === 'cookie')?.[1] || '';
}

function headersWithoutCookie(headers) {
  return Object.fromEntries(Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== 'cookie'));
}

async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return { name: file.name, type: file.type, base64: btoa(binary) };
}

function downloadResponse(result) {
  const { base64, contentType, contentDisposition } = result.download;
  const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  let name = match?.[1] ? decodeURIComponent(match[1]) : match?.[2];
  name = (name || 'download').split(/[\\/]/).pop() || 'download';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType || 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function requestOrigin(url) {
  return URL.canParse(url) ? new URL(url).origin : '';
}

export default function ClientApiEditor({
  projectId,
  project,
  environments,
  onProjectPatch,
  clientApi,
  clientApiIndex,
  onChange,
  actions,
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
  const [uploadFile, setUploadFile] = useState(null);
  const [rightTab, setRightTab] = useState('response');
  const bodyType = clientApi.bodyType || 'text';

  useEffect(() => { setUploadFile(null); setSendResult(null); }, [clientApi.id]);
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
  const { activeEnvironmentId, nodePortEnabled } = project;
  const activeEnv = activeEnvironmentId ? getActiveEnvironment(environments, activeEnvironmentId) : null;
  const inherited = resolveHttpHeaders({ environment: activeEnv, project, inheritHeaders: useProjectHeaders, inheritCookies: useProjectCookies });
  const projectHeaderRows = objToKv(headersWithoutCookie(inherited));
  const projectCookieRows = cookieStringToRows(cookieHeader(inherited));
  const cookieValue = cookieHeader(clientApi.headers);
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
  const outboundApiHeaders = {
    ...effectiveClientApiHeaders,
    ...(effectiveClientApiCookies ? { Cookie: effectiveClientApiCookies } : {}),
  };
  const mergedHeaders = resolveHttpHeaders({
    environment: activeEnv,
    project,
    apiHeaders: outboundApiHeaders,
    inheritHeaders: useProjectHeaders,
    inheritCookies: useProjectCookies,
  });
  const pathParamNames = useMemo(() => parsePathParams(clientApi.url), [clientApi.url]);
  const resolvedUrl = activeEnvironmentId && !activeEnv
    ? ''
    : resolveClientApiUrl({ ...project, environments, clientApi: effectiveClientApi });
  const curlCommand = useMemo(
    () => buildCurl({
      method: clientApi.method,
      url: resolvedUrl,
      headers: mergedHeaders,
      body: clientApi.body,
      allowGetBody: clientApi.allowGetBody === true,
      bodyType,
      fileFieldName: clientApi.fileFieldName || 'file',
      fileName: uploadFile?.name || 'selected-file',
    }),
    [clientApi.method, resolvedUrl, mergedHeaders, clientApi.body, clientApi.allowGetBody, bodyType, clientApi.fileFieldName, uploadFile]
  );
  const restClientRequest = useMemo(
    () => buildRestClientRequest({
      method: clientApi.method,
      url: resolvedUrl,
      headers: mergedHeaders,
      body: clientApi.body,
      allowGetBody: clientApi.allowGetBody === true,
      bodyType,
      fileFieldName: clientApi.fileFieldName || 'file',
      fileName: uploadFile?.name || 'selected-file',
    }),
    [clientApi.method, resolvedUrl, mergedHeaders, clientApi.body, clientApi.allowGetBody, bodyType, clientApi.fileFieldName, uploadFile]
  );
  const requestText = !resolvedUrl ? '请先配置当前服务的连接地址' : requestFormat === 'curl' ? curlCommand : restClientRequest;
  const paramsCount = Object.keys(effectiveQueryParams || {}).filter(Boolean).length;
  const headersCount = Object.keys(headersWithoutCookie(mergedHeaders)).filter(Boolean).length;
  const cookiesCount = cookieStringToRows(cookieHeader(mergedHeaders)).filter((row) => row.key?.trim()).length;

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
      const cookie = cookieHeader(a.headers);
      const headers = rowsToObjectAll(rows);
      if (cookie) headers.Cookie = cookie;
      a.headers = headers;
      const disabled = disabledKeysFromRows(rows);
      a.disabledHeaders = disabled.length ? disabled : undefined;
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
    if (bodyType !== 'text' && !uploadFile) {
      setTab('body');
      setSendError('请选择上传文件');
      setRightTab('response');
      return;
    }
    if (uploadFile && uploadFile.size > 25 * 1024 * 1024) {
      setSendError('文件不能超过 25 MB');
      setRightTab('response');
      return;
    }
    setSending(true);
    setSendError('');
    setSendResult(null);
    try {
      const result = await api.sendClientApi(projectId, clientApi.id, {
        path: clientApi.url,
        pathParams: clientApi.pathParams,
        queryParams: effectiveQueryParams,
        method: clientApi.method,
        apiHeaders: outboundApiHeaders,
        serviceHeaders: project.clientHeaders || {},
        serviceCookies: project.clientCookies || {},
        activeEnvironmentId: activeEnvironmentId || '',
        nodePortEnabled,
        body: clientApi.body,
        bodyType,
        fileFieldName: clientApi.fileFieldName || 'file',
        file: bodyType === 'text' ? undefined : await encodeFile(uploadFile),
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
          { id: 'params', label: 'Params', count: paramsCount + pathParamNames.length },
          { id: 'headers', label: 'Headers', count: headersCount },
          { id: 'cookies', label: 'Cookies', count: cookiesCount },
          { id: 'body', label: 'Body', count: 0 },
          { id: 'schema', label: '结构', count: 0 },
          { id: 'setting', label: '设置', count: 0 },
        ].map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span>{t.label}</span>
            {t.count > 0 && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'params' && (
        <div className="panel">
          {pathParamNames.length > 0 && (
            <div className="path-params">
              <h4>路径参数</h4>
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
                      aria-label={`${name} 参数值`}
                      onChange={(e) => updatePathParam(name, e.target.value)}
                    />
                    <input
                      className="desc-input"
                      value={clientApi.pathParamDescriptions?.[name] ?? ''}
                      aria-label={`${name} 参数说明`}
                      onChange={(e) => updatePathParamDescription(name, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <section>
            {pathParamNames.length > 0 && <h4>查询参数</h4>}
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
            <span>继承环境与服务 Headers</span>
          </label>
          {useProjectHeaders && projectHeaderRows.some((r) => r.key.trim()) && (
            <section className="inherited-headers">
              <h4>继承的 Headers</h4>
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
            {projectHeaderRows.some((row) => row.key.trim()) && <h4>API Headers</h4>}
            <KVEditor
              resetKey={clientApi.id}
              rows={headerRows}
              bulkEdit
              onChange={updateActionHeaders}
            />
          </section>
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
            <span>继承环境与服务 Cookies</span>
          </label>
          {nodePortEnabled && <p className="hint section-hint">已跳过环境 Cookies</p>}
          {useProjectCookies && projectCookieRows.some((r) => r.key.trim()) && (
            <section className="inherited-headers">
              <h4>继承的 Cookies</h4>
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
            {projectCookieRows.some((row) => row.key.trim()) && <h4>API Cookies</h4>}
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

      {tab === 'schema' && (
        <div className="panel fill-panel editor-schema-panel">
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
                <button type="button" className={schemaView === 'structure' ? 'active' : ''} onClick={() => setSchemaView('structure')}>预览</button>
              </div>
              <button type="button" className="ghost sm" onClick={inferSchemaFromBody}>从 Body</button>
            </div>
            {schemaView === 'source' ? (
              <textarea
                className="http-schema-source"
                aria-label="参数结构源码"
                value={clientApi.requestSchemaSource || ''}
                spellCheck={false}
                placeholder="粘贴类型定义或 JSON"
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
              <div className="http-schema-message">暂无结构</div>
            )}
          </section>
        </div>
      )}

      {tab === 'body' && (
        <div className="panel fill-panel http-request-body">
          <div className="file-body-controls">
            <label>Body 类型
              <select className="field" value={bodyType} onChange={(e) => patch((a) => { a.bodyType = e.target.value; })}>
                <option value="text">文本</option>
                <option value="multipart">文件上传 (multipart/form-data)</option>
                <option value="binary">文件上传 (二进制)</option>
              </select>
            </label>
            {bodyType !== 'text' && <>
              {bodyType === 'multipart' && <label>文件字段名
                <input className="field" value={clientApi.fileFieldName || 'file'} onChange={(e) => patch((a) => { a.fileFieldName = e.target.value; })} />
              </label>}
              <label>选择文件 <input type="file" key={clientApi.id} onChange={(e) => setUploadFile(e.target.files?.[0] || null)} /></label>
              {uploadFile && <span className="hint">{uploadFile.name} ({uploadFile.size} 字节)</span>}
            </>}
          </div>
          {bodyType !== 'binary' && (
            <section className="grpc-request-json-panel editor-body-panel">
              <div className="body-toolbar grpc-body-json-toolbar">
                {bodyType === 'multipart' && <strong>附加字段</strong>}
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
                  {clientApi.method?.toUpperCase() === 'GET' && <label className="body-get-switch">
                    <input
                      type="checkbox"
                      checked={clientApi.allowGetBody === true}
                      onChange={(e) => patch((a) => { a.allowGetBody = e.target.checked; })}
                    />
                    <span>GET Body</span>
                  </label>}
                </div>
              </div>
              <textarea
                className="code-input fill"
                aria-label={bodyType === 'multipart' ? '附加字段' : '请求 Body'}
                value={clientApi.body ?? ''}
                spellCheck={false}
                onChange={(e) => patch((a) => { a.body = e.target.value; })}
              />
            </section>
          )}
        </div>
      )}
      {tab === "setting" && (
        <div className="panel settings-panel">
          <section>
            <label className="inherit-switch setting-option">
              <input
                type="checkbox"
                checked={!nodePortEnabled && clientApi.proxy === true}
                disabled={nodePortEnabled}
                onChange={(e) => patch((a) => { a.proxy = e.target.checked; })}
              />
              <span>使用服务端代理</span>
            </label>
            {nodePortEnabled && <p className="hint setting-hint">NodePort 直连已停用代理</p>}
            <label className="inherit-switch setting-option">
              <input
                type="checkbox"
                checked={clientApi.insecureTls === true}
                onChange={(e) => patch((a) => { a.insecureTls = e.target.checked; })}
              />
              <span>跳过 TLS 证书校验</span>
            </label>
          </section>
        </div>
      )}
    </>
  );

  const rightPanel = rightTab === 'request' ? (
    <div className="side-panel">
      <div className="request-format-toolbar">
        <div className="request-format-tabs">
          <button
            type="button"
            aria-pressed={requestFormat === 'curl'}
            className={requestFormat === 'curl' ? 'active' : ''}
            onClick={() => setRequestFormat('curl')}
          >
            curl
          </button>
          <button
            type="button"
            aria-pressed={requestFormat === 'rest'}
            className={requestFormat === 'rest' ? 'active' : ''}
            onClick={() => setRequestFormat('rest')}
          >
            REST Client
          </button>
        </div>
        <button
          type="button"
          className="ghost copy-curl-btn"
          disabled={!resolvedUrl}
          onClick={() => navigator.clipboard.writeText(requestText)}
        >
          复制
        </button>
      </div>
      <pre className="code-block fill">{requestText}</pre>
    </div>
  ) : (
    <div className="side-panel">
      {sendError && <div className="alert error">{sendError}</div>}
      {!sendResult && !sendError && (
        <div className="record-empty side-empty">暂无响应</div>
      )}
      {sendResult && (
        <>
          <div className="response-meta">
            <span className={`detail-status ${statusClass(sendResult.status)}`}>{sendResult.status}</span>
            <span className="hint">{formatDuration(sendResult.durationMs)}</span>
            {sendResult.download && <button type="button" className="ghost sm" onClick={() => downloadResponse(sendResult)}>下载文件</button>}
          </div>
          {!sendResult.download && <pre className="code-block fill">{prettyJson(sendResult.body) || sendResult.body || '空响应'}</pre>}
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
      <div className="url-bar">
        <div className="request-line">
          <select
            className="method-select"
            aria-label="请求方法"
            value={(clientApi.method || 'POST').toUpperCase()}
            onChange={(e) => patch((a) => { a.method = e.target.value; })}
          >
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <RequestAddress address={requestOrigin(resolvedUrl)} />
          <input
            className="url-input"
            aria-label="请求路径"
            value={clientApi.url || ''}
            placeholder="/api/path/:id"
            onChange={(e) => updateUrl(e.target.value)}
          />
        </div>
        <ServiceConnection compact project={project} environments={environments} onChange={onProjectPatch} />
        <div className="url-actions">
          <button type="button" className="primary" onClick={handleSend} disabled={sending || busy || !resolvedUrl}>
            {sending ? '发送中…' : '发送'}
          </button>
          <button type="button" className="ghost" onClick={onSave} disabled={busy}>保存</button>
          <Dropdown trigger={<Icon name="more" />} label="接口操作" items={actions} disabled={busy} />
        </div>
      </div>

      <SplitPane
        className="editor-split"
        rightHeader={rightHeader}
        rightFraction={0.43}
        minLeft={360}
        minRight={300}
        left={leftPanel}
        right={rightPanel}
      />
    </div>
  );
}
