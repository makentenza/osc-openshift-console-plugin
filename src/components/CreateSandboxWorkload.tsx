import {
  DocumentTitle,
  k8sCreate,
  ListPageHeader,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  ExpandableSection,
  Form,
  FormGroup,
  FormGroupLabelHelp,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  MenuToggle,
  NumberInput,
  PageSection,
  Popover,
  Radio,
  Select,
  SelectList,
  SelectOption,
  TextArea,
  TextInput,
  Wizard,
  WizardStep,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { useRuntimeClasses } from '../k8s/hooks';
import {
  ConfigMapGVK,
  DeploymentGVK,
  DeploymentModel,
  NamespaceGVK,
  OSC_NAMESPACE,
  PEER_PODS_CM,
  PodGVK,
  PodModel,
} from '../k8s/resources';
import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import type { ConfigMapKind, NamespaceKind, RuntimeClassKind } from '../k8s/types';
import { isSandboxRuntimeClass, isolationForHandler, runtimeClassCatalog } from '../utils/runtime';
import {
  namespacePhase,
  parseEnvLines,
  parseKeyValueLines,
  suggestWorkloadName,
  workloadNameExists,
} from '../utils/workload';
import { fromYaml, toYaml } from '../utils/yaml';
import { IsolationLabel } from './IsolationLabel';
import './sandbox.css';

const MACHINE_TYPE_ANNOTATION = 'io.katacontainers.config.hypervisor.machine_type';
// Peer pods can instead let the operator auto-pick an instance type from a vCPU/memory floor (§3.8).
const DEFAULT_VCPUS_ANNOTATION = 'io.katacontainers.config.hypervisor.default_vcpus';
const DEFAULT_MEMORY_ANNOTATION = 'io.katacontainers.config.hypervisor.default_memory';
// A custom pod VM image for this workload, overriding the operator's default registered image (§3.7).
const IMAGE_ANNOTATION = 'io.katacontainers.config.hypervisor.image';

/** RFC 1123 label: what the API server will accept as a resource name. */
const K8S_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

interface WorkloadForm {
  kind: 'Pod' | 'Deployment';
  name: string;
  namespace: string;
  runtimeClass: string;
  image: string;
  command: string;
  cpu: string;
  memory: string;
  replicas: number;
  // Peer-pod instance selection: cluster default, a specific PODVM_INSTANCE_TYPE(S), or auto by size.
  instanceMode: 'default' | 'specific' | 'auto';
  machineType: string;
  defaultVcpus: string;
  defaultMemory: string;
  podVmImage: string;
  env: string;
  pullPolicy: string;
  port: string;
  serviceAccount: string;
  labels: string;
  nodeSelector: string;
  imagePullSecret: string;
  restartPolicy: string;
  annotations: string;
  runAsNonRoot: boolean;
  strategy: string;
  maxSurge: string;
  maxUnavailable: string;
}

const buildManifest = (
  f: WorkloadForm,
  isPeerPod: boolean,
): K8sResourceCommon & Record<string, unknown> => {
  const container: Record<string, unknown> = {
    name: f.name,
    image: f.image,
    ...(f.command ? { command: f.command.trim().split(/\s+/) } : {}),
    securityContext: {
      privileged: false,
      seccompProfile: { type: 'RuntimeDefault' },
      ...(f.runAsNonRoot ? { runAsNonRoot: true } : {}),
    },
  };
  if (f.cpu || f.memory) {
    const res: Record<string, string> = {};
    if (f.cpu) res.cpu = f.cpu;
    if (f.memory) res.memory = f.memory;
    container.resources = { requests: { ...res }, limits: { ...res } };
  }
  const env = parseEnvLines(f.env);
  if (env.length) container.env = env;
  if (f.pullPolicy) container.imagePullPolicy = f.pullPolicy;
  const port = Number(f.port);
  if (f.port.trim() && Number.isInteger(port) && port > 0 && port <= 65535)
    container.ports = [{ containerPort: port }];
  const nodeSelector = parseKeyValueLines(f.nodeSelector);
  const podSpec: Record<string, unknown> = {
    runtimeClassName: f.runtimeClass,
    containers: [container],
    ...(f.serviceAccount.trim() ? { serviceAccountName: f.serviceAccount.trim() } : {}),
    ...(Object.keys(nodeSelector).length ? { nodeSelector } : {}),
    ...(f.imagePullSecret.trim() ? { imagePullSecrets: [{ name: f.imagePullSecret.trim() }] } : {}),
    // A Deployment's pod template must use restartPolicy Always; only set it for a bare Pod.
    ...(f.kind === 'Pod' && f.restartPolicy ? { restartPolicy: f.restartPolicy } : {}),
  };
  // app={name} is forced last so a user-supplied "app" label can't break the Deployment selector.
  const labels = { ...parseKeyValueLines(f.labels), app: f.name };
  // Peer-pod instance type → either a specific machine_type, or a default_vcpus/default_memory floor
  // the operator sizes an instance from; on-node pods and the "default" mode add nothing (§3.8).
  const peerPodAnnotations: Record<string, string> = {};
  if (isPeerPod && f.instanceMode === 'specific' && f.machineType.trim())
    peerPodAnnotations[MACHINE_TYPE_ANNOTATION] = f.machineType.trim();
  if (isPeerPod && f.instanceMode === 'auto') {
    if (f.defaultVcpus.trim()) peerPodAnnotations[DEFAULT_VCPUS_ANNOTATION] = f.defaultVcpus.trim();
    if (f.defaultMemory.trim())
      peerPodAnnotations[DEFAULT_MEMORY_ANNOTATION] = f.defaultMemory.trim();
  }
  if (isPeerPod && f.podVmImage.trim()) peerPodAnnotations[IMAGE_ANNOTATION] = f.podVmImage.trim();
  const annotations = {
    ...parseKeyValueLines(f.annotations),
    ...peerPodAnnotations,
  };
  const hasAnnotations = Object.keys(annotations).length > 0;

  if (f.kind === 'Pod') {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: f.name,
        namespace: f.namespace,
        labels,
        ...(hasAnnotations ? { annotations } : {}),
      },
      spec: podSpec,
    };
  }
  const rollingUpdate =
    f.maxSurge || f.maxUnavailable
      ? {
          ...(f.maxSurge ? { maxSurge: f.maxSurge } : {}),
          ...(f.maxUnavailable ? { maxUnavailable: f.maxUnavailable } : {}),
        }
      : undefined;
  const strategy =
    f.strategy === 'Recreate'
      ? { type: 'Recreate' }
      : f.strategy === 'RollingUpdate' || rollingUpdate
        ? { type: 'RollingUpdate', ...(rollingUpdate ? { rollingUpdate } : {}) }
        : undefined;
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: f.name, namespace: f.namespace, labels },
    spec: {
      replicas: f.replicas,
      ...(strategy ? { strategy } : {}),
      selector: { matchLabels: { app: f.name } },
      template: {
        metadata: { labels, ...(hasAnnotations ? { annotations } : {}) },
        spec: podSpec,
      },
    },
  };
};

