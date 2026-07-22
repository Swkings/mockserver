const PRIMITIVE_TYPES = new Map([
  ['string', 'string'], ['str', 'string'], ['char', 'string'], ['rune', 'string'],
  ['date', 'string'], ['datetime', 'string'], ['time.time', 'string'],
  ['number', 'number'], ['float', 'number'], ['float32', 'number'], ['float64', 'number'],
  ['double', 'number'], ['decimal', 'number'],
  ['int', 'integer'], ['int8', 'integer'], ['int16', 'integer'], ['int32', 'integer'],
  ['int64', 'integer'], ['uint', 'integer'], ['uint8', 'integer'], ['uint16', 'integer'],
  ['uint32', 'integer'], ['uint64', 'integer'], ['integer', 'integer'], ['long', 'integer'],
  ['bool', 'boolean'], ['boolean', 'boolean'],
  ['any', 'any'], ['unknown', 'any'], ['interface{}', 'any'], ['object', 'object'],
]);

function splitTopLevel(value, separators = new Set([','])) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if ('([{<'.includes(char)) depth += 1;
    else if (')]}>' .includes(char)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && separators.has(char)) {
      const part = value.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function namedBraceBlocks(source, pattern) {
  const blocks = [];
  let match = pattern.exec(source);
  while (match) {
    const openIndex = pattern.lastIndex - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex < 0) break;
    blocks.push({ name: match[1], body: source.slice(openIndex + 1, closeIndex) });
    pattern.lastIndex = closeIndex + 1;
    match = pattern.exec(source);
  }
  return blocks;
}

function preferredRoot(names, requestedRoot) {
  if (requestedRoot && names.includes(requestedRoot)) return requestedRoot;
  return names.find((name) => /(request|input|payload|body|dto)$/i.test(name)) || names[0];
}

function genericType(raw, names) {
  for (const name of names) {
    const square = raw.match(new RegExp('^' + name + '\\s*\\[([\\s\\S]+)\\]$', 'i'));
    if (square) return square[1];
    const angle = raw.match(new RegExp('^' + name + '\\s*<([\\s\\S]+)>$', 'i'));
    if (angle) return angle[1];
  }
  return null;
}

