const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function createId() {
  return globalThis.crypto?.randomUUID?.() || `imported-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function jsonPointerGet(document, pointer) {
  if (!pointer?.startsWith('#/')) return undefined;
  return pointer.slice(2).split('/').reduce((value, segment) => {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    return value?.[key];
  }, document);
}

function resolveRef(value, document) {
  if (!value?.$ref) return value;
  return jsonPointerGet(document, value.$ref) || value;
}

function schemaExample(schema, document, seen = new Set()) {
  if (schema?.$ref) {
    if (seen.has(schema.$ref)) return undefined;
    seen.add(schema.$ref);
  }
  const resolved = resolveRef(schema, document);
  if (!resolved || typeof resolved !== 'object') return undefined;
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (Array.isArray(resolved.enum) && resolved.enum.length) return resolved.enum[0];

  if (Array.isArray(resolved.allOf)) {
    const values = resolved.allOf.map((entry) => schemaExample(entry, document, new Set(seen)));
    const objects = values.filter((value) => value && typeof value === 'object' && !Array.isArray(value));
    if (objects.length) return Object.assign({}, ...objects);
    return values.find((value) => value !== undefined);
  }
  if (resolved.oneOf?.length || resolved.anyOf?.length) {
    return schemaExample((resolved.oneOf || resolved.anyOf)[0], document, new Set(seen));
  }
  if (resolved.type === 'array' || resolved.items) {
    const item = schemaExample(resolved.items, document, seen);
    return item === undefined ? [] : [item];
  }

  if (resolved.type === 'object' || resolved.properties) {
    const result = {};
    for (const [key, property] of Object.entries(resolved.properties || {})) {
      const example = schemaExample(property, document, new Set(seen));
      if (example !== undefined) result[key] = example;
    }
    return result;
  }

  if (resolved.type === 'integer' || resolved.type === 'number') return 0;
  if (resolved.type === 'boolean') return false;
  if (resolved.type === 'string') {
    if (resolved.format === 'date') return '2026-01-01';
    if (resolved.format === 'date-time') return '2026-01-01T00:00:00Z';
    return '';
  }
  return undefined;
}

function contentExample(content, document) {
  const entries = Object.entries(asObject(content));
  if (!entries.length) return { mediaType: '', value: undefined };
  const [mediaType, media] = entries.find(([type]) => type.includes('json')) || entries[0];
  const resolvedMedia = resolveRef(media, document) || {};
  let value = resolvedMedia.example;
  if (value === undefined) {
    const namedExample = Object.values(resolvedMedia.examples || {})[0];
    value = resolveRef(namedExample, document)?.value;
  }
  if (value === undefined) value = schemaExample(resolvedMedia.schema, document);
  return { mediaType, value };
}

function stringifyBody(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function normalizePath(path) {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function joinPaths(prefix, path) {
  const left = String(prefix || '').replace(/\/$/, '');
  const right = normalizePath(path);
  return normalizePath(`${left}${right}`.replace(/\/{2,}/g, '/'));
}

function resolveServerUrl(document) {
  if (document.openapi) {
    const server = document.servers?.[0];
    if (!server?.url) return { host: '', basePath: '' };
    const expanded = server.url.replace(/\{([^}]+)\}/g, (match, name) => {
      return server.variables?.[name]?.default ?? match;
    });
    try {
      const url = new URL(expanded);
      return { host: `${url.protocol}//${url.host}`, basePath: url.pathname === '/' ? '' : url.pathname };
    } catch {
      return { host: '', basePath: expanded.startsWith('/') ? expanded : '' };
    }
  }

  const scheme = document.schemes?.[0] || 'http';
  return {
    host: document.host ? `${scheme}://${document.host}` : '',
    basePath: document.basePath || '',
  };
}

function parameterValue(parameter, document) {
  const resolved = resolveRef(parameter, document) || {};
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.schema?.example !== undefined) return resolved.schema.example;
  if (resolved.schema?.default !== undefined) return resolved.schema.default;
  if (resolved.default !== undefined) return resolved.default;
  return schemaExample(resolved.schema || resolved, document) ?? '';
}

