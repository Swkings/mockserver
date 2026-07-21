import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import yaml from 'js-yaml';
import { api, subscribeEvents } from './api.js';
import ApiEditor from './components/ApiEditor.jsx';
import ClientApiEditor from './components/ClientApiEditor.jsx';
import GrpcEditor from './components/GrpcEditor.jsx';
import RequestLogPanel from './components/RequestLogPanel.jsx';
import MethodBadge from './components/MethodBadge.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import Dropdown from './components/Dropdown.jsx';
import ProjectSettings from './components/ProjectSettings.jsx';
import MockServiceSwitch from './components/MockServiceSwitch.jsx';
import { duplicateApi, duplicateClientApi, duplicateGrpcItem } from './utils/duplicate.js';
import { useDragResize } from './components/SplitPane.jsx';
import { defaultEnvironments, resolveClientApiUrl } from './utils/environment.js';
import { findMatchingGrpcItem, sortGrpcMethods } from './utils/grpc.js';
import { objToKv, kvToObj } from './utils/format.js';

const emptyProject = () => ({
  name: 'New Project',
  host: '0.0.0.0',
  port: 3900,
  enabled: false,
  grpcHost: '0.0.0.0',
  grpcPort: 50051,
  grpcEnabled: false,
  description: '',
  environments: defaultEnvironments(),
  activeEnvironmentId: 'local',
  clientCookies: {},
  apiFolders: [],
  clientApiFolders: [],
  grpcMockFolders: [],
  grpcClientFolders: [],
  apis: [],
  clientApis: [],
  grpcMocks: [],
  grpcClients: [],
});

const emptyFolder = (name = 'New Folder', parentId) => ({
  id: crypto.randomUUID(),
  name,
  parentId,
});

const emptyClientApi = () => ({
  id: crypto.randomUUID(),
  name: 'New API',
  method: 'POST',
  url: '/',
  headers: { 'Content-Type': 'application/json' },
  useProjectHeaders: true,
  useProjectCookies: true,
  body: '',
  allowGetBody: false,
  description: '',
});

const emptyApi = () => ({
  id: crypto.randomUUID(),
  name: 'New API',
  enabled: true,
  priority: 0,
  match: { method: 'POST', path: '/' },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: '',
    delayMs: 0,
  },
});

const DEFAULT_PROTO = `syntax = "proto3";

package demo;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }`;

const emptyGrpcMock = () => ({
  id: crypto.randomUUID(), name: "New gRPC Mock", enabled: true, proto: DEFAULT_PROTO, protoFilename: "greeter.proto",
  packageName: "demo", serviceName: "Greeter", methodName: "SayHello", response: "{\n  \"message\": \"Hello\"\n}", delayMs: 0,
});

const emptyGrpcClient = () => ({
  id: crypto.randomUUID(), name: "New gRPC Client", target: "http://127.0.0.1:50051", proto: DEFAULT_PROTO, protoFilename: "greeter.proto",
  packageName: "demo", serviceName: "Greeter", methodName: "SayHello", request: "{\n  \"name\": \"World\"\n}", metadata: {}, timeoutMs: 10000, useTls: false, useEnvironment: true,
});

const folderConfig = {
  api: { foldersKey: 'apiFolders', itemsKey: 'apis', itemLabel: 'HTTP Mock' },
  'client-api': { foldersKey: 'clientApiFolders', itemsKey: 'clientApis', itemLabel: 'HTTP Client' },
  'grpc-mock': { foldersKey: 'grpcMockFolders', itemsKey: 'grpcMocks', itemLabel: 'gRPC Mock' },
  'grpc-client': { foldersKey: 'grpcClientFolders', itemsKey: 'grpcClients', itemLabel: 'gRPC Client' },
};

function formatExportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function normalizeDraftProject(project) {
  return {
    ...project,
    apiFolders: project.apiFolders || [],
    clientApiFolders: project.clientApiFolders || [],
    grpcMockFolders: project.grpcMockFolders || [],
    grpcClientFolders: project.grpcClientFolders || [],
    apis: project.apis || [],
    clientApis: project.clientApis || [],
    grpcMocks: project.grpcMocks || [],
    grpcClients: project.grpcClients || [],
  };
}

function getChildFolders(folders, parentId) {
  return folders.filter((folder) => (folder.parentId || null) === (parentId || null));
}

function getDescendantFolderIds(folders, folderId) {
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}


