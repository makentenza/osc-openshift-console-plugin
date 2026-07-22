/**
 * peer-pods-cm stores its allow-lists — instance sizes/types, security group ids — as one
 * comma-separated string, and the cloud-api-adaptor reads that value verbatim. A space around a
 * comma therefore becomes part of the entry, which then silently never matches the size a workload
 * asks for.
 *
 * The wizard used to push that on the user ("Comma-separated, no spaces"). Normalize on write
 * instead, and read with the same helper so the form and the workload picker agree (issue #68).
 */

/** Split a comma-separated value into trimmed, non-empty entries. */
export const parseCsvList = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** Re-join a comma-separated value with the spaces and empty entries taken out. */
export const normalizeCsvList = (value?: string): string => parseCsvList(value).join(',');
