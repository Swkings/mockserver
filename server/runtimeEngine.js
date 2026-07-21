import { GrpcEngine } from './grpcEngine.js';
import { inspectGrpcProto, invokeGrpc } from './grpcRuntime.js';
import { MockEngine } from './mockEngine.js';

export class RuntimeEngine {
  constructor(store) {
    this.store = store;
    this.http = new MockEngine(store);
    this.grpc = new GrpcEngine(store);
  }

  syncAll() {
    this.http.syncAll();
    this.grpc.syncAll();
  }

  stopProject(projectId) {
    this.http.stopProject(projectId);
    this.grpc.stopProject(projectId);
  }

  restartProject(projectId) {
    this.http.restartProject(projectId);
    this.grpc.restartProject(projectId);
  }

  status() {
    const grpcStatus = new Map(this.grpc.status().map((item) => [item.id, item]));
    return this.http.status().map((item) => ({ ...item, grpc: grpcStatus.get(item.id) }));
  }

  inspectGrpc(config) {
    return inspectGrpcProto(config);
  }

  async sendGrpcClient(projectId, clientId, overrides = {}) {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const client = (project.grpcClients || []).find((item) => item.id === clientId);
    if (!client) throw new Error('gRPC Client not found');

    const started = Date.now();
    try {
      const effectiveClient = { ...client, ...overrides, id: client.id, name: client.name };
      const result = await invokeGrpc(effectiveClient, overrides);
      const record = {
        id: `${Date.now()}-grpc-client-${Math.random().toString(36).slice(2, 8)}`,
        projectId: project.id,
        projectName: project.name,
        timestamp: new Date().toISOString(),
        direction: 'outbound',
        protocol: 'grpc',
        method: result.methodName,
        methodType: result.methodType,
        path: result.path,
        url: `${overrides.target || client.target}${result.path}`,
        headers: overrides.metadata || client.metadata || {},
        body: typeof (overrides.request ?? client.request) === 'string'
          ? (overrides.request ?? client.request)
          : JSON.stringify(overrides.request ?? client.request),
        matchedApiId: client.id,
        matchedApiName: client.name,
        responseStatus: 0,
        responseHeaders: {},
        responseBody: JSON.stringify(result.response),
        durationMs: Date.now() - started,
      };
      this.store.addRequest(record);
      return { ok: true, status: 0, durationMs: record.durationMs, ...result };
    } catch (error) {
      const code = Number.isInteger(error.code) ? error.code : 2;
      const record = {
        id: `${Date.now()}-grpc-client-${Math.random().toString(36).slice(2, 8)}`,
        projectId: project.id,
        projectName: project.name,
        timestamp: new Date().toISOString(),
        direction: 'outbound',
        protocol: 'grpc',
        method: client.methodName || 'gRPC',
        path: [client.packageName, client.serviceName, client.methodName].filter(Boolean).join('/'),
        url: overrides.target || client.target,
        headers: overrides.metadata || client.metadata || {},
        body: typeof (overrides.request ?? client.request) === 'string'
          ? (overrides.request ?? client.request)
          : JSON.stringify(overrides.request ?? client.request),
        matchedApiId: client.id,
        matchedApiName: client.name,
        responseStatus: code,
        responseHeaders: {},
        responseBody: error.details || error.message,
        durationMs: Date.now() - started,
      };
      this.store.addRequest(record);
      error.grpcCode = code;
      throw error;
    }
  }
}
