import type { PodKind } from '../k8s/types';
import { statusCategory } from './status';

/** The cloud a peer pod runs on. Peer pods are supported on AWS, Azure, and Google Cloud. */
export type CloudProvider = 'aws' | 'azure' | 'gcp';

/**
 * Map an Infrastructure.status.platform value (AWS/Azure/GCP/…) — or a peer-pods-cm CLOUD_PROVIDER
 * value (aws/azure/gcp) — to a CloudProvider. Returns undefined for platforms that don't run peer
 * pods, so callers fall back to cloud-neutral text instead of naming the wrong cloud (issue #56).
 */
export const cloudProviderFromPlatform = (
  platform: string | undefined,
): CloudProvider | undefined => {
  switch ((platform ?? '').toLowerCase()) {
    case 'aws':
      return 'aws';
    case 'azure':
      return 'azure';
    case 'gcp':
      return 'gcp';
    default:
      return undefined;
  }
};

/** Base of each cloud's Red Hat "Deploying OpenShift sandboxed containers" (1.12) deploy guide. */
export const DEPLOY_DOCS: Record<CloudProvider, string> = {
  aws: 'https://docs.redhat.com/en/documentation/openshift_sandboxed_containers/1.12/html/deploying_openshift_sandboxed_containers_on_aws/index',
  azure:
    'https://docs.redhat.com/en/documentation/openshift_sandboxed_containers/1.12/html/deploying_openshift_sandboxed_containers_on_microsoft_azure/index',
  gcp: 'https://docs.redhat.com/en/documentation/openshift_sandboxed_containers/1.12/html/deploying_openshift_sandboxed_containers_on_google_cloud/index',
};

/** Azure deploy guide — used by the Azure-only outbound-connectivity note in the peer-pods wizard. */
export const AZURE_DEPLOY_DOCS = DEPLOY_DOCS.azure;

/**
 * Cloud-specific terminology for the diagnostic messages. The cloud-api-adaptor is configured
 * entirely through peer-pods-cm, whose keys differ per cloud (PODVM_INSTANCE_TYPE vs
 * AZURE_INSTANCE_SIZE vs GCP_MACHINE_TYPE, AWS_REGION vs GCP_ZONE, …). Naming the wrong cloud's keys
 * is exactly the bug in issue #56, so every remediation is rendered from the entry for the detected
 * cloud. Env-var names and egress prerequisites follow the per-cloud 1.12 deploy guides.
 */
interface CloudTerms {
  /** Human-readable cloud name. */
  name: string;
  /** peer-pods-cm key holding the default pod-VM size — AWS "instance type" / Azure "instance size" / GCP "machine type". */
  sizeVar: string;
  /** What that size is called on this cloud. */
  sizeWord: string;
  /** peer-pods-cm key holding the allow-list of sizes (AWS/Azure); GCP has no allow-list. */
  sizesVar?: string;
  /** peer-pods-cm key holding the region (AWS/Azure) or zone (GCP). */
  regionVar: string;
  /** "region" (AWS/Azure) or "zone" (GCP). */
  regionWord: string;
  /** peer-pods-cm key naming the pod-VM subnet. */
  subnetVar: string;
  /** How to give the pod-VM subnet outbound egress on this cloud, phrased as the supported fix. */
  egress: string;
  /** What credential the cloud-api-adaptor authenticates with, for the auth-failed fix. */
  credentials: string;
  /** The cloud's deploy guide. */
  docs: string;
}

