import { useMemo } from 'react';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import {
  ConfigMapGVK,
  InfrastructureGVK,
  MachineSetGVK,
  MACHINE_API_NAMESPACE,
  OSC_NAMESPACE,
  PEER_PODS_CM,
} from './resources';
import type { ConfigMapKind } from './types';

export type InfrastructureKind = K8sResourceCommon & {
  status?: {
    platform?: string;
    platformStatus?: { gcp?: { projectID?: string; region?: string }; aws?: { region?: string } };
  };
};

type GcpProviderSpec = {
  projectID?: string;
  zone?: string;
  machineType?: string;
  networkInterfaces?: { network?: string; subnetwork?: string }[];
};

export type MachineSetKind = K8sResourceCommon & {
  spec?: { template?: { spec?: { providerSpec?: { value?: GcpProviderSpec } } } };
};

// A named-resource watch for an object that does not exist yet returns a 404
// that sets `loadError` but never flips `loaded` to true. Report the watch as
// settled once it is loaded OR errored, so create forms (which watch a CM that
// is absent by definition) aren't blocked forever. Only expose the ConfigMap
// when it genuinely loaded, so consumers can't mistake a not-found watch for an
// existing resource.
const settledCm = ([cm, loaded, loadError]: [ConfigMapKind | undefined, boolean, unknown]): [
  ConfigMapKind | undefined,
  boolean,
] => [loaded ? cm : undefined, loaded || Boolean(loadError)];

/** The cloud-api-adaptor config map (peer-pods-cm) in the OSC operator namespace. */
export const usePeerPodsCm = (): [ConfigMapKind | undefined, boolean] =>
  settledCm(
    useK8sWatchResource<ConfigMapKind>({
      groupVersionKind: ConfigMapGVK,
      namespace: OSC_NAMESPACE,
      name: PEER_PODS_CM,
    }),
  );

export const useClusterPlatform = (): string | undefined => {
  const [infra] = useK8sWatchResource<InfrastructureKind>({
    groupVersionKind: InfrastructureGVK,
    name: 'cluster',
  });
  return infra?.status?.platform;
};

export interface GcpNetworking {
  project?: string;
  zone?: string;
  machineType?: string;
  network?: string;
  subnetwork?: string;
}

/** Best-effort prefill of GCP values from the cluster's Infrastructure + worker MachineSets. */
export const useGcpNetworking = (): GcpNetworking => {
  const [infra] = useK8sWatchResource<InfrastructureKind>({
    groupVersionKind: InfrastructureGVK,
    name: 'cluster',
  });
  const [machineSets] = useK8sWatchResource<MachineSetKind[]>({
    groupVersionKind: MachineSetGVK,
    namespace: MACHINE_API_NAMESPACE,
    isList: true,
  });

  return useMemo(() => {
    const gcp = infra?.status?.platformStatus?.gcp;
    const pv = (machineSets ?? [])
      .map((m) => m.spec?.template?.spec?.providerSpec?.value)
      .find((v) => v?.networkInterfaces?.length);
    const ni = pv?.networkInterfaces?.[0];
    return {
      project: gcp?.projectID ?? pv?.projectID,
      zone: pv?.zone ?? (gcp?.region ? `${gcp.region}-a` : undefined),
      machineType: pv?.machineType,
      network: ni?.network,
      subnetwork: ni?.subnetwork,
    };
  }, [infra, machineSets]);
};
