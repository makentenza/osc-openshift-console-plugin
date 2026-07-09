import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useMemo } from 'react';
import {
  CAA_DAEMONSET,
  EventGVK,
  KataConfigGVK,
  OSC_NAMESPACE,
  PeerPodGVK,
  PodGVK,
  RuntimeClassGVK,
} from './resources';
import type {
  EventKind,
  Isolation,
  KataConfigKind,
  PeerPodKind,
  PodKind,
  RuntimeClassKind,
  SandboxWorkload,
} from './types';
import { buildIsolationMap, isSandboxRuntimeClass } from '../utils/runtime';
import { podDisplayStatus, podRestartCount } from '../utils/status';

export const useRuntimeClasses = (): [RuntimeClassKind[], boolean] => {
  const [data, loaded] = useK8sWatchResource<RuntimeClassKind[]>({
    groupVersionKind: RuntimeClassGVK,
    isList: true,
  });
  return [data ?? [], loaded];
};

/**
 * The cluster's KataConfig (there is only ever one). Returns `[kataConfig, loaded, loadError]`.
 *
 * loadError matters to callers. The plugin's pages are gated by the OSC_KATACONFIG flag (KataConfig
 * CRD present), so the operator is always installed when they render: an empty list means "installed
 * but not configured", while a loadError means the CR could not be read (missing permission, or a
 * transient API error) — never a missing operator. Callers use it to avoid a wrong-state message and
 * to break out of the loading skeleton when the watch errors (issue #54).
 */
export const useKataConfig = (): [KataConfigKind | undefined, boolean, unknown] => {
  const [data, loaded, loadError] = useK8sWatchResource<KataConfigKind[]>({
    groupVersionKind: KataConfigGVK,
    isList: true,
  });
  return [data?.[0], loaded, loadError];
};

/** Index PeerPods by `${namespace}/${ownerPodName}` so we can map a Pod to its cloud VM. */
export const usePeerPodIndex = (): Record<string, PeerPodKind> => {
  const [data] = useK8sWatchResource<PeerPodKind[]>({
    groupVersionKind: PeerPodGVK,
    isList: true,
  });
  return useMemo(() => {
    const index: Record<string, PeerPodKind> = {};
    (data ?? []).forEach((pp) => {
      const owner = pp.metadata?.ownerReferences?.find((o) => o.kind === 'Pod');
      if (owner) index[`${pp.metadata?.namespace}/${owner.name}`] = pp;
    });
    return index;
  }, [data]);
};

/**
 * The heart of the plugin: watch Pods cluster-wide and reduce them to normalized SandboxWorkload
 * rows, keeping only those on a kata RuntimeClass. A sandboxed workload is the actual VM guest —
 * the Pod; Deployments are just controllers and are not listed as workloads (their guest is the
 * replica Pod, shown here), mirroring the confidential-containers plugin (issue #14).
 */
export const useSandboxWorkloads = (): {
  workloads: SandboxWorkload[];
  loaded: boolean;
  isolationMap: Record<string, Isolation>;
} => {
  const [runtimeClasses, rcLoaded] = useRuntimeClasses();
  const peerPods = usePeerPodIndex();

  const [pods, podsLoaded] = useK8sWatchResource<PodKind[]>({
    groupVersionKind: PodGVK,
    isList: true,
  });

  const isolationMap = useMemo(() => buildIsolationMap(runtimeClasses), [runtimeClasses]);
  const sandboxRCNames = useMemo(
    () => new Set(runtimeClasses.filter(isSandboxRuntimeClass).map((rc) => rc.metadata?.name)),
    [runtimeClasses],
  );

  const workloads = useMemo<SandboxWorkload[]>(() => {
    if (!rcLoaded) return [];
    const rows: SandboxWorkload[] = [];

    (pods ?? []).forEach((p) => {
      const rc = p.spec?.runtimeClassName;
      if (!rc || !sandboxRCNames.has(rc)) return;
      const isolation = isolationMap[rc] ?? 'unknown';
      const peerPod =
        isolation === 'peerpod'
          ? peerPods[`${p.metadata?.namespace}/${p.metadata?.name}`]
          : undefined;
      rows.push({
        uid: p.metadata?.uid ?? `${p.metadata?.namespace}/${p.metadata?.name}`,
        kind: 'Pod',
        name: p.metadata?.name ?? '',
        namespace: p.metadata?.namespace ?? '',
        runtimeClass: rc,
        isolation,
        placement: isolation === 'peerpod' ? peerPod?.spec?.instanceID : p.spec?.nodeName,
        cloudProvider: peerPod?.spec?.cloudProvider,
        status: podDisplayStatus(p),
        restarts: podRestartCount(p),
        creationTimestamp: p.metadata?.creationTimestamp,
        obj: p,
      });
    });

    return rows.sort((a, b) =>
      (b.creationTimestamp ?? '').localeCompare(a.creationTimestamp ?? ''),
    );
  }, [pods, sandboxRCNames, isolationMap, peerPods, rcLoaded]);

  return { workloads, loaded: rcLoaded && podsLoaded, isolationMap };
};

/**
 * The osc-caa-ds (cloud-api-adaptor) pod on a given node — the one place peer-VM provisioning errors
 * are logged, since they never become Kubernetes Events (issue #49). A peer pod's spec.nodeName is the
 * worker it was scheduled on; the caa DaemonSet runs one pod per worker, so we match on nodeName.
 */
export const useCaaPodForNode = (nodeName?: string): [PodKind | undefined, boolean] => {
  const [pods, loaded] = useK8sWatchResource<PodKind[]>({
    groupVersionKind: PodGVK,
    namespace: OSC_NAMESPACE,
    isList: true,
  });
  return useMemo(() => {
    if (!nodeName) return [undefined, loaded];
    const caa = (pods ?? []).find(
      (p) => p.spec?.nodeName === nodeName && (p.metadata?.name ?? '').startsWith(CAA_DAEMONSET),
    );
    return [caa, loaded];
  }, [pods, loaded, nodeName]);
};

/** Events for a single Pod (newest first), used to surface the FailedCreatePodSandBox timeout. */
export const usePodEvents = (namespace?: string, name?: string): [EventKind[], boolean] => {
  const [events, loaded] = useK8sWatchResource<EventKind[]>({
    groupVersionKind: EventGVK,
    namespace,
    isList: true,
  });
  return useMemo(() => {
    if (!name) return [[], loaded];
    const matched = (events ?? [])
      .filter((e) => e.involvedObject?.kind === 'Pod' && e.involvedObject?.name === name)
      .sort((a, b) =>
        (b.lastTimestamp ?? b.eventTime ?? '').localeCompare(a.lastTimestamp ?? a.eventTime ?? ''),
      );
    return [matched, loaded];
  }, [events, loaded, name]);
};

/** Pods belonging to a Deployment, matched via its label selector. */
export const useDeploymentPods = (
  namespace?: string,
  matchLabels?: Record<string, string>,
): [PodKind[], boolean] => {
  const [pods, loaded] = useK8sWatchResource<PodKind[]>({
    groupVersionKind: PodGVK,
    isList: true,
    namespace,
  });
  return useMemo(() => {
    const entries = Object.entries(matchLabels ?? {});
    if (!entries.length) return [[], loaded];
    const matched = (pods ?? []).filter((p) =>
      entries.every(([k, v]) => p.metadata?.labels?.[k] === v),
    );
    return [matched, loaded];
  }, [pods, loaded, matchLabels]);
};
