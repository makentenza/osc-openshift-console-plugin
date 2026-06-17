import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

/** A node.k8s.io/v1 RuntimeClass. */
export type RuntimeClassKind = K8sResourceCommon & {
  handler?: string;
  overhead?: {
    podFixed?: Record<string, string>;
  };
};

/** A v1 ConfigMap (we only read .data). */
export type ConfigMapKind = K8sResourceCommon & {
  data?: Record<string, string>;
};

/** kataconfiguration.openshift.io/v1 KataConfig (cluster-scoped singleton). */
export type KataConfigKind = K8sResourceCommon & {
  spec?: {
    enablePeerPods?: boolean;
    logLevel?: string;
    checkNodeEligibility?: boolean;
  };
  status?: {
    conditions?: {
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }[];
    kataNodes?: {
      nodeCount?: number;
      readyNodeCount?: number;
      installed?: string[];
      installing?: string[];
      failedToInstall?: string[];
    };
    runtimeClasses?: string[];
    waitingForMcoToStart?: boolean;
  };
};

/** confidentialcontainers.org/v1alpha1 PeerPod — links a Pod to its backing cloud VM. */
export type PeerPodKind = K8sResourceCommon & {
  spec?: {
    cloudProvider?: string;
    instanceID?: string;
  };
};

export type ContainerStatusKind = {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: { exitCode?: number; reason?: string; finishedAt?: string };
  };
  image?: string;
};

/** Minimal Pod shape we rely on. */
export type PodKind = K8sResourceCommon & {
  spec?: {
    runtimeClassName?: string;
    nodeName?: string;
    containers?: { name: string; image?: string }[];
  };
  status?: {
    phase?: string;
    podIP?: string;
    containerStatuses?: ContainerStatusKind[];
  };
};

/** Minimal Deployment shape we rely on. */
export type DeploymentKind = K8sResourceCommon & {
  spec?: {
    replicas?: number;
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      spec?: {
        runtimeClassName?: string;
        containers?: { name: string; image?: string }[];
      };
    };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
  };
};

export type DaemonSetKind = K8sResourceCommon & {
  status?: {
    desiredNumberScheduled?: number;
    numberReady?: number;
    numberAvailable?: number;
  };
};

/** v1 Node — we read status.addresses + labels to compute firewall source ranges. */
export type NodeKind = K8sResourceCommon & {
  status?: {
    addresses?: { type: string; address: string }[];
  };
};

/** batch/v1 Job status we surface for the in-cluster firewall apply. */
export type JobKind = K8sResourceCommon & {
  spec?: { backoffLimit?: number };
  status?: {
    active?: number;
    succeeded?: number;
    failed?: number;
    conditions?: { type: string; status: string; reason?: string; message?: string }[];
  };
};

/** v1 Event for watching cluster events. */
export type EventKind = K8sResourceCommon & {
  involvedObject: {
    kind: string;
    name: string;
    namespace?: string;
    uid?: string;
  };
  reason?: string;
  message?: string;
  source?: { component?: string; host?: string };
  type?: 'Normal' | 'Warning';
  count?: number;
  lastTimestamp?: string;
  firstTimestamp?: string;
  eventTime?: string;
};

/** Isolation classification derived from a RuntimeClass handler. */
export type Isolation = 'peerpod' | 'node' | 'unknown';

/** A normalized row in the Sandboxed Workloads table (Pod or Deployment). */
export interface SandboxWorkload {
  uid: string;
  kind: 'Pod' | 'Deployment';
  name: string;
  namespace: string;
  runtimeClass: string;
  isolation: Isolation;
  /** Node name (on-node) or backing cloud VM instanceID (peer pod). */
  placement?: string;
  cloudProvider?: string;
  status: string;
  /** Total container restarts (Pods only). */
  restarts?: number;
  ready?: string; // e.g. "2/3" for deployments
  creationTimestamp?: string;
  obj: PodKind | DeploymentKind;
}
