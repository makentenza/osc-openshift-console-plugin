import { load } from 'js-yaml';

/**
 * Parse a YAML document (the manifest a user edited in the create wizard) back into a plain object
 * so it can be created. Uses the full js-yaml parser — unlike the minimal emitter below, the input
 * is arbitrary user-authored YAML. Throws on invalid YAML.
 */
export const fromYaml = (text: string): unknown => load(text);

/**
 * Minimal YAML emitter for manifest previews. Handles the plain-JSON shapes we
 * build in the create wizard; not a general-purpose YAML library.
 */
const needsQuotes = (s: string): boolean =>
  s === '' ||
  /[:#{}[\],&*!|>'"%@`]/.test(s) ||
  /^[\s-?]/.test(s) ||
  /\s$/.test(s) ||
  /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
  /^[\d.+-]/.test(s);

const pad = (n: number): string => '  '.repeat(n);

const isNonEmptyComposite = (v: unknown): boolean =>
  v !== null &&
  typeof v === 'object' &&
  (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);

export const toYaml = (value: unknown, indent = 0): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return needsQuotes(value) ? JSON.stringify(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (isNonEmptyComposite(item)) {
          const lines = toYaml(item, indent + 1).split('\n');
          const rest = lines.slice(1).join('\n');
          return `${pad(indent)}- ${lines[0].trimStart()}${rest ? `\n${rest}` : ''}`;
        }
        return `${pad(indent)}- ${toYaml(item)}`;
      })
      .join('\n');
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) =>
      isNonEmptyComposite(v)
        ? `${pad(indent)}${k}:\n${toYaml(v, indent + 1)}`
        : `${pad(indent)}${k}: ${toYaml(v)}`,
    )
    .join('\n');
};
