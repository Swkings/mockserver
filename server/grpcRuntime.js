import { grpcTargetAuthority } from '../shared/environment.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_DIR = path.join(os.tmpdir(), 'mockserver-grpc-protos');
const LOADER_OPTIONS = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};


const SCALAR_TYPE_NAMES = {
  TYPE_DOUBLE: "double", TYPE_FLOAT: "float", TYPE_INT64: "int64", TYPE_UINT64: "uint64",
  TYPE_INT32: "int32", TYPE_FIXED64: "fixed64", TYPE_FIXED32: "fixed32", TYPE_BOOL: "bool",
  TYPE_STRING: "string", TYPE_BYTES: "bytes", TYPE_UINT32: "uint32", TYPE_SFIXED32: "sfixed32",
  TYPE_SFIXED64: "sfixed64", TYPE_SINT32: "sint32", TYPE_SINT64: "sint64",
};

function lowerCamel(value) {
  return String(value || "").replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function createTypeRegistry(packageDefinition) {
  return new Map(Object.entries(packageDefinition || {})
    .filter(([, value]) => value?.type)
    .map(([name, value]) => [name.replace(/^\./, ""), value]));
}

function resolveTypeEntry(registry, typeName, ownerName) {
  const normalized = String(typeName || "").replace(/^\./, "");
  if (!normalized) return null;
  if (registry.has(normalized)) return { name: normalized, value: registry.get(normalized) };
  const ownerParts = String(ownerName || "").split(".").filter(Boolean);
  ownerParts.pop();
  while (ownerParts.length) {
    const candidate = `${ownerParts.join(".")}.${normalized}`;
    if (registry.has(candidate)) return { name: candidate, value: registry.get(candidate) };
    ownerParts.pop();
  }
  const matches = [...registry.entries()].filter(([name]) => name === normalized || name.endsWith(`.${normalized}`));
  return matches.length === 1 ? { name: matches[0][0], value: matches[0][1] } : null;
}

function describeMessage(descriptor, fullName, registry, ancestors = new Set()) {
  if (!descriptor) return { typeName: fullName || "message", fields: [] };
  if (ancestors.has(fullName)) return { typeName: fullName, fields: [], recursive: true };
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(fullName);
  return {
    typeName: fullName || descriptor.name || "message",
    fields: (descriptor.field || []).map((field) => describeField(field, descriptor, fullName, registry, nextAncestors)),
  };
}

function describeField(field, ownerDescriptor, ownerName, registry, ancestors) {
  const repeated = field.label === "LABEL_REPEATED";
  const base = {
    name: lowerCamel(field.jsonName || field.name),
    protoName: field.name,
    number: field.number,
    repeated,
  };
  if (field.type === "TYPE_MESSAGE") {
    const shortName = String(field.typeName || "").split(".").pop();
    const nested = (ownerDescriptor.nestedType || []).find((entry) => entry.name === shortName);
    const resolved = nested
      ? { name: `${ownerName}.${shortName}`, value: { type: nested } }
      : resolveTypeEntry(registry, field.typeName, ownerName);
    const descriptor = resolved?.value?.type;
    if (descriptor?.options?.mapEntry) {
      const [keyField, valueField] = descriptor.field || [];
      return {
        ...base,
        kind: "map",
        type: "map",
        key: keyField ? describeField(keyField, descriptor, resolved.name, registry, ancestors) : null,
        value: valueField ? describeField(valueField, descriptor, resolved.name, registry, ancestors) : null,
      };
    }
    return {
      ...base,
      kind: "message",
      type: resolved?.name || field.typeName || "message",
      message: describeMessage(descriptor, resolved?.name || field.typeName || "message", registry, ancestors),
    };
  }
  if (field.type === "TYPE_ENUM") {
    const resolved = resolveTypeEntry(registry, field.typeName, ownerName);
    return {
      ...base,
      kind: "enum",
      type: resolved?.name || field.typeName || "enum",
      values: (resolved?.value?.type?.value || []).map((value) => value.name),
    };
  }
  return { ...base, kind: "scalar", type: SCALAR_TYPE_NAMES[field.type] || String(field.type || "unknown").replace(/^TYPE_/, "").toLowerCase() };
}

function writeProto(proto, filename = 'service.proto') {
  if (!String(proto || '').trim()) throw new Error('Proto 内容不能为空');
  fs.mkdirSync(PROTO_DIR, { recursive: true });
  const hash = crypto.createHash('sha256').update(String(proto)).digest('hex').slice(0, 16);
  const safeName = path.basename(filename || 'service.proto').replace(/[^a-zA-Z0-9_.-]/g, '-');
  const filePath = path.join(PROTO_DIR, `${hash}-${safeName.endsWith('.proto') ? safeName : `${safeName}.proto`}`);
  fs.writeFileSync(filePath, proto, 'utf8');
  return filePath;
}

function collectServices(node, prefix = '', rows = [], typeRegistry = new Map()) {
  for (const [name, value] of Object.entries(node || {})) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'function' && value.service) {
      const dot = fullName.lastIndexOf('.');
      rows.push({
        fullName,
        packageName: dot >= 0 ? fullName.slice(0, dot) : '',
        serviceName: dot >= 0 ? fullName.slice(dot + 1) : fullName,
        constructor: value,
        definition: value.service,
        methods: Object.entries(value.service).map(([key, definition]) => ({
          key,
          name: definition.path?.split('/').pop() || definition.originalName || key,
          path: definition.path,
          requestStream: definition.requestStream === true,
          responseStream: definition.responseStream === true,
          requestSchema: describeMessage(
            definition.requestType?.type,
            [fullName.split('.').slice(0, -1).join('.'), definition.requestType?.type?.name].filter(Boolean).join('.'),
            typeRegistry,
          ),
          responseSchema: describeMessage(
            definition.responseType?.type,
            [fullName.split('.').slice(0, -1).join('.'), definition.responseType?.type?.name].filter(Boolean).join('.'),
            typeRegistry,
          ),
        })),
      });
    } else if (value && typeof value === 'object') {
      collectServices(value, fullName, rows, typeRegistry);
    }
  }
  return rows;
}

