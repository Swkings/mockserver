import { useState } from 'react';
import { findEnvironmentEntry, moveEnvironmentEntry } from '../../../shared/environmentLayout.js';
import { api } from '../api.js';
import Icon from './Icon.jsx';

function folderOptions(layout, skipId, path = '') {
  return layout.flatMap((entry) => {
    if (entry.type !== 'folder' || entry.id === skipId) return [];
    const label = path ? `${path} / ${entry.name}` : entry.name;
    return [{ value: entry.id, label }, ...folderOptions(entry.children, skipId, label)];
  });
}

function ancestorIds(layout, id) {
  for (const entry of layout) {
    if (entry.id === id) return [];
    if (entry.type === 'folder') {
      const trail = ancestorIds(entry.children, id);
      if (trail) return [entry.id, ...trail];
    }
  }
  return null;
}

export default function EnvironmentTree({
  snapshot, environments, projects, currentId, disabled, onSelect, onCreate, onRefresh, onMenu,
  promptDialog, selectDialog, confirmDialog,
}) {
  const [collapsed, setCollapsed] = useState(new Set());
  const [dragged, setDragged] = useState(null);
  const [hint, setHint] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const layout = snapshot?.layout || [];
  const isDisabled = disabled || saving || !snapshot;
  const environmentsById = new Map(environments.map((environment) => [environment.id, environment]));
  const references = new Map();
  for (const { activeEnvironmentId } of projects) {
    if (activeEnvironmentId) references.set(activeEnvironmentId, (references.get(activeEnvironmentId) || 0) + 1);
  }

  function expand(ids) {
    setCollapsed((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
  }

  async function save(next, revealId) {
    if (isDisabled || !next) return;
    setSaving(true);
    setError('');
    try {
      await api.saveEnvironmentLayout({ layout: next, revision: snapshot.revision });
      await onRefresh();
      if (revealId) expand(ancestorIds(next, revealId) || []);
    } catch (err) {
      setError(err.message);
      await onRefresh().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  async function createFolder(parentId) {
    const entered = await promptDialog({ title: '新建文件夹', placeholder: '文件夹名称' });
    const name = entered?.trim();
    if (!name) return;
    const next = structuredClone(layout);
    const folder = { type: 'folder', id: crypto.randomUUID(), name, children: [] };
    const siblings = parentId ? findEnvironmentEntry(next, parentId)?.entry.children : next;
    if (!siblings) return;
    siblings.push(folder);
    await save(next, folder.id);
  }

  function move(id, targetId, placement) {
    return save(moveEnvironmentEntry(layout, id, targetId, placement), id);
  }

  async function moveTo(id) {
    const target = await selectDialog({
      title: '移动到',
      options: [{ value: '', label: '根目录' }, ...folderOptions(layout, id)],
    });
    if (target !== null) await move(id, target, 'inside');
  }

  async function rename(folder) {
    const name = (await promptDialog({ title: '重命名文件夹', defaultValue: folder.name }))?.trim();
    if (!name || name === folder.name) return;
    const next = structuredClone(layout);
    findEnvironmentEntry(next, folder.id).entry.name = name;
    await save(next);
  }

  async function remove(folder) {
    if (folder.children.length) return;
    if (!await confirmDialog({ title: '删除文件夹', message: `删除空文件夹「${folder.name}」？`, danger: true, confirmLabel: '删除' })) return;
    const next = structuredClone(layout);
    const found = findEnvironmentEntry(next, folder.id);
    found.siblings.splice(found.index, 1);
    await save(next);
  }

  function actions(entry, previous, following) {
    return [
      { label: '上移', disabled: !previous, onClick: () => move(entry.id, previous.id, 'before') },
      { label: '下移', disabled: !following, onClick: () => move(entry.id, following.id, 'after') },
      { label: '移动到…', onClick: () => moveTo(entry.id) },
      ...(entry.type === 'folder' ? [
        { label: '新建子文件夹', onClick: () => createFolder(entry.id) },
        { label: '重命名', onClick: () => rename(entry) },
        { label: '删除空文件夹', disabled: entry.children.length > 0, danger: true, onClick: () => remove(entry) },
      ] : []),
    ];
  }

  function getPlacement(event, entry) {
    if (isDisabled || !dragged || dragged.id === entry.id) return null;
    if (dragged.type === 'folder' && findEnvironmentEntry(dragged.children, entry.id)) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - rect.top) / rect.height;
    if (entry.type === 'folder' && offset > 0.24 && offset < 0.76) return 'inside';
    return offset < 0.5 ? 'before' : 'after';
  }

  function endDrag() {
    setDragged(null);
    setHint(null);
  }

  function render(entries) {
    return (
      <ul className="environment-tree">
        {entries.map((entry, index) => {
          const folder = entry.type === 'folder';
          const env = environmentsById.get(entry.id);
          if (!folder && !env) return null;
          const name = folder ? entry.name : env.name;
          const open = folder && !collapsed.has(entry.id);
          const count = references.get(entry.id);
          const rowActions = () => actions(entry, entries[index - 1], entries[index + 1]);
          return (
            <li key={entry.id} data-env-entry={entry.id}>
              <div
                className="environment-tree-row"
                data-drop={hint?.id === entry.id ? hint.placement : undefined}
                draggable={!isDisabled}
                onContextMenu={(event) => { if (!isDisabled) onMenu(event, rowActions()); }}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', entry.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragged(entry);
                }}
                onDragEnd={endDrag}
                onDragOver={(event) => {
                  const placement = getPlacement(event, entry);
                  if (!placement) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setHint((current) => current?.id === entry.id && current.placement === placement ? current : { id: entry.id, placement });
                }}
                onDragLeave={(event) => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                    setHint((current) => current?.id === entry.id ? null : current);
                  }
                }}
                onDrop={(event) => {
                  const placement = getPlacement(event, entry);
                  if (!placement) return;
                  event.preventDefault();
                  move(dragged.id, entry.id, placement);
                  endDrag();
                }}
              >
                {folder ? (
                  <button
                    type="button"
                    className="environment-tree-item environment-folder-item"
                    aria-expanded={open}
                    onClick={() => setCollapsed((previous) => {
                      const next = new Set(previous);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })}
                  >
                    <Icon name={open ? 'down' : 'forward'} />
                    <Icon name="folder" />
                    <strong title={name}>{name}</strong>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="environment-tree-item environment-entry"
                    aria-current={currentId === entry.id ? 'true' : undefined}
                    aria-label={count > 0 ? `${name}，${count} 个项目引用` : name}
                    disabled={disabled}
                    onClick={() => onSelect(env.id)}
                  >
                    <span className="environment-mark" aria-hidden="true" />
                    <span className="environment-entry-text"><strong title={name}>{name}</strong>{env.host && <small>{env.host}</small>}</span>
                    {count > 0 && <span className="environment-reference" title={`${count} 个项目引用`} aria-hidden="true"><Icon name="link" />{count}</span>}
                  </button>
                )}
                <button type="button" className="icon-btn environment-row-more" title="列表操作" aria-label={`${name}的列表操作`} disabled={isDisabled} onClick={(event) => onMenu(event, rowActions())}>
                  <Icon name="more" />
                </button>
              </div>
              {open && entry.children.length > 0 && render(entry.children)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav id="environment-list" className="environment-list scroll-y" aria-label="环境列表" aria-busy={saving}>
      <div className="environment-list-actions">
        <button type="button" className="primary" disabled={disabled || saving} onClick={onCreate}>新建环境</button>
        <button type="button" className="icon-btn" aria-label="新建文件夹" title="新建文件夹" disabled={isDisabled} onClick={() => createFolder(null)}>
          <Icon name="folderPlus" />
        </button>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {render(layout)}
      {dragged && (
        <div
          className="environment-root-drop"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
          onDrop={(event) => {
            event.preventDefault();
            move(dragged.id, null, 'inside');
            endDrag();
          }}
        >拖到根目录</div>
      )}
    </nav>
  );
}
