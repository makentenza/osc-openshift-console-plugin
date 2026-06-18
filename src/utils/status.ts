import type { KataConfigKind, PodKind } from '../k8s/types';

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

export type KataPhase = 'absent' | 'installing' | 'ready' | 'failed';

export interface KataReadiness {
  phase: KataPhase;
  /** True only when the kata runtime is actually installed and registered, not merely created. */
  ready: boolean;
  readyNodes: number;
  totalNodes: number;
  failedNodes: number;
  /** Uninstall is blocked because pods still use the kata-remote runtime class (§8.1). */
  blockedByExistingPods: boolean;
}

/**
 * Derive the real install state of a KataConfig. Creating the object only *starts* a rollout that
 * reboots each worker to install the kata RPM, so the setup checklist must not call the step "done"
 * until the runtime is genuinely ready — the object exists long before workloads can run (issue #6).
 *
 * Ready = the `InProgress` condition has settled to False, every counted node is installed, and the
 * runtime classes are registered. A node in `failedToInstall` after the rollout settles is a failure.
 */
export const kataConfigReadiness = (kc?: KataConfigKind): KataReadiness => {
  if (!kc)
    return {
      phase: 'absent',
      ready: false,
      readyNodes: 0,
      totalNodes: 0,
      failedNodes: 0,
      blockedByExistingPods: false,
    };
  const nodes = kc.status?.kataNodes;
  const totalNodes = nodes?.nodeCount ?? 0;
  const readyNodes = nodes?.readyNodeCount ?? 0;
  const failedNodes = nodes?.failedToInstall?.length ?? 0;
  const inProgressCond = kc.status?.conditions?.find((c) => c.type === 'InProgress');
  const inProgress = inProgressCond?.status;
  // Deleting a KataConfig while kata-remote pods still run blocks the uninstall (§8.1).
  const blockedByExistingPods = inProgressCond?.reason === 'BlockedByExistingKataPods';
  const runtimeClasses = kc.status?.runtimeClasses?.length ?? 0;

  const base = { readyNodes, totalNodes, failedNodes, blockedByExistingPods };
  // Still churning: keep it "installing" even if a node transiently shows up as failed.
  if (inProgress === 'True') return { phase: 'installing', ready: false, ...base };
  if (failedNodes > 0) return { phase: 'failed', ready: false, ...base };
  if (totalNodes > 0 && readyNodes >= totalNodes && runtimeClasses > 0)
    return { phase: 'ready', ready: true, ...base };
  // Object exists but status hasn't populated yet (nascent) — treat as installing, never ready.
  return { phase: 'installing', ready: false, ...base };
};