export function loadGrpcProto(config) {
  const filePath = writeProto(config.proto, config.protoFilename);
  const packageDefinition = protoLoader.loadSync(filePath, {
    ...LOADER_OPTIONS,
    includeDirs: [path.dirname(filePath)],
  });
  const root = grpc.loadPackageDefinition(packageDefinition);
  const typeRegistry = createTypeRegistry(packageDefinition);
  const services = collectServices(root, '', [], typeRegistry);
  if (!services.length) throw new Error('Proto 中未找到 gRPC service');
  return { filePath, root, services };
}

export function inspectGrpcProto(config) {
  const { services } = loadGrpcProto(config);
  return services.map(({ constructor: _constructor, definition: _definition, ...service }) => service);
}

export function resolveGrpcMethod(config) {
  const loaded = loadGrpcProto(config);
  const requestedService = [config.packageName, config.serviceName].filter(Boolean).join('.');
  const service = loaded.services.find((candidate) => candidate.fullName === requestedService)
    || loaded.services.find((candidate) => candidate.serviceName === config.serviceName)
    || (loaded.services.length === 1 ? loaded.services[0] : null);
  if (!service) throw new Error(`未找到 gRPC service: ${requestedService || config.serviceName || '(未选择)'}`);

  const requestedMethod = String(config.methodName || '').toLowerCase();
  const method = service.methods.find((candidate) => (
    candidate.key.toLowerCase() === requestedMethod
    || candidate.name.toLowerCase() === requestedMethod
    || candidate.path.toLowerCase().endsWith(`/${requestedMethod}`)
  )) || (service.methods.length === 1 ? service.methods[0] : null);
  if (!method) throw new Error(`未找到 gRPC method: ${config.methodName || '(未选择)'}`);

  return {
    ...loaded,
    service,
    method,
    methodDefinition: service.definition[method.key],
  };
}

export function parseJsonValue(value, fallback, label) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label}不是有效 JSON: ${error.message}`);
  }
}

export function grpcMethodType(method) {
  if (method.requestStream && method.responseStream) return 'Bidi streaming';
  if (method.requestStream) return 'Client streaming';
  if (method.responseStream) return 'Server streaming';
  return 'Unary';
}

export function createMetadata(values = {}) {
  const metadata = new grpc.Metadata();
  for (const [key, value] of Object.entries(values || {})) {
    if (key.trim() && value != null) metadata.set(key.trim(), String(value));
  }
  return metadata;
}

export async function invokeGrpc(config, overrides = {}) {
  const resolved = resolveGrpcMethod(config);
  const rawTarget = overrides.target || config.target || 'http://127.0.0.1:50051';
  const target = grpcTargetAuthority(rawTarget);
  const credentials = (overrides.useTls ?? config.useTls)
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();
  const client = new resolved.service.constructor(target, credentials);
  const metadata = createMetadata(overrides.metadata ?? config.metadata);
  const timeoutMs = Number(overrides.timeoutMs ?? config.timeoutMs) || 10000;
  const options = { deadline: new Date(Date.now() + timeoutMs) };
  const rawRequest = overrides.request ?? config.request;
  const request = parseJsonValue(rawRequest, resolved.method.requestStream ? [] : {}, '请求体');
  const method = client[resolved.method.key].bind(client);

  try {
    const response = await new Promise((resolve, reject) => {
      if (!resolved.method.requestStream && !resolved.method.responseStream) {
        method(request || {}, metadata, options, (error, value) => (error ? reject(error) : resolve(value)));
        return;
      }

      if (!resolved.method.requestStream && resolved.method.responseStream) {
        const call = method(request || {}, metadata, options);
        const values = [];
        call.on('data', (value) => values.push(value));
        call.on('error', reject);
        call.on('end', () => resolve(values));
        return;
      }

      const messages = Array.isArray(request) ? request : [request];
      if (resolved.method.requestStream && !resolved.method.responseStream) {
        const call = method(metadata, options, (error, value) => (error ? reject(error) : resolve(value)));
        for (const message of messages) call.write(message || {});
        call.end();
        return;
      }

      const call = method(metadata, options);
      const values = [];
      call.on('data', (value) => values.push(value));
      call.on('error', reject);
      call.on('end', () => resolve(values));
      for (const message of messages) call.write(message || {});
      call.end();
    });

    return {
      response,
      methodType: grpcMethodType(resolved.method),
      path: resolved.method.path,
      serviceName: resolved.service.fullName,
      methodName: resolved.method.name,
    };
  } finally {
    client.close();
  }
}

export function normalizeGrpcErrorCode(value) {
  if (value == null || value === '') return grpc.status.OK;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 16 ? number : grpc.status.UNKNOWN;
}

export { grpc };
