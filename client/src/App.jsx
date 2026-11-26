import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import yaml from 'js-yaml';
import { api, subscribeEvents } from './api.js';
import ApiEditor from './components/ApiEditor.jsx';
import ClientApiEditor from './components/ClientApiEditor.jsx';
import GrpcMethodPicker from './components/GrpcMethodPicker.jsx';
import GrpcEditor from './components/GrpcEditor.jsx';
import RequestLogPanel from './components/RequestLogPanel.jsx';
import MethodBadge from './components/MethodBadge.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import Icon from './components/Icon.jsx';
import Dropdown from './components/Dropdown.jsx';
import ProjectSettings from './components/ProjectSettings.jsx';
import ProtoManager from './components/ProtoManager.jsx';
import EnvironmentManager from './components/EnvironmentManager.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import InterfaceDrawer from './components/InterfaceDrawer.jsx';
import PanelDivider, { clampPanelWidth, useContainerWidth } from './components/PanelDivider.jsx';
import { duplicateApi, duplicateClientApi, duplicateGrpcItem } from './utils/duplicate.js';
import { findMatchingGrpcItem, sortGrpcMethods } from './utils/grpc.js';
import { importCurlCommand, importOpenApiDocument, isOpenApiDocument } from './utils/apiImport.js';
import {
  readProjectActivity,
  removeProjectActivity,
  resolveProjectActivity,
  writeProjectActivity,
} from './utils/projectActivity.js';
import {
  clearAllRequestRecords,
  clearProjectRequestRecords,
  mergeRequestRecords,
  readProjectRequestRecords,
  writeProjectRequestRecords,
} from './utils/requestRecords.js';

const emptyGrpcMethodOption = { key: 'manual', name: '空白方法', detail: '稍后关联 Proto' };
const minProjectSidebarWidth = 220;
const minProjectRailWidth = 104;
const minInterfaceSidebarWidth = 190;

