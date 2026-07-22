import { v4 as uuidv4 } from 'uuid';

function protoName(filename, fallback = 'Proto') {
  return String(filename || fallback).replace(/\.proto$/i, '') || fallback;
}

function normalizeProto(entry, createId) {
  const filename = entry?.filename || entry?.protoFilename || 'service.proto';
  return {
    id: entry?.id || createId(),
    name: entry?.name || protoName(filename),
    filename,
    content: String(entry?.content ?? entry?.proto ?? ''),
  };
}

export function normalizeProjectGrpcProtos(project = {}, createId = uuidv4) {
  const protos = (Array.isArray(project.protos) ? project.protos : [])
    .map((entry) => normalizeProto(entry, createId));
  const protoIds = new Set(protos.map((entry) => entry.id));

  function migrateItem(item) {
    const next = { ...item };
    let protoId = protoIds.has(item?.protoId) ? item.protoId : undefined;
    const legacyContent = String(item?.proto || '');
    if (!protoId && legacyContent.trim()) {
      let shared = protos.find((entry) => entry.content === legacyContent);
      if (!shared) {
        shared = normalizeProto({
          name: protoName(item.protoFilename, 'Migrated Proto'),
          filename: item.protoFilename || 'service.proto',
          content: legacyContent,
        }, createId);
        protos.push(shared);
        protoIds.add(shared.id);
      }
      protoId = shared.id;
    }
    next.protoId = protoId;
    delete next.proto;
    delete next.protoFilename;
    return next;
  }

  return {
    protos,
    grpcMocks: (project.grpcMocks || []).map(migrateItem),
    grpcClients: (project.grpcClients || []).map(migrateItem),
  };
}

export function resolveProjectGrpcConfig(project, item) {
  if (String(item?.proto || '').trim()) return item;
  const proto = (project?.protos || []).find((entry) => entry.id === item?.protoId);
  if (!proto) {
    throw new Error('gRPC 方法 ' + (item?.name || item?.methodName || '(未命名)') + ' 未关联 Proto');
  }
  if (!String(proto.content || '').trim()) {
    throw new Error('Proto ' + (proto.name || proto.filename || proto.id) + ' 内容为空');
  }
  return {
    ...item,
    proto: proto.content,
    protoFilename: proto.filename || 'service.proto',
  };
}
