import type { Isolation, RuntimeClassKind } from '../k8s/types';

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
