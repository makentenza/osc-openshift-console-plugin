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
  Form,
  FormGroup,
  Grid,
  GridItem,
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
import { DeploymentModel, NamespaceGVK, PodModel } from '../k8s/resources';
import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import type { RuntimeClassKind } from '../k8s/types';
import { isSandboxRuntimeClass, isolationForHandler, runtimeClassCatalog } from '../utils/runtime';
import { IsolationLabel } from './IsolationLabel';
import './sandbox.css';

const MACHINE_TYPE_ANNOTATION = 'io.katacontainers.config.hypervisor.machine_type';

interface Form {
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
  f: Form,
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
  const { t } = useTranslation('plugin__osc-plugin');
  const navigate = useNavigate();
  const [runtimeClasses] = useRuntimeClasses();
  const [namespaces] = useK8sWatchResource<K8sResourceCommon[]>({
    groupVersionKind: NamespaceGVK,
    isList: true,
  });
  const sandboxRCs = useMemo(() => runtimeClasses.filter(isSandboxRuntimeClass), [runtimeClasses]);

  const [form, setForm] = useState<Form>({
    kind: 'Pod',
    name: 'my-sandbox',
    namespace: 'default',
    runtimeClass: '',
    image: 'registry.access.redhat.com/ubi9/ubi:latest',
    command: 'sleep 36000',
    cpu: '',
    memory: '',
    replicas: 1,
    machineType: '',
  });
  const [nsOpen, setNsOpen] = useState(false);
  const [error, setError] = useState<string>();

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
  };
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

  const generalValid = !!form.name && !!form.namespace;
  const rcValid = !!form.runtimeClass;

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
                  onChange={(_e, v) => {
                    set({ name: v });
                  }}
                />
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
                  <SelectList className="osc-plugin__ns-list">
                    {(namespaces ?? []).map((ns) => (
                      <SelectOption key={ns.metadata?.name} value={ns.metadata?.name}>
                        {ns.metadata?.name}
                      </SelectOption>
                    ))}
                  </SelectList>
                </Select>
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
                      className={`osc-plugin__rc-card${selected ? ' osc-plugin__rc-selected' : ''}`}
                    >
                      <CardTitle>
                        {cat?.title ?? name} <IsolationLabel isolation={iso} />
                      </CardTitle>
                      <CardBody>{cat?.blurb ?? t('Sandbox runtime class.')}</CardBody>
                    </Card>
                  </GridItem>
                );
              })}
            </Grid>
          </WizardStep>

          <WizardStep name={t('Container')} id="step-container">
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
                    placeholder="e2-standard-4"
                  />
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
            <Card>
              <CardTitle>{t('Manifest preview')}</CardTitle>
              <CardBody>
                <CodeBlock>
                  <CodeBlockCode>{JSON.stringify(manifest, null, 2)}</CodeBlockCode>
                </CodeBlock>
              </CardBody>
            </Card>
          </WizardStep>
        </Wizard>
      </PageSection>
    </>
  );
};

export default CreateSandboxWorkload;