const TERMS: Record<CloudProvider, CloudTerms> = {
  aws: {
    name: 'AWS',
    sizeVar: 'PODVM_INSTANCE_TYPE',
    sizeWord: 'instance type',
    sizesVar: 'PODVM_INSTANCE_TYPES',
    regionVar: 'AWS_REGION',
    regionWord: 'region',
    subnetVar: 'AWS_SUBNET_ID',
    egress:
      'Give the pod-VM subnet (AWS_SUBNET_ID) outbound internet access — attach a NAT gateway to its route table so the peer VM can reach the registry. The plugin cannot create this; it is an AWS networking step.',
    credentials: 'the AWS credentials in peer-pods-secret (access key id / secret access key)',
    docs: DEPLOY_DOCS.aws,
  },
  azure: {
    name: 'Azure',
    sizeVar: 'AZURE_INSTANCE_SIZE',
    sizeWord: 'instance size',
    sizesVar: 'AZURE_INSTANCE_SIZES',
    regionVar: 'AZURE_REGION',
    regionWord: 'region',
    subnetVar: 'AZURE_SUBNET_ID',
    egress:
      'Give the pod-VM subnet (AZURE_SUBNET_ID) outbound internet access — configure a NAT gateway on the subnet (Azure "Outbound connections") so the peer VM can reach the registry. The plugin cannot create this; it is an Azure networking step.',
    credentials:
      'the Azure credentials in peer-pods-secret (client id / secret, tenant id, subscription id)',
    docs: DEPLOY_DOCS.azure,
  },
  gcp: {
    name: 'Google Cloud',
    sizeVar: 'GCP_MACHINE_TYPE',
    sizeWord: 'machine type',
    // Google Cloud has no size allow-list — GCP_MACHINE_TYPE is the only sizing key.
    sizesVar: undefined,
    regionVar: 'GCP_ZONE',
    regionWord: 'zone',
    subnetVar: 'GCP_SUBNETWORK',
    egress:
      'Give the pod-VM subnetwork (GCP_SUBNETWORK) outbound internet access — configure Cloud NAT for the network so the peer VM can reach the registry. The plugin cannot create this; it is a Google Cloud networking step.',
    credentials:
      'the Google Cloud credential the cloud-api-adaptor uses (minted by the Cloud Credential Operator, or the peer-pods service account)',
    docs: DEPLOY_DOCS.gcp,
  },
};

/** Cloud-neutral fallback when the provider is unknown, so text never wrongly names one cloud. */
const GENERIC_TERMS: CloudTerms = {
  name: 'your cloud',
  sizeVar: 'the pod-VM size key in peer-pods-cm',
  sizeWord: 'instance size',
  sizesVar: 'the pod-VM size allow-list in peer-pods-cm',
  regionVar: 'the region/zone key in peer-pods-cm',
  regionWord: 'region',
  subnetVar: 'the pod-VM subnet key in peer-pods-cm',
  egress:
    'Give the pod-VM subnet outbound internet access (for example a NAT gateway or Cloud NAT) so the peer VM can reach the registry. The plugin cannot create this; it is a cloud networking step.',
  credentials:
    'the cloud credentials the cloud-api-adaptor uses (peer-pods-secret, or a Cloud-Credential-Operator-minted credential)',
  docs: 'https://docs.redhat.com/en/documentation/openshift_sandboxed_containers/1.12',
};

