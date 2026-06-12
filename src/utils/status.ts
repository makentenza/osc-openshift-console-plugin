import type { PodKind } from '../k8s/types';

/**
 * Console-style display status: surface container waiting/terminated reasons
 * (CrashLoopBackOff, ImagePullBackOff, …) instead of the bare pod phase.
 */
export const podDisplayStatus = (pod: PodKind): string => {
  if (pod.metadata?.deletionTimestamp) return 'Terminating';
  for (const cs of pod.status?.containerStatuses ?? []) {
    const reason = cs.state?.waiting?.reason;
    if (reason) return reason;
  }
  for (const cs of pod.status?.containerStatuses ?? []) {
    const term = cs.state?.terminated;
    if (term && (term.exitCode ?? 0) !== 0) return term.reason ?? 'Error';
  }
  return pod.status?.phase ?? 'Unknown';
};

export const podRestartCount = (pod: PodKind): number =>
  (pod.status?.containerStatuses ?? []).reduce((sum, cs) => sum + (cs.restartCount ?? 0), 0);

export type StatusCategory = 'Healthy' | 'Pending' | 'Error';

const HEALTHY = new Set(['Running', 'Available', 'Succeeded', 'Completed']);
const PENDING = new Set([
  'Pending',
  'Progressing',
  'ContainerCreating',
  'PodInitializing',
  'Terminating',
]);

/** Anything that is neither healthy nor a known transitional state is an error. */
export const statusCategory = (status: string): StatusCategory => {
  if (HEALTHY.has(status)) return 'Healthy';
  if (PENDING.has(status)) return 'Pending';
  return 'Error';
};

export const statusColor = (status: string): 'green' | 'orange' | 'red' => {
  const cat = statusCategory(status);
  return cat === 'Healthy' ? 'green' : cat === 'Pending' ? 'orange' : 'red';
};
