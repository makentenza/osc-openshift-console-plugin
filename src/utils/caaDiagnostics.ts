import type { PodKind } from '../k8s/types';
import { statusCategory } from './status';

/** Base of the Red Hat "Deploying OpenShift sandboxed containers on Microsoft Azure" (1.12) guide. */
export const AZURE_DEPLOY_DOCS =
  'https://docs.redhat.com/en/documentation/openshift_sandboxed_containers/1.12/html/deploying_openshift_sandboxed_containers_on_microsoft_azure/index';

export interface CaaDiagnosis {
  /** Stable key for the matched signature. */
  key: string;
  /** Plain-language cause. */
  cause: string;
  /** Suggested fix, phrased as the supported remediation (peer-pods-cm / infra), not a workaround. */
  fix: string;
  /** Optional docs link for the fix. */
  docHref?: string;
}

/**
 * The real reason a `kata-remote` peer pod fails to start is emitted by the cloud-api-adaptor
 * (osc-caa-ds) or surfaces in the pod's own container-waiting message — never as a clean Event, which
 * only ever says "create container timeout … unknown" (issue #49). Pattern-match the known signatures
 * across the caa log tail + the pod's waiting messages/events into a plain-language cause + fix.
 *
 * Order matters: the most specific signatures are checked first. Returns undefined when nothing
 * recognizable is present (the UI then falls back to the generic "logs live in the adaptor" guidance).
 */
const SIGNATURES: { key: string; re: RegExp; build: () => CaaDiagnosis }[] = [
  {
    // Peer VM boots but the in-guest image pull (image_guest_pull) can't reach the registry — the
    // documented outbound-connectivity (NAT gateway) prerequisite is missing (issue #50, Azure §2.2).
    key: 'image-pull-no-egress',
    re: /image_guest_pull[\s\S]*?(context deadline exceeded|deadline|timed?\s?out)|(context deadline exceeded|deadline|timed?\s?out)[\s\S]*?image_guest_pull/i,
    build: () => ({
      key: 'image-pull-no-egress',
      cause:
        'The peer VM booted but timed out pulling the workload image itself (image_guest_pull). The most common cause is that the peer-pod subnet has no outbound path to the registry.',
      fix: 'Give the peer-pod VM subnet outbound internet connectivity — configure a NAT gateway on the subnet in AZURE_SUBNET_ID (Azure "Outbound Connections", §2.2). The plugin cannot create this; it is an Azure-infra step.',
      docHref: AZURE_DEPLOY_DOCS,
    }),
  },
  {
    // Default AZURE_INSTANCE_SIZE / requested size not offered in the cluster's region.
    key: 'size-not-in-region',
    re: /VM size .* is not available in the current region|not available in the current region|SkuNotAvailable/i,
    build: () => ({
      key: 'size-not-in-region',
      cause: 'The requested instance size is not offered in this cluster’s cloud region.',
      fix: 'Set AZURE_INSTANCE_SIZE (and any AZURE_INSTANCE_SIZES) in peer-pods-cm to a Confidential VM size available in AZURE_REGION, then restart the cloud-api-adaptor DaemonSet.',
    }),
  },
  {
    // Pod requested an instance type/size that isn't in the allow-list, or the allow-list is empty.
    key: 'instance-not-allowed',
    re: /supported instance types list is empty|failed to verify instance type|not in the list of supported/i,
    build: () => ({
      key: 'instance-not-allowed',
      cause:
        'The instance size the workload requested (machine_type annotation) is not in the peer-pods-cm allow-list, or the allow-list is empty.',
      fix: 'Add the size to AZURE_INSTANCE_SIZES (AWS: PODVM_INSTANCE_TYPES) in peer-pods-cm, then restart the cloud-api-adaptor DaemonSet so it picks up the new env.',
    }),
  },
  {
    // ROOT_VOLUME_SIZE smaller than the pod VM image's OS disk.
    key: 'root-volume-too-small',
    re: /disk size \d+ ?GB is smaller than|OperationNotAllowed[\s\S]*?disk size/i,
    build: () => ({
      key: 'root-volume-too-small',
      cause:
        'ROOT_VOLUME_SIZE is smaller than the pod VM image’s OS disk, so the VM cannot be created.',
      fix: 'Increase ROOT_VOLUME_SIZE in peer-pods-cm to at least the pod VM image OS disk size, then restart the cloud-api-adaptor DaemonSet.',
    }),
  },
  {
    // Cloud credentials rejected.
    key: 'auth-failed',
    re: /AuthenticationFailed|InvalidClientSecret|unauthorized|invalid client secret|AADSTS/i,
    build: () => ({
      key: 'auth-failed',
      cause: 'The cloud-api-adaptor could not authenticate to the cloud API.',
      fix: 'Check the credentials in peer-pods-secret (Azure client id/secret, tenant, subscription) and that they are still valid.',
    }),
  },
  {
    // Subscription quota exhausted.
    key: 'quota-exceeded',
    re: /QuotaExceeded|exceeding approved .* quota|OperationNotAllowed[\s\S]*?quota/i,
    build: () => ({
      key: 'quota-exceeded',
      cause: 'The cloud subscription is at its compute quota for the requested VM size.',
      fix: 'Request a quota increase for that VM family in the region, or set a smaller AZURE_INSTANCE_SIZE in peer-pods-cm.',
    }),
  },
];

export const diagnoseCaaLog = (text: string | undefined): CaaDiagnosis | undefined => {
  if (!text) return undefined;
  for (const sig of SIGNATURES) {
    if (sig.re.test(text)) return sig.build();
  }
  return undefined;
};

/** The common cloud-api-adaptor failure causes, shown as a checklist when the logs can't be read. */
export const COMMON_CAA_CAUSES: string[] = [
  'Default instance size (AZURE_INSTANCE_SIZE) not offered in the cluster region.',
  'Requested size not in the allow-list (AZURE_INSTANCE_SIZES / PODVM_INSTANCE_TYPES).',
  'ROOT_VOLUME_SIZE smaller than the pod VM image OS disk.',
  'Peer-pod subnet has no outbound connectivity (NAT gateway) to pull the image.',
  'Invalid cloud credentials in peer-pods-secret, or compute quota exhausted.',
];

/** The cloud-api-adaptor container in the osc-caa-ds pod, for the log query (falls back to the first). */
export const caaContainerName = (caaPod: PodKind | undefined): string | undefined => {
  const containers = caaPod?.spec?.containers ?? [];
  return (containers.find((c) => /adaptor|caa|cloud-api/i.test(c.name)) ?? containers[0])?.name;
};

/**
 * A peer pod is "stuck" when it is neither healthy nor merely mid-creation for a short while — i.e.
 * it is a peer pod that has not reached Running/Succeeded. We surface diagnostics for any non-healthy
 * peer pod so the opaque `create container timeout … unknown` never stands alone (issue #49).
 */
export const peerPodNeedsDiagnostics = (pod: PodKind | undefined, status: string): boolean =>
  Boolean(pod) && statusCategory(status) !== 'Healthy';

/** Container-waiting messages on the pod itself — some peer-VM errors surface here, not just in caa logs. */
export const podWaitingText = (pod: PodKind | undefined): string =>
  (pod?.status?.containerStatuses ?? [])
    .map((cs) => [cs.state?.waiting?.reason, cs.state?.waiting?.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('\n');
