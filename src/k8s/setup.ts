import { useMemo } from 'react';
import {
  k8sCreate,
  k8sGet,
  k8sUpdate,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import {
  CloudCredentialGVK,
  ConfigMapGVK,
  ConfigMapModel,
  FIREWALL_OPENED_KEY,
  InfrastructureGVK,
  MachineSetGVK,
  MACHINE_API_NAMESPACE,
  OSC_NAMESPACE,
  PEER_PODS_CM,
  SETUP_CM,
} from './resources';
import type { ConfigMapKind } from './types';
import { toGcpNetworkPath } from '../utils/gcp';

export type InfrastructureKind = K8sResourceCommon & {
  status?: {
    platform?: string;
    platformStatus?: {
      gcp?: { projectID?: string; region?: string };
      aws?: { region?: string };
      azure?: { resourceGroupName?: string; networkResourceGroupName?: string };
    };
  };
};

interface GcpProviderSpec {
  projectID?: string;
  zone?: string;
  machineType?: string;
  networkInterfaces?: { network?: string; subnetwork?: string }[];
}

// AWSMachineProviderConfig (machine.openshift.io/v1beta1). OpenShift IPI clusters usually reference
// the subnet and security groups by tag *filters* rather than literal ids, so id is optional and we
// only prefill what's literally present — region and instanceType are always literal.
interface AwsFilterRef {
  id?: string;
  filters?: { name?: string; values?: string[] }[];
}
interface AwsProviderSpec {
  instanceType?: string;
  placement?: { region?: string; availabilityZone?: string };
  subnet?: AwsFilterRef;
  securityGroups?: AwsFilterRef[];
}

export type MachineSetKind = K8sResourceCommon & {
  spec?: { template?: { spec?: { providerSpec?: { value?: GcpProviderSpec & AwsProviderSpec } } } };
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

/**
 * Whether the user has marked the (manual) "open the peer pods firewall ports" step done — the
 * plugin can't detect a cloud firewall rule itself (especially AWS/Azure), so the acknowledgement
 * is recorded in the setup ConfigMap and reflected as a green check (issue #13). Returns
 * `[opened, loaded]`.
 */
export const useFirewallOpened = (): [boolean, boolean] => {
  const [cm, loaded] = settledCm(
    useK8sWatchResource<ConfigMapKind>({
      groupVersionKind: ConfigMapGVK,
      namespace: OSC_NAMESPACE,
      name: SETUP_CM,
    }),
  );
  return [cm?.data?.[FIREWALL_OPENED_KEY] === 'true', loaded];
};

const isNotFound = (e: unknown): boolean => {
  const code = typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined;
  return code === 404 || /not found/i.test(e instanceof Error ? e.message : String(e));
};

/** Record (or clear) the firewall-opened acknowledgement in the setup ConfigMap, creating it if absent. */
export const setFirewallOpened = async (opened: boolean): Promise<void> => {
  const value = opened ? 'true' : 'false';
  try {
    const cm = await k8sGet<ConfigMapKind>({
      model: ConfigMapModel,
      name: SETUP_CM,
      ns: OSC_NAMESPACE,
    });
    await k8sUpdate({
      model: ConfigMapModel,
      data: { ...cm, data: { ...cm.data, [FIREWALL_OPENED_KEY]: value } },
    });
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await k8sCreate({
      model: ConfigMapModel,
      data: {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: SETUP_CM, namespace: OSC_NAMESPACE },
        data: { [FIREWALL_OPENED_KEY]: value },
      },
    });
  }
};

export const useClusterPlatform = (): string | undefined => {
  const [infra] = useK8sWatchResource<InfrastructureKind>({
    groupVersionKind: InfrastructureGVK,
    name: 'cluster',
  });
  return infra?.status?.platform;
};

export type CloudCredentialKind = K8sResourceCommon & {
  spec?: { credentialsMode?: string };
};

/**
 * The Cloud Credential Operator's configured mode (CloudCredential/cluster .spec.credentialsMode).
 * 'Manual' (GCP Workload Identity / STS) means CCO cannot mint credentials at all, so the in-cluster
 * "Apply" firewall flow can't work and the UI disables it. Empty (default), 'Mint', or 'Passthrough'
 * are attempted — with a fast-fail if CCO then reports a provisioning error. undefined until loaded.
 */
export const useCcoMode = (): string | undefined => {
  const [cc] = useK8sWatchResource<CloudCredentialKind>({
    groupVersionKind: CloudCredentialGVK,
    name: 'cluster',
  });
  return cc?.spec?.credentialsMode;
};

/** Cloud-provider facts the AWS/Azure firewall CLI needs, read best-effort from the cluster. */
export interface CloudNetworking {
  /** AWS region from Infrastructure.status.platformStatus.aws (Azure's isn't exposed here). */
  region?: string;
  /** Azure resource group that owns the network (falls back to the cluster resource group). */
  azureResourceGroup?: string;
}

/**
 * Best-effort cloud networking facts for the firewall step. Only the values the cloud APIs expose
 * cluster-side are filled in (region, Azure network resource group); identifiers the cluster never
 * stores — the AWS security group / VPC, the Azure NSG name — stay undefined so the UI can mark them
 * as placeholders the user must supply.
 */
export const useCloudNetworking = (): CloudNetworking => {
  const [infra] = useK8sWatchResource<InfrastructureKind>({
    groupVersionKind: InfrastructureGVK,
    name: 'cluster',
  });
  return useMemo(() => {
    const ps = infra?.status?.platformStatus;
    return {
      // Only AWS exposes its region here; Azure carries the resource group instead.
      region: ps?.aws?.region,
      azureResourceGroup: ps?.azure?.networkResourceGroupName ?? ps?.azure?.resourceGroupName,
    };
  }, [infra]);
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
    const project = gcp?.projectID ?? pv?.projectID;
    return {
      project,
      zone: pv?.zone ?? (gcp?.region ? `${gcp.region}-a` : undefined),
      machineType: pv?.machineType,
      // GCP_NETWORK must be the fully-qualified resource path; MachineSets carry only the name.
      network: toGcpNetworkPath(ni?.network, project),
      subnetwork: ni?.subnetwork,
    };
  }, [infra, machineSets]);
};

