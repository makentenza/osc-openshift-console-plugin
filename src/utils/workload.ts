import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

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
