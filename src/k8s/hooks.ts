import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { useMemo } from 'react';
import { DeploymentGVK, KataConfigGVK, PeerPodGVK, PodGVK, RuntimeClassGVK } from './resources';
import type {
  DeploymentKind,
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

export const useKataConfig = (): [KataConfigKind | undefined, boolean] => {
  const [data, loaded] = useK8sWatchResource<KataConfigKind[]>({
    groupVersionKind: KataConfigGVK,
    isList: true,
  });
  return [data?.[0], loaded];
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

const deploymentReady = (d: DeploymentKind): string =>
  `${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? d.status?.replicas ?? 0}`;

/**
 * The heart of the plugin: watch Pods + Deployments cluster-wide and reduce them to
 * normalized SandboxWorkload rows, keeping only those using a kata RuntimeClass.
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
  const [deployments, depLoaded] = useK8sWatchResource<DeploymentKind[]>({
    groupVersionKind: DeploymentGVK,
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

    (deployments ?? []).forEach((d) => {
      const rc = d.spec?.template?.spec?.runtimeClassName;
      if (!rc || !sandboxRCNames.has(rc)) return;
      rows.push({
        uid: d.metadata?.uid ?? `${d.metadata?.namespace}/${d.metadata?.name}`,
        kind: 'Deployment',
        name: d.metadata?.name ?? '',
        namespace: d.metadata?.namespace ?? '',
        runtimeClass: rc,
        isolation: isolationMap[rc] ?? 'unknown',
        status:
          (d.status?.readyReplicas ?? 0) >= (d.spec?.replicas ?? 1) ? 'Available' : 'Progressing',
        ready: deploymentReady(d),
        creationTimestamp: d.metadata?.creationTimestamp,
        obj: d,
      });
    });

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
  }, [pods, deployments, sandboxRCNames, isolationMap, peerPods, rcLoaded]);

  return { workloads, loaded: rcLoaded && podsLoaded && depLoaded, isolationMap };
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
