import {
  DocumentTitle,
  k8sCreate,
  ListPageHeader,
  useK8sWatchResource,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormHelperText,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  MenuToggle,
  NumberInput,
  PageSection,
  Radio,
  Select,
  SelectList,
  SelectOption,
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
import {
  isSandboxRuntimeClass,
  isolationForHandler,
  platformLikelySupportsNestedVirt,
  runtimeClassCatalog,
} from '../utils/runtime';
import { useClusterPlatform } from '../k8s/setup';
import { namespacePhase, suggestWorkloadName, workloadNameExists } from '../utils/workload';
import { toYaml } from '../utils/yaml';
import { IsolationLabel } from './IsolationLabel';
import './sandbox.css';

const MACHINE_TYPE_ANNOTATION = 'io.katacontainers.config.hypervisor.machine_type';

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
  machineType: string;
}

const buildManifest = (
  f: WorkloadForm,
  isPeerPod: boolean,
): K8sResourceCommon & Record<string, unknown> => {
  const container: Record<string, unknown> = {
    name: f.name,
    image: f.image,
    ...(f.command ? { command: f.command.trim().split(/\s+/) } : {}),
    securityContext: { privileged: false, seccompProfile: { type: 'RuntimeDefault' } },
  };
  if (f.cpu || f.memory) {
    const res: Record<string, string> = {};
    if (f.cpu) res.cpu = f.cpu;
    if (f.memory) res.memory = f.memory;
    container.resources = { requests: { ...res }, limits: { ...res } };
  }
  const podSpec = { runtimeClassName: f.runtimeClass, containers: [container] };
  const annotations =
    isPeerPod && f.machineType ? { [MACHINE_TYPE_ANNOTATION]: f.machineType } : undefined;

  if (f.kind === 'Pod') {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: f.name,
        namespace: f.namespace,
        labels: { app: f.name },
        ...(annotations ? { annotations } : {}),
      },
      spec: podSpec,
    };
  }
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: f.name, namespace: f.namespace, labels: { app: f.name } },
    spec: {
      replicas: f.replicas,
      selector: { matchLabels: { app: f.name } },
      template: {
        metadata: { labels: { app: f.name }, ...(annotations ? { annotations } : {}) },
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
  const platform = useClusterPlatform();
  const sandboxRCs = useMemo(() => runtimeClasses.filter(isSandboxRuntimeClass), [runtimeClasses]);
  const defaultMachineType =
    peerPodsCm?.data?.GCP_MACHINE_TYPE ?? peerPodsCm?.data?.PODVM_INSTANCE_TYPE;
  // On-node kata needs the worker to expose hardware virt (KVM); managed clouds usually don't, so
  // warn (best-effort, never block) when the platform likely lacks it (issue: on-node caveat).
  const nestedVirtUnlikely = platformLikelySupportsNestedVirt(platform) === false;

  const [form, setForm] = useState<WorkloadForm>(() => ({
    kind: 'Pod',
    name: suggestWorkloadName(),
    namespace: 'default',
    runtimeClass: '',
    image: 'registry.access.redhat.com/ubi9/ubi:latest',
    command: 'sleep 36000',
    cpu: '',
    memory: '',
    replicas: 1,
    machineType: '',
  }));
  const [nsOpen, setNsOpen] = useState(false);
  const [error, setError] = useState<string>();

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

  const onSave = async () => {
    setError(undefined);
    try {
      await k8sCreate({
        model: form.kind === 'Pod' ? PodModel : DeploymentModel,
        data: manifest,
      });
      void navigate(`/sandboxes/workloads/${form.kind}/${form.namespace}/${form.name}`);
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
                          {iso === 'node' && nestedVirtUnlikely && (
                            <div className="osc-openshift-console-plugin__mt">
                              <HelperText>
                                <HelperTextItem variant="warning">
                                  {t(
                                    'On-node kata needs nested virtualization. This {{platform}} cluster likely lacks it on standard nodes — the pod may stay unschedulable. Use a peer-pod runtime class instead, or a node with nested virt enabled.',
                                    { platform },
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
                  placeholder="sleep 36000"
                />
              </FormGroup>
              <FormGroup label={t('CPU request/limit')} fieldId="cpu">
                <TextInput
                  id="cpu"
                  value={form.cpu}
                  onChange={(_e, v) => {
                    set({ cpu: v });
                  }}
                  placeholder="500m"
                />
              </FormGroup>
              <FormGroup label={t('Memory request/limit')} fieldId="memory">
                <TextInput
                  id="memory"
                  value={form.memory}
                  onChange={(_e, v) => {
                    set({ memory: v });
                  }}
                  placeholder="256Mi"
                />
              </FormGroup>
              {isPeerPod && (
                <FormGroup label={t('Peer-pod machine type (optional)')} fieldId="mt">
                  <TextInput
                    id="mt"
                    value={form.machineType}
                    onChange={(_e, v) => {
                      set({ machineType: v });
                    }}
                    placeholder={defaultMachineType ?? 'e2-standard-4'}
                  />
                  {defaultMachineType && (
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t('Leave empty to use the cluster default: {{mt}}', {
                            mt: defaultMachineType,
                          })}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  )}
                </FormGroup>
              )}
            </Form>
          </WizardStep>

          <WizardStep name={t('Review')} id="step-review" footer={{ nextButtonText: t('Create') }}>
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
                          <DescriptionListTerm>{t('Machine type')}</DescriptionListTerm>
                          <DescriptionListDescription>
                            {form.machineType ||
                              (defaultMachineType
                                ? t('Cluster default ({{mt}})', { mt: defaultMachineType })
                                : t('Cluster default'))}
                          </DescriptionListDescription>
                        </DescriptionListGroup>
                      )}
                    </DescriptionList>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem span={7}>
                <Card isCompact>
                  <CardTitle>{t('Manifest preview')}</CardTitle>
                  <CardBody>
                    <CodeBlock>
                      <CodeBlockCode>{toYaml(manifest)}</CodeBlockCode>
                    </CodeBlock>
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
