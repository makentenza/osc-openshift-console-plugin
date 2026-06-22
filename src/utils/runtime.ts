import type { Isolation, NodeKind, RuntimeClassKind } from '../k8s/types';

/** Handlers that mean "peer pod" (workload runs in a separate cloud VM). */
const PEER_POD_HANDLERS = new Set(['kata-remote']);

/** Classify a RuntimeClass handler into an isolation type. */
export const isolationForHandler = (handler?: string): Isolation => {
  if (!handler) return 'unknown';
  if (PEER_POD_HANDLERS.has(handler)) return 'peerpod';
  if (handler.startsWith('kata')) return 'node';
  return 'unknown';
};

/** Build a lookup of runtimeClassName -> isolation from watched RuntimeClasses. */
export const buildIsolationMap = (
  runtimeClasses: RuntimeClassKind[] = [],
): Record<string, Isolation> => {
  const map: Record<string, Isolation> = {};
  runtimeClasses.forEach((rc) => {
    map[rc.metadata?.name ?? ''] = isolationForHandler(rc.handler);
  });
  return map;
};

/** Is this RuntimeClass one of OSC's sandbox runtimes? */
export const isSandboxRuntimeClass = (rc: RuntimeClassKind): boolean =>
  isolationForHandler(rc.handler) !== 'unknown';

/** Does this RuntimeClass target NVIDIA GPU passthrough (e.g. kata-nvidia-gpu)? */
export const isGpuRuntimeClass = (rc: RuntimeClassKind): boolean =>
  `${rc.handler ?? ''} ${rc.metadata?.name ?? ''}`.toLowerCase().includes('gpu');

/**
 * Does this Node expose an NVIDIA GPU? True when the device plugin advertises an
 * `nvidia.com/gpu` allocatable, or NFD has labeled the NVIDIA PCI vendor (10de).
 * Used to flag the GPU runtime class as unschedulable when no GPU node exists.
 */
export const nodeHasNvidiaGpu = (node: NodeKind): boolean =>
  Boolean(node.status?.allocatable?.['nvidia.com/gpu']) ||
  node.metadata?.labels?.['feature.node.kubernetes.io/pci-10de.present'] === 'true';

export const isolationLabel = (isolation: Isolation): string => {
  switch (isolation) {
    case 'peerpod':
      return 'Peer pod';
    case 'node':
      return 'On-node';
    default:
      return 'Unknown';
  }
};

export const isolationDescription = (isolation: Isolation): string => {
  switch (isolation) {
    case 'peerpod':
      return 'Runs in a dedicated cloud VM on a separate host (cloud-api-adaptor).';
    case 'node':
      return 'Runs in a lightweight QEMU microVM directly on the worker node.';
    default:
      return 'Isolation type could not be determined from the RuntimeClass handler.';
  }
};

/**
 * Best-effort guess at whether on-node kata (handler `kata`) can schedule on this cluster, based on
 * the Infrastructure platform. On-node kata boots a QEMU microVM directly on the worker, which needs
 * the worker to expose hardware virtualization (KVM). Bare-metal and unmanaged (`None`) clusters run
 * on real hardware and normally have it; managed cloud platforms (GCP/AWS/Azure/…) usually do *not*
 * expose nested virt on standard instance types, so on-node kata silently fails to schedule there
 * and peer pods (`kata-remote`) are the supported path.
 *
 * Returns `undefined` when the platform is unknown/empty so callers can stay informational rather
 * than asserting. This is a heuristic for messaging only — never a hard gate (issue: on-node caveat).
 */
export const platformLikelySupportsNestedVirt = (platform?: string): boolean | undefined => {
  if (!platform) return undefined;
  const p = platform.toLowerCase();
  if (p === 'baremetal' || p === 'none') return true;
  if (['gcp', 'aws', 'azure', 'vsphere', 'ibmcloud', 'openstack', 'powervs', 'nutanix'].includes(p))
    return false;
  return undefined;
};

/** Static catalog used to enrich the create wizard cards (falls back gracefully). */
export const runtimeClassCatalog: Record<string, { title: string; blurb: string }> = {
  kata: {
    title: 'Kata (on-node)',
    blurb: 'Fast-starting microVM on the worker node. Requires nested virtualization.',
  },
  'kata-remote': {
    title: 'Kata remote (peer pod)',
    blurb: 'Separate cloud VM per pod. Strongest isolation; per-pod cloud cost.',
  },
  'kata-nvidia-gpu': {
    title: 'Kata + NVIDIA GPU (on-node)',
    blurb: 'On-node microVM with GPU passthrough for accelerated sandboxed workloads.',
  },
};
