/**
 * peer-pods-cm carries its flags as strings that the cloud-api-adaptor parses as Go booleans, so
 * "False", "FALSE" and "0" all mean exactly what "false" means. Comparing against one spelling
 * would read a config map written by hand — or by any other tool — as saying the opposite of what
 * it says, and the wizard would then overwrite it (issue #68).
 *
 * Mirrors Go's strconv.ParseBool. Returns undefined when the key is absent or unparseable, i.e.
 * when the config map states no preference and the caller's own default applies.
 */
const TRUE_SPELLINGS = new Set(['1', 't', 'true']);
const FALSE_SPELLINGS = new Set(['0', 'f', 'false']);

export const parsePeerPodsBool = (value?: string): boolean | undefined => {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  if (TRUE_SPELLINGS.has(v)) return true;
  if (FALSE_SPELLINGS.has(v)) return false;
  return undefined;
};
