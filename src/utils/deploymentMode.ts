/**
 * How the OSC operator installs the kata runtime on a cluster — and, crucially, whether that
 * reboots the user's nodes.
 *
 * Two screens tell the user about this: the KataConfig wizard (before creating it) and the setup
 * checklist (while it rolls out). They must not disagree, so the resolution lives here rather than
 * in either component (issue #58).
 */

/** What the operator actually does: install live via a DaemonSet, or drain + reboot each node. */
export type DeploymentMode = 'DaemonSet' | 'MachineConfig';

/** The value the operator reads from the osc-feature-gates ConfigMap. */
export const DAEMONSET_FALLBACK = 'DaemonSetFallback';

/**
 * Whether Infrastructure.status.controlPlaneTopology describes a hosted control plane
 * (HyperShift/HCP). 'External' means the control plane runs outside the cluster, so there is no
 * MachineConfig Operator to drive a reboot-based install. undefined while Infrastructure loads.
 */
export const isHostedTopology = (topology?: string): boolean | undefined =>
  topology === undefined ? undefined : topology === 'External';

/**
 * Resolve the effective install mode from the `deploymentMode` feature gate and the cluster's
 * topology.
 *
 * An explicit DaemonSet/MachineConfig gate settles it on its own. Anything else — DaemonSetFallback
 * (what the wizard writes for "Auto"), an absent ConfigMap, or a value we don't recognise — leaves
 * the operator's fallback in charge: DaemonSet only where there is no MachineConfig Operator, which
 * is exactly a hosted control plane. Returns undefined when the topology is still unknown and so
 * cannot settle it, so callers can hold off on reboot-or-not copy rather than guess wrong.
 */
export const resolveDeploymentMode = (
  configured: string | undefined,
  isHosted: boolean | undefined,
): DeploymentMode | undefined => {
  if (configured === 'DaemonSet' || configured === 'MachineConfig') return configured;
  if (isHosted === undefined) return undefined;
  return isHosted ? 'DaemonSet' : 'MachineConfig';
};

/** Whether the install drains and reboots nodes. undefined when the mode isn't known yet. */
export const modeWillReboot = (mode: DeploymentMode | undefined): boolean | undefined =>
  mode === undefined ? undefined : mode === 'MachineConfig';