const termsFor = (provider: CloudProvider | undefined): CloudTerms =>
  provider ? TERMS[provider] : GENERIC_TERMS;

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
 * across the caa log tail + the pod's waiting messages/events into a plain-language cause + fix, using
 * the terminology of the cloud the cluster runs on (issue #56).
 *
 * Order matters: the most specific signatures are checked first. Returns undefined when nothing
 * recognizable is present (the UI then falls back to the generic "logs live in the adaptor" guidance).
 */
const SIGNATURES: { key: string; re: RegExp; build: (t: CloudTerms) => CaaDiagnosis }[] = [
  {
    // Peer VM boots but the in-guest image pull (image_guest_pull) can't reach the registry — the
    // documented outbound-connectivity prerequisite is missing (issue #50).
    key: 'image-pull-no-egress',
    re: /image_guest_pull[\s\S]*?(context deadline exceeded|deadline|timed?\s?out)|(context deadline exceeded|deadline|timed?\s?out)[\s\S]*?image_guest_pull/i,
    build: (t) => ({
      key: 'image-pull-no-egress',
      cause:
        'The peer VM booted but timed out pulling the workload image itself (image_guest_pull). The most common cause is that the peer-pod subnet has no outbound path to the registry.',
      fix: t.egress,
      docHref: t.docs,
    }),
  },
  {
    // Default instance size / requested size not offered in the cluster's region (or zone on GCP).
    key: 'size-not-in-region',
    re: /VM size .* is not available in the current region|not available in the current region|SkuNotAvailable/i,
    build: (t) => ({
      key: 'size-not-in-region',
      cause: `The requested pod-VM ${t.sizeWord} is not offered in this cluster’s cloud ${t.regionWord}.`,
      fix: `Set ${t.sizeVar}${t.sizesVar ? ` (and any ${t.sizesVar})` : ''} in peer-pods-cm to a size available in ${t.regionVar}, then restart the cloud-api-adaptor DaemonSet.`,
    }),
  },
  {
    // Pod requested an instance type/size that isn't in the allow-list, or the allow-list is empty.
    key: 'instance-not-allowed',
    re: /supported instance types list is empty|failed to verify instance type|not in the list of supported/i,
    build: (t) => ({
      key: 'instance-not-allowed',
      cause: t.sizesVar
        ? `The ${t.sizeWord} the workload requested (machine_type annotation) is not in the peer-pods-cm allow-list (${t.sizesVar}), or the allow-list is empty.`
        : `The ${t.sizeWord} the workload requested (machine_type annotation) was not accepted by the cloud-api-adaptor.`,
      fix: t.sizesVar
        ? `Add the size to ${t.sizesVar} in peer-pods-cm, then restart the cloud-api-adaptor DaemonSet so it picks up the new env.`
        : `Set ${t.sizeVar} in peer-pods-cm to a supported ${t.sizeWord} (Google Cloud has no size allow-list), then restart the cloud-api-adaptor DaemonSet.`,
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
    re: /AuthenticationFailed|InvalidClientSecret|unauthorized|invalid client secret|AADSTS|InvalidClientTokenId|SignatureDoesNotMatch|AuthFailure/i,
    build: (t) => ({
      key: 'auth-failed',
      cause: 'The cloud-api-adaptor could not authenticate to the cloud API.',
      fix: `Check ${t.credentials} and that they are still valid.`,
    }),
  },
  {
    // Subscription/account quota exhausted.
    key: 'quota-exceeded',
    re: /QuotaExceeded|exceeding approved .* quota|OperationNotAllowed[\s\S]*?quota|VcpuLimitExceeded|InstanceLimitExceeded/i,
    build: (t) => ({
      key: 'quota-exceeded',
      cause: `The cloud account is at its compute quota for the requested ${t.sizeWord}.`,
      fix: `Request a quota increase for that ${t.sizeWord} family in the ${t.regionWord}, or set a smaller ${t.sizeVar} in peer-pods-cm.`,
    }),
  },
];

export const diagnoseCaaLog = (
  text: string | undefined,
  provider?: CloudProvider,
): CaaDiagnosis | undefined => {
  if (!text) return undefined;
  const terms = termsFor(provider);
  for (const sig of SIGNATURES) {
    if (sig.re.test(text)) return sig.build(terms);
  }
  return undefined;
};

/**
 * The common cloud-api-adaptor failure causes, shown as a checklist when the logs can't be read.
 * Rendered with the detected cloud's peer-pods-cm keys so an AWS cluster never sees Azure keys (#56).
 */
export const commonCaaCauses = (provider?: CloudProvider): string[] => {
  const t = termsFor(provider);
  return [
    `Default pod-VM ${t.sizeWord} (${t.sizeVar}) not offered in the cluster ${t.regionWord}.`,
    t.sizesVar
      ? `Requested size not in the allow-list (${t.sizesVar}).`
      : `Requested ${t.sizeWord} (${t.sizeVar}) not supported.`,
    'ROOT_VOLUME_SIZE smaller than the pod VM image OS disk.',
    `Peer-pod subnet (${t.subnetVar}) has no outbound connectivity to pull the image.`,
    'Invalid cloud credentials, or compute quota exhausted.',
  ];
};

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
