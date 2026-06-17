import type { K8sGroupVersionKind, K8sModel } from '@openshift-console/dynamic-plugin-sdk';

export const RuntimeClassGVK: K8sGroupVersionKind = {
  group: 'node.k8s.io',
  version: 'v1',
  kind: 'RuntimeClass',
};

export const KataConfigGVK: K8sGroupVersionKind = {
  group: 'kataconfiguration.openshift.io',
  version: 'v1',
  kind: 'KataConfig',
};

export const PeerPodGVK: K8sGroupVersionKind = {
  group: 'confidentialcontainers.org',
  version: 'v1alpha1',
  kind: 'PeerPod',
};

export const PodGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Pod' };
export const DeploymentGVK: K8sGroupVersionKind = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
};
export const DaemonSetGVK: K8sGroupVersionKind = {
  group: 'apps',
  version: 'v1',
  kind: 'DaemonSet',
};
export const ConfigMapGVK: K8sGroupVersionKind = { version: 'v1', kind: 'ConfigMap' };
export const EventGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Event' };
export const NamespaceGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Namespace' };
export const NodeGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Node' };
export const JobGVK: K8sGroupVersionKind = { group: 'batch', version: 'v1', kind: 'Job' };
export const SecretGVK: K8sGroupVersionKind = { version: 'v1', kind: 'Secret' };

/** Minimal K8sModels for create/delete via k8sCreate / k8sDelete. */
export const PodModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Pod',
  plural: 'pods',
  namespaced: true,
  abbr: 'P',
  label: 'Pod',
  labelPlural: 'Pods',
};

export const DeploymentModel: K8sModel = {
  apiVersion: 'v1',
  apiGroup: 'apps',
  kind: 'Deployment',
  plural: 'deployments',
  namespaced: true,
  abbr: 'D',
  label: 'Deployment',
  labelPlural: 'Deployments',
};

/** Where OSC operator resources live. */
export const OSC_NAMESPACE = 'openshift-sandboxed-containers-operator';
export const PEER_PODS_CM = 'peer-pods-cm';
export const PODVM_IMAGE_CM = 'podvm-image-cm';
export const PEER_PODS_SECRET = 'peer-pods-secret';
export const CAA_DAEMONSET = 'osc-caa-ds';
export const KATACONFIG_NAME = 'example-kataconfig';
export const MACHINE_API_NAMESPACE = 'openshift-machine-api';

export const ConfigMapModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  plural: 'configmaps',
  namespaced: true,
  abbr: 'CM',
  label: 'ConfigMap',
  labelPlural: 'ConfigMaps',
};

/** kataconfiguration.openshift.io/v1 KataConfig — cluster-scoped. */
export const KataConfigModel: K8sModel = {
  apiGroup: 'kataconfiguration.openshift.io',
  apiVersion: 'v1',
  kind: 'KataConfig',
  plural: 'kataconfigs',
  namespaced: false,
  abbr: 'KC',
  label: 'KataConfig',
  labelPlural: 'KataConfigs',
  crd: true,
};

export const BuildGVK: K8sGroupVersionKind = {
  group: 'build.openshift.io',
  version: 'v1',
  kind: 'Build',
};

/** Name of the in-cluster pod VM image BuildConfig / ImageStream the Setup wizard creates. */
export const PODVM_BUILDCONFIG = 'podvm-bootc';

export const BuildConfigModel: K8sModel = {
  apiGroup: 'build.openshift.io',
  apiVersion: 'v1',
  kind: 'BuildConfig',
  plural: 'buildconfigs',
  namespaced: true,
  abbr: 'BC',
  label: 'BuildConfig',
  labelPlural: 'BuildConfigs',
};

export const ImageStreamModel: K8sModel = {
  apiGroup: 'image.openshift.io',
  apiVersion: 'v1',
  kind: 'ImageStream',
  plural: 'imagestreams',
  namespaced: true,
  abbr: 'IS',
  label: 'ImageStream',
  labelPlural: 'ImageStreams',
};

export const InfrastructureGVK: K8sGroupVersionKind = {
  group: 'config.openshift.io',
  version: 'v1',
  kind: 'Infrastructure',
};

export const SecretModel: K8sModel = {
  apiVersion: 'v1',
  kind: 'Secret',
  plural: 'secrets',
  namespaced: true,
  abbr: 'S',
  label: 'Secret',
  labelPlural: 'Secrets',
};

/** batch/v1 Job — used to run gcloud in-cluster for the peer pods firewall. */
export const JobModel: K8sModel = {
  apiGroup: 'batch',
  apiVersion: 'v1',
  kind: 'Job',
  plural: 'jobs',
  namespaced: true,
  abbr: 'J',
  label: 'Job',
  labelPlural: 'Jobs',
};

/** cloudcredential.openshift.io/v1 CredentialsRequest — asks CCO to mint a scoped cloud credential. */
export const CredentialsRequestModel: K8sModel = {
  apiGroup: 'cloudcredential.openshift.io',
  apiVersion: 'v1',
  kind: 'CredentialsRequest',
  plural: 'credentialsrequests',
  namespaced: true,
  abbr: 'CR',
  label: 'CredentialsRequest',
  labelPlural: 'CredentialsRequests',
  crd: true,
};

/** Where the Cloud Credential Operator watches CredentialsRequests. */
export const CLOUD_CREDENTIAL_NAMESPACE = 'openshift-cloud-credential-operator';
/** The CredentialsRequest / minted Secret / Job the firewall "Apply in cluster" flow creates. */
export const FIREWALL_CRED_REQUEST = 'osc-peerpods-firewall';
export const FIREWALL_CRED_SECRET = 'osc-peerpods-firewall-creds';
export const FIREWALL_JOB = 'osc-open-peerpods-firewall';
/** The GCP firewall rule name (matches the Red Hat docs / issue #5). */
export const FIREWALL_RULE_NAME = 'allow-port-15150-restricted';
/** Container image that provides the gcloud CLI for the in-cluster apply Job. */
export const CLOUD_SDK_IMAGE = 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim';

export const MachineSetGVK: K8sGroupVersionKind = {
  group: 'machine.openshift.io',
  version: 'v1beta1',
  kind: 'MachineSet',
};
