#!/usr/bin/env node
/**
 * Validate mockserver project YAML config.
 * Usage: node scripts/validate-config.js <path-to.yaml>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { isFullUrl, parsePathParams } from '../../../../shared/environment.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const BODY_TYPES = new Set(['text', 'multipart', 'binary']);
const errors = [];
const warnings = [];

function err(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPathTemplate(url) {
  return isNonEmptyString(url) && url.startsWith('/');
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateEnvironments(envs, prefix) {
  if (envs == null) return;
  if (!Array.isArray(envs)) {
    err(`${prefix}: must be an array`);
    return;
  }
  const ids = new Set();
  for (const [i, env] of envs.entries()) {
    const ep = `${prefix}[${i}]`;
    if (!isMap(env)) {
      err(`${ep}: must be an object`);
      continue;
    }
    if (!isNonEmptyString(env.id)) warn(`${ep}.id: missing`);
    else if (ids.has(env.id)) err(`${ep}.id: duplicate "${env.id}"`);
    else ids.add(env.id);
  }
}

function validateProject(project, idx) {
  const prefix = `projects[${idx}]`;

  if (!isMap(project)) {
    err(`${prefix}: must be an object`);
    return;
  }

  if (!isNonEmptyString(project.name)) {
    warn(`${prefix}.name: missing or empty (will default to "Untitled Project")`);
  }

  if (project.port != null && (Number.isNaN(Number(project.port)) || Number(project.port) <= 0)) {
    err(`${prefix}.port: must be a positive number`);
  }

  if (project.environments != null) {
    warn(`${prefix}.environments: legacy placement; use top-level environments for new configs`);
    validateEnvironments(project.environments, `${prefix}.environments`);
  }

  if (project.clientHeaders != null && !isMap(project.clientHeaders)) {
    err(`${prefix}.clientHeaders: must be an object`);
  }

  const apis = project.apis;
  if (apis != null && !Array.isArray(apis)) {
    err(`${prefix}.apis: must be an array`);
  } else {
    (apis || []).forEach((api, i) => validateApi(api, `${prefix}.apis[${i}]`));
  }

  const clientApis = project.clientApis;
  if (clientApis != null && !Array.isArray(clientApis)) {
    err(`${prefix}.clientApis: must be an array`);
  } else {
    (clientApis || []).forEach((clientApi, i) => validateClientApi(clientApi, `${prefix}.clientApis[${i}]`, project));
  }

  const protoIds = new Set(Array.isArray(project.protos) ? project.protos.map((proto) => proto?.id) : []);
  for (const field of ['grpcMocks', 'grpcClients']) {
    if (project[field] == null) continue;
    if (!Array.isArray(project[field])) {
      err(`${prefix}.${field}: must be an array`);
      continue;
    }
    for (const [i, method] of project[field].entries()) {
      const methodPrefix = `${prefix}.${field}[${i}]`;
      if (!isMap(method)) err(`${methodPrefix}: must be an object`);
      else if (method.protoId && !protoIds.has(method.protoId)) err(`${methodPrefix}.protoId: not found in project protos`);
      else if (!method.protoId && !isNonEmptyString(method.proto)) warn(`${methodPrefix}: no Proto associated`);
    }
  }
}

function validateApi(api, prefix) {
  if (!isMap(api)) {
    err(`${prefix}: must be an object`);
    return;
  }

  if (!isNonEmptyString(api.name)) {
    warn(`${prefix}.name: missing or empty`);
  }

  const match = api.match;
  if (!isMap(match)) {
    err(`${prefix}.match: required object`);
  } else {
    if (match.method && !HTTP_METHODS.has(String(match.method).toUpperCase())) {
      err(`${prefix}.match.method: invalid HTTP method "${match.method}"`);
    }
    if (!isNonEmptyString(match.path) && !isNonEmptyString(match.pathPattern)) {
      warn(`${prefix}.match.path: missing (will match all paths for this method)`);
    }
    if (isFullUrl(match.path)) {
      warn(`${prefix}.match.path: should be path only, not full URL`);
    }
  }

  const response = api.response;
  if (!isMap(response)) {
    err(`${prefix}.response: required object`);
  } else {
    if (response.status != null && (Number.isNaN(Number(response.status)) || Number(response.status) < 100)) {
      err(`${prefix}.response.status: invalid HTTP status`);
    }
    if (response.body != null && typeof response.body !== 'string') {
      warn(`${prefix}.response.body: should be a string (JSON as text)`);
    }
    if (String(response.headers?.['Content-Type'] || '').includes('json') && typeof response.body === 'string' && response.body.trim()) {
      try {
        JSON.parse(response.body);
      } catch {
        warn(`${prefix}.response.body: Content-Type is JSON but body is not valid JSON`);
      }
    }
  }
}

function validateClientApi(clientApi, prefix, project) {
  if (!isMap(clientApi)) {
    err(`${prefix}: must be an object`);
    return;
  }

  if (!isNonEmptyString(clientApi.name)) {
    warn(`${prefix}.name: missing or empty`);
  }

  if (!isNonEmptyString(clientApi.url)) {
    err(`${prefix}.url: required (path template or legacy full URL)`);
  } else if (isFullUrl(clientApi.url)) {
    warn(`${prefix}.url: legacy full URL — prefer path + environments[].host`);
  } else if (!isPathTemplate(clientApi.url)) {
    warn(`${prefix}.url: expected path starting with / (got "${clientApi.url}")`);
  }

  if (!project.activeEnvironmentId && !project.environments?.length && isPathTemplate(clientApi.url)) {
    warn(`${prefix}: set the project's activeEnvironmentId to select a shared environment`);
  }

  if (clientApi.pathParams != null) {
    if (!isMap(clientApi.pathParams)) err(`${prefix}.pathParams: must be an object`);
    else for (const name of parsePathParams(clientApi.url)) {
      if (!Object.hasOwn(clientApi.pathParams, name)) {
        warn(`${prefix}.pathParams: missing value for ":${name}"`);
      }
    }
  }

  if (clientApi.pathParamDescriptions && typeof clientApi.pathParamDescriptions !== 'object') {
    err(`${prefix}.pathParamDescriptions: must be an object`);
  }
  if (clientApi.queryParamDescriptions && typeof clientApi.queryParamDescriptions !== 'object') {
    err(`${prefix}.queryParamDescriptions: must be an object`);
  }

  if (clientApi.method && !HTTP_METHODS.has(String(clientApi.method).toUpperCase())) {
    err(`${prefix}.method: invalid HTTP method "${clientApi.method}"`);
  }

  if (clientApi.bodyType != null && !BODY_TYPES.has(clientApi.bodyType)) {
    err(`${prefix}.bodyType: expected text, multipart or binary`);
  }
  const bodyText = typeof clientApi.body === 'string' ? clientApi.body.trim() : null;
  if (clientApi.bodyType === 'multipart' && clientApi.body != null && bodyText !== '') {
    let fields;
    try { fields = JSON.parse(bodyText); } catch {}
    if (!isMap(fields)) {
      err(`${prefix}.body: multipart fields must be a JSON object encoded as text`);
    }
  }
  if ((!clientApi.bodyType || clientApi.bodyType === 'text') && String(clientApi.headers?.['Content-Type'] || '').includes('json') && typeof clientApi.body === 'string' && clientApi.body.trim()) {
    try {
      JSON.parse(clientApi.body);
    } catch {
      warn(`${prefix}.body: Content-Type is JSON but body is not valid JSON`);
    }
  }
}

async function validateImport(data) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mockserver-validate-'));
  const originalDataDir = process.env.MOCKSERVER_DATA_DIR;
  try {
    process.env.MOCKSERVER_DATA_DIR = sandbox;
    const { store } = await import('../../../../server/store.js');
    store.prepareConfig(data, false);
  } catch (error) {
    err(`import: ${error.message}`);
  } finally {
    if (originalDataDir === undefined) delete process.env.MOCKSERVER_DATA_DIR;
    else process.env.MOCKSERVER_DATA_DIR = originalDataDir;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node validate-config.js <path-to.yaml>');
    process.exit(1);
  }

  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  let data;
  try {
    data = yaml.load(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    console.error(`YAML parse error: ${e.message}`);
    process.exit(1);
  }

  if (!isMap(data)) {
    err('root: file must be a YAML object');
  } else if (!Array.isArray(data.projects)) {
    err('root: missing "projects" array');
  } else {
    if (!data.projects.length) warn('root: "projects" array is empty');
    validateEnvironments(data.environments, 'environments');
    data.projects.forEach((p, i) => validateProject(p, i));
    if (!errors.length) await validateImport(data);
  }

  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);

  if (errors.length) {
    console.error(`\nValidation failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }

  const projectCount = data?.projects?.length ?? 0;
  const apiCount = (data?.projects || []).reduce((n, p) => n + (p.apis?.length || 0), 0);
  const clientApiCount = (data?.projects || []).reduce((n, p) => n + (p.clientApis?.length || 0), 0);
  const grpcMockCount = (data?.projects || []).reduce((n, p) => n + (p.grpcMocks?.length || 0), 0);
  const grpcClientCount = (data?.projects || []).reduce((n, p) => n + (p.grpcClients?.length || 0), 0);
  console.log(`OK: ${projectCount} project(s), ${apiCount} api(s), ${clientApiCount} clientApi(s), ${grpcMockCount} grpcMock(s), ${grpcClientCount} grpcClient(s), ${warnings.length} warning(s)`);
}

await main();