function describeType(rawType, definitions, language, stack = []) {
  let raw = String(rawType || 'any').trim().replace(/[;,]$/, '').trim();
  let required = true;

  if (raw.startsWith('*')) {
    required = false;
    raw = raw.replace(/^\*+/, '');
  }
  if (/\|\s*(none|null|undefined)$/i.test(raw)) {
    required = false;
    raw = raw.replace(/\|\s*(none|null|undefined)$/i, '').trim();
  }
  const optional = genericType(raw, ['Optional', 'Nullable']);
  if (optional) {
    required = false;
    raw = optional.trim();
  }

  let repeated = false;
  if (/^\[\]/.test(raw)) {
    repeated = true;
    raw = raw.slice(2).trim();
  } else if (/^\[[0-9]*\]/.test(raw)) {
    repeated = true;
    raw = raw.replace(/^\[[0-9]*\]/, '').trim();
  } else if (/\[\]$/.test(raw)) {
    repeated = true;
    raw = raw.slice(0, -2).trim();
  } else {
    const listType = genericType(raw, ['List', 'Array', 'Sequence', 'Set', 'Tuple']);
    if (listType) {
      repeated = true;
      raw = splitTopLevel(listType)[0] || 'any';
    }
  }

  const goMap = raw.match(/^map\s*\[([^\]]+)]\s*(.+)$/i);
  const genericMap = genericType(raw, ['Map', 'Dict', 'Dictionary', 'Record']);
  if (goMap || genericMap) {
    const args = goMap ? [goMap[1], goMap[2]] : splitTopLevel(genericMap);
    return {
      kind: 'map',
      type: 'map',
      key: describeType(args[0] || 'string', definitions, language, stack),
      value: describeType(args[1] || 'any', definitions, language, stack),
      required,
      repeated: false,
    };
  }

  const literal = genericType(raw, ['Literal']);
  const unionValues = splitTopLevel(literal || raw, new Set(['|']))
    .map((value) => value.trim())
    .filter((value) => /^(['"]).*\1$/.test(value))
    .map((value) => value.slice(1, -1));
  if (unionValues.length > 1 || literal && unionValues.length) {
    return { kind: 'enum', type: 'enum', values: unionValues, required, repeated };
  }

  const normalized = raw.replace(/^typing\./, '').replace(/^java\.lang\./, '');
  const primitive = PRIMITIVE_TYPES.get(normalized.toLowerCase());
  if (primitive) return { kind: 'scalar', type: primitive, required, repeated };

  const typeName = normalized.split('.').pop().replace(/[^A-Za-z0-9_$]/g, '') || 'any';
  if (definitions.has(typeName)) {
    if (stack.includes(typeName)) {
      return { kind: 'message', type: typeName, message: { fields: [], recursive: true }, required, repeated };
    }
    return {
      kind: 'message',
      type: typeName,
      message: buildMessage(definitions, typeName, language, [...stack, typeName]),
      required,
      repeated,
    };
  }
  return { kind: 'scalar', type: typeName || 'any', required, repeated };
}

function buildMessage(definitions, typeName, language, stack = [typeName]) {
  const definition = definitions.get(typeName);
  const fields = (definition?.fields || []).map((field, index) => {
    const described = describeType(field.type, definitions, language, stack);
    return {
      number: index + 1,
      name: field.name,
      ...described,
      required: field.required === false ? false : described.required,
    };
  });
  return { typeName, fields };
}

function resultFromDefinitions(definitions, language, requestedRoot) {
  const availableTypes = [...definitions.keys()];
  if (!availableTypes.length) throw new Error('未识别到可解析的类型定义');
  const typeName = preferredRoot(availableTypes, requestedRoot);
  const message = buildMessage(definitions, typeName, language);
  return { language, typeName, availableTypes, fields: message.fields };
}

function parseGo(source, requestedRoot) {
  const definitions = new Map();
  const blocks = namedBraceBlocks(source, /type\s+([A-Za-z_]\w*)\s+struct\s*\{/g);
  for (const block of blocks) {
    const fields = [];
    for (const rawLine of splitTopLevel(block.body, new Set(['\n', ';']))) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      const match = line.match(/^([A-Za-z_]\w*)\s+([^\s`]+(?:\s*\{[^}]*})?)\s*(?:`([^`]*)`)?/);
      if (!match) continue;
      const tagName = match[3]?.match(/json:\s*"([^",]+)/)?.[1];
      if (tagName === '-') continue;
      const name = tagName || match[1][0].toLowerCase() + match[1].slice(1);
      fields.push({ name, type: match[2], required: !/omitempty/.test(match[3] || '') });
    }
    definitions.set(block.name, { fields });
  }
  return resultFromDefinitions(definitions, 'go', requestedRoot);
}

function parseTypeScript(source, requestedRoot) {
  const definitions = new Map();
  const blocks = [
    ...namedBraceBlocks(source, /(?:export\s+)?interface\s+([A-Za-z_$]\w*)[^\{]*\{/g),
    ...namedBraceBlocks(source, /(?:export\s+)?type\s+([A-Za-z_$]\w*)\s*=\s*\{/g),
  ];
  for (const block of blocks) {
    const fields = splitTopLevel(block.body, new Set([';', ',', '\n']))
      .map((entry) => entry.replace(/\/\/.*$/, '').trim())
      .map((entry) => entry.match(/^(?:readonly\s+)?["']?([A-Za-z_$][\w$-]*)["']?\s*(\?)?\s*:\s*([\s\S]+)$/))
      .filter(Boolean)
      .map((match) => ({ name: match[1], type: match[3], required: !match[2] }));
    definitions.set(block.name, { fields });
  }
  return resultFromDefinitions(definitions, 'typescript', requestedRoot);
}

function parsePython(source, requestedRoot) {
  const definitions = new Map();
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const classMatch = lines[index].match(/^(\s*)class\s+([A-Za-z_]\w*)[^:]*:/);
    if (!classMatch) continue;
    const indent = classMatch[1].length;
    const fields = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      const lineIndent = line.match(/^\s*/)[0].length;
      if (lineIndent <= indent) {
        index -= 1;
        break;
      }
      const field = line.trim().match(/^([A-Za-z_]\w*)\s*:\s*([^=#]+?)(?:\s*=\s*([^#]+))?$/);
      if (!field || field[1].startsWith('_')) continue;
      fields.push({
        name: field[1],
        type: field[2].trim(),
        required: !field[3] && !/(Optional|None|\|\s*None)/.test(field[2]),
      });
    }
    definitions.set(classMatch[2], { fields });
  }
  return resultFromDefinitions(definitions, 'python', requestedRoot);
}

function parseJava(source, requestedRoot) {
  const definitions = new Map();
  const blocks = namedBraceBlocks(source, /(?:public\s+|protected\s+|private\s+)?class\s+([A-Za-z_]\w*)[^\{]*\{/g);
  for (const block of blocks) {
    const fields = block.body.split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .map((line) => line.match(/^(?:(?:public|protected|private|static|final)\s+)*([A-Za-z_$][\w$<>, ?\[\].]*)\s+([A-Za-z_$]\w*)\s*(?:=[^;]*)?;/))
      .filter(Boolean)
      .map((match) => ({ name: match[2], type: match[1].trim(), required: !/@Nullable/.test(match[0]) }));
    definitions.set(block.name, { fields });
  }
  return resultFromDefinitions(definitions, 'java', requestedRoot);
}

function fieldFromValue(name, value, index) {
  if (Array.isArray(value)) {
    const child = value.length ? fieldFromValue(name, value[0], index) : { kind: 'scalar', type: 'any' };
    return { ...child, number: index + 1, name, repeated: true, required: true };
  }
  if (value && typeof value === 'object') {
    const fields = Object.entries(value).map(([childName, childValue], childIndex) => fieldFromValue(childName, childValue, childIndex));
    return { number: index + 1, name, kind: 'message', type: 'object', message: { fields }, required: true, repeated: false };
  }
  const type = value === null ? 'any' : typeof value === 'number'
    ? (Number.isInteger(value) ? 'integer' : 'number')
    : typeof value === 'boolean' ? 'boolean' : 'string';
  return { number: index + 1, name, kind: 'scalar', type, required: true, repeated: false };
}

function schemaFromObject(value, language, typeName = 'RequestBody') {
  const root = Array.isArray(value) ? value[0] : value;
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('根结构必须是对象');
  return {
    language,
    typeName,
    availableTypes: [typeName],
    fields: Object.entries(root).map(([name, fieldValue], index) => fieldFromValue(name, fieldValue, index)),
  };
}

function parseJavaScriptValue(raw) {
  const value = raw.trim();
  if (/^(['"`])[\s\S]*\1$/.test(value)) return '';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (/^(true|false)$/.test(value)) return value === 'true';
  if (/^(null|undefined)$/.test(value)) return null;
  if (value.startsWith('{') && value.endsWith('}')) return parseJavaScriptObject(value.slice(1, -1));
  if (value.startsWith('[') && value.endsWith(']')) {
    const entries = splitTopLevel(value.slice(1, -1));
    return entries.length ? [parseJavaScriptValue(entries[0])] : [];
  }
  return '';
}

function parseJavaScriptObject(body) {
  const object = {};
  for (const entry of splitTopLevel(body, new Set([',', '\n']))) {
    const match = entry.match(/^["']?([A-Za-z_$][\w$-]*)["']?\s*:\s*([\s\S]+)$/);
    if (match) object[match[1]] = parseJavaScriptValue(match[2]);
  }
  return object;
}

function parseJavaScript(source) {
  const assignment = /(?:const|let|var)\s+([A-Za-z_$]\w*)\s*=\s*\{/g.exec(source);
  const openIndex = assignment ? assignment.index + assignment[0].lastIndexOf('{') : source.indexOf('{');
  if (openIndex < 0) throw new Error('未识别到 JavaScript 对象');
  const closeIndex = findMatchingBrace(source, openIndex);
  if (closeIndex < 0) throw new Error('JavaScript 对象缺少结束括号');
  const name = assignment?.[1]
    ? assignment[1][0].toUpperCase() + assignment[1].slice(1)
    : 'RequestBody';
  return schemaFromObject(parseJavaScriptObject(source.slice(openIndex + 1, closeIndex)), 'javascript', name);
}

function detectLanguage(source) {
  const trimmed = source.trim();
  if (/^[[{]/.test(trimmed)) {
    try { JSON.parse(trimmed); return 'json'; } catch { /* continue */ }
  }
  if (/type\s+\w+\s+struct\s*\{/.test(source)) return 'go';
  if (/(?:interface\s+\w+|type\s+\w+\s*=)\s*\{/.test(source)) return 'typescript';
  if (/@dataclass|class\s+\w+\s*\([^)]*(?:BaseModel|TypedDict)[^)]*\)\s*:|class\s+\w+(?:\([^)]*\))?\s*:\s*\n\s+\w+\s*:/m.test(source)) return 'python';
  if (/(?:public\s+)?class\s+\w+[^\{]*\{[\s\S]*(?:private|public|protected)\s+\w+/m.test(source)) return 'java';
  return 'javascript';
}

export function parseHttpRequestSchema(source, language = 'auto', requestedRoot) {
  const raw = String(source || '');
  const resolvedLanguage = language === 'auto' ? detectLanguage(raw) : language;
  if (!raw.trim()) return { language: resolvedLanguage, typeName: '', availableTypes: [], fields: [], error: '' };
  try {
    if (resolvedLanguage === 'json') return schemaFromObject(JSON.parse(raw), 'json');
    if (resolvedLanguage === 'go') return parseGo(raw, requestedRoot);
    if (resolvedLanguage === 'typescript') return parseTypeScript(raw, requestedRoot);
    if (resolvedLanguage === 'python') return parsePython(raw, requestedRoot);
    if (resolvedLanguage === 'java') return parseJava(raw, requestedRoot);
    return parseJavaScript(raw);
  } catch (error) {
    return {
      language: resolvedLanguage,
      typeName: '',
      availableTypes: [],
      fields: [],
      error: error.message || '结构解析失败',
    };
  }
}

function exampleField(field, depth = 0) {
  if (field.repeated) return [exampleField({ ...field, repeated: false }, depth)];
  if (field.kind === 'map') return { key: exampleField(field.value || { type: 'any' }, depth + 1) };
  if (field.kind === 'message') {
    if (depth > 6 || field.message?.recursive) return {};
    return Object.fromEntries((field.message?.fields || []).map((child) => [child.name, exampleField(child, depth + 1)]));
  }
  if (field.kind === 'enum') return field.values?.[0] || 'value';
  if (field.type === 'boolean') return false;
  if (field.type === 'integer' || field.type === 'number') return 0;
  if (field.type === 'object') return {};
  if (field.type === 'any') return null;
  return 'string';
}

export function schemaExample(schema) {
  return Object.fromEntries((schema?.fields || []).map((field) => [field.name, exampleField(field)]));
}