function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-action-icon">
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-action-icon">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      <path d="M12 11v5" />
      <path d="M9.5 13.5h5" />
    </svg>
  );
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedApiId, setSelectedApiId] = useState(null);
  const [selectedClientApiId, setSelectedClientApiId] = useState(null);
  const [selectedGrpcMockId, setSelectedGrpcMockId] = useState(null);
  const [selectedGrpcClientId, setSelectedGrpcClientId] = useState(null);
  const lastGrpcMockIdRef = useRef(null);
  const lastGrpcClientIdRef = useRef(null);
  const [grpcOpenVersion, setGrpcOpenVersion] = useState(0);
  const [draft, setDraft] = useState(null);
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('mockserver-theme') || 'dark');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mainView, setMainView] = useState('edit');
  const [navApiType, setNavApiType] = useState('api');
  const [sseConnected, setSseConnected] = useState(false);

  const sidebarResize = useDragResize({ initialSize: 320, minSize: 320, maxSize: 480, invert: false });
  const [contextMenu, setContextMenu] = useState(null);
  const [collapsedProjects, setCollapsedProjects] = useState({});
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const draftRef = useRef(null);
  const draftVersionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const dialogResolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const notify = useCallback((text, type = 'info') => {
    if (!text) return;
    const id = crypto.randomUUID();
    setNotifications((prev) => [...prev, { id, text, type }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const setMessage = useCallback((text) => {
    if (text) notify(text);
  }, [notify]);

  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mockserver-theme', theme);
  }, [theme]);

  function openDialog(config) {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({
        inputValue: config.defaultValue || '',
        selectValue: config.defaultValue || '',
        ...config,
      });
    });
  }

  function resolveDialog(value) {
    dialogResolverRef.current?.(value);
    dialogResolverRef.current = null;
    setDialog(null);
  }

  function promptDialog({ title, message, defaultValue = '', placeholder = '' }) {
    return openDialog({ kind: 'prompt', title, message, defaultValue, placeholder });
  }

  function confirmDialog({ title, message, danger = false, confirmLabel = '确定' }) {
    return openDialog({ kind: 'confirm', title, message, danger, confirmLabel });
  }

  function selectDialog({ title, message, options, defaultValue = '' }) {
    return openDialog({ kind: 'select', title, message, options, defaultValue });
  }

  const loadRequests = useCallback(async (projectId) => {
    const params = new URLSearchParams({ limit: '200' });
    if (projectId) params.set('projectId', projectId);
    const r = await api.listRequests(params.toString());
    setRequests(r);
    return r;
  }, []);

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([api.listProjects(), api.projectStatus()]);
    setProjects(p);
    setStatus(s);
    const pid = selectedProjectId || p[0]?.id;
    if (pid) await loadRequests(pid);
    if (!selectedProjectId && p.length) setSelectedProjectId(p[0].id);
  }, [loadRequests, selectedProjectId]);

  useEffect(() => {
    refresh().catch((err) => setMessage(err.message));
  }, [refresh]);

  useEffect(() => {
    if (!selectedProjectId) return;
    loadRequests(selectedProjectId).catch(() => {});
  }, [selectedProjectId, loadRequests]);

  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => {
      if (selectedProjectId) loadRequests(selectedProjectId).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [paused, loadRequests, selectedProjectId]);

  useEffect(() => {
    const unsub = subscribeEvents((event, payload) => {
      if (event === 'request' && !paused) {
        if (selectedProjectId && payload.projectId !== selectedProjectId) return;
        setRequests((prev) => [payload, ...prev.filter((r) => r.id !== payload.id)].slice(0, 200));
      }
      if (event === 'projects' || event === 'requests_cleared') {
        refresh().catch(() => {});
      }
    }, setSseConnected);
    return unsub;
  }, [refresh, paused, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setDraft(null);
      setSelectedApiId(null);
      setSelectedClientApiId(null);
      setSelectedGrpcMockId(null);
      setSelectedGrpcClientId(null);
      return;
    }
    api.getProject(selectedProjectId).then((p) => {
      const environments = p.environments?.length ? p.environments : defaultEnvironments();
      const normalized = normalizeDraftProject({
        ...p,
        environments,
        activeEnvironmentId: p.activeEnvironmentId || environments[0]?.id,
      });
      setDraft(normalized);
      draftRef.current = normalized;
      setDirty(false);
      setSelectedApiId(normalized.apis?.[0]?.id || null);
      setSelectedClientApiId(null);
      setSelectedGrpcMockId(null);
      setSelectedGrpcClientId(null);
    }).catch((err) => setMessage(err.message));
  }, [selectedProjectId]);

  const selectedStatus = useMemo(
    () => status.find((s) => s.id === selectedProjectId),
    [status, selectedProjectId]
  );

  const selectedApiIndex = useMemo(() => {
    if (!draft || !selectedApiId) return -1;
    return draft.apis.findIndex((a) => a.id === selectedApiId);
  }, [draft, selectedApiId]);

  const selectedClientApiIndex = useMemo(() => {
    if (!draft || !selectedClientApiId) return -1;
    return draft.clientApis.findIndex((a) => a.id === selectedClientApiId);
  }, [draft, selectedClientApiId]);

  const selectedGrpcMockIndex = useMemo(() => {
    if (!draft || !selectedGrpcMockId) return -1;
    return draft.grpcMocks.findIndex((item) => item.id === selectedGrpcMockId);
  }, [draft, selectedGrpcMockId]);

  const selectedGrpcClientIndex = useMemo(() => {
    if (!draft || !selectedGrpcClientId) return -1;
    return draft.grpcClients.findIndex((item) => item.id === selectedGrpcClientId);
  }, [draft, selectedGrpcClientId]);

  const selectedApi = selectedApiIndex >= 0 ? draft?.apis[selectedApiIndex] : null;
  const selectedClientApi = selectedClientApiIndex >= 0 ? draft?.clientApis[selectedClientApiIndex] : null;
  const selectedGrpcMock = selectedGrpcMockIndex >= 0 ? draft?.grpcMocks[selectedGrpcMockIndex] : null;
  const selectedGrpcClient = selectedGrpcClientIndex >= 0 ? draft?.grpcClients[selectedGrpcClientIndex] : null;

  const projectClientHeaderRows = useMemo(
    () => objToKv(draft?.clientHeaders),
    [draft?.clientHeaders]
  );

  const projectClientCookieRows = useMemo(
    () => objToKv(draft?.clientCookies),
    [draft?.clientCookies]
  );

  const activeSelection = selectedApi || selectedClientApi || selectedGrpcMock || selectedGrpcClient;

  const logRecords = useMemo(() => {
    if (!activeSelection) return requests;
    const direction = selectedApi || selectedGrpcMock ? 'inbound' : 'outbound';
    return requests.filter((record) => record.direction === direction && (
      record.matchedApiId === activeSelection.id
      || (!record.matchedApiId && record.matchedApiName === activeSelection.name)
    ));
  }, [requests, activeSelection, selectedApi, selectedGrpcMock]);

  const logTitle = activeSelection?.name || draft?.name || '项目';

  const logPath = selectedApi
    ? ((selectedApi.match?.method || 'GET').toUpperCase() + ' ' + (selectedApi.match?.path || '/'))
    : selectedClientApi
      ? ((selectedClientApi.method || 'POST').toUpperCase() + ' ' + resolveClientApiUrl({
        environments: draft?.environments,
        activeEnvironmentId: draft?.activeEnvironmentId,
        clientApi: selectedClientApi,
      }))
      : activeSelection
        ? ('gRPC /' + [activeSelection.packageName, activeSelection.serviceName].filter(Boolean).join('.') + '/' + (activeSelection.methodName || 'Method'))
        : null;

  const showMainNav = draft && !showSettings && Boolean(activeSelection);

  function updateDraft(updater) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const result = updater(next);
      const resolved = normalizeDraftProject(result ?? next);
      draftRef.current = resolved;
      draftVersionRef.current += 1;
      setDirty(true);
      return resolved;
    });
  }

  async function saveProjectPort(projectId, port, protocol = 'http') {
    const num = Number(port);
    if (!num || num < 1 || num > 65535) return;
    const enabledKey = protocol === 'grpc' ? 'grpcEnabled' : 'enabled';
    const portKey = protocol === 'grpc' ? 'grpcPort' : 'port';
    setBusy(true);
    try {
      const project = projectId === draft?.id ? structuredClone(draft) : await api.getProject(projectId);
      if (project[enabledKey]) return;
      project[portKey] = num;
      const saved = normalizeDraftProject(await api.saveProject(project));
      if (draft?.id === projectId) {
        setDraft(saved);
        draftRef.current = saved;
        setDirty(false);
      }
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMockService(projectId, nextEnabled, protocol = 'http') {
    setBusy(true);
    try {
      const project = projectId === draft?.id ? structuredClone(draft) : await api.getProject(projectId);
      const enabledKey = protocol === 'grpc' ? 'grpcEnabled' : 'enabled';
      project[enabledKey] = nextEnabled;
      const saved = normalizeDraftProject(await api.saveProject(project));
      if (draft?.id === projectId) {
        setDraft(saved);
        draftRef.current = saved;
        setDirty(false);
      }
      setMessage((protocol === 'grpc' ? 'gRPC' : 'HTTP') + (nextEnabled ? ' Mock 服务已启动' : ' Mock 服务已停止'));
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = useCallback(async ({ silent = false } = {}) => {
    const current = draftRef.current;
    if (!current) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    const saveVersion = draftVersionRef.current;
    savingRef.current = true;
    setSaving(true);
    setBusy(true);
    try {
      const saved = normalizeDraftProject(await api.saveProject(current));
      if (saveVersion === draftVersionRef.current) {
        setDraft(saved);
        draftRef.current = saved;
        setSelectedProjectId(saved.id);
        setDirty(false);
      } else {
        pendingSaveRef.current = true;
      }
      if (!silent) notify('已保存');
      await refresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
      setBusy(false);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        window.setTimeout(() => saveDraft({ silent: true }), 0);
      }
    }
  }, [notify, refresh]);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDraft();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveDraft]);

  useEffect(() => {
    if (!dirty || !draft) return undefined;
    const timer = window.setTimeout(() => saveDraft({ silent: true }), 1800);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, saveDraft]);

  async function createProject() {
    setBusy(true);
    try {
      const saved = normalizeDraftProject(await api.saveProject(emptyProject()));
      setSelectedProjectId(saved.id);
      setDraft(saved);
      draftRef.current = saved;
      setDirty(false);
      setSelectedApiId(null);
      setShowSettings(false);
      setMessage('项目已创建');
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openContextMenu(e, items) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  function getFolders(type) {
    return draft?.[folderConfig[type].foldersKey] || [];
  }

  function getItems(type) {
    return draft?.[folderConfig[type].itemsKey] || [];
  }

  function folderPath(type, folderId) {
    const folders = getFolders(type);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const names = [];
    let current = byId.get(folderId);
    while (current) {
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    return names.join(' / ');
  }

  async function askFolderTarget(type, { excludeIds = new Set() } = {}) {
    const folders = getFolders(type).filter((folder) => !excludeIds.has(folder.id));
    const options = [
      { value: '', label: '根目录' },
      ...folders.map((folder) => ({ value: folder.id, label: folderPath(type, folder.id) })),
    ];
    const targetId = await selectDialog({
      title: '移动到文件夹',
      message: '选择目标文件夹，保存后会自动更新项目配置。',
      options,
      defaultValue: '',
    });
    return targetId === null ? undefined : targetId || null;
  }

  function toggleFolder(type, folderId) {
    const key = `${type}:${folderId}`;
    setCollapsedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function addFolder(type, parentId) {
    const name = await promptDialog({ title: '新建文件夹', defaultValue: 'New Folder', placeholder: '文件夹名称' });
    if (!name?.trim()) return;
    const cfg = folderConfig[type];
    updateDraft((d) => {
      d[cfg.foldersKey] = d[cfg.foldersKey] || [];
      d[cfg.foldersKey].push(emptyFolder(name.trim(), parentId));
      return d;
    });
  }

  async function renameFolder(type, folderId) {
    const cfg = folderConfig[type];
    const target = draft?.[cfg.foldersKey]?.find((folder) => folder.id === folderId);
    if (!target) return;
    const name = await promptDialog({ title: '重命名文件夹', defaultValue: target.name, placeholder: '文件夹名称' });
    if (!name?.trim()) return;
    updateDraft((d) => {
      const folder = d[cfg.foldersKey].find((item) => item.id === folderId);
      if (folder) folder.name = name.trim();
      return d;
    });
  }

  async function moveFolder(type, folderId) {
    const cfg = folderConfig[type];
    const folders = getFolders(type);
    const excludeIds = getDescendantFolderIds(folders, folderId);
    const targetId = await askFolderTarget(type, { excludeIds });
    if (targetId === undefined) return;
    updateDraft((d) => {
      const folder = d[cfg.foldersKey].find((item) => item.id === folderId);
      if (folder) folder.parentId = targetId || undefined;
      return d;
    });
  }

  function copyFolder(type, folderId) {
    const cfg = folderConfig[type];
    updateDraft((d) => {
      const folders = d[cfg.foldersKey] || [];
      const ids = getDescendantFolderIds(folders, folderId);
      const originals = folders.filter((folder) => ids.has(folder.id));
      const idMap = new Map(originals.map((folder) => [folder.id, crypto.randomUUID()]));
      const copies = originals.map((folder) => ({
        ...folder,
        id: idMap.get(folder.id),
        name: folder.id === folderId ? `${folder.name} Copy` : folder.name,
        parentId: ids.has(folder.parentId) ? idMap.get(folder.parentId) : folder.parentId,
      }));
      d[cfg.foldersKey] = [...folders, ...copies];
      const duplicate = type === 'api' ? duplicateApi : type === 'client-api' ? duplicateClientApi : duplicateGrpcItem;
      const copiedItems = (d[cfg.itemsKey] || [])
        .filter((item) => item.folderId && ids.has(item.folderId))
        .map((item) => ({ ...duplicate(item), folderId: idMap.get(item.folderId) }));
      d[cfg.itemsKey] = [...(d[cfg.itemsKey] || []), ...copiedItems];
      return d;
    });
    notify('已复制文件夹');
  }

  async function deleteFolder(type, folderId) {
    const confirmed = await confirmDialog({ title: '删除文件夹', message: '确定删除该文件夹及其中所有接口？', danger: true, confirmLabel: '删除' });
    if (!confirmed) return;
    const cfg = folderConfig[type];
    updateDraft((d) => {
      const ids = getDescendantFolderIds(d[cfg.foldersKey] || [], folderId);
      d[cfg.foldersKey] = (d[cfg.foldersKey] || []).filter((folder) => !ids.has(folder.id));
      d[cfg.itemsKey] = (d[cfg.itemsKey] || []).filter((item) => !item.folderId || !ids.has(item.folderId));
      if (type === 'api' && selectedApiId && !(d.apis || []).some((item) => item.id === selectedApiId)) {
        setSelectedApiId(d.apis?.[0]?.id || null);
      }
      if (type === 'client-api' && selectedClientApiId && !(d.clientApis || []).some((item) => item.id === selectedClientApiId)) {
        setSelectedClientApiId(d.clientApis?.[0]?.id || null);
      }
      if (type === 'grpc-mock' && selectedGrpcMockId && !(d.grpcMocks || []).some((item) => item.id === selectedGrpcMockId)) {
        setSelectedGrpcMockId(d.grpcMocks?.[0]?.id || null);
      }
      if (type === 'grpc-client' && selectedGrpcClientId && !(d.grpcClients || []).some((item) => item.id === selectedGrpcClientId)) {
        setSelectedGrpcClientId(d.grpcClients?.[0]?.id || null);
      }
      return d;
    });
  }

  function setItemFolder(type, itemId, folderId) {
    const cfg = folderConfig[type];
    updateDraft((d) => {
      const item = (d[cfg.itemsKey] || []).find((candidate) => candidate.id === itemId);
      if (item) item.folderId = folderId || undefined;
      return d;
    });
  }

  async function moveItemToFolder(type, itemId) {
    const targetId = await askFolderTarget(type);
    if (targetId === undefined) return;
    setItemFolder(type, itemId, targetId);
  }

  function handleItemDrop(e, type, folderId) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData('application/x-mockserver-item');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload.type !== type) {
        notify('只能移动到相同类型的文件夹', 'error');
        return;
      }
      setItemFolder(type, payload.id, folderId);
      notify('接口已移动');
    } catch {
      notify('无法识别拖拽内容', 'error');
    }
  }

  function selectItem(type, itemId) {
    setNavApiType(type);
    if (type.startsWith('grpc-') && itemId) setGrpcOpenVersion((value) => value + 1);
    if (type === 'grpc-mock') lastGrpcMockIdRef.current = itemId;
    if (type === 'grpc-client') lastGrpcClientIdRef.current = itemId;
    setSelectedApiId(type === 'api' ? itemId : null);
    setSelectedClientApiId(type === 'client-api' ? itemId : null);
    setSelectedGrpcMockId(type === 'grpc-mock' ? itemId : null);
    setSelectedGrpcClientId(type === 'grpc-client' ? itemId : null);
    setShowSettings(false);
    setMainView('edit');
  }

  function addGrpcItem(type, folderId) {
    const item = { ...(type === 'grpc-mock' ? emptyGrpcMock() : emptyGrpcClient()), folderId: folderId || undefined };
    const cfg = folderConfig[type];
    updateDraft((d) => {
      d[cfg.itemsKey] = d[cfg.itemsKey] || [];
      d[cfg.itemsKey].push(item);
      return d;
    });
    selectItem(type, item.id);
  }

  async function renameGrpcItem(type, itemId) {
    const cfg = folderConfig[type];
    const target = draft?.[cfg.itemsKey]?.find((item) => item.id === itemId);
    if (!target) return;
    const name = await promptDialog({ title: '重命名 ' + cfg.itemLabel, defaultValue: target.name, placeholder: '名称' });
    if (!name?.trim()) return;
    updateDraft((d) => {
      const item = d[cfg.itemsKey].find((candidate) => candidate.id === itemId);
      if (item) item.name = name.trim();
      return d;
    });
  }

  function copyGrpcItem(type, itemId) {
    const cfg = folderConfig[type];
    const target = draft?.[cfg.itemsKey]?.find((item) => item.id === itemId);
    if (!target) return;
    const copy = { ...duplicateGrpcItem(target), folderId: target.folderId };
    updateDraft((d) => { d[cfg.itemsKey].push(copy); return d; });
    selectItem(type, copy.id);
    notify('已复制 ' + cfg.itemLabel);
  }

  async function deleteGrpcItem(type, itemId) {
    const cfg = folderConfig[type];
    const confirmed = await confirmDialog({ title: '删除 ' + cfg.itemLabel, message: '确定删除该接口？', danger: true, confirmLabel: '删除' });
    if (!confirmed) return;
    const remaining = (draft[cfg.itemsKey] || []).filter((item) => item.id !== itemId);
    updateDraft((d) => { d[cfg.itemsKey] = remaining; return d; });
    if ((type === 'grpc-mock' && selectedGrpcMockId === itemId) || (type === 'grpc-client' && selectedGrpcClientId === itemId)) {
      selectItem(type, remaining[0]?.id || null);
    }
  }

  function addItem(type, folderId) {
    if (type === 'api') addApi(folderId);
    else if (type === 'client-api') addClientApi(folderId);
    else addGrpcItem(type, folderId);
  }

  function addApi(folderId) {
    const na = { ...emptyApi(), folderId: folderId || undefined };
    updateDraft((d) => { d.apis.push(na); return d; });
    setNavApiType('api');
    setSelectedApiId(na.id);
    setSelectedClientApiId(null);
    setSelectedGrpcMockId(null);
    setSelectedGrpcClientId(null);
    setShowSettings(false);
    setMainView('edit');
  }

  function addClientApi(folderId) {
    const na = { ...emptyClientApi(), folderId: folderId || undefined };
    updateDraft((d) => {
      d.clientApis = d.clientApis || [];
      d.clientApis.push(na);
      return d;
    });
    setNavApiType('client-api');
    setSelectedClientApiId(na.id);
    setSelectedApiId(null);
    setSelectedGrpcMockId(null);
    setSelectedGrpcClientId(null);
    setShowSettings(false);
    setMainView('edit');
  }

  async function renameApi(apiId) {
    const target = draft?.apis.find((a) => a.id === apiId);
    if (!target) return;
    const name = await promptDialog({ title: '重命名 API', defaultValue: target.name, placeholder: 'API 名称' });
    if (!name?.trim()) return;
    updateDraft((d) => {
      const a = d.apis.find((x) => x.id === apiId);
      if (a) a.name = name.trim();
      return d;
    });
  }

  function copyApiItem(apiId) {
    const target = draft?.apis.find((a) => a.id === apiId);
    if (!target) return;
    const copy = { ...duplicateApi(target), folderId: target.folderId };
    updateDraft((d) => { d.apis.push(copy); return d; });
    setNavApiType('api');
    setSelectedApiId(copy.id);
    setSelectedClientApiId(null);
    setSelectedGrpcMockId(null);
    setSelectedGrpcClientId(null);
    setShowSettings(false);
    setMainView('edit');
    notify('已复制 API');
  }

  async function deleteApiItem(apiId) {
    const confirmed = await confirmDialog({ title: '删除 API', message: '确定删除该 API？', danger: true, confirmLabel: '删除' });
    if (!confirmed) return;
    const remaining = draft.apis.filter((a) => a.id !== apiId);
    updateDraft((d) => { d.apis = remaining; return d; });
    if (selectedApiId === apiId) setSelectedApiId(remaining[0]?.id || null);
  }

  async function renameClientApiItem(clientApiId) {
    const target = draft?.clientApis?.find((a) => a.id === clientApiId);
    if (!target) return;
    const name = await promptDialog({ title: '重命名 API', defaultValue: target.name, placeholder: 'API 名称' });
    if (!name?.trim()) return;
    updateDraft((d) => {
      const a = d.clientApis.find((x) => x.id === clientApiId);
      if (a) a.name = name.trim();
      return d;
    });
  }

  function copyClientApiItem(clientApiId) {
    const target = draft?.clientApis?.find((a) => a.id === clientApiId);
    if (!target) return;
    const copy = { ...duplicateClientApi(target), folderId: target.folderId };
    updateDraft((d) => {
      d.clientApis = d.clientApis || [];
      d.clientApis.push(copy);
      return d;
    });
    setNavApiType('client-api');
    setSelectedClientApiId(copy.id);
    setSelectedApiId(null);
    setSelectedGrpcMockId(null);
    setSelectedGrpcClientId(null);
    setShowSettings(false);
    setMainView('edit');
    notify('已复制 API');
  }

  async function deleteClientApiItem(clientApiId) {
    const confirmed = await confirmDialog({ title: '删除 API', message: '确定删除该 API？', danger: true, confirmLabel: '删除' });
    if (!confirmed) return;
    const remaining = (draft.clientApis || []).filter((a) => a.id !== clientApiId);
    updateDraft((d) => { d.clientApis = remaining; return d; });
    if (selectedClientApiId === clientApiId) setSelectedClientApiId(remaining[0]?.id || null);
  }

  function openProjectSettings(projectId) {
    setSelectedProjectId(projectId);
    setShowSettings(true);
    setSelectedApiId(null);
    setSelectedClientApiId(null);
    setSelectedGrpcMockId(null);
    setSelectedGrpcClientId(null);
  }

  async function importProjectFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const beforeIds = new Set(projects.map((p) => p.id));
      const raw = await file.text();
      await api.importConfig(raw, true);
      const nextProjects = await api.listProjects();
      const imported = nextProjects.find((p) => !beforeIds.has(p.id)) || nextProjects[nextProjects.length - 1];
      if (imported?.id) {
        setSelectedProjectId(imported.id);
        setShowSettings(false);
      }
      setMessage('项目已导入');
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportProjectFile(projectId, projectName) {
    try {
      const raw = await api.exportProject(projectId);
      const blob = new Blob([raw], { type: 'application/x-yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (projectId || projectName || 'project') + '-' + formatExportTimestamp() + '.yaml';
      a.click();
      URL.revokeObjectURL(url);
      setMessage('项目已导出');
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function exportConfig() {
    const raw = await api.exportConfig();
    const blob = new Blob([raw], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mockserver-config-' + formatExportTimestamp() + '.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearLogs() {
    if (activeSelection && draft) {
      return api.clearRequests(draft.id, activeSelection.id).then(() => loadRequests(draft.id));
    }
    if (draft) {
      return api.clearRequests(draft.id).then(() => loadRequests(draft.id));
    }
    return api.clearRequests().then(() => setRequests([]));
  }

  const itemExportKinds = { api: 'mock-api', 'client-api': 'api', 'grpc-mock': 'grpc-mock', 'grpc-client': 'grpc-client' };

  function itemExportPayload(type, item) {
    return { kind: itemExportKinds[type], version: 1, item };
  }

  function exportItem(type, item) {
    const payload = itemExportPayload(type, item);
    const raw = yaml.dump(payload, { lineWidth: 120 });
    const blob = new Blob([raw], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = String(item.name || item.id || 'interface').replace(/[/:*?"<>|]/g, '-');
    a.download = safeName + '-' + formatExportTimestamp() + '.' + itemExportKinds[type] + '.yaml';
    a.click();
    URL.revokeObjectURL(url);
    notify('接口已导出');
  }

  async function importProtoFile(type, file) {
    if (!file) return;
    if (!type.startsWith('grpc-')) throw new Error('Proto 只能导入到 gRPC 分组');
    const proto = await file.text();
    const inspected = await api.inspectGrpc({ proto, protoFilename: file.name });
    const cfg = folderConfig[type];
    const folders = structuredClone(draft?.[cfg.foldersKey] || []);
    const items = structuredClone(draft?.[cfg.itemsKey] || []);
    let added = 0;
    let updated = 0;
    let firstItemId = null;

    for (const service of inspected.services || []) {
      let folder = folders.find((candidate) => !candidate.parentId && candidate.name === service.serviceName);
      if (!folder) {
        folder = emptyFolder(service.serviceName);
        folders.push(folder);
      }
      for (const method of service.methods || []) {
        let item = items.find((candidate) => (
          candidate.packageName === service.packageName
          && candidate.serviceName === service.serviceName
          && candidate.methodName === method.name
        ));
        if (item) {
          item.name = method.name;
          item.proto = proto;
          item.protoFilename = file.name;
          item.folderId = folder.id;
          updated += 1;
        } else {
          const base = type === 'grpc-mock' ? emptyGrpcMock() : emptyGrpcClient();
          item = {
            ...base,
            id: crypto.randomUUID(),
            name: method.name,
            proto,
            protoFilename: file.name,
            packageName: service.packageName,
            serviceName: service.serviceName,
            methodName: method.name,
            ...(type === 'grpc-mock' ? { response: method.responseStream ? '[]' : '{}' } : { request: method.requestStream ? '[]' : '{}' }),
            folderId: folder.id,
          };
          items.push(item);
          added += 1;
        }
        if (!firstItemId) firstItemId = item.id;
      }
    }

    if (!firstItemId) throw new Error('Proto 中未找到可导入的 gRPC 方法');
    updateDraft((next) => {
      next[cfg.foldersKey] = folders;
      next[cfg.itemsKey] = items;
      return next;
    });
    selectItem(type, firstItemId);
    notify('Proto 导入完成：新增 ' + added + '，更新 ' + updated);
  }

  async function importItemFile(type, file, folderId) {
    if (!file) return;
    try {
      const raw = await file.text();
      if (file.name?.toLowerCase().endsWith('.proto')) {
        await importProtoFile(type, file);
        return;
      }
      const parsed = yaml.load(raw);
      const item = parsed?.item || parsed;
      if (!item || typeof item !== 'object') throw new Error('未找到接口配置');
      if (parsed?.kind && parsed.kind !== itemExportKinds[type]) throw new Error('接口类型与当前分组不匹配');
      if (type === 'api' && (!item.match || !item.response)) throw new Error('不是有效的 HTTP Mock 配置');
      if (type === 'client-api' && !('url' in item)) throw new Error('不是有效的 HTTP Client 配置');
      if (type.startsWith('grpc-') && !('proto' in item)) throw new Error('不是有效的 gRPC 配置');
      const imported = structuredClone(item);
      imported.id = crypto.randomUUID();
      imported.name = imported.name ? imported.name + ' Copy' : 'Imported API';
      imported.folderId = folderId || undefined;
      const cfg = folderConfig[type];
      updateDraft((d) => {
        d[cfg.itemsKey] = d[cfg.itemsKey] || [];
        d[cfg.itemsKey].push(imported);
        return d;
      });
      selectItem(type, imported.id);
      notify('接口已导入');
    } catch (err) {
      notify(err.message || '导入失败', 'error');
    }
  }

  function renderNavItem(type, item, depth = 0) {
    const isGrpc = type.startsWith('grpc-');
    const activeId = type === 'api' ? selectedApiId
      : type === 'client-api' ? selectedClientApiId
        : type === 'grpc-mock' ? selectedGrpcMockId : selectedGrpcClientId;
    const active = activeId === item.id && !showSettings;
    const method = type === 'api' ? item.match?.method : type === 'client-api' ? item.method : 'RPC';
    const select = () => selectItem(type, item.id);
    const rename = () => type === 'api' ? renameApi(item.id)
      : type === 'client-api' ? renameClientApiItem(item.id) : renameGrpcItem(type, item.id);
    const copy = () => type === 'api' ? copyApiItem(item.id)
      : type === 'client-api' ? copyClientApiItem(item.id) : copyGrpcItem(type, item.id);
    const remove = () => type === 'api' ? deleteApiItem(item.id)
      : type === 'client-api' ? deleteClientApiItem(item.id) : deleteGrpcItem(type, item.id);
    return (
      <button
        type="button"
        key={item.id}
        className={'nav-item ' + (active ? 'active' : '')}
        style={{ paddingLeft: (8 + depth * 14) + 'px' }}
        onClick={select}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-mockserver-item', JSON.stringify({ type, id: item.id }));
        }}
        onContextMenu={(e) => openContextMenu(e, [
          { label: '编辑', onClick: select },
          { label: '重命名', onClick: rename },
          { label: '复制', onClick: copy },
          { label: '移动到文件夹', onClick: () => moveItemToFolder(type, item.id) },
          { label: '导出接口', onClick: () => exportItem(type, item) },
          { label: '删除', danger: true, onClick: remove },
        ])}
      >
        {isGrpc ? <span className="protocol-badge grpc sm">RPC</span> : <MethodBadge method={method} size="sm" />}
        <span className="nav-item-name">{item.name}</span>
      </button>
    );
  }

  function renderNavFolder(type, folder, depth = 0) {
    const cfg = folderConfig[type];
    const folders = getFolders(type);
    const items = getItems(type);
    const key = `${type}:${folder.id}`;
    const collapsed = collapsedFolders[key] === true;
    const childFolders = getChildFolders(folders, folder.id);
    const childItems = items.filter((item) => item.folderId === folder.id);
    const orderedChildItems = type.startsWith('grpc-') ? sortGrpcMethods(childItems) : childItems;
    return (
      <div key={folder.id} className="nav-folder">
        <button
          type="button"
          className="nav-folder-row"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => toggleFolder(type, folder.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleItemDrop(e, type, folder.id)}
          onContextMenu={(e) => openContextMenu(e, [
            { label: `新建${cfg.itemLabel}`, onClick: () => addItem(type, folder.id) },
            { label: '导入接口', fileInput: true, accept: type.startsWith('grpc-') ? '.proto,.yaml,.yml,.json' : '.yaml,.yml,.json', onFile: (file) => importItemFile(type, file, folder.id) },
            { label: '新建子文件夹', onClick: () => addFolder(type, folder.id) },
            { label: '重命名', onClick: () => renameFolder(type, folder.id) },
            { label: '复制', onClick: () => copyFolder(type, folder.id) },
            { label: '移动', onClick: () => moveFolder(type, folder.id) },
            { label: '删除', danger: true, onClick: () => deleteFolder(type, folder.id) },
          ])}
        >
          <span className="nav-folder-caret">{collapsed ? '›' : '⌄'}</span>
          <span className="nav-item-name">{folder.name}</span>
        </button>
        {!collapsed && (
          <div className="nav-folder-children">
            {childFolders.map((child) => renderNavFolder(type, child, depth + 1))}
            {orderedChildItems.map((item) => renderNavItem(type, item, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function renderFolderSection(type) {
    const folders = getFolders(type);
    const items = getItems(type);
    const rootFolders = getChildFolders(folders, undefined);
    const rootItems = items.filter((item) => !item.folderId || !folders.some((folder) => folder.id === item.folderId));
    const orderedRootItems = type.startsWith('grpc-') ? sortGrpcMethods(rootItems) : rootItems;
    return (
      <div
        className="nav-drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleItemDrop(e, type, null)}
      >
        {rootFolders.map((folder) => renderNavFolder(type, folder))}
        {orderedRootItems.map((item) => renderNavItem(type, item))}
      </div>
    );
  }

  function renderApiNavTabs() {
    const type = navApiType;
    const cfg = folderConfig[type];
    const isGrpc = type.startsWith('grpc-');
    const direction = type.endsWith('client') || type === 'client-api' ? 'client' : 'mock';
    const protocol = isGrpc ? 'grpc' : 'http';
    const runtime = isGrpc ? selectedStatus?.grpc : selectedStatus;
    const enabled = isGrpc ? draft.grpcEnabled === true : draft.enabled === true;
    const port = isGrpc ? draft.grpcPort : draft.port;
    const portKey = isGrpc ? 'grpcPort' : 'port';

    function switchType(nextType) {
      const targetItems = getItems(nextType);
      const items = nextType.startsWith('grpc-') ? sortGrpcMethods(targetItems) : targetItems;
      const currentId = nextType === 'api' ? selectedApiId
        : nextType === 'client-api' ? selectedClientApiId
          : nextType === 'grpc-mock'
            ? (selectedGrpcMockId || lastGrpcMockIdRef.current)
            : (selectedGrpcClientId || lastGrpcClientIdRef.current);
      const sourceGrpcItem = type === 'grpc-mock'
        ? selectedGrpcMock
        : type === 'grpc-client' ? selectedGrpcClient : null;
      const matchingGrpcItem = type.startsWith('grpc-') && nextType.startsWith('grpc-')
        ? findMatchingGrpcItem(items, sourceGrpcItem, currentId)
        : null;
      const nextId = matchingGrpcItem?.id
        || (items.some((item) => item.id === currentId) ? currentId : items[0]?.id)
        || null;
      selectItem(nextType, nextId);
    }

    return (
      <div className="nav-api-shell">
        <div className="nav-protocol-runtime">
          <div className="nav-protocol-tabs">
            <button type="button" className={protocol === 'http' ? 'active' : ''} onClick={() => switchType(direction === 'mock' ? 'api' : 'client-api')}>HTTP</button>
            <button type="button" className={protocol === 'grpc' ? 'active' : ''} onClick={() => switchType(direction === 'mock' ? 'grpc-mock' : 'grpc-client')}>gRPC</button>
          </div>
          <div className="nav-runtime-control" title={protocol.toUpperCase() + ' Mock Server'}>
            <MockServiceSwitch
              compact
              enabled={enabled}
              running={runtime?.running}
              port={port}
              busy={busy}
              onToggle={(next) => toggleMockService(draft.id, next, protocol)}
              onPortChange={(nextPort) => { if (!enabled && !runtime?.running) updateDraft((d) => { d[portKey] = nextPort; return d; }); }}
              onPortBlur={(nextPort) => { if (!enabled && !runtime?.running) saveProjectPort(draft.id, nextPort, protocol); }}
            />
          </div>
        </div>
        <div className="nav-api-bar" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleItemDrop(e, type, null)}>
          <div className="nav-direction-tabs">
            <button type="button" className={direction === 'mock' ? 'active' : ''} onClick={() => switchType(isGrpc ? 'grpc-mock' : 'api')}>Server</button>
            <button type="button" className={direction === 'client' ? 'active' : ''} onClick={() => switchType(isGrpc ? 'grpc-client' : 'client-api')}>Client</button>
          </div>
          <div className="nav-api-actions">
            <label className="icon-btn sm nav-import-btn" title="导入接口" aria-label="导入接口">
              <ImportIcon />
              <input type="file" accept=".yaml,.yml,.json" hidden onChange={(e) => { importItemFile(type, e.target.files?.[0], null); e.target.value = ''; }} />
            </label>
            <button type="button" className="icon-btn sm" title="新建文件夹" aria-label="新建文件夹" onClick={() => addFolder(type)}><FolderPlusIcon /></button>
            <button type="button" className="icon-btn sm" title={'新建 ' + cfg.itemLabel} aria-label={'新建 ' + cfg.itemLabel} onClick={() => addItem(type)}>+</button>
            {isGrpc && (
              <label className="nav-proto-import" title="导入 Proto 并按 Service 建文件夹">
                <span>.proto</span>
                <input
                  type="file"
                  accept=".proto"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importProtoFile(type, file).catch((error) => notify(error.message || 'Proto 导入失败', 'error'));
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        </div>
        {renderFolderSection(type)}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">AMS</span>
        </div>
        <div className="topbar-center">
          {showMainNav && (
            <nav className="main-nav header-main-nav">
              <button
                type="button"
                className={`main-nav-item ${mainView === 'edit' ? 'active' : ''}`}
                onClick={() => setMainView('edit')}
              >
                Edit
              </button>
              <button
                type="button"
                className={`main-nav-item ${mainView === 'record' ? 'active' : ''}`}
                onClick={() => setMainView('record')}
              >
                Record
                {logRecords.length > 0 && <span className="nav-badge">{logRecords.length}</span>}
              </button>
            </nav>
          )}
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="icon-btn theme-toggle"
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button type="button" className="ghost" onClick={exportConfig}>导出</button>
          <label className="ghost file-btn">
            导入
            <input
              type="file"
              accept=".yaml,.yml,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                file.text().then((raw) => api.importConfig(raw, true).then(() => {
                  notify('配置已导入');
                  refresh();
                })).catch((err) => notify(err.message, 'error'));
              }}
            />
          </label>
        </div>
      </header>

      {notifications.length > 0 && (
        <div className="notifications" aria-live="polite" aria-atomic="true">
          {notifications.map((item) => (
            <div key={item.id} className={`notification ${item.type}`}>
              <span>{item.text}</span>
              <button type="button" onClick={() => dismissNotification(item.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="shell">
        <aside className="nav scroll-y" style={{ width: sidebarResize.size, flexShrink: 0 }}>
          <div className="nav-head">
            <span>项目</span>
            <Dropdown
              align="right"
              trigger="+"
              items={[
                { label: '新建项目', onClick: createProject },
                {
                  label: '导入项目',
                  fileInput: true,
                  accept: '.yaml,.yml,.json',
                  onFile: importProjectFile,
                },
              ]}
            />
          </div>
          <div className="nav-tree">
            {projects.map((p) => {
              const st = status.find((s) => s.id === p.id);
              const active = selectedProjectId === p.id;
              const collapsed = collapsedProjects[p.id] === true;
              const expanded = active && !collapsed;
              const selectProject = () => {
                setSelectedProjectId(p.id);
                setCollapsedProjects((prev) => ({ ...prev, [p.id]: false }));
                setShowSettings(false);
                setSelectedClientApiId(null);
                setSelectedGrpcMockId(null);
                setSelectedGrpcClientId(null);
              };
              return (
                <div key={p.id} className="nav-group">
                  <div
                    className={`nav-project ${active ? 'active' : ''}`}
                    onContextMenu={(e) => openContextMenu(e, [
                      { label: '项目设置', onClick: () => openProjectSettings(p.id) },
                      { label: '导出项目', onClick: () => exportProjectFile(p.id, p.name) },
                      { label: '重启服务', onClick: () => api.restartProject(p.id) },
                      {
                        label: '删除项目',
                        danger: true,
                        onClick: async () => {
                          const confirmed = await confirmDialog({ title: '删除项目', message: '确定删除项目？', danger: true, confirmLabel: '删除' });
                          if (!confirmed) return;
                          api.deleteProject(p.id).then(() => {
                            setSelectedProjectId(null);
                            refresh();
                          });
                        },
                      },
                    ])}
                  >
                    <button
                      type="button"
                      className="nav-project-caret"
                      aria-label={expanded ? `折叠项目 ${p.name}` : `展开项目 ${p.name}`}
                      aria-expanded={expanded}
                      onClick={() => {
                        if (!active) {
                          selectProject();
                          return;
                        }
                        setCollapsedProjects((prev) => ({ ...prev, [p.id]: !collapsed }));
                      }}
                    >
                      {expanded ? '⌄' : '›'}
                    </button>
                    <button type="button" className="nav-project-main" onClick={selectProject}>
                      <span className="nav-name">{p.name}</span>
                      <span className={'project-protocol-dot ' + (st?.running ? 'on' : '')} title={'HTTP :' + p.port}>H</span>
                      <span className={'project-protocol-dot ' + (st?.grpc?.running ? 'on' : '')} title={'gRPC :' + (p.grpcPort || 50051)}>G</span>
                    </button>
                  </div>

                  {expanded && draft && (
                    <div className="nav-items">
                      {renderApiNavTabs()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
        <div
          className="split-handle shell-handle"
          onMouseDown={sidebarResize.onMouseDown}
          role="separator"
          aria-orientation="vertical"
        />

        <div className="content">
          <div className="main-body">
            {!draft ? (
              <div className="placeholder">
                <p>选择或创建一个项目</p>
                <button type="button" className="primary" onClick={createProject}>创建项目</button>
              </div>
            ) : showSettings ? (
              <div className="page-scroll">
                <ProjectSettings
                  draft={draft}
                  running={selectedStatus?.running}
                  grpcRunning={selectedStatus?.grpc?.running}
                  busy={busy}
                  clientHeaderRows={projectClientHeaderRows}
                  clientCookieRows={projectClientCookieRows}
                  onChange={updateDraft}
                  onToggleService={(next) => toggleMockService(draft.id, next, 'http')}
                  onToggleGrpcService={(next) => toggleMockService(draft.id, next, 'grpc')}
                  onSave={saveDraft}
                  dirty={dirty}
                  saving={saving}
                  onDelete={async () => {
                    const confirmed = await confirmDialog({ title: '删除项目', message: '确定删除项目？', danger: true, confirmLabel: '删除' });
                    if (!confirmed) return;
                    api.deleteProject(draft.id).then(() => {
                      setSelectedProjectId(null);
                      refresh();
                    });
                  }}
                />
              </div>
            ) : mainView === 'record' && activeSelection ? (
              <RequestLogPanel
                records={logRecords}
                contextLabel={logTitle}
                contextPath={logPath}
                onRefresh={() => loadRequests(draft.id)}
                onClear={clearLogs}
                paused={paused}
                onTogglePause={() => setPaused((p) => !p)}
                sseConnected={sseConnected}
              />
            ) : selectedGrpcClient ? (
              <GrpcEditor
                key={selectedGrpcClient.id}
                mode="client"
                openVersion={grpcOpenVersion}
                projectId={draft.id}
                item={selectedGrpcClient}
                itemIndex={selectedGrpcClientIndex}
                environments={draft.environments}
                activeEnvironmentId={draft.activeEnvironmentId}
                onProjectPatch={updateDraft}
                onChange={updateDraft}
                onRemove={() => deleteGrpcItem('grpc-client', selectedGrpcClient.id)}
                onSave={saveDraft}
                onSent={() => loadRequests(draft.id)}
                busy={busy}
              />
            ) : selectedGrpcMock ? (
              <GrpcEditor
                key={selectedGrpcMock.id}
                mode="mock"
                openVersion={grpcOpenVersion}
                projectId={draft.id}
                item={selectedGrpcMock}
                itemIndex={selectedGrpcMockIndex}
                onChange={updateDraft}
                onRemove={() => deleteGrpcItem('grpc-mock', selectedGrpcMock.id)}
                onSave={saveDraft}
                busy={busy}
              />
            ) : selectedClientApi ? (
              <ClientApiEditor
                  key={selectedClientApi.id}
                  projectId={draft.id}
                  projectResetKey={draft.id}
                  projectHeaders={draft.clientHeaders}
                  projectCookies={draft.clientCookies}
                  environments={draft.environments}
                  activeEnvironmentId={draft.activeEnvironmentId}
                  onProjectPatch={updateDraft}
                  clientApi={selectedClientApi}
                  clientApiIndex={selectedClientApiIndex}
                  onChange={updateDraft}
                  onRemove={async () => {
                    const confirmed = await confirmDialog({ title: '删除 API', message: '确定删除该 API？', danger: true, confirmLabel: '删除' });
                    if (!confirmed) return;
                    const removedId = selectedClientApiId;
                    updateDraft((d) => {
                      d.clientApis = (d.clientApis || []).filter((a) => a.id !== removedId);
                      setSelectedClientApiId(d.clientApis[0]?.id || null);
                      return d;
                    });
                  }}
                  onSave={saveDraft}
                  busy={busy}
                onSent={() => loadRequests(draft.id)}
              />
            ) : selectedApi ? (
              <ApiEditor
                  key={selectedApi.id}
                  api={selectedApi}
                  apiIndex={selectedApiIndex}
                  onChange={updateDraft}
                  onRemove={async () => {
                    const confirmed = await confirmDialog({ title: '删除 API', message: '确定删除该 API？', danger: true, confirmLabel: '删除' });
                    if (!confirmed) return;
                    const removedId = selectedApiId;
                    updateDraft((d) => {
                      d.apis = d.apis.filter((a) => a.id !== removedId);
                      setSelectedApiId(d.apis[0]?.id || null);
                      return d;
                    });
                  }}
                onSave={saveDraft}
                busy={busy}
              />
            ) : (
              <div className="placeholder">
                <p>选择一个 HTTP 或 gRPC 的 Mock Server/Client 接口</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => resolveDialog(null)}>
          <div className="app-dialog" role="dialog" aria-modal="true" aria-label={dialog.title} onMouseDown={(e) => e.stopPropagation()}>
            <header className="app-dialog-head">
              <h3>{dialog.title}</h3>
              {dialog.message && <p>{dialog.message}</p>}
            </header>
            {dialog.kind === 'prompt' && (
              <input
                className="dialog-input"
                autoFocus
                value={dialog.inputValue}
                placeholder={dialog.placeholder}
                onChange={(e) => setDialog((prev) => ({ ...prev, inputValue: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') resolveDialog(dialog.inputValue);
                }}
              />
            )}
            {dialog.kind === 'select' && (
              <select
                className="dialog-input"
                autoFocus
                value={dialog.selectValue}
                onChange={(e) => setDialog((prev) => ({ ...prev, selectValue: e.target.value }))}
              >
                {(dialog.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <footer className="app-dialog-actions">
              <button type="button" className="ghost" onClick={() => resolveDialog(null)}>取消</button>
              <button
                type="button"
                className={dialog.danger ? 'primary danger-primary' : 'primary'}
                onClick={() => {
                  if (dialog.kind === 'confirm') resolveDialog(true);
                  else if (dialog.kind === 'select') resolveDialog(dialog.selectValue);
                  else resolveDialog(dialog.inputValue);
                }}
              >
                {dialog.confirmLabel || '确定'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