export interface AwsNetworking {
  region?: string;
  instanceType?: string;
  /** Only set when the worker MachineSet references the subnet by literal id (not a tag filter). */
  subnetId?: string;
  /** First literal security-group id, when present. */
  securityGroupId?: string;
  /** Comma-joined literal security-group ids, when present (peer-pods-cm AWS_SG_IDS format). */
  securityGroupIds?: string;
}

/**
 * Best-effort prefill of AWS values from the cluster's Infrastructure + worker MachineSets, so the
 * peer-pods config map starts filled in like GCP (issue #28). Region and instance type are always
 * literal; subnet and security groups are only prefilled when the MachineSet carries literal ids
 * (IPI clusters often use tag filters instead — those stay blank for the user to supply, and the
 * wizard surfaces the AWS CLI to fetch them).
 */
export const useAwsNetworking = (): AwsNetworking => {
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
    const region = infra?.status?.platformStatus?.aws?.region;
    const pv = (machineSets ?? [])
      .map((m) => m.spec?.template?.spec?.providerSpec?.value)
      .find((v) => v?.instanceType || v?.subnet || v?.securityGroups?.length);
    const sgIds = (pv?.securityGroups ?? [])
      .map((g) => g?.id)
      .filter((id): id is string => Boolean(id));
    return {
      region: region ?? pv?.placement?.region,
      instanceType: pv?.instanceType,
      subnetId: pv?.subnet?.id,
      securityGroupId: sgIds[0],
      securityGroupIds: sgIds.length ? sgIds.join(',') : undefined,
    };
  }, [infra, machineSets]);
};

export interface AzureNetworking {
  subscriptionId?: string;
  region?: string;
  resourceGroup?: string;
  /** Full ARM resource id of the worker subnet (peer-pods-cm AZURE_SUBNET_ID). */
  subnetId?: string;
  /** Full ARM resource id of the node network security group (peer-pods-cm AZURE_NSG_ID). */
  nsgId?: string;
}

/**
 * Best-effort prefill of Azure values from the cluster's cloud-provider-config, so the peer-pods
 * config map starts filled in like GCP/AWS. The `cloud-provider-config` ConfigMap
 * (openshift-config) carries the subscription id, region, resource group, and vnet/subnet/NSG
 * names — none of them secrets. The peer-pods AZURE_SUBNET_ID / AZURE_NSG_ID want the FULL ARM
 * resource ids, so we assemble those from the names.
 */
export const useAzureNetworking = (): AzureNetworking => {
  const [cm] = useK8sWatchResource<ConfigMapKind>({
    groupVersionKind: ConfigMapGVK,
    namespace: 'openshift-config',
    name: 'cloud-provider-config',
  });
  return useMemo(() => {
    const raw = cm?.data?.config;
    if (!raw) return {};
    let c: Record<string, string | undefined>;
    try {
      c = JSON.parse(raw) as Record<string, string | undefined>;
    } catch {
      return {};
    }
    const sub = c.subscriptionId;
    const vnetRg = c.vnetResourceGroup || c.resourceGroup;
    const nsgRg = c.securityGroupResourceGroup || c.resourceGroup;
    const subnetId =
      sub && vnetRg && c.vnetName && c.subnetName
        ? `/subscriptions/${sub}/resourceGroups/${vnetRg}/providers/Microsoft.Network/virtualNetworks/${c.vnetName}/subnets/${c.subnetName}`
        : undefined;
    const nsgId =
      sub && nsgRg && c.securityGroupName
        ? `/subscriptions/${sub}/resourceGroups/${nsgRg}/providers/Microsoft.Network/networkSecurityGroups/${c.securityGroupName}`
        : undefined;
    return {
      subscriptionId: sub,
      region: c.location,
      resourceGroup: c.resourceGroup,
      subnetId,
      nsgId,
    };
  }, [cm]);
};