function collectParameters(pathItem, operation, document) {
  const merged = new Map();
  for (const raw of [...(pathItem.parameters || []), ...(operation.parameters || [])]) {
    const parameter = resolveRef(raw, document) || {};
    if (parameter.name && parameter.in) merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

function pickResponse(operation, document) {
  const responses = asObject(operation.responses);
  const keys = Object.keys(responses);
  const key = keys.filter((value) => /^2\d\d$/.test(value)).sort()[0]
    || (Object.hasOwn(responses, 'default') ? 'default' : keys[0]);
  const response = resolveRef(responses[key], document) || {};
  const status = /^\d+$/.test(key || '') ? Number(key) : 200;
  const content = contentExample(response.content, document);
  if (content.value !== undefined || content.mediaType) {
    return { status, body: stringifyBody(content.value), mediaType: content.mediaType || 'application/json' };
  }
  const swaggerValue = response.examples ? Object.values(response.examples)[0] : schemaExample(response.schema, document);
  return {
    status,
    body: stringifyBody(swaggerValue),
    mediaType: operation.produces?.[0] || document.produces?.[0] || 'application/json',
  };
}

function requestDetails(operation, parameters, document) {
  const headers = {};
  const pathParams = {};
  const pathParamDescriptions = {};
  const queryParams = {};
  const queryParamDescriptions = {};

  for (const parameter of parameters) {
    const value = parameterValue(parameter, document);
    const description = parameter.description || '';
    if (parameter.in === 'header' && value !== '') headers[parameter.name] = String(value);
    if (parameter.in === 'path') {
      pathParams[parameter.name] = String(value);
      if (description) pathParamDescriptions[parameter.name] = description;
    }
    if (parameter.in === 'query') {
      queryParams[parameter.name] = String(value);
      if (description) queryParamDescriptions[parameter.name] = description;
    }
  }

  let mediaType = '';
  let bodyValue;
  if (operation.requestBody) {
    const requestBody = resolveRef(operation.requestBody, document) || {};
    const content = contentExample(requestBody.content, document);
    mediaType = content.mediaType;
    bodyValue = content.value;
  } else {
    const bodyParameter = parameters.find((parameter) => parameter.in === 'body');
    if (bodyParameter) {
      bodyValue = parameterValue(bodyParameter, document);
      mediaType = operation.consumes?.[0] || document.consumes?.[0] || 'application/json';
    }
  }
  if (mediaType) headers['Content-Type'] = mediaType;

  return {
    headers,
    pathParams,
    pathParamDescriptions,
    queryParams,
    queryParamDescriptions,
    body: stringifyBody(bodyValue),
  };
}

export function isOpenApiDocument(document) {
  return Boolean(document && typeof document === 'object' && (document.openapi || document.swagger) && document.paths);
}

export function importOpenApiDocument(document, { type, folderId, idFactory = createId } = {}) {
  if (!isOpenApiDocument(document)) throw new Error('文件不是有效的 OpenAPI 或 Swagger 文档');
  if (!['api', 'client-api'].includes(type)) throw new Error('OpenAPI 仅支持导入 HTTP 接口');

  const { host, basePath } = resolveServerUrl(document);
  const items = [];
  for (const [rawPath, rawPathItem] of Object.entries(document.paths || {})) {
    const pathItem = resolveRef(rawPathItem, document) || {};
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const operation = resolveRef(rawOperation, document) || {};
      const path = joinPaths(basePath, rawPath);
      const name = operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`;
      const details = requestDetails(operation, collectParameters(pathItem, operation, document), document);

      if (type === 'client-api') {
        items.push({
          id: idFactory(),
          name,
          method: method.toUpperCase(),
          url: path,
          headers: details.headers,
          useProjectHeaders: true,
          useProjectCookies: true,
          proxy: false,
          insecureTls: false,
          body: details.body,
          allowGetBody: method.toLowerCase() === 'get' && Boolean(details.body),
          description: operation.description || operation.summary || '',
          folderId: folderId || undefined,
          pathParams: Object.keys(details.pathParams).length ? details.pathParams : undefined,
          pathParamDescriptions: Object.keys(details.pathParamDescriptions).length ? details.pathParamDescriptions : undefined,
          queryParams: Object.keys(details.queryParams).length ? details.queryParams : undefined,
          queryParamDescriptions: Object.keys(details.queryParamDescriptions).length ? details.queryParamDescriptions : undefined,
        });
      } else {
        const response = pickResponse(operation, document);
        items.push({
          id: idFactory(),
          name,
          enabled: true,
          priority: 0,
          folderId: folderId || undefined,
          match: {
            method: method.toUpperCase(),
            path,
            headers: Object.keys(details.headers).length ? details.headers : undefined,
          },
          response: {
            status: response.status,
            headers: response.mediaType ? { 'Content-Type': response.mediaType } : {},
            body: response.body,
            delayMs: 0,
          },
        });
      }
    }
  }

  if (!items.length) throw new Error('OpenAPI 文档中没有可导入的 HTTP 接口');
  return { items, host, title: document.info?.title || '' };
}

function tokenizeShell(command) {
  const tokens = [];
  let token = '';
  let quote = '';
  let escaping = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaping) {
      if (char !== '\n') token += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += char;
  }
  if (escaping) token += '\\';
  if (quote) throw new Error('cURL 命令中的引号未闭合');
  if (token) tokens.push(token);
  return tokens;
}

function optionValue(tokens, index, token) {
  const equalsIndex = token.indexOf('=');
  if (equalsIndex > 0) return { value: token.slice(equalsIndex + 1), nextIndex: index };
  if (index + 1 >= tokens.length) throw new Error(`cURL 参数 ${token} 缺少值`);
  return { value: tokens[index + 1], nextIndex: index + 1 };
}

function parseHeader(value, headers) {
  const separator = value.indexOf(':');
  if (separator <= 0) return;
  const key = value.slice(0, separator).trim();
  const headerValue = value.slice(separator + 1).trim();
  if (key) headers[key] = headerValue;
}

export function parseCurlCommand(command) {
  const tokens = tokenizeShell(String(command || '').trim());
  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('请输入以 curl 开头的命令');

  let method = '';
  let url = '';
  let body = '';
  let hasData = false;
  const headers = {};
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-X' || token === '--request' || token.startsWith('--request=') || /^-X.+/.test(token)) {
      if (/^-X.+/.test(token)) {
        method = token.slice(2).toUpperCase();
        continue;
      }
      const result = optionValue(tokens, index, token);
      method = result.value.toUpperCase();
      index = result.nextIndex;
    } else if (token === '-H' || token === '--header' || token.startsWith('--header=') || /^-H.+/.test(token)) {
      if (/^-H.+/.test(token)) {
        parseHeader(token.slice(2), headers);
        continue;
      }
      const result = optionValue(tokens, index, token);
      parseHeader(result.value, headers);
      index = result.nextIndex;
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(token)
      || /^-d.+/.test(token) || /^--data(?:-raw|-binary|-ascii|-urlencode)?=/.test(token)) {
      if (/^-d.+/.test(token)) {
        body = body ? `${body}&${token.slice(2)}` : token.slice(2);
        hasData = true;
        continue;
      }
      const result = optionValue(tokens, index, token);
      body = body ? `${body}&${result.value}` : result.value;
      hasData = true;
      index = result.nextIndex;
    } else if (token === '-b' || token === '--cookie' || token.startsWith('--cookie=')) {
      const result = optionValue(tokens, index, token);
      headers.Cookie = result.value;
      index = result.nextIndex;
    } else if (token === '--url' || token.startsWith('--url=')) {
      const result = optionValue(tokens, index, token);
      url = result.value;
      index = result.nextIndex;
    } else if (!token.startsWith('-') && !url) {
      url = token;
    }
  }

  if (!url) throw new Error('cURL 命令中未找到 URL');
  if (!/^https?:\/\//i.test(url)) throw new Error('cURL URL 必须包含 http:// 或 https://');
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('cURL 中的 URL 无效');
  }

  const queryParams = {};
  for (const [key, value] of parsedUrl.searchParams) queryParams[key] = value;
  return {
    method: method || (hasData ? 'POST' : 'GET'),
    host: `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname || '/',
    queryParams,
    headers,
    body,
  };
}

export function importCurlCommand(command, { type, folderId, idFactory = createId } = {}) {
  if (!['api', 'client-api'].includes(type)) throw new Error('cURL 仅支持导入 HTTP 接口');
  const parsed = parseCurlCommand(command);
  const name = `${parsed.method} ${parsed.path}`;
  if (type === 'client-api') {
    return {
      host: parsed.host,
      items: [{
        id: idFactory(),
        name,
        method: parsed.method,
        url: parsed.path,
        headers: parsed.headers,
        useProjectHeaders: true,
        useProjectCookies: true,
        proxy: false,
        insecureTls: false,
        body: parsed.body,
        allowGetBody: parsed.method === 'GET' && Boolean(parsed.body),
        description: '',
        folderId: folderId || undefined,
        queryParams: Object.keys(parsed.queryParams).length ? parsed.queryParams : undefined,
      }],
    };
  }
  return {
    host: '',
    items: [{
      id: idFactory(),
      name,
      enabled: true,
      priority: 0,
      folderId: folderId || undefined,
      match: {
        method: parsed.method,
        path: parsed.path,
        headers: Object.keys(parsed.headers).length ? parsed.headers : undefined,
      },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '',
        delayMs: 0,
      },
    }],
  };
}
