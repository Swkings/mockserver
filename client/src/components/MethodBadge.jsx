import { METHOD_COLORS } from '../utils/format.js';

export default function MethodBadge({ method, size = 'md' }) {
  const m = (method || 'GET').toUpperCase();
  const color = METHOD_COLORS[m] || '#64748b';
  return (
    <span className={`method-badge size-${size}`} style={{ '--method-color': color }}>
      {m}
    </span>
  );
}