const CreateSandboxWorkload: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();
  const [runtimeClasses] = useRuntimeClasses();
  const [namespaces, nsLoaded] = useK8sWatchResource<NamespaceKind[]>({
    groupVersionKind: NamespaceGVK,
    isList: true,
  });
  const [peerPodsCm] = useK8sWatchResource<ConfigMapKind>({
    groupVersionKind: ConfigMapGVK,
    namespace: OSC_NAMESPACE,
    name: PEER_PODS_CM,
  });
  const sandboxRCs = useMemo(() => runtimeClasses.filter(isSandboxRuntimeClass), [runtimeClasses]);
  const defaultMachineType =
    peerPodsCm?.data?.GCP_MACHINE_TYPE ?? peerPodsCm?.data?.PODVM_INSTANCE_TYPE;
  // Instance types a peer-pod workload may request (peer-pods-cm PODVM_INSTANCE_TYPES), offered as a
  // dropdown so the machine_type annotation stays within the allowed set (§3.8). The default type is
  // always offered too, even if it isn't listed.
  const allowedInstanceTypes = (peerPodsCm?.data?.PODVM_INSTANCE_TYPES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const instanceTypeOptions = Array.from(
    new Set([...(defaultMachineType ? [defaultMachineType] : []), ...allowedInstanceTypes]),
  );

  const [form, setForm] = useState<WorkloadForm>(() => ({
    kind: 'Pod',
    name: suggestWorkloadName(),
    namespace: 'default',
    runtimeClass: '',
    image: 'registry.access.redhat.com/ubi9/ubi:latest',
    command: '',
    cpu: '',
    memory: '',
    replicas: 1,
    instanceMode: 'default',
    machineType: '',
    defaultVcpus: '',
    defaultMemory: '',
    podVmImage: '',
    env: '',
    pullPolicy: '',
    port: '',
    serviceAccount: '',
    labels: '',
    nodeSelector: '',
    imagePullSecret: '',
    restartPolicy: '',
    annotations: '',
    runAsNonRoot: false,
    strategy: '',
    maxSurge: '',
    maxUnavailable: '',
  }));
  const [nsOpen, setNsOpen] = useState(false);
  const [error, setError] = useState<string>();
  // The user can edit the generated manifest freely before creating (issue #9). `undefined` means
  // "not edited — track the form"; a string means the edited YAML takes over until they reset.
  const [editedManifest, setEditedManifest] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = (patch: Partial<WorkloadForm>) => {
    setForm((f) => ({ ...f, ...patch }));
  };

  // Live duplicate-name check: a workload that already exists 409s on create, so warn now instead
  // of failing at the final step and forcing a roll-back (issue #12).
  const [existingPods] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: PodGVK,
    namespace: form.namespace,
    isList: true,
  });
  const [existingDeployments] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: DeploymentGVK,
    namespace: form.namespace,
    isList: true,
  });
  const nameTaken = workloadNameExists(
    form.kind,
    form.name,
    existingPods ?? [],
    existingDeployments ?? [],
  );

  const selectedRC: RuntimeClassKind | undefined = sandboxRCs.find(
    (rc) => rc.metadata?.name === form.runtimeClass,
  );
  const isPeerPod = isolationForHandler(selectedRC?.handler) === 'peerpod';
  const manifest = useMemo(() => buildManifest(form, isPeerPod), [form, isPeerPod]);
  const generatedYaml = useMemo(() => toYaml(manifest), [manifest]);

  // What Create actually submits: the user's edited YAML if they touched it, else the generated
  // manifest. Parse + sanity-check the edit so an invalid document blocks Create with a clear error
  // instead of a cryptic API failure (issue #9).
  const review = useMemo(():
    | { ok: true; obj: Record<string, unknown> }
    | { ok: false; error: string } => {
    if (editedManifest === undefined) return { ok: true, obj: manifest };
    let parsed: unknown;
    try {
      parsed = fromYaml(editedManifest);
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? String(e) };
    }
    const obj = parsed as { kind?: unknown; metadata?: { name?: unknown } } | null;
    if (!obj || typeof obj !== 'object' || typeof obj.kind !== 'string' || !obj.metadata?.name)
      return { ok: false, error: t('The manifest needs a kind and a metadata.name.') };
    return { ok: true, obj: obj };
  }, [editedManifest, manifest, t]);

  const onSave = async () => {
    setError(undefined);
    if (!review.ok) {
      setError(review.error);
      return;
    }
    const obj = review.obj;
    const kind = obj.kind as string;
    const meta = (obj.metadata ?? {}) as { name?: string; namespace?: string };
    try {
      await k8sCreate({
        model: kind === 'Deployment' ? DeploymentModel : PodModel,
        data: obj,
      });
      void navigate(
        `/sandboxes/workloads/${kind}/${meta.namespace ?? form.namespace}/${meta.name ?? form.name}`,
      );
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    }
  };

  // Pre-validate the target namespace: creating into a missing/Terminating namespace 500s at submit
  // with an opaque error, so resolve it from the watched list and gate Create now.
  const nsPhase = namespacePhase(form.namespace, namespaces ?? [], nsLoaded);
  const nsUsable = nsPhase === 'active' || nsPhase === 'unknown';

  const nameValid = K8S_NAME_RE.test(form.name) && form.name.length <= 63;
  const generalValid = nameValid && !!form.namespace && !nameTaken && nsUsable;
  const rcValid = !!form.runtimeClass;
  const containerValid = !!form.image;

  // The peer pods pull-secret procedure (§3.6), shown in the Image pull secret field's popover so a
  // private workload image actually pulls inside the pod VM.
  const pullSecretCli = [
    `oc get secret pull-secret -n openshift-config -o yaml \\`,
    `  | sed 's/namespace: openshift-config/namespace: ${form.namespace}/' \\`,
    `  | oc apply -n ${form.namespace} -f -`,
    `oc secrets link default pull-secret --for=pull -n ${form.namespace}`,
  ].join('\n');

  return (
    <>
      <DocumentTitle>{t('Create sandboxed workload')}</DocumentTitle>
      <ListPageHeader title={t('Create sandboxed workload')} />
      <PageSection>
        <Wizard
          onClose={() => void navigate('/sandboxes/workloads')}
          onSave={() => void onSave()}
          height={520}
        >
          <WizardStep
            name={t('General')}
            id="step-general"
            footer={{ isNextDisabled: !generalValid }}
          >
            <Form>
              <FormGroup label={t('Workload type')} isInline fieldId="kind">
                <Radio
                  id="kind-pod"
                  name="kind"
                  label={t('Pod (one microVM)')}
                  isChecked={form.kind === 'Pod'}
                  onChange={() => {
                    set({ kind: 'Pod' });
                  }}
                />
                <Radio
                  id="kind-deploy"
                  name="kind"
                  label={t('Deployment (scalable)')}
                  isChecked={form.kind === 'Deployment'}
                  onChange={() => {
                    set({ kind: 'Deployment' });
                  }}
                />
              </FormGroup>
              <FormGroup label={t('Name')} isRequired fieldId="name">
                <TextInput
                  id="name"
                  value={form.name}
                  validated={!form.name || (nameValid && !nameTaken) ? 'default' : 'error'}
                  onChange={(_e, v) => {
                    set({ name: v });
                  }}
                />
                {form.name && !nameValid && (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem variant="error">
                        {t(
                          'Must consist of lowercase letters, numbers, and hyphens, start and end with an alphanumeric character, and be at most 63 characters.',
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                )}
                {nameValid && nameTaken && (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem variant="error">
                        {t(
                          'A {{kind}} named "{{name}}" already exists in {{namespace}}. Pick a different name.',
                          { kind: form.kind, name: form.name, namespace: form.namespace },
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                )}
              </FormGroup>
              <FormGroup label={t('Namespace')} isRequired fieldId="namespace">
                <Select
                  isOpen={nsOpen}
                  selected={form.namespace}
                  onSelect={(_e, v) => {
                    set({ namespace: v as string });
                    setNsOpen(false);
                  }}
                  onOpenChange={setNsOpen}
                  toggle={(ref) => (
                    <MenuToggle
                      ref={ref}
                      isFullWidth
                      onClick={() => {
                        setNsOpen(!nsOpen);
                      }}
                    >
                      {form.namespace}
                    </MenuToggle>
                  )}
                >
                  <SelectList className="osc-openshift-console-plugin__ns-list">
                    {(namespaces ?? []).map((ns) => (
                      <SelectOption key={ns.metadata?.name} value={ns.metadata?.name}>
                        {ns.metadata?.name}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
                {nsPhase === 'missing' && (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem variant="error">
                        {t(
                          'Namespace "{{namespace}}" does not exist. Pick an existing namespace.',
                          {
                            namespace: form.namespace,
                          },
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                )}
                {nsPhase === 'terminating' && (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem variant="error">
                        {t(
                          'Namespace "{{namespace}}" is terminating and cannot accept new workloads.',
                          { namespace: form.namespace },
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                )}
                {form.namespace === OSC_NAMESPACE && (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem variant="warning">
                        {t(
                          'Avoid deploying workloads in the Operator namespace. Create or pick a dedicated namespace instead.',
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                )}
              </FormGroup>
              {form.kind === 'Deployment' && (
                <FormGroup label={t('Replicas')} fieldId="replicas">
                  <NumberInput
                    value={form.replicas}
                    min={1}
                    onMinus={() => {
                      set({ replicas: Math.max(1, form.replicas - 1) });
                    }}
                    onPlus={() => {
                      set({ replicas: form.replicas + 1 });
                    }}
                    onChange={(e) => {
                      set({ replicas: Number((e.target as HTMLInputElement).value) || 1 });
                    }}
                  />
                </FormGroup>
              )}
            </Form>
          </WizardStep>

          <WizardStep name={t('Runtime class')} id="step-rc" footer={{ isNextDisabled: !rcValid }}>
            {sandboxRCs.length === 0 ? (
              <EmptyState headingLevel="h4" titleText={t('No sandbox runtime classes available')}>
                <EmptyStateBody>
                  {t(
                    'No kata runtime classes were found. Check that the KataConfig has finished installing on the Sandboxes overview page.',
                  )}
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <Grid hasGutter>
                {sandboxRCs.map((rc) => {
                  const name = rc.metadata?.name ?? '';
                  const iso = isolationForHandler(rc.handler);
                  const cat = runtimeClassCatalog[name];
                  const selected = form.runtimeClass === name;
                  return (
                    <GridItem span={4} key={name}>
                      <Card
                        onClick={() => {
                          set({ runtimeClass: name });
                        }}
                        className={`osc-openshift-console-plugin__rc-card${selected ? ' osc-openshift-console-plugin__rc-selected' : ''}`}
                      >
                        <CardTitle>
                          {cat?.title ?? name} <IsolationLabel isolation={iso} />
                        </CardTitle>
                        <CardBody>
                          {cat?.blurb ?? t('Sandbox runtime class.')}
                          {iso === 'node' && (
                            <div className="osc-openshift-console-plugin__mt">
                              <HelperText>
                                <HelperTextItem variant="indeterminate">
                                  {t(
                                    'On-node Kata boots the microVM directly on the worker node, so those nodes must expose hardware virtualization (KVM): native on bare-metal workers, or nested virtualization on VM-based workers. Make sure your nodes have it — in a mixed cluster, on-node pods only schedule onto nodes that do. If you are not sure, a peer-pods runtime class runs each pod in its own cloud VM and needs neither.',
                                  )}
                                </HelperTextItem>
                              </HelperText>
                            </div>
                          )}
                        </CardBody>
                      </Card>
                    </GridItem>
                  );
                })}
              </Grid>
            )}
          </WizardStep>

          <WizardStep
            name={t('Container')}
            id="step-container"
            footer={{ isNextDisabled: !containerValid }}
          >
            <Form>
              <FormGroup label={t('Image')} isRequired fieldId="image">
                <TextInput
                  id="image"
                  value={form.image}
                  onChange={(_e, v) => {
                    set({ image: v });
                  }}
                />
              </FormGroup>
              <FormGroup label={t('Command')} fieldId="command">
                <TextInput
                  id="command"
                  value={form.command}
                  onChange={(_e, v) => {
                    set({ command: v });
                  }}
                  placeholder="e.g. sleep 36000"
                />
              </FormGroup>
              <FormGroup label={t('CPU request/limit')} fieldId="cpu">
                <TextInput
                  id="cpu"
                  value={form.cpu}
                  onChange={(_e, v) => {
                    set({ cpu: v });
                  }}
                  placeholder="e.g. 500m"
                />
              </FormGroup>
              <FormGroup label={t('Memory request/limit')} fieldId="memory">
                <TextInput
                  id="memory"
                  value={form.memory}
                  onChange={(_e, v) => {
                    set({ memory: v });
                  }}
                  placeholder="e.g. 256Mi"
                />
              </FormGroup>
              {isPeerPod && (
                <FormGroup label={t('Peer-pod instance type')} isInline fieldId="instanceMode">
                  <Radio
                    id="it-default"
                    name="instanceMode"
                    label={
                      defaultMachineType
                        ? t('Cluster default ({{mt}})', { mt: defaultMachineType })
                        : t('Cluster default')
                    }
                    isChecked={form.instanceMode === 'default'}
                    onChange={() => {
                      set({ instanceMode: 'default' });
                    }}
                  />
                  <Radio
                    id="it-specific"
                    name="instanceMode"
                    label={t('Specific type')}
                    isChecked={form.instanceMode === 'specific'}
                    onChange={() => {
                      set({ instanceMode: 'specific' });
                    }}
                  />
                  <Radio
                    id="it-auto"
                    name="instanceMode"
                    label={t('Automatic (by vCPU and memory)')}
                    isChecked={form.instanceMode === 'auto'}
                    onChange={() => {
                      set({ instanceMode: 'auto' });
                    }}
                  />
                </FormGroup>
              )}
              {isPeerPod && form.instanceMode === 'specific' && (
                <FormGroup label={t('Instance type')} fieldId="mt">
                  {instanceTypeOptions.length > 0 ? (
                    <FormSelect
                      id="mt"
                      value={form.machineType}
                      onChange={(_e, v) => {
                        set({ machineType: v });
                      }}
                    >
                      <FormSelectOption value="" label={t('Select an instance type')} />
                      {instanceTypeOptions.map((it) => (
                        <FormSelectOption key={it} value={it} label={it} />
                      ))}
                    </FormSelect>
                  ) : (
                    <TextInput
                      id="mt"
                      value={form.machineType}
                      onChange={(_e, v) => {
                        set({ machineType: v });
                      }}
                      placeholder={defaultMachineType ?? 't3.large'}
                    />
                  )}
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {t(
                          'Must be one of the instance types allowed in peer-pods-cm (PODVM_INSTANCE_TYPES).',
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
              )}
              {isPeerPod && form.instanceMode === 'auto' && (
                <>
                  <FormGroup label={t('vCPUs')} fieldId="vcpus">
                    <TextInput
                      id="vcpus"
                      type="number"
                      value={form.defaultVcpus}
                      onChange={(_e, v) => {
                        set({ defaultVcpus: v });
                      }}
                      placeholder="2"
                    />
                  </FormGroup>
                  <FormGroup label={t('Memory (MiB)')} fieldId="mem">
                    <TextInput
                      id="mem"
                      type="number"
                      value={form.defaultMemory}
                      onChange={(_e, v) => {
                        set({ defaultMemory: v });
                      }}
                      placeholder="2048"
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'The operator picks the smallest instance type that meets this vCPU and memory floor.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>
                </>
              )}
              {isPeerPod && (
                <FormGroup label={t('Pod VM image (optional)')} fieldId="podVmImage">
                  <TextInput
                    id="podVmImage"
                    value={form.podVmImage}
                    onChange={(_e, v) => {
                      set({ podVmImage: v });
                    }}
                    placeholder={t('Use the operator default')}
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {t(
                          'Override the default pod VM image with a custom image ID (AMI or Azure image) compatible with your cloud. Leave blank to use the image the operator registered.',
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
              )}
              <ExpandableSection
                toggleText={t('Advanced options (optional)')}
                isExpanded={advancedOpen}
                onToggle={(_e, x) => {
                  setAdvancedOpen(x);
                }}
              >
                <FormGroup label={t('Environment variables')} fieldId="env">
                  <TextArea
                    id="env"
                    value={form.env}
                    onChange={(_e, v) => {
                      set({ env: v });
                    }}
                    placeholder={'KEY=value\nKEY2=value2'}
                    rows={3}
                    resizeOrientation="vertical"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>{t('One KEY=value per line.')}</HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                <FormGroup label={t('Image pull policy')} fieldId="pullPolicy">
                  <FormSelect
                    id="pullPolicy"
                    value={form.pullPolicy}
                    onChange={(_e, v) => {
                      set({ pullPolicy: v });
                    }}
                  >
                    <FormSelectOption value="" label={t('Cluster default')} />
                    <FormSelectOption value="Always" label="Always" />
                    <FormSelectOption value="IfNotPresent" label="IfNotPresent" />
                    <FormSelectOption value="Never" label="Never" />
                  </FormSelect>
                </FormGroup>
                <FormGroup label={t('Container port')} fieldId="port">
                  <TextInput
                    id="port"
                    type="number"
                    value={form.port}
                    onChange={(_e, v) => {
                      set({ port: v });
                    }}
                    placeholder="8080"
                  />
                </FormGroup>
                <FormGroup label={t('Security context')} fieldId="runAsNonRoot">
                  <Checkbox
                    id="runAsNonRoot"
                    label={t('Run the container as a non-root user')}
                    isChecked={form.runAsNonRoot}
                    onChange={(_e, v) => {
                      set({ runAsNonRoot: v });
                    }}
                  />
                </FormGroup>
                <FormGroup label={t('Service account')} fieldId="sa">
                  <TextInput
                    id="sa"
                    value={form.serviceAccount}
                    onChange={(_e, v) => {
                      set({ serviceAccount: v });
                    }}
                    placeholder="default"
                  />
                </FormGroup>
                <FormGroup label={t('Labels')} fieldId="labels">
                  <TextArea
                    id="labels"
                    value={form.labels}
                    onChange={(_e, v) => {
                      set({ labels: v });
                    }}
                    placeholder={'tier=frontend\nteam=payments'}
                    rows={2}
                    resizeOrientation="vertical"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {t('One KEY=value per line, added alongside app={{name}}.', {
                          name: form.name,
                        })}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                <FormGroup label={t('Annotations')} fieldId="annotations">
                  <TextArea
                    id="annotations"
                    value={form.annotations}
                    onChange={(_e, v) => {
                      set({ annotations: v });
                    }}
                    placeholder={'prometheus.io/scrape=true\nexample.com/owner=payments'}
                    rows={2}
                    resizeOrientation="vertical"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {t(
                          'One KEY=value per line. Non-identifying metadata for tools and pipelines.',
                        )}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                <FormGroup label={t('Node selector')} fieldId="nodeSelector">
                  <TextArea
                    id="nodeSelector"
                    value={form.nodeSelector}
                    onChange={(_e, v) => {
                      set({ nodeSelector: v });
                    }}
                    placeholder={'disktype=ssd\nkubernetes.io/arch=amd64'}
                    rows={2}
                    resizeOrientation="vertical"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {t('One KEY=value per line. The pod schedules only onto matching nodes.')}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                <FormGroup
                  label={t('Image pull secret')}
                  fieldId="pullSecret"
                  labelHelp={
                    <Popover
                      headerContent={t('Create a pull secret for peer pods')}
                      bodyContent={
                        <>
                          <p className="osc-openshift-console-plugin__mb">
                            {t(
                              'Peer pods pull the image inside the pod VM, so the secret must exist in this namespace. Copy the cluster pull secret in (and optionally link it to the default service account):',
                            )}
                          </p>
                          <CodeBlock>
                            <CodeBlockCode>{pullSecretCli}</CodeBlockCode>
                          </CodeBlock>
                        </>
                      }
                    >
                      <FormGroupLabelHelp aria-label={t('More info for image pull secret')} />
                    </Popover>
                  }
                >
                  <TextInput
                    id="pullSecret"
                    value={form.imagePullSecret}
                    onChange={(_e, v) => {
                      set({ imagePullSecret: v });
                    }}
                    placeholder="my-registry-secret"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        {t('Name of a pull secret in this namespace, for private registry images.')}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
                {form.kind === 'Pod' && (
                  <FormGroup label={t('Restart policy')} fieldId="restartPolicy">
                    <FormSelect
                      id="restartPolicy"
                      value={form.restartPolicy}
                      onChange={(_e, v) => {
                        set({ restartPolicy: v });
                      }}
                    >
                      <FormSelectOption value="" label={t('Cluster default (Always)')} />
                      <FormSelectOption value="Always" label="Always" />
                      <FormSelectOption value="OnFailure" label="OnFailure" />
                      <FormSelectOption value="Never" label="Never" />
                    </FormSelect>
                  </FormGroup>
                )}
                {form.kind === 'Deployment' && (
                  <>
                    <FormGroup label={t('Update strategy')} fieldId="strategy">
                      <FormSelect
                        id="strategy"
                        value={form.strategy}
                        onChange={(_e, v) => {
                          set({ strategy: v });
                        }}
                      >
                        <FormSelectOption value="" label={t('Cluster default (RollingUpdate)')} />
                        <FormSelectOption value="RollingUpdate" label="RollingUpdate" />
                        <FormSelectOption value="Recreate" label="Recreate" />
                      </FormSelect>
                    </FormGroup>
                    {form.strategy !== 'Recreate' && (
                      <>
                        <FormGroup label={t('Max surge')} fieldId="maxSurge">
                          <TextInput
                            id="maxSurge"
                            value={form.maxSurge}
                            onChange={(_e, v) => {
                              set({ maxSurge: v });
                            }}
                            placeholder="25%"
                          />
                        </FormGroup>
                        <FormGroup label={t('Max unavailable')} fieldId="maxUnavailable">
                          <TextInput
                            id="maxUnavailable"
                            value={form.maxUnavailable}
                            onChange={(_e, v) => {
                              set({ maxUnavailable: v });
                            }}
                            placeholder="25%"
                          />
                        </FormGroup>
                      </>
                    )}
                  </>
                )}
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      {t(
                        'For probes, volumes, or anything else, edit the manifest directly on the Review step.',
                      )}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </ExpandableSection>
            </Form>
          </WizardStep>

          <WizardStep
            name={t('Review')}
            id="step-review"
            footer={{ nextButtonText: t('Create'), isNextDisabled: !review.ok }}
          >
            {error && (
              <Alert variant="danger" title={t('Could not create workload')} isInline>
                {error}
              </Alert>
            )}
            <Grid hasGutter>
              <GridItem span={5}>
                <Card isCompact>
                  <CardTitle>{t('Summary')}</CardTitle>
                  <CardBody>
                    <DescriptionList isHorizontal isCompact>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Type')}</DescriptionListTerm>
                        <DescriptionListDescription>{form.kind}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Name')}</DescriptionListTerm>
                        <DescriptionListDescription>{form.name}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Namespace')}</DescriptionListTerm>
                        <DescriptionListDescription>{form.namespace}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Runtime class')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          {form.runtimeClass}{' '}
                          <IsolationLabel isolation={isolationForHandler(selectedRC?.handler)} />
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      {form.kind === 'Deployment' && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Replicas')}</DescriptionListTerm>
                          <DescriptionListDescription>{form.replicas}</DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Image')}</DescriptionListTerm>
                        <DescriptionListDescription className="osc-openshift-console-plugin__mono">
                          {form.image}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      {(form.cpu || form.memory) && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Resources')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {[
                              form.cpu && `cpu: ${form.cpu}`,
                              form.memory && `memory: ${form.memory}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                      {isPeerPod && (
                        <DescriptionListGroup>
                          <DescriptionListTerm>{t('Instance type')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {form.instanceMode === 'specific'
                              ? form.machineType ||
                                (defaultMachineType
                                  ? t('Cluster default ({{mt}})', { mt: defaultMachineType })
                                  : t('Cluster default'))
                              : form.instanceMode === 'auto'
                                ? t('Automatic ({{vcpus}} vCPU, {{mem}} MiB)', {
                                    vcpus: form.defaultVcpus || '—',
                                    mem: form.defaultMemory || '—',
                                  })
                                : defaultMachineType
                                  ? t('Cluster default ({{mt}})', { mt: defaultMachineType })
                                  : t('Cluster default')}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem span={7}>
                <Card isCompact>
                  <CardTitle>
                    {t('Manifest')}{' '}
                    {editedManifest !== undefined && (
                      <Button
                        variant="link"
                        isInline
                        onClick={() => {
                          setEditedManifest(undefined);
                        }}
                      >
                        {t('Reset to form values')}
                      </Button>
                    )}
                  </CardTitle>
                  <CardBody>
                    <TextArea
                      aria-label={t('Workload manifest')}
                      className="osc-openshift-console-plugin__mono"
                      value={editedManifest ?? generatedYaml}
                      onChange={(_e, v) => {
                        setEditedManifest(v);
                      }}
                      rows={22}
                      resizeOrientation="vertical"
                    />
                    {!review.ok ? (
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem variant="error">{review.error}</HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    ) : (
                      editedManifest !== undefined && (
                        <FormHelperText>
                          <HelperText>
                            <HelperTextItem>
                              {t(
                                'Editing the manifest directly — form changes won’t apply until you reset.',
                              )}
                            </HelperTextItem>
                          </HelperText>
                        </FormHelperText>
                      )
                    )}
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>
          </WizardStep>
        </Wizard>
      </PageSection>
    </>
  );
};

export default CreateSandboxWorkload;
