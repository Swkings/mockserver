import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { sortGrpcMethods } from '../utils/grpc.js';

const STARTER_PROTO = `syntax = "proto3";

package demo;

service DemoService {
  rpc Example (ExampleRequest) returns (ExampleResponse);
}

message ExampleRequest {}
message ExampleResponse {}
`;

function newProto() {
  return {
    id: crypto.randomUUID(),
    name: 'New Proto',
    filename: 'service.proto',
    content: STARTER_PROTO,
  };
}

export default function ProtoManager({ draft, onChange, onSave, onDelete, onClose, busy }) {
  const protos = draft.protos || [];
  const [selectedId, setSelectedId] = useState(() => protos[0]?.id || null);
  const [services, setServices] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(
    () => protos.find((proto) => proto.id === selectedId) || null,
    [protos, selectedId]
  );

  useEffect(() => {
    if (!selected && protos.length) setSelectedId(protos[0].id);
    if (!protos.length) setSelectedId(null);
  }, [protos, selected]);

  useEffect(() => {
    if (!selected?.content?.trim()) {
      setServices([]);
      setError('');
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setParsing(true);
      try {
        const inspected = await api.inspectGrpc({
          proto: selected.content,
          protoFilename: selected.filename,
        });
        if (active) {
          setServices(inspected.services || []);
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
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selected?.content, selected?.filename]);

  function patchSelected(updater) {
    if (!selectedId) return;
    onChange((project) => {
      const proto = (project.protos || []).find((entry) => entry.id === selectedId);
      if (proto) updater(proto);
    });
  }

  function createProto() {
    const proto = newProto();
    onChange((project) => {
      project.protos = [...(project.protos || []), proto];
    });
    setSelectedId(proto.id);
  }

  async function importProto(file) {
    if (!file) return;
    try {
      const content = await file.text();
      await api.inspectGrpc({ proto: content, protoFilename: file.name });
      const proto = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.proto$/i, '') || 'Imported Proto',
        filename: file.name,
        content,
      };
      onChange((project) => {
        project.protos = [...(project.protos || []), proto];
      });
      setSelectedId(proto.id);
      setError('');
    } catch (importError) {
      setError(importError.message);
    }
  }

  return (
    <div className="proto-manager">
      <header className="settings-head proto-manager-head">
        <h2>Proto 管理</h2>
        <div className="btn-row">
          <button type="button" className="ghost" onClick={onClose}>返回</button>
          <button type="button" className="primary" disabled={busy} onClick={onSave}>保存</button>
        </div>
      </header>

      <div className="proto-manager-layout">
        <aside className="proto-library">
          <div className="proto-library-head">
            <div className="btn-row">
              <label className="ghost sm file-btn">
                导入
                <input type="file" accept=".proto" hidden onChange={(event) => {
                  importProto(event.target.files?.[0]);
                  event.target.value = '';
                }} />
              </label>
              <button type="button" className="ghost sm" onClick={createProto}>新建</button>
            </div>
          </div>
          <div className="proto-library-list scroll-y">
            {protos.length ? protos.map((proto) => {
              const references = [...(draft.grpcMocks || []), ...(draft.grpcClients || [])]
                .filter((item) => item.protoId === proto.id).length;
              return (
                <button
                  type="button"
                  className={'proto-library-item ' + (selectedId === proto.id ? 'active' : '')}
                  key={proto.id}
                  onClick={() => setSelectedId(proto.id)}
                >
                  <span>{proto.name || proto.filename}</span>
                  {proto.name && proto.name !== proto.filename && <small>{proto.filename || 'service.proto'}</small>}
                  {references > 0 && <small>{references} 处引用</small>}
                </button>
              );
            }) : (
              <div className="record-empty">尚未创建 Proto</div>
            )}
          </div>
        </aside>

        <main className="proto-workspace">
          {selected ? (
            <>
              <div className="proto-editor-meta">
                <label>
                  <span>名称</span>
                  <input value={selected.name || ''} onChange={(event) => patchSelected((proto) => { proto.name = event.target.value; })} />
                </label>
                <label>
                  <span>文件名</span>
                  <input value={selected.filename || ''} onChange={(event) => patchSelected((proto) => { proto.filename = event.target.value; })} />
                </label>
                {parsing && <span className="grpc-parse-state busy" role="status">解析中…</span>}
                <button type="button" className="ghost danger sm" onClick={() => onDelete(selected.id)}>删除</button>
              </div>
              {error && <div className="grpc-error proto-manager-error">{error}</div>}
              <div className="proto-editor-grid">
                <textarea
                  className="code-input fill proto-source-editor"
                  aria-label="Proto 源码"
                  value={selected.content || ''}
                  spellCheck={false}
                  placeholder="粘贴或编写 Proto 内容"
                  onChange={(event) => patchSelected((proto) => { proto.content = event.target.value; })}
                />
                <div className="proto-method-preview scroll-y">
                  <div className="grpc-body-pane-head">
                    <strong>可用方法</strong>
                    <code>{services.reduce((count, service) => count + service.methods.length, 0)}</code>
                  </div>
                  {services.length ? services.map((service) => (
                    <section className="proto-service-preview" key={service.fullName}>
                      <strong>{service.fullName}</strong>
                      {sortGrpcMethods(service.methods).map((method) => (
                        <div className="proto-method-preview-row" key={method.key}>
                          <span>{method.name}</span>
                          <small>{method.requestStream || method.responseStream ? 'Streaming' : 'Unary'}</small>
                        </div>
                      ))}
                    </section>
                  )) : <div className="record-empty">暂无方法</div>}
                </div>
              </div>
            </>
          ) : protos.length > 0 && <div className="placeholder">请选择 Proto</div>}
        </main>
      </div>
    </div>
  );
}
