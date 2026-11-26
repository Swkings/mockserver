import Icon from './Icon.jsx';
import Dropdown from './Dropdown.jsx';
import { useMemo, useState } from 'react';
import KVEditor from './KVEditor.jsx';
import SplitPane from './SplitPane.jsx';
import BodyPresetToolbar from './BodyPresetToolbar.jsx';
import {
  HTTP_METHODS,
  objToKv,
  kvToObj,
  jsonMatchToKv,
  kvToJsonMatch,
  prettyJson,
} from '../utils/format.js';

export default function ApiEditor({
  api,
  apiIndex,
  onChange,
  actions,
  onSave,
  busy,
}) {
  const [tab, setTab] = useState('match');
  const [bodyTab, setBodyTab] = useState('body');

  const headerRows = useMemo(() => objToKv(api.match?.headers), [api.match?.headers]);
  const responseHeaderRows = useMemo(() => objToKv(api.response?.headers), [api.response?.headers]);
  const jsonMatchRows = useMemo(() => jsonMatchToKv(api.match?.jsonMatch), [api.match?.jsonMatch]);

  function patch(updater) {
    onChange((prev) => {
      const next = structuredClone(prev);
      updater(next.apis[apiIndex]);
      return next;
    });
  }

  function formatResponseBody() {
    patch((a) => {
      try { a.response.body = prettyJson(a.response.body); } catch { /* ignore */ }
    });
  }

  const curlExample = useMemo(() => {
    const method = (api.match?.method || 'GET').toUpperCase();
    const path = api.match?.path || '/';
    let lines = [`curl -X ${method} 'http://localhost:PORT${path}'`];
    if (api.match?.headers) {
      for (const [k, v] of Object.entries(api.match.headers)) {
        lines.push(`  -H '${k}: ${v}'`);
      }
    }
    if (api.response?.body && !['GET', 'HEAD'].includes(method)) {
      lines.push(`  -d '${String(api.response.body).replace(/'/g, "'\\''")}'`);
    }
    return lines.join(' \\\n');
  }, [api]);

  const leftPanel = (
    <>
      <div className="tabs">
        {[
          { id: 'match', label: '匹配规则' },
          { id: 'advanced', label: '高级' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'match' && (
        <div className="panel">
          <section>
            <h4>Headers</h4>
            <KVEditor
              resetKey={api.id}
              rows={headerRows}
              bulkEdit
              onChange={(rows) => patch((a) => {
                const headers = kvToObj(rows);
                a.match = { ...a.match, headers: Object.keys(headers).length ? headers : undefined };
              })}
            />
          </section>
          <section>
            <h4>Body 包含</h4>
            <input
              className="field"
              value={api.match?.bodyContains || ''}
              placeholder="请求体包含的字符串（可选）"
              onChange={(e) => patch((a) => {
                a.match = { ...a.match, bodyContains: e.target.value || undefined };
              })}
            />
          </section>
          <section>
            <h4>JSON 匹配</h4>
            <KVEditor
              resetKey={api.id}
              rows={jsonMatchRows}
              keyPlaceholder="字段名"
              valuePlaceholder="期望值"
              onChange={(rows) => patch((a) => {
                a.match = { ...a.match, jsonMatch: kvToJsonMatch(rows) };
              })}
            />
          </section>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="panel">
          <div className="inline-row">
            <label>Priority<input type="number" value={api.priority ?? 0} onChange={(e) => patch((a) => { a.priority = Number(e.target.value); })} /></label>
            <label className="check">
              <input type="checkbox" checked={api.match?.pathPrefix === true} onChange={(e) => patch((a) => { a.match = { ...a.match, pathPrefix: e.target.checked || undefined }; })} />
              路径前缀匹配
            </label>
          </div>
          <section>
            <h4>curl 示例</h4>
            <pre className="code-block fill">{curlExample}</pre>
          </section>
        </div>
      )}
    </>
  );

  const rightPanel = (
    <div className="side-panel">
      <div className="inline-row">
        <label>Status<input type="number" value={api.response?.status ?? 200} onChange={(e) => patch((a) => { a.response = { ...a.response, status: Number(e.target.value) }; })} /></label>
        <label>Delay (ms)<input type="number" min={0} value={api.response?.delayMs ?? 0} onChange={(e) => patch((a) => { a.response = { ...a.response, delayMs: Number(e.target.value) }; })} /></label>
      </div>
      <section>
        <h4>Response Headers</h4>
        <KVEditor
          resetKey={api.id}
          rows={responseHeaderRows}
          bulkEdit
          onChange={(rows) => patch((a) => { a.response = { ...a.response, headers: kvToObj(rows) }; })}
        />
      </section>
      <section className="fill-section">
        <div className="body-toolbar">
          <div className="mini-tabs">
            <button type="button" className={bodyTab === 'body' ? 'active' : ''} onClick={() => setBodyTab('body')}>编辑</button>
            <button type="button" className={bodyTab === 'preview' ? 'active' : ''} onClick={() => setBodyTab('preview')}>预览</button>
          </div>
          {bodyTab === 'body' && (
            <BodyPresetToolbar
              presets={api.bodyPresets}
              body={api.response?.body}
              onBodyChange={(body) => patch((a) => { a.response = { ...a.response, body }; })}
              onPresetsChange={(bodyPresets) => patch((a) => { a.bodyPresets = bodyPresets; })}
              onSave={onSave}
            />
          )}
          <button type="button" className="link" onClick={formatResponseBody}>格式化</button>
        </div>
        {bodyTab === 'body' ? (
          <textarea
            className="code-input fill"
            aria-label="响应 Body"
            value={api.response?.body ?? ''}
            spellCheck={false}
            onChange={(e) => patch((a) => { a.response = { ...a.response, body: e.target.value }; })}
          />
        ) : (
          <pre className="code-block fill">{prettyJson(api.response?.body) || '(empty)'}</pre>
        )}
      </section>
    </div>
  );

  return (
    <div className="editor-page">
      <div className="url-bar">
        <select
          className="method-select"
          aria-label="请求方法"
          value={(api.match?.method || 'GET').toUpperCase()}
          onChange={(e) => patch((a) => { a.match = { ...a.match, method: e.target.value }; })}
        >
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          className="url-input"
          aria-label="匹配路径"
          value={api.match?.path || '/'}
          placeholder="/api/path"
          onChange={(e) => patch((a) => { a.match = { ...a.match, path: e.target.value }; })}
        />
        <div className="url-actions">
          <button type="button" className="primary" onClick={onSave} disabled={busy}>保存</button>
          <Dropdown trigger={<Icon name="more" />} label="接口操作" items={actions} disabled={busy} />
        </div>
      </div>

      <SplitPane
        className="editor-split"
        rightTitle="Mock 响应"
        rightFraction={0.46}
        minLeft={360}
        minRight={320}
        left={leftPanel}
        right={rightPanel}
      />
    </div>
  );
}