const emptyProject = () => ({
  name: 'New Project',
  host: '0.0.0.0',
  port: 3900,
  enabled: false,
  grpcHost: '0.0.0.0',
  grpcPort: 50051,
  grpcEnabled: false,
  description: '',
  clientCookies: {},
  apiFolders: [],
  clientApiFolders: [],
  grpcMockFolders: [],
  grpcClientFolders: [],
  protos: [],
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
  proxy: false,
  insecureTls: false,
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

const emptyGrpcMock = () => ({
  id: crypto.randomUUID(), name: "New gRPC Mock", enabled: false, protoId: undefined,
  packageName: "", serviceName: "", methodName: "", response: "{}", delayMs: 0,
});

const emptyGrpcClient = () => ({
  id: crypto.randomUUID(), name: "New gRPC Client", target: "http://127.0.0.1:50051", protoId: undefined,
  packageName: "", serviceName: "", methodName: "", request: "{}", metadata: {}, timeoutMs: 10000, useTls: false, useEnvironment: true,
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
    protos: project.protos || [],
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

function getAncestorFolderIds(folders, folderId) {
  const byId = new Map((folders || []).map((folder) => [folder.id, folder]));
  const ids = [];
  const visited = new Set();
  let currentId = folderId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    ids.push(currentId);
    currentId = byId.get(currentId)?.parentId;
  }
  return ids;
}


export default function App() {
  const [projects, setProjects] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [environmentLayout, setEnvironmentLayout] = useState(null);
  const [workspace, setWorkspace] = useState(() => window.location.hash === '#environments' ? 'environments' : 'projects');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [status, setStatus] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedApiId, setSelectedApiId] = useState(null);
  const [selectedClientApiId, setSelectedClientApiId] = useState(null);
  const [selectedGrpcMockId, setSelectedGrpcMockId] = useState(null);
  const [selectedGrpcClientId, setSelectedGrpcClientId] = useState(null);
  const lastGrpcMockIdRef = useRef(null);
  const lastGrpcClientIdRef = useRef(null);
  const projectOpenIntentRef = useRef(null);
  const activeNavItemRef = useRef(null);
  const selectedProjectIdRef = useRef(null);
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
  const [showProtoManager, setShowProtoManager] = useState(false);
  const [importPanel, setImportPanel] = useState(null);
  const [mainView, setMainView] = useState('edit');
  const [navApiType, setNavApiType] = useState('api');
  const [sseConnected, setSseConnected] = useState(false);

  const [workbenchRef, workbenchWidth] = useContainerWidth();
  const [preferredProjectSidebarWidth, setProjectSidebarWidth] = useState(320);
  const [preferredProjectRailWidth, setProjectRailWidth] = useState(122);
  const [preferredInterfaceSidebarWidth, setInterfaceSidebarWidth] = useState(198);
  const [contextMenu, setContextMenu] = useState(null);
  const [sidebarProjectId, setSidebarProjectId] = useState(null);
  const [interfaceFilters, setInterfaceFilters] = useState({});
  const projectListRef = useRef(null);
  const interfaceListRef = useRef(null);
  const projectScrollTop = useRef(0);
  const interfaceScrollPositions = useRef(new Map());
  const visibleInterface = useRef(null);
  const focusProjectId = useRef(null);
  const focusInterfaceHeading = useRef(false);
  const backToProjectsRef = useRef(null);
  const [projectReload, setProjectReload] = useState(0);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const draftRef = useRef(null);
  const draftVersionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const dialogResolverRef = useRef(null);
  const configInputRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const sidebarShowsInterfaces = sidebarProjectId !== null && sidebarProjectId === selectedProjectId;
  const sidebarLimit = Math.min(760, Math.max(340, Math.floor((workbenchWidth || 1440) * 0.57)));
  const projectSidebarLimit = Math.min(480, sidebarLimit);
  const projectRailLimit = Math.min(300, Math.floor(sidebarLimit * 0.4));
  const interfaceSidebarLimit = sidebarLimit - projectRailLimit - 12;
  const projectSidebarWidth = clampPanelWidth(preferredProjectSidebarWidth, minProjectSidebarWidth, projectSidebarLimit);
  const projectRailWidth = clampPanelWidth(preferredProjectRailWidth, minProjectRailWidth, projectRailLimit);
  const interfaceSidebarWidth = clampPanelWidth(preferredInterfaceSidebarWidth, minInterfaceSidebarWidth, interfaceSidebarLimit);
  const interfaceKey = draft?.id === selectedProjectId && draft ? JSON.stringify([draft.id, navApiType]) : null;
  const interfaceFilter = interfaceFilters[interfaceKey] || '';
  const sidebarItemId = selectedApiId || selectedClientApiId || selectedGrpcMockId || selectedGrpcClientId;

  selectedProjectIdRef.current = selectedProjectId;

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

  useEffect(() => {
    function syncWorkspace() {
      setWorkspace(window.location.hash === '#environments' ? 'environments' : 'projects');
      setMobileNavOpen(false);
    }
    window.addEventListener('hashchange', syncWorkspace);
    return () => window.removeEventListener('hashchange', syncWorkspace);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavOpen]);

  function navigateWorkspace(next) {
    setMobileNavOpen(false);
    setWorkspace(next);
    window.location.hash = next;
  }

  const refreshEnvironments = useCallback(async () => {
    const [entries, layout] = await Promise.all([api.listEnvironments(), api.getEnvironmentLayout()]);
    setEnvironments(entries);
    setEnvironmentLayout(layout);
  }, []);

  const loadRequests = useCallback(async (projectId) => {
    const cached = readProjectRequestRecords(projectId);
    if (selectedProjectIdRef.current === projectId) setRequests(cached);
    const params = new URLSearchParams({ limit: '200' });
    if (projectId) params.set('projectId', projectId);
    const remote = await api.listRequests(params.toString());
    const merged = mergeRequestRecords(cached, remote);
    writeProjectRequestRecords(projectId, merged);
    if (selectedProjectIdRef.current === projectId) setRequests(merged);
    return merged;
  }, []);

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([api.listProjects(), api.projectStatus(), refreshEnvironments()]);
    setProjects(p);
    setStatus(s);
    const pid = selectedProjectId || p[0]?.id;
    if (pid) await loadRequests(pid);
    if (!selectedProjectId && p.length) setSelectedProjectId(p[0].id);
  }, [loadRequests, selectedProjectId, refreshEnvironments]);

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
      if (event === 'request') {
        const cached = readProjectRequestRecords(payload.projectId);
        const persisted = mergeRequestRecords(cached, [payload]);
        writeProjectRequestRecords(payload.projectId, persisted);
        if (!paused && selectedProjectId === payload.projectId) {
          setRequests((prev) => mergeRequestRecords(prev, [payload]));
        }
      }
      if (event === 'projects') {
        refresh().catch(() => {});
      }
      if (event === 'environments') refreshEnvironments().catch(() => {});
      if (event === 'requests_cleared') {
        if (payload?.projectId) clearProjectRequestRecords(payload.projectId, payload.apiId);
        else clearAllRequestRecords();
        if (!payload?.projectId || payload.projectId === selectedProjectId) {
          loadRequests(selectedProjectId).catch(() => {});
        }
      }
    }, setSseConnected);
    return unsub;
  }, [refresh, paused, selectedProjectId, loadRequests, refreshEnvironments]);

  useEffect(() => {
    if (!selectedProjectId) {
      setDraft(null);
      setSelectedApiId(null);
      setSelectedClientApiId(null);
      setSelectedGrpcMockId(null);
      setSelectedGrpcClientId(null);
      return undefined;
    }

    let active = true;
    api.getProject(selectedProjectId).then((p) => {
      if (!active) return;
      const normalized = normalizeDraftProject(p);
      const intent = projectOpenIntentRef.current?.projectId === selectedProjectId
        ? projectOpenIntentRef.current
        : null;
      if (intent) projectOpenIntentRef.current = null;
      const savedActivity = readProjectActivity(selectedProjectId);
      const restored = resolveProjectActivity(normalized, intent
        ? { ...savedActivity, location: intent.location }
        : savedActivity);

      setDraft(normalized);
      draftRef.current = normalized;
      setDirty(false);
      setNavApiType(restored.type);
      setSelectedApiId(restored.type === 'api' ? restored.itemId : null);
      setSelectedClientApiId(restored.type === 'client-api' ? restored.itemId : null);
      setSelectedGrpcMockId(restored.type === 'grpc-mock' ? restored.itemId : null);
      setSelectedGrpcClientId(restored.type === 'grpc-client' ? restored.itemId : null);
      lastGrpcMockIdRef.current = restored.type === 'grpc-mock' ? restored.itemId : null;
      lastGrpcClientIdRef.current = restored.type === 'grpc-client' ? restored.itemId : null;
      setShowSettings(restored.location === 'settings');
      setShowProtoManager(restored.location === 'protos');
      setMainView(restored.mainView);

      const cfg = folderConfig[restored.type];
      const selectedItem = normalized[cfg.itemsKey]?.find((item) => item.id === restored.itemId);
      const ancestorIds = getAncestorFolderIds(normalized[cfg.foldersKey], selectedItem?.folderId);
      if (ancestorIds.length) {
        setCollapsedFolders((prev) => {
          const next = { ...prev };
          for (const folderId of ancestorIds) {
            const key = JSON.stringify([selectedProjectId, restored.type, folderId]);
            if (!Object.hasOwn(next, key)) next[key] = false;
          }
          return next;
        });
      }
    }).catch((err) => {
      if (active) setMessage(err.message);
    });

    return () => {
      active = false;
    };
  }, [selectedProjectId, projectReload, setMessage]);

  useEffect(() => {
    if (!selectedProjectId || draft?.id !== selectedProjectId) return;
    const type = selectedApiId ? 'api'
      : selectedClientApiId ? 'client-api'
        : selectedGrpcMockId ? 'grpc-mock'
          : selectedGrpcClientId ? 'grpc-client'
            : navApiType;
    const itemId = selectedApiId || selectedClientApiId || selectedGrpcMockId || selectedGrpcClientId || null;
    writeProjectActivity(selectedProjectId, {
      type,
      itemId,
      location: showSettings ? 'settings' : showProtoManager ? 'protos' : itemId ? 'item' : 'empty',
      mainView,
    });
  }, [
    draft?.id,
    mainView,
    navApiType,
    selectedApiId,
    selectedClientApiId,
    selectedGrpcMockId,
    selectedGrpcClientId,
    selectedProjectId,
    showProtoManager,
    showSettings,
  ]);

  useLayoutEffect(() => {
    if (workspace !== 'projects') return;
    if (sidebarShowsInterfaces) {
      if (focusInterfaceHeading.current && backToProjectsRef.current?.offsetWidth) {
        backToProjectsRef.current.focus({ preventScroll: true });
        focusInterfaceHeading.current = false;
      }
      return;
    }
    const list = projectListRef.current;
    if (!list?.clientHeight) return;
    list.scrollTop = projectScrollTop.current;
    if (focusProjectId.current) {
      const row = [...list.querySelectorAll('[data-project-id]')]
        .find((button) => button.dataset.projectId === focusProjectId.current);
      row?.focus({ preventScroll: true });
      focusProjectId.current = null;
    }
  }, [sidebarShowsInterfaces, workspace, mobileNavOpen, projects.length]);

  useLayoutEffect(() => {
    const list = interfaceListRef.current;
    if (!sidebarShowsInterfaces || workspace !== 'projects' || !list?.clientHeight || !interfaceKey) {
      visibleInterface.current = null;
      return;
    }
    const previous = visibleInterface.current;
    if (previous?.key !== interfaceKey && interfaceScrollPositions.current.has(interfaceKey)) {
      list.scrollTop = interfaceScrollPositions.current.get(interfaceKey);
    } else if (previous?.key !== interfaceKey || previous.itemId !== sidebarItemId) {
      const row = activeNavItemRef.current?.getBoundingClientRect();
      if (row) {
        const bounds = list.getBoundingClientRect();
        if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
        else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
      }
    }
    visibleInterface.current = { key: interfaceKey, itemId: sidebarItemId };
  }, [sidebarShowsInterfaces, interfaceKey, sidebarItemId, workspace, mobileNavOpen]);

  function changeInterfaceFilter(value) {
    if (!interfaceKey || value === interfaceFilter) return;
    interfaceScrollPositions.current.set(interfaceKey, 0);
    if (interfaceListRef.current) interfaceListRef.current.scrollTop = 0;
    setInterfaceFilters((filters) => ({ ...filters, [interfaceKey]: value }));
  }

  function rememberInterfaceScroll() {
    if (interfaceKey && interfaceListRef.current) {
      interfaceScrollPositions.current.set(interfaceKey, interfaceListRef.current.scrollTop);
    }
  }

  async function enterProject(projectId) {
    if (projectId !== selectedProjectId && dirty && !await saveDraft({ silent: true })) return;
    if (sidebarShowsInterfaces) rememberInterfaceScroll();
    if (projectListRef.current) projectScrollTop.current = projectListRef.current.scrollTop;
    focusInterfaceHeading.current = !sidebarShowsInterfaces;
    projectOpenIntentRef.current = null;
    setSidebarProjectId(projectId);
    setSelectedProjectId(projectId);
  }

  function backToProjects() {
    rememberInterfaceScroll();
    focusProjectId.current = sidebarProjectId;
    setSidebarProjectId(null);
  }

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

  const activeSelection = selectedApi || selectedClientApi || selectedGrpcMock || selectedGrpcClient;
  const activeType = selectedApi ? 'api' : selectedClientApi ? 'client-api' : selectedGrpcMock ? 'grpc-mock' : 'grpc-client';

  function patchInterfaceIdentity(fields) {
    updateDraft((project) => {
      const item = project[folderConfig[activeType].itemsKey].find(({ id }) => id === activeSelection?.id);
      if (item) Object.assign(item, fields);
    });
  }

  const logRecords = useMemo(() => {
    if (!activeSelection) return requests;
    const direction = selectedApi || selectedGrpcMock ? 'inbound' : 'outbound';
    return requests.filter((record) => record.direction === direction && (
      record.matchedApiId === activeSelection.id
      || (!record.matchedApiId && record.matchedApiName === activeSelection.name)
    ));
  }, [requests, activeSelection, selectedApi, selectedGrpcMock]);

  const projectReady = draft?.id === selectedProjectId && Boolean(draft);
  const showMainNav = workspace === 'projects' && projectReady && Boolean(activeSelection);
  const viewingInterface = !showSettings && !showProtoManager;

  function openInterfaceView(view) {
    setShowSettings(false);
    setShowProtoManager(false);
    setMainView(view);
  }

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
    if (!current) return false;
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
      if (selectedProjectIdRef.current === saved.id) {
        if (saveVersion === draftVersionRef.current) {
          setDraft(saved);
          draftRef.current = saved;
          setDirty(false);
        } else {
          pendingSaveRef.current = true;
        }
      }
      if (!silent) notify('已保存');
      await refresh();
      return saveVersion === draftVersionRef.current;
    } catch (err) {
      notify(err.message, 'error');
      return false;
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && workspace === 'projects') {
        e.preventDefault();
        saveDraft();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveDraft, workspace]);

  useEffect(() => {
    if (!dirty || !draft) return undefined;
    const timer = window.setTimeout(() => saveDraft({ silent: true }), 1800);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, saveDraft]);

  async function createProject() {
    setBusy(true);
    try {
      const saved = normalizeDraftProject(await api.saveProject({ ...emptyProject(), activeEnvironmentId: environments[0]?.id }));
      setSidebarProjectId(saved.id);
      setSelectedProjectId(saved.id);
      setDraft(saved);
      draftRef.current = saved;
      setDirty(false);
      setSelectedApiId(null);
      projectOpenIntentRef.current = { projectId: saved.id, location: 'settings' };
      setShowSettings(true);
      setShowProtoManager(false);
      setMobileNavOpen(false);
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
    const trigger = e.type === 'click' ? e.currentTarget : null;
    const anchor = trigger?.getBoundingClientRect();
    setContextMenu({ x: anchor ? anchor.left : e.clientX, y: anchor ? anchor.bottom + 4 : e.clientY, items, trigger });
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
    const key = JSON.stringify([selectedProjectId, type, folderId]);
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
    setShowProtoManager(false);
    setMainView('edit');
  }

  async function addGrpcItem(type, folderId) {
    let availableMethods = [];
    if (draft?.protos?.length) {
      setBusy(true);
      try {
        const inspected = await Promise.all((draft.protos || []).map(async (proto) => {
          try {
            const result = await api.inspectGrpc({ proto: proto.content, protoFilename: proto.filename });
            return { proto, services: result.services || [] };
          } catch {
            return { proto, services: [] };
          }
        }));
        availableMethods = inspected.flatMap(({ proto, services }) => services.flatMap((service) => (
          sortGrpcMethods(service.methods || []).map((method) => ({
            protoId: proto.id,
            protoName: proto.name || proto.filename,
            packageName: service.packageName,
            serviceName: service.serviceName,
            methodName: method.name,
            path: method.path,
            requestStream: method.requestStream,
            responseStream: method.responseStream,
          }))
        )));
      } finally {
        setBusy(false);
      }
    }

    let selectedMethod = null;
    if (availableMethods.length) {
      const methods = availableMethods.map((method, index) => ({
        ...method,
        key: `method:${index}`,
        name: method.methodName,
        detail: `${method.protoName} · ${[method.packageName, method.serviceName].filter(Boolean).join('.')}`,
      }));
      const choice = await openDialog({
        kind: 'grpc-method',
        title: '新建 ' + folderConfig[type].itemLabel,
        message: '选择项目 Proto 中的方法，或创建空白方法。',
        methods,
        defaultValue: emptyGrpcMethodOption.key,
      });
      if (choice === null) return;
      selectedMethod = methods.find((method) => method.key === choice) || null;
    }

    const item = {
      ...(type === 'grpc-mock' ? emptyGrpcMock() : emptyGrpcClient()),
      folderId: folderId || undefined,
    };
    if (selectedMethod) {
      item.name = selectedMethod.methodName;
      if (type === 'grpc-mock') item.enabled = true;
      item.protoId = selectedMethod.protoId;
      item.packageName = selectedMethod.packageName;
      item.serviceName = selectedMethod.serviceName;
      item.methodName = selectedMethod.methodName;
      if (type === 'grpc-mock') item.response = selectedMethod.responseStream ? '[]' : '{}';
      else item.request = selectedMethod.requestStream ? '[]' : '{}';
    }

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
    setShowProtoManager(false);
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
    setShowProtoManager(false);
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
    setShowProtoManager(false);
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
    setShowProtoManager(false);
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
    setMobileNavOpen(false);
    if (projectId !== selectedProjectId) {
      projectOpenIntentRef.current = { projectId, location: 'settings' };
    }
    setSelectedProjectId(projectId);
    setShowSettings(true);
    setShowProtoManager(false);
  }

  function openProtoManager() {
    setShowSettings(false);
    setShowProtoManager(true);
  }

  async function deleteProto(protoId) {
    const references = [...(draft?.grpcMocks || []), ...(draft?.grpcClients || [])]
      .filter((item) => item.protoId === protoId);
    const confirmed = await confirmDialog({
      title: '删除 Proto',
      message: references.length
        ? '该 Proto 已关联 ' + references.length + ' 个方法。删除后这些方法将解除关联，是否继续？'
        : '确定删除该 Proto？',
      danger: true,
      confirmLabel: '删除',
    });
    if (!confirmed) return;
    updateDraft((project) => {
      project.protos = (project.protos || []).filter((proto) => proto.id !== protoId);
      for (const item of [...(project.grpcMocks || []), ...(project.grpcClients || [])]) {
        if (item.protoId === protoId) item.protoId = undefined;
      }
    });
  }

  async function importConfigFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const beforeIds = new Set(projects.map((p) => p.id));
      const raw = await file.text();
      await api.importConfig(raw, true);
      const nextProjects = await api.listProjects();
      const imported = nextProjects.find((p) => !beforeIds.has(p.id));
      if (imported?.id) {
        if (sidebarShowsInterfaces) setSidebarProjectId(imported.id);
        setSelectedProjectId(imported.id);
        setShowSettings(false);
        setShowProtoManager(false);
      } else if (selectedProjectIdRef.current) {
        setProjectReload((version) => version + 1);
      }
      setMessage('配置已导入');
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
      return api.clearRequests(draft.id, activeSelection.id).then(() => {
        clearProjectRequestRecords(draft.id, activeSelection.id);
        return loadRequests(draft.id);
      });
    }
    if (draft) {
      return api.clearRequests(draft.id).then(() => {
        clearProjectRequestRecords(draft.id);
        return loadRequests(draft.id);
      });
    }
    return api.clearRequests().then(() => {
      clearAllRequestRecords();
      setRequests([]);
    });
  }

  const itemExportKinds = { api: 'mock-api', 'client-api': 'api', 'grpc-mock': 'grpc-mock', 'grpc-client': 'grpc-client' };

  function itemExportPayload(type, item) {
    if (!type.startsWith('grpc-')) return { kind: itemExportKinds[type], version: 1, item };
    return {
      kind: itemExportKinds[type],
      version: 2,
      item,
      proto: (draft?.protos || []).find((entry) => entry.id === item.protoId),
    };
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

  async function appendImportedItems(type, items, { host = '', environmentName = '' } = {}) {
    if (!items.length) throw new Error('没有可导入的接口');
    const cfg = folderConfig[type];
    let environment;
    if (type === 'client-api' && host) {
      const existing = await api.listEnvironments();
      environment = existing.find((env) => env.host === host && env.id === draft?.activeEnvironmentId)
        || existing.find((env) => env.host === host);
      if (!environment) {
        environment = await api.saveEnvironment({ name: environmentName || new URL(host).hostname, host });
        await refreshEnvironments();
      }
    }
    updateDraft((project) => {
      if (project.id !== draft.id) return project;
      project[cfg.itemsKey].push(...items);
      if (environment) project.activeEnvironmentId = environment.id;
    });
    selectItem(type, items[0].id);
    notify(items.length === 1 ? '接口已导入' : `已导入 ${items.length} 个接口`);
  }

  function importExportedItem(type, parsed, folderId) {
    const item = parsed?.item || parsed;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('未找到接口配置');
    if (parsed?.kind && parsed.kind !== itemExportKinds[type]) throw new Error('接口类型与当前分组不匹配');
    if (type === 'api' && (!item.match || !item.response)) throw new Error('不是有效的 HTTP Mock 配置');
    if (type === 'client-api' && !('url' in item)) throw new Error('不是有效的 HTTP Client 配置');
    const imported = structuredClone(item);
    imported.id = crypto.randomUUID();
    imported.name = imported.name ? imported.name + ' Copy' : 'Imported API';
    imported.folderId = folderId || undefined;
    let protoToAdd = null;

    if (type.startsWith('grpc-')) {
      const bundledProto = parsed?.proto && typeof parsed.proto === 'object' ? parsed.proto : null;
      const legacyContent = typeof imported.proto === 'string' ? imported.proto : '';
      const protoContent = bundledProto?.content || legacyContent;
      if (protoContent) {
        const existing = (draftRef.current?.protos || []).find((proto) => proto.content === protoContent);
        if (existing) {
          imported.protoId = existing.id;
        } else {
          protoToAdd = {
            id: crypto.randomUUID(),
            name: bundledProto?.name || (bundledProto?.filename || imported.protoFilename || 'Imported Proto').replace(/\.proto$/i, ''),
            filename: bundledProto?.filename || imported.protoFilename || 'service.proto',
            content: protoContent,
          };
          imported.protoId = protoToAdd.id;
        }
      } else if (imported.protoId && !(draftRef.current?.protos || []).some((proto) => proto.id === imported.protoId)) {
        throw new Error('gRPC 配置引用的 Proto 不存在');
      } else {
        imported.protoId = undefined;
      }
      delete imported.proto;
      delete imported.protoFilename;
    }

    const cfg = folderConfig[type];
    updateDraft((project) => {
      project[cfg.itemsKey] = project[cfg.itemsKey] || [];
      if (protoToAdd) project.protos = [...(project.protos || []), protoToAdd];
      project[cfg.itemsKey].push(imported);
      return project;
    });
    selectItem(type, imported.id);
    notify('接口已导入');
  }

  async function importItemFile(type, file, folderId) {
    if (!file) throw new Error('请先选择要导入的文件');
    const raw = await file.text();
    let parsed;
    try {
      parsed = yaml.load(raw);
    } catch (error) {
      throw new Error(`文件解析失败：${error.message}`);
    }
    if ((type === 'api' || type === 'client-api') && isOpenApiDocument(parsed)) {
      const result = importOpenApiDocument(parsed, { type, folderId });
      await appendImportedItems(type, result.items, { host: result.host, environmentName: result.title });
      return;
    }
    importExportedItem(type, parsed, folderId);
  }

  async function importItemCurl(type, command, folderId) {
    const result = importCurlCommand(command, { type, folderId });
    await appendImportedItems(type, result.items, { host: result.host });
  }

  function openImportPanel(type, folderId = null) {
    const folder = getFolders(type).find((entry) => entry.id === folderId);
    setImportPanel({ type, folderId, folderName: folder?.name || '' });
  }

  function getItemActions(type, item) {
    const rename = () => type === 'api' ? renameApi(item.id)
      : type === 'client-api' ? renameClientApiItem(item.id) : renameGrpcItem(type, item.id);
    const copy = () => type === 'api' ? copyApiItem(item.id)
      : type === 'client-api' ? copyClientApiItem(item.id) : copyGrpcItem(type, item.id);
    const remove = () => type === 'api' ? deleteApiItem(item.id)
      : type === 'client-api' ? deleteClientApiItem(item.id) : deleteGrpcItem(type, item.id);
    return [
      { label: '重命名', onClick: rename },
      { label: '复制', onClick: copy },
      { label: '移动到文件夹', onClick: () => moveItemToFolder(type, item.id) },
      { label: '导出接口', onClick: () => exportItem(type, item) },
      { label: '删除', danger: true, onClick: remove },
    ];
  }

  function renderNavItem(type, item, depth = 0) {
    const isGrpc = type.startsWith('grpc-');
    const activeId = type === 'api' ? selectedApiId
      : type === 'client-api' ? selectedClientApiId
        : type === 'grpc-mock' ? selectedGrpcMockId : selectedGrpcClientId;
    const active = activeId === item.id && !showSettings && !showProtoManager;
    const method = type === 'api' ? item.match?.method : type === 'client-api' ? item.method : 'RPC';
    const select = () => {
      selectItem(type, item.id);
      setMobileNavOpen(false);
    };
    return (
      <button
        type="button"
        key={item.id}
        className={'nav-item ' + (active ? 'active' : '')}
        aria-current={active ? 'true' : undefined}
        ref={active ? activeNavItemRef : undefined}
        style={{ paddingLeft: (8 + depth * 14) + 'px' }}
        onClick={select}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-mockserver-item', JSON.stringify({ type, id: item.id }));
        }}
        onContextMenu={(e) => openContextMenu(e, [
          { label: '编辑', onClick: select },
          ...getItemActions(type, item),
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
    const key = JSON.stringify([selectedProjectId, type, folder.id]);
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
            { label: '导入接口', onClick: () => openImportPanel(type, folder.id) },
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

    function switchType(nextType) {
      rememberInterfaceScroll();
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

    const query = interfaceFilter.trim().toLowerCase();
    const filtered = query && getItems(type).filter((item) => (
      [item.name, item.match?.path, item.url, item.methodName, item.serviceName]
        .some((value) => value?.toLowerCase().includes(query))
    ));

    return (
      <>
        <div className="nav-interface-tools">
          <div className="nav-api-bar">
            <select className="field nav-api-type" aria-label="接口类型" value={type} onChange={(event) => switchType(event.target.value)}>
              <option value="api">HTTP Server</option>
              <option value="client-api">HTTP Client</option>
              <option value="grpc-mock">gRPC Server</option>
              <option value="grpc-client">gRPC Client</option>
            </select>
            <button type="button" className="ghost sm nav-create-api" onClick={() => { changeInterfaceFilter(''); addItem(type); }}>新建接口</button>
            <Dropdown trigger={<Icon name="more" />} label="接口列表操作" items={[
              { label: '导入接口', onClick: () => openImportPanel(type) },
              { label: '新建文件夹', onClick: () => addFolder(type) },
              ...(isGrpc ? [{ label: '管理 Proto', onClick: openProtoManager }] : []),
            ]} />
          </div>
          <input className="field nav-filter" type="search" aria-label="筛选接口" placeholder="筛选名称或路径" value={interfaceFilter} onChange={(event) => changeInterfaceFilter(event.target.value)} />
        </div>
        <div key={interfaceKey} className="nav-interface-list scroll-y" ref={interfaceListRef} onScroll={rememberInterfaceScroll}>
          {query
            ? filtered.length ? filtered.map((item) => renderNavItem(type, item)) : <div className="nav-list-empty">没有匹配的接口</div>
            : renderFolderSection(type)}
        </div>
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10" /></svg>
            <span className="logo">Mockserver</span>
          </div>
          <nav className="workspace-navigation" aria-label="工作区">
            <button type="button" aria-current={workspace === 'projects' ? 'page' : undefined} onClick={() => navigateWorkspace('projects')}>接口工作台</button>
            <button type="button" aria-current={workspace === 'environments' ? 'page' : undefined} onClick={() => navigateWorkspace('environments')}>环境管理</button>
          </nav>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="icon-btn theme-toggle"
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <Dropdown trigger={<Icon name="settings" />} label="配置" title="配置" items={[
            { label: '导入配置', onClick: () => configInputRef.current?.click() },
            { label: '导出全部配置', onClick: exportConfig },
          ]} />
          <input
            ref={configInputRef}
            type="file"
            accept=".yaml,.yml,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              importConfigFile(file);
            }}
          />
        </div>
      </header>

      {notifications.length > 0 && (
        <div className="notifications" aria-live="polite" aria-atomic="true">
          {notifications.map((item) => (
            <div key={item.id} className={`notification ${item.type}`}>
              <span>{item.text}</span>
              <button type="button" aria-label="关闭通知" onClick={() => dismissNotification(item.id)}><Icon name="close" /></button>
            </div>
          ))}
        </div>
      )}

      <main className="environment-shell" hidden={workspace !== 'environments'}>
        <EnvironmentManager
          environments={environments}
          layout={environmentLayout}
          projects={projects}
          onRefresh={refreshEnvironments}
          onNotify={notify}
          onMenu={openContextMenu}
          promptDialog={promptDialog}
          selectDialog={selectDialog}
          confirmDialog={confirmDialog}
        />
      </main>
      <div ref={workbenchRef} className="shell" hidden={workspace !== 'projects'}>
        {mobileNavOpen && <button type="button" className="mobile-nav-backdrop" aria-label="关闭项目导航" onClick={() => setMobileNavOpen(false)} />}
        <aside id="project-navigation" aria-label="项目和接口" className={`nav ${mobileNavOpen ? 'mobile-open' : ''} ${sidebarShowsInterfaces ? 'drawer-open' : ''}`} style={{ '--project-sidebar-width': `${projectSidebarWidth}px`, '--project-rail-width': `${projectRailWidth}px`, '--interface-sidebar-width': `${interfaceSidebarWidth}px` }}>
            <nav id="project-sidebar" className="sidebar-panel project-sidebar" aria-label="项目导航">
              <div className="nav-head">
                <strong>项目</strong>
                <button type="button" className="ghost sm project-add" onClick={createProject} disabled={busy} aria-label="新建项目" title="新建项目">
                  {sidebarShowsInterfaces ? <Icon name="plus" /> : '新建项目'}
                </button>
              </div>
              <div className="nav-tree scroll-y" ref={projectListRef} aria-label="项目列表" onScroll={(event) => { projectScrollTop.current = event.currentTarget.scrollTop; }}>
                {projects.map((p) => {
                  const active = selectedProjectId === p.id;
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
                                removeProjectActivity(p.id);
                                clearProjectRequestRecords(p.id);
                                setSelectedProjectId(null);
                                refresh();
                              });
                            },
                          },
                        ])}
                      >
                        <button type="button" className="nav-project-main" data-project-id={p.id} aria-current={active ? 'true' : undefined} aria-controls="interface-drawer" aria-expanded={active && sidebarShowsInterfaces} title={p.name} disabled={busy && !active} onClick={() => enterProject(p.id)}>
                          <span className="nav-name">{p.name}</span>
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>
            </nav>
          {sidebarShowsInterfaces && (
            <PanelDivider className="project-rail-divider" label="调整项目列表宽度" controls="project-sidebar" width={projectRailWidth} min={minProjectRailWidth} max={projectRailLimit} onResize={setProjectRailWidth} />
          )}
          <InterfaceDrawer
            open={sidebarShowsInterfaces}
            projectName={draft?.id === selectedProjectId ? draft.name : projects.find((project) => project.id === sidebarProjectId)?.name}
            closeRef={backToProjectsRef}
            onClose={backToProjects}
          >
            {interfaceKey ? renderApiNavTabs() : <div className="nav-list-empty" role="status">加载中…</div>}
          </InterfaceDrawer>
        </aside>
        <PanelDivider
          className="shell-handle"
          label={sidebarShowsInterfaces ? '调整接口列表宽度' : '调整项目列表宽度'}
          controls={sidebarShowsInterfaces ? 'interface-drawer' : 'project-sidebar'}
          width={sidebarShowsInterfaces ? interfaceSidebarWidth : projectSidebarWidth}
          min={sidebarShowsInterfaces ? minInterfaceSidebarWidth : minProjectSidebarWidth}
          max={sidebarShowsInterfaces ? interfaceSidebarLimit : projectSidebarLimit}
          onResize={sidebarShowsInterfaces ? setInterfaceSidebarWidth : setProjectSidebarWidth}
        />

        <main className="content">
          <div className="workspace-bar">
            <div className="workspace-context">
              <button type="button" className="ghost mobile-nav-toggle" aria-expanded={mobileNavOpen} aria-controls="project-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{sidebarShowsInterfaces ? '接口' : '项目'}</button>
              {projectReady && <strong title={draft.name}>{draft.name}</strong>}
              {projectReady && activeSelection && viewingInterface && (
                <>
                  <span className="workspace-divider" aria-hidden="true">/</span>
                  {mainView === 'edit' ? (
                    <>
                      <input
                        key={activeSelection.id}
                        className="workspace-interface-name"
                        aria-label="接口名称"
                        title={activeSelection.name}
                        placeholder="接口名称"
                        value={activeSelection.name || ''}
                        onChange={(event) => patchInterfaceIdentity({ name: event.target.value })}
                      />
                      {(selectedApi || selectedGrpcMock) && (
                        <label className="toggle-switch workspace-mock-toggle" title="启用 Mock 接口">
                          <input type="checkbox" aria-label="启用 Mock 接口" checked={activeSelection.enabled !== false} onChange={(event) => patchInterfaceIdentity({ enabled: event.target.checked })} />
                          <span className="toggle-track" />
                        </label>
                      )}
                    </>
                  ) : <span className="workspace-interface-label" title={activeSelection.name}>{activeSelection.name}</span>}
                </>
              )}
            </div>
            <nav className="workspace-actions" aria-label="项目视图">
              {showMainNav && <>
                <button type="button" className="ghost" aria-pressed={viewingInterface && mainView === 'edit'} onClick={() => openInterfaceView('edit')}>编辑</button>
                <button type="button" className="ghost" aria-pressed={viewingInterface && mainView === 'record'} onClick={() => openInterfaceView('record')}>记录 {logRecords.length > 0 && <span className="nav-badge">{logRecords.length}</span>}</button>
              </>}
              {projectReady && <button type="button" className="ghost" aria-pressed={showSettings} onClick={() => openProjectSettings(draft.id)}>项目设置</button>}
            </nav>
          </div>
          <div className="main-body">
            {!projectReady ? (
              <div className="placeholder">
                {selectedProjectId
                  ? <span role="status">加载中…</span>
                  : <button type="button" className="primary" onClick={createProject}>创建项目</button>}
              </div>
            ) : showSettings ? (
              <div className="page-scroll">
                <ProjectSettings
                  draft={draft}
                  running={selectedStatus?.running}
                  grpcRunning={selectedStatus?.grpc?.running}
                  busy={busy}
                  environments={environments}
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
                      removeProjectActivity(draft.id);
                      clearProjectRequestRecords(draft.id);
                      setSelectedProjectId(null);
                      refresh();
                    });
                  }}
                />
              </div>
            ) : showProtoManager ? (
              <ProtoManager
                draft={draft}
                onChange={updateDraft}
                onSave={saveDraft}
                onDelete={deleteProto}
                onClose={() => setShowProtoManager(false)}
                busy={busy}
              />
            ) : mainView === 'record' && activeSelection ? (
              <RequestLogPanel
                records={logRecords}
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
                protos={draft.protos}
                item={selectedGrpcClient}
                itemIndex={selectedGrpcClientIndex}
                project={draft}
                environments={environments}
                onProjectPatch={updateDraft}
                onChange={updateDraft}
                actions={getItemActions('grpc-client', selectedGrpcClient)}
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
                protos={draft.protos}
                item={selectedGrpcMock}
                itemIndex={selectedGrpcMockIndex}
                onChange={updateDraft}
                actions={getItemActions('grpc-mock', selectedGrpcMock)}
                onSave={saveDraft}
                busy={busy}
              />
            ) : selectedClientApi ? (
              <ClientApiEditor
                  key={selectedClientApi.id}
                  projectId={draft.id}
                  project={draft}
                  environments={environments}
                  onProjectPatch={updateDraft}
                  clientApi={selectedClientApi}
                  clientApiIndex={selectedClientApiIndex}
                  onChange={updateDraft}
                  actions={getItemActions('client-api', selectedClientApi)}
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
                  actions={getItemActions('api', selectedApi)}
                onSave={saveDraft}
                busy={busy}
              />
            ) : (
              <div className="placeholder">
                {getItems(navApiType).length > 0
                  ? <span>请选择接口</span>
                  : <span>暂无接口</span>}
              </div>
            )}
          </div>
        </main>
      </div>

      {importPanel && (
        <ImportPanel
          type={importPanel.type}
          folderName={importPanel.folderName}
          onImportFile={(file) => importItemFile(importPanel.type, file, importPanel.folderId)}
          onImportCurl={(command) => importItemCurl(importPanel.type, command, importPanel.folderId)}
          onClose={() => setImportPanel(null)}
        />
      )}

      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => resolveDialog(null)}>
          <div className="app-dialog" role="dialog" aria-modal="true" aria-label={dialog.title} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(event) => {
            if (dialog.kind === 'grpc-method' && event.key === 'Escape') {
              event.stopPropagation();
              resolveDialog(null);
            }
          }}>
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
            {dialog.kind === 'grpc-method' && (
              <GrpcMethodPicker
                inDialog
                methods={dialog.methods}
                pinnedMethod={emptyGrpcMethodOption}
                selectedMethod={dialog.methods.find((method) => method.key === dialog.selectValue) || emptyGrpcMethodOption}
                onSelect={(method) => setDialog((current) => ({ ...current, selectValue: method.key }))}
              />
            )}
            <footer className="app-dialog-actions">
              <button type="button" className="ghost" onClick={() => resolveDialog(null)}>取消</button>
              <button
                type="button"
                className={dialog.danger ? 'primary danger-primary' : 'primary'}
                onClick={() => {
                  if (dialog.kind === 'confirm') resolveDialog(true);
                  else if (dialog.kind === 'select' || dialog.kind === 'grpc-method') resolveDialog(dialog.selectValue);
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
          trigger={contextMenu.trigger}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
