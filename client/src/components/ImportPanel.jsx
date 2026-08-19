import { useEffect, useRef, useState } from 'react';

const TYPE_LABELS = {
  api: 'HTTP Server',
  'client-api': 'HTTP Client',
  'grpc-mock': 'gRPC Server',
  'grpc-client': 'gRPC Client',
};

export default function ImportPanel({ type, folderName, onImportFile, onImportCurl, onClose }) {
  const isHttp = type === 'api' || type === 'client-api';
  const [tab, setTab] = useState('file');
  const [file, setFile] = useState(null);
  const [curl, setCurl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      if (tab === 'file') {
        if (!file) throw new Error('请先选择要导入的文件');
        await onImportFile(file);
      } else {
        if (!curl.trim()) throw new Error('请粘贴 cURL 命令');
        await onImportCurl(curl);
      }
      onClose();
    } catch (submitError) {
      setError(submitError.message || '导入失败');
    } finally {
      setSubmitting(false);
    }
  }

  function selectFile(nextFile) {
    if (!nextFile) return;
    setFile(nextFile);
    setError('');
  }

  return (
    <div className="modal-backdrop import-backdrop" role="presentation" onMouseDown={() => !submitting && onClose()}>
      <div className="import-panel" role="dialog" aria-modal="true" aria-labelledby="import-panel-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="import-panel-head">
          <div>
            <h3 id="import-panel-title">导入接口</h3>
            <p>
              导入到 <strong>{TYPE_LABELS[type] || '当前分组'}</strong>
              {folderName ? ` / ${folderName}` : ''}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭导入面板" onClick={onClose} disabled={submitting}>×</button>
        </header>

        {isHttp && (
          <div className="import-tabs" role="tablist" aria-label="导入方式">
            <button type="button" role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'active' : ''} onClick={() => { setTab('file'); setError(''); }}>
              OpenAPI 文件
            </button>
            <button type="button" role="tab" aria-selected={tab === 'curl'} className={tab === 'curl' ? 'active' : ''} onClick={() => { setTab('curl'); setError(''); }}>
              粘贴 cURL
            </button>
          </div>
        )}

        <div className="import-panel-body">
          {tab === 'file' ? (
            <>
              <div
                className={`import-drop-zone ${dragging ? 'dragging' : ''} ${file ? 'selected' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  selectFile(event.dataTransfer.files?.[0]);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".yaml,.yml,.json"
                  hidden
                  onChange={(event) => {
                    selectFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <span className="import-file-icon" aria-hidden="true">⇩</span>
                {file ? (
                  <>
                    <strong>{file.name}</strong>
                    <span>{Math.max(1, Math.ceil(file.size / 1024))} KB · 点击重新选择</span>
                  </>
                ) : (
                  <>
                    <strong>选择文件或拖放到此处</strong>
                    <span>{isHttp ? '支持 OpenAPI 3、Swagger 2，以及已导出的接口配置' : '支持已导出的 gRPC 接口配置'}</span>
                    <small>YAML / JSON，单个文件</small>
                  </>
                )}
              </div>
              {isHttp && (
                <p className="import-help">
                  OpenAPI 文件中的所有 HTTP operations 会批量导入；Server 使用响应示例，Client 使用请求参数与请求体示例。
                </p>
              )}
            </>
          ) : (
            <>
              <label className="import-curl-label" htmlFor="import-curl-input">cURL 命令</label>
              <textarea
                id="import-curl-input"
                className="import-curl-input"
                autoFocus
                value={curl}
                spellCheck={false}
                placeholder={'curl --request POST \\\n  --url https://api.example.com/users \\\n  --header \'Content-Type: application/json\' \\\n  --data \'{"name":"Ada"}\''}
                onChange={(event) => { setCurl(event.target.value); setError(''); }}
              />
              <p className="import-help">会读取请求方法、URL、查询参数、Headers、Cookie 和 Body，不会执行该命令。</p>
            </>
          )}

          {error && <div className="import-error" role="alert">{error}</div>}
        </div>

        <footer className="import-panel-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={submitting}>取消</button>
          <button type="button" className="primary" onClick={submit} disabled={submitting || (tab === 'file' ? !file : !curl.trim())}>
            {submitting ? '导入中…' : '导入'}
          </button>
        </footer>
      </div>
    </div>
  );
}
