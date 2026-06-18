import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

/** A Namespace's lifecycle as far as create pre-validation cares. */
export type NamespacePhase = 'active' | 'terminating' | 'missing' | 'unknown';

/** Namespace shape we read for pre-validation (status.phase is Active | Terminating). */
type NamespaceLike = K8sResourceCommon & { status?: { phase?: string } };

/**
 * Classify the selected namespace before enabling Create. Creating into a namespace that is missing
 * or Terminating fails at submit with an opaque API error, so we resolve it up front from the
 * watched Namespace list (issue: create pre-validation).
 *
 * Returns `unknown` until the list has loaded so the UI doesn't flash a false "missing" while the
 * watch settles.
 */
export const namespacePhase = (
  name: string,
  namespaces: NamespaceLike[],
  loaded: boolean,
): NamespacePhase => {
  if (!loaded) return 'unknown';
  const ns = namespaces.find((n) => n.metadata?.name === name);
  if (!ns) return 'missing';
  return ns.status?.phase === 'Terminating' ? 'terminating' : 'active';
};

/**
 * Whether a workload of the given kind already uses `name` in the namespace being watched.
 * Pods and Deployments are named independently (a Pod and a Deployment can share a name), so only
 * the matching kind's list is consulted — that is what would 409 on create (issue #12).
 */
export const workloadNameExists = (
  kind: 'Pod' | 'Deployment',
  name: string,
  pods: K8sResourceCommon[],
  deployments: K8sResourceCommon[],
): boolean => (kind === 'Pod' ? pods : deployments).some((o) => o.metadata?.name === name);

/** A unique-ish starter name so two quick creates don't collide on the default (issue #12). */
export const suggestWorkloadName = (base = 'my-sandbox'): string =>
  // padEnd guards the rare case where toString(36) yields no fractional digits (empty suffix).
  `${base}-${Math.random().toString(36).slice(2, 7).padEnd(3, '0')}`;

/**
 * Parse "KEY=value" lines (one per line, from the optional env field) into container env entries.
 * Blank lines, lines without `=`, and lines with an empty key are skipped; only the first `=`
 * splits, so values may contain `=` (issue #9).
 */
export const parseEnvLines = (text: string): { name: string; value: string }[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
    })
    .filter((e) => e.name !== '');

/**
 * Parse "KEY=value" lines into a string map for the advanced workload fields that take a flat object
 * — labels and nodeSelector (issue #9 advanced options). Later duplicate keys win. Reuses the env
 * line parser, so blank/`=`-less lines and empty keys are skipped the same way.
 */
export const parseKeyValueLines = (text: string): Record<string, string> =>
  Object.fromEntries(parseEnvLines(text).map((e) => [e.name, e.value]));
