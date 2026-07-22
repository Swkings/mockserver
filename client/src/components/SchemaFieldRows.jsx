export function schemaFieldTypeLabel(field) {
  let label = field.type || 'unknown';
  if (field.kind === 'message') label = String(field.type || 'object').split('.').pop();
  if (field.kind === 'map') label = `map<${field.key?.type || 'string'}, ${field.value?.type || 'unknown'}>`;
  if (field.kind === 'enum' && field.values?.length) label = field.values.join(' | ');
  return field.repeated && field.kind !== 'map' ? `${label}[]` : label;
}

export default function SchemaFieldRows({ fields, depth = 0 }) {
  return (fields || []).map((field, index) => {
    const children = field.kind === 'message'
      ? field.message?.fields
      : (field.kind === 'map' && field.value?.kind === 'message' ? field.value.message?.fields : null);
    return (
      <div className="grpc-schema-node" key={`${depth}-${field.number ?? index}-${field.name}`}>
        <div className="grpc-schema-row" style={{ paddingLeft: `${10 + depth * 16}px` }}>
          <span className="grpc-schema-name">{field.name}{field.required === false ? '?' : ''}</span>
          <span className={`grpc-schema-type ${field.kind}`}>{schemaFieldTypeLabel(field)}</span>
        </div>
        {children?.length > 0 && <SchemaFieldRows fields={children} depth={depth + 1} />}
      </div>
    );
  });
}
