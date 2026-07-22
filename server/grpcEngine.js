import {
  grpc,
  grpcMethodType,
  normalizeGrpcErrorCode,
  parseJsonValue,
  resolveGrpcMethod,
} from './grpcRuntime.js';
import { resolveProjectGrpcConfig } from './utils/grpcProtos.js';

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function requestMetadata(call) {
  const values = call.metadata?.getMap?.() || {};
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    Buffer.isBuffer(value) ? value.toString('base64') : String(value),
  ]));
}

function grpcError(code, details) {
  return { code, details: details || 'Mock gRPC error' };
}

export class GrpcEngine {
  constructor(store) {
    this.store = store;
    this.servers = new Map();
    this.errors = new Map();
  }

  syncAll() {
    const activeIds = new Set(this.store.projects.filter((project) => project.grpcEnabled).map((project) => project.id));
    for (const id of this.servers.keys()) {
      if (!activeIds.has(id)) this.stopProject(id);
    }
    for (const project of this.store.projects) {
      if (project.grpcEnabled) this.startProject(project);
      else this.stopProject(project.id);
    }
  }

  startProject(project) {
    this.stopProject(project.id);
    this.errors.delete(project.id);
    const server = new grpc.Server();
    const groups = new Map();

    try {
      for (const config of (project.grpcMocks || []).filter((item) => item.enabled !== false)) {
        const resolved = resolveGrpcMethod(resolveProjectGrpcConfig(project, config));
        const key = resolved.service.fullName;
        if (!groups.has(key)) {
          groups.set(key, { definition: resolved.service.definition, handlers: {} });
        }
        groups.get(key).handlers[resolved.method.key] = this.createHandler(project, config, resolved);
      }
      for (const group of groups.values()) server.addService(group.definition, group.handlers);
    } catch (error) {
      this.errors.set(project.id, error.message);
      console.error(`[grpc] failed to load ${project.name}:`, error.message);
      return;
    }

    const address = `${project.grpcHost || '0.0.0.0'}:${project.grpcPort || 50051}`;
    this.servers.set(project.id, { server, project, running: false });
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
      const entry = this.servers.get(project.id);
      if (!entry || entry.server !== server) return;
      if (error) {
        this.errors.set(project.id, error.message);
        this.servers.delete(project.id);
        console.error(`[grpc] failed to start ${project.name} on ${address}:`, error.message);
        return;
      }
      entry.running = true;
      console.log(`[grpc] ${project.name} listening on ${address}`);
    });
  }

  createHandler(project, config, resolved) {
    const method = resolved.method;
    if (!method.requestStream && !method.responseStream) {
      return async (call, callback) => {
        const result = await this.execute(project, config, resolved, call, call.request);
        callback(result.error || null, result.response);
      };
    }
    if (!method.requestStream && method.responseStream) {
      return async (call) => {
        const result = await this.execute(project, config, resolved, call, call.request);
        if (result.error) {
          call.destroy(result.error);
          return;
        }
        for (const message of result.response) call.write(message);
        call.end();
      };
    }
    if (method.requestStream && !method.responseStream) {
      return (call, callback) => {
        const requests = [];
        call.on('data', (message) => requests.push(message));
        call.on('error', () => {});
        call.on('end', async () => {
          const result = await this.execute(project, config, resolved, call, requests);
          callback(result.error || null, result.response);
        });
      };
    }
    return (call) => {
      const requests = [];
      call.on('data', (message) => requests.push(message));
      call.on('error', () => {});
      call.on('end', async () => {
        const result = await this.execute(project, config, resolved, call, requests);
        if (result.error) {
          call.destroy(result.error);
          return;
        }
        for (const message of result.response) call.write(message);
        call.end();
      });
    };
  }

  async execute(project, config, resolved, call, request) {
    const started = Date.now();
    const errorCode = normalizeGrpcErrorCode(config.errorCode);
    let response = parseJsonValue(config.response, resolved.method.responseStream ? [] : {}, 'Mock 响应');
    if (resolved.method.responseStream && !Array.isArray(response)) response = [response];
    await sleep(Number(config.delayMs) || 0);

    const record = {
      id: `${Date.now()}-grpc-${Math.random().toString(36).slice(2, 8)}`,
      projectId: project.id,
      projectName: project.name,
      timestamp: new Date().toISOString(),
      direction: 'inbound',
      protocol: 'grpc',
      clientIp: call.getPeer?.() || '',
      method: resolved.method.name,
      methodType: grpcMethodType(resolved.method),
      path: resolved.method.path,
      url: `${project.grpcHost}:${project.grpcPort}${resolved.method.path}`,
      headers: requestMetadata(call),
      body: JSON.stringify(request),
      matchedApiId: config.id,
      matchedApiName: config.name,
      responseStatus: errorCode,
      responseHeaders: {},
      responseBody: errorCode === grpc.status.OK ? JSON.stringify(response) : (config.errorMessage || 'Mock gRPC error'),
      durationMs: Date.now() - started,
    };
    this.store.addRequest(record);

    if (errorCode !== grpc.status.OK) {
      return { error: grpcError(errorCode, config.errorMessage), response: null };
    }
    return { error: null, response };
  }

  stopProject(projectId) {
    const entry = this.servers.get(projectId);
    if (!entry) return;
    entry.server.forceShutdown();
    this.servers.delete(projectId);
    console.log(`[grpc] stopped project ${entry.project.name}`);
  }

  restartProject(projectId) {
    const project = this.store.getProject(projectId);
    this.stopProject(projectId);
    if (project?.grpcEnabled) this.startProject(project);
  }

  status() {
    return this.store.projects.map((project) => {
      const entry = this.servers.get(project.id);
      return {
        id: project.id,
        host: project.grpcHost,
        port: project.grpcPort,
        enabled: project.grpcEnabled,
        running: entry?.running === true,
        error: this.errors.get(project.id) || null,
      };
    });
  }
}
