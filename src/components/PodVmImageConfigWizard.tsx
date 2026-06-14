import {
  DocumentTitle,
  k8sCreate,
  k8sUpdate,
  ListPageHeader,
  ResourceLink,
  useK8sWatchResource,
  type K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  CodeBlock,
  CodeBlockCode,
  Content,
  ExpandableSection,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormHelperText,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  Label,
  PageSection,
  ProgressStep,
  ProgressStepper,
  Spinner,
  Switch,
  TextArea,
  TextInput,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import type { FC, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import {
  BuildConfigModel,
  BuildGVK,
  ConfigMapModel,
  ImageStreamModel,
  OSC_NAMESPACE,
  PODVM_BUILDCONFIG,
  PODVM_IMAGE_CM,
} from '../k8s/resources';
import type { ConfigMapKind } from '../k8s/types';
import { usePodvmImageCm } from '../k8s/setup';
import { toYaml } from '../utils/yaml';
import './sandbox.css';

// Default bootc build customizations from the 1.12 "Creating the peer pod VM image config map" example.
const DEFAULT_BOOTC_BUILD_CONFIG = `[[customizations.user]]
name = "peerpod"
password = "peerpod"
groups = ["wheel", "root"]

[[customizations.filesystem]]
mountpoint = "/"
minsize = "5 GiB"

[[customizations.filesystem]]
mountpoint = "/var/kata-containers"
minsize = "15 GiB"
`;

// --- Workstation (podman) build commands ---
const WS_CLONE = `git clone https://github.com/openshift/sandboxed-containers-operator.git
cd sandboxed-containers-operator/config/peerpods/podvm/bootc`;

const WS_LOGIN = `podman login registry.redhat.io`;

const WS_BUILD = `IMG="<registry>/<your-username>/podvm-bootc:latest"
podman build -t "\${IMG}" -f Containerfile.rhel .`;

const WS_PUSH = `podman login <registry>
podman push "\${IMG}"`;

// --- In-cluster build (OpenShift BuildConfig, no local tooling) ---
const CLUSTER_BUILD = `oc apply -f - <<'EOF'
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata:
  name: podvm-bootc
  namespace: openshift-sandboxed-containers-operator
spec:
  source:
    type: Git
    git:
      uri: https://github.com/openshift/sandboxed-containers-operator.git
    contextDir: config/peerpods/podvm/bootc
  strategy:
    type: Docker
    dockerStrategy:
      dockerfilePath: Containerfile.rhel
  output:
    to:
      kind: ImageStreamTag
      name: podvm-bootc:latest
EOF

oc start-build podvm-bootc -n openshift-sandboxed-containers-operator --follow`;

const CLUSTER_IMAGE_REF =
  'image-registry.openshift-image-registry.svc:5000/openshift-sandboxed-containers-operator/podvm-bootc:latest';

const RUNNING_PHASES = ['New', 'Pending', 'Running'];
const FAILED_PHASES = ['Failed', 'Error', 'Cancelled'];

type BuildKind = K8sResourceCommon & { status?: { phase?: string } };

const isAlreadyExists = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  const code = typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined;
  return code === 409 || /already exists/i.test(msg);
};

// The output ImageStream + Docker-strategy BuildConfig the wizard creates so OpenShift
// builds the pod VM image in-cluster from Red Hat's upstream Containerfile — no local tools.
const podvmImageStream: K8sResourceCommon = {
  apiVersion: 'image.openshift.io/v1',
  kind: 'ImageStream',
  metadata: { name: PODVM_BUILDCONFIG, namespace: OSC_NAMESPACE },
};

const podvmBuildConfig: K8sResourceCommon & { spec: Record<string, unknown> } = {
  apiVersion: 'build.openshift.io/v1',
  kind: 'BuildConfig',
  metadata: { name: PODVM_BUILDCONFIG, namespace: OSC_NAMESPACE },
  spec: {
    source: {
      type: 'Git',
      git: { uri: 'https://github.com/openshift/sandboxed-containers-operator.git' },
      contextDir: 'config/peerpods/podvm/bootc',
    },
    strategy: { type: 'Docker', dockerStrategy: { dockerfilePath: 'Containerfile.rhel' } },
    output: { to: { kind: 'ImageStreamTag', name: `${PODVM_BUILDCONFIG}:latest` } },
    // A ConfigChange trigger starts the first build automatically when the BuildConfig is created.
    triggers: [{ type: 'ConfigChange' }],
  },
};

const podvmBuildRequest: K8sResourceCommon & { triggeredBy: unknown[] } = {
  apiVersion: 'build.openshift.io/v1',
  kind: 'BuildRequest',
  metadata: { name: PODVM_BUILDCONFIG, namespace: OSC_NAMESPACE },
  triggeredBy: [{ message: 'Started from the Setup wizard' }],
};

/** One numbered instruction in the build guide: badge + title + explanation + optional copyable command. */
const BuildStep: FC<{
  num: number;
  title: string;
  command?: string;
  children?: ReactNode;
  extra?: ReactNode;
}> = ({ num, title, command, children, extra }) => (
  <li className="osc-openshift-console-plugin__step">
    <span className="osc-openshift-console-plugin__step-num" aria-hidden="true">
      {num}
    </span>
    <div className="osc-openshift-console-plugin__step-body">
      <div className="osc-openshift-console-plugin__step-title">{title}</div>
      {children ? (
        <Content component="p" className="osc-openshift-console-plugin__muted">
          {children}
        </Content>
      ) : null}
      {command ? (
        <ClipboardCopy
          className="osc-openshift-console-plugin__step-cmd"
          isReadOnly
          isExpanded
          variant="expansion"
        >
          {command}
        </ClipboardCopy>
      ) : null}
      {extra}
    </div>
  </li>
);

const PodVmImageConfigWizard: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();
  const [existing, loaded] = usePodvmImageCm();

  const d = existing?.data ?? {};
  const [imageType] = useState(d.IMAGE_TYPE ?? 'pre-built');
  const [uri, setUri] = useState(d.PODVM_IMAGE_URI ?? '');
  const [baseName, setBaseName] = useState(d.IMAGE_BASE_NAME ?? 'podvm-image');
  const [version, setVersion] = useState(d.IMAGE_VERSION ?? '0-0-0');
  const [installPackages, setInstallPackages] = useState((d.INSTALL_PACKAGES ?? 'no') === 'yes');
  const [disableCloudConfig, setDisableCloudConfig] = useState(
    (d.DISABLE_CLOUD_CONFIG ?? 'true') === 'true',
  );
  const [updatePeerPodsCm, setUpdatePeerPodsCm] = useState(
    (d.UPDATE_PEERPODS_CM ?? 'yes') === 'yes',
  );
  const [bootFips, setBootFips] = useState((d.BOOT_FIPS ?? 'no') === 'yes');
  const [bootcConfig, setBootcConfig] = useState(
    d.BOOTC_BUILD_CONFIG ?? DEFAULT_BOOTC_BUILD_CONFIG,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [method, setMethod] = useState<'workstation' | 'cluster'>('cluster');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // In-cluster build: create the ImageStream + BuildConfig and start a build, then
  // watch its status. No oc / podman needed.
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | undefined>();
  const [builds] = useK8sWatchResource<BuildKind[]>({
    groupVersionKind: BuildGVK,
    namespace: OSC_NAMESPACE,
    isList: true,
  });
  const latestBuild = useMemo(() => {
    const mine = (builds ?? []).filter(
      (b) => b.metadata?.labels?.['openshift.io/build-config.name'] === PODVM_BUILDCONFIG,
    );
    return mine.sort((a, b) =>
      (b.metadata?.creationTimestamp ?? '').localeCompare(a.metadata?.creationTimestamp ?? ''),
    )[0];
  }, [builds]);
  const buildPhase = latestBuild?.status?.phase;
  const buildRunning = RUNNING_PHASES.includes(buildPhase ?? '');
  const buildFailed = FAILED_PHASES.includes(buildPhase ?? '');
  const buildComplete = buildPhase === 'Complete';

  // Once the in-cluster build finishes, prefill the image URI (only if the user hasn't typed one).
  const prefilled = useRef(false);
  useEffect(() => {
    if (buildComplete && !prefilled.current && uri.trim() === '') {
      prefilled.current = true;
      setUri(CLUSTER_IMAGE_REF);
    }
  }, [buildComplete, uri]);

  const startClusterBuild = async () => {
    setBuildBusy(true);
    setBuildError(undefined);
    try {
      try {
        await k8sCreate({ model: ImageStreamModel, data: podvmImageStream });
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
      }
      let created = true;
      try {
        await k8sCreate({ model: BuildConfigModel, data: podvmBuildConfig });
      } catch (e) {
        if (isAlreadyExists(e)) created = false;
        else throw e;
      }
      // A new BuildConfig auto-builds via its ConfigChange trigger; if it already
      // existed, instantiate a fresh build explicitly.
      if (!created) {
        await k8sCreate({
          model: BuildConfigModel,
          data: podvmBuildRequest,
          ns: OSC_NAMESPACE,
          name: PODVM_BUILDCONFIG,
          path: 'instantiate',
        });
      }
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuildBusy(false);
    }
  };

  const data: Record<string, string> = {
    IMAGE_TYPE: imageType,
    PODVM_IMAGE_URI: uri.trim(),
    IMAGE_BASE_NAME: baseName.trim() || 'podvm-image',
    IMAGE_VERSION: version.trim() || '0-0-0',
    INSTALL_PACKAGES: installPackages ? 'yes' : 'no',
    DISABLE_CLOUD_CONFIG: disableCloudConfig ? 'true' : 'false',
    UPDATE_PEERPODS_CM: updatePeerPodsCm ? 'yes' : 'no',
    BOOT_FIPS: bootFips ? 'yes' : 'no',
  };
  if (bootcConfig.trim()) data.BOOTC_BUILD_CONFIG = bootcConfig;

  const cm: ConfigMapKind & K8sResourceCommon = existing
    ? { ...existing, data: { ...existing.data, ...data } }
    : {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: PODVM_IMAGE_CM, namespace: OSC_NAMESPACE },
        data,
      };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (existing) {
        await k8sUpdate({ model: ConfigMapModel, data: cm });
      } else {
        await k8sCreate({ model: ConfigMapModel, data: cm });
      }
      navigate('/sandboxes/setup');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DocumentTitle>{t('Configure pod VM image')}</DocumentTitle>
      <ListPageHeader title={t('Configure pod VM image')} />
      <PageSection>
        {/* What is this & the end-to-end flow */}
        <Card className="osc-openshift-console-plugin__mb">
          <CardBody>
            <Content component="p">
              {t(
                'A peer pod does not run from a container image — each one boots a small virtual machine in your cloud, and that VM needs a disk image: the pod VM image. You build this image once, store it in a registry, and point the operator at it here. The operator turns it into a real cloud image and wires it into your peer pods config for you.',
              )}
            </Content>
            <ProgressStepper
              aria-label={t('Pod VM image setup flow')}
              isCenterAligned
              className="osc-openshift-console-plugin__mt"
            >
              <ProgressStep
                variant="info"
                id="flow-build"
                titleId="flow-build-title"
                description={t('On your laptop or in the cluster')}
              >
                {t('Build the image')}
              </ProgressStep>
              <ProgressStep
                variant="info"
                id="flow-store"
                titleId="flow-store-title"
                description={t('So the cluster can pull it')}
              >
                {t('Store in a registry')}
              </ProgressStep>
              <ProgressStep
                isCurrent
                variant="info"
                id="flow-ref"
                titleId="flow-ref-title"
                description={t('Paste the image location below')}
              >
                {t('Reference it here')}
              </ProgressStep>
              <ProgressStep
                variant="pending"
                id="flow-operator"
                titleId="flow-operator-title"
                description={t('Creates the cloud image & updates peer-pods-cm')}
              >
                {t('Operator finishes')}
              </ProgressStep>
            </ProgressStepper>
          </CardBody>
        </Card>

        <Grid hasGutter>
          {/* STEP 1 — build guide */}
          <GridItem lg={7}>
            <Card>
              <CardTitle>{t('Step 1 — Build the pod VM image')}</CardTitle>
              <CardBody>
                <ToggleGroup aria-label={t('Choose how to build the image')}>
                  <ToggleGroupItem
                    text={t('In the cluster')}
                    buttonId="pvi-method-cluster"
                    isSelected={method === 'cluster'}
                    onChange={() => {
                      setMethod('cluster');
                    }}
                  />
                  <ToggleGroupItem
                    text={t('On my workstation')}
                    buttonId="pvi-method-workstation"
                    isSelected={method === 'workstation'}
                    onChange={() => {
                      setMethod('workstation');
                    }}
                  />
                </ToggleGroup>
                <Content
                  component="p"
                  className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mt"
                >
                  {method === 'workstation'
                    ? t('Pick this if you have podman and an account on a container registry.')
                    : t('No local tools — OpenShift builds the image and stores it for you.')}
                </Content>

                {method === 'workstation' ? (
                  <>
                    <Alert
                      variant="info"
                      isInline
                      isPlain
                      title={t('Before you start')}
                      className="osc-openshift-console-plugin__mt osc-openshift-console-plugin__mb"
                    >
                      {t(
                        'You need podman, a Red Hat account (for registry.redhat.io), and a container registry you can push to — for example Quay.io.',
                      )}
                    </Alert>
                    <ol className="osc-openshift-console-plugin__steps">
                      <BuildStep num={1} title={t('Get the image definition')} command={WS_CLONE}>
                        {t(
                          'Red Hat publishes the pod VM image as a bootc Containerfile. Clone the repo and switch into the bootc directory.',
                        )}
                      </BuildStep>
                      <BuildStep
                        num={2}
                        title={t('Sign in to the Red Hat registry')}
                        command={WS_LOGIN}
                      >
                        {t('The Containerfile pulls its base layers from registry.redhat.io.')}
                      </BuildStep>
                      <BuildStep num={3} title={t('Build the image')} command={WS_BUILD}>
                        {t(
                          'Set IMG to a registry path you can push to, then build. This produces your pod VM image.',
                        )}
                      </BuildStep>
                      <BuildStep num={4} title={t('Push it to your registry')} command={WS_PUSH}>
                        {t('Upload the image so the cluster can pull it.')}
                      </BuildStep>
                      <BuildStep num={5} title={t('Reference it in Step 2')}>
                        {t(
                          'Copy your image location (the value of IMG) into the Pod VM image URI field on the right, then select Create.',
                        )}
                      </BuildStep>
                    </ol>
                  </>
                ) : (
                  <>
                    <Alert
                      variant="info"
                      isInline
                      isPlain
                      title={t('No local tools needed')}
                      className="osc-openshift-console-plugin__mt osc-openshift-console-plugin__mb"
                    >
                      {t(
                        'OpenShift builds the image for you with a BuildConfig and stores it in the internal registry. It uses your cluster pull secret for registry.redhat.io and needs network access to github.com.',
                      )}
                    </Alert>
                    <ol className="osc-openshift-console-plugin__steps">
                      <li className="osc-openshift-console-plugin__step">
                        <span className="osc-openshift-console-plugin__step-num" aria-hidden="true">
                          1
                        </span>
                        <div className="osc-openshift-console-plugin__step-body">
                          <div className="osc-openshift-console-plugin__step-title">
                            {t('Build the image in the cluster')}
                          </div>
                          <Content component="p" className="osc-openshift-console-plugin__muted">
                            {t(
                              'One click creates the build and starts it. Everything runs in the cluster — no podman, no copy-paste.',
                            )}
                          </Content>
                          <div className="osc-openshift-console-plugin__step-cmd">
                            <Button
                              variant="primary"
                              onClick={() => void startClusterBuild()}
                              isLoading={buildBusy}
                              isDisabled={buildBusy || buildRunning}
                            >
                              {buildRunning
                                ? t('Building…')
                                : latestBuild
                                  ? t('Rebuild in the cluster')
                                  : t('Build in the cluster')}
                            </Button>
                          </div>
                          {buildError && (
                            <Alert
                              variant="danger"
                              isInline
                              title={t('Could not start the build')}
                              className="osc-openshift-console-plugin__mt"
                            >
                              {buildError}
                            </Alert>
                          )}
                          {latestBuild && (
                            <div className="osc-openshift-console-plugin__step-cmd">
                              <Flex
                                alignItems={{ default: 'alignItemsCenter' }}
                                gap={{ default: 'gapSm' }}
                                flexWrap={{ default: 'wrap' }}
                              >
                                {buildRunning && (
                                  <FlexItem>
                                    <Spinner size="md" aria-label={t('Build running')} />
                                  </FlexItem>
                                )}
                                <FlexItem>
                                  <Label
                                    isCompact
                                    color={buildComplete ? 'green' : buildFailed ? 'red' : 'blue'}
                                  >
                                    {buildPhase}
                                  </Label>
                                </FlexItem>
                                <FlexItem>
                                  <ResourceLink
                                    groupVersionKind={BuildGVK}
                                    name={latestBuild.metadata?.name}
                                    namespace={OSC_NAMESPACE}
                                    inline
                                  />
                                </FlexItem>
                              </Flex>
                              {buildComplete && (
                                <Alert
                                  variant="success"
                                  isInline
                                  isPlain
                                  title={t('Image built — referenced in Step 2 below.')}
                                  className="osc-openshift-console-plugin__mt"
                                />
                              )}
                              {buildFailed && (
                                <Alert
                                  variant="warning"
                                  isInline
                                  isPlain
                                  title={t('Build {{phase}} — open it above to read the logs.', {
                                    phase: buildPhase,
                                  })}
                                  className="osc-openshift-console-plugin__mt"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                      <li className="osc-openshift-console-plugin__step">
                        <span className="osc-openshift-console-plugin__step-num" aria-hidden="true">
                          2
                        </span>
                        <div className="osc-openshift-console-plugin__step-body">
                          <div className="osc-openshift-console-plugin__step-title">
                            {t('Reference it in Step 2')}
                          </div>
                          <Content component="p" className="osc-openshift-console-plugin__muted">
                            {t(
                              'The image lands in the internal registry at the address below — it fills in automatically when the build finishes.',
                            )}
                          </Content>
                          <div className="osc-openshift-console-plugin__step-cmd">
                            <ClipboardCopy isReadOnly>{CLUSTER_IMAGE_REF}</ClipboardCopy>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="osc-openshift-console-plugin__mt"
                              onClick={() => {
                                setUri(CLUSTER_IMAGE_REF);
                              }}
                            >
                              {t('Use this image location')}
                            </Button>
                          </div>
                        </div>
                      </li>
                    </ol>
                    <ExpandableSection toggleText={t('Prefer the command line?')}>
                      <ClipboardCopy isReadOnly isExpanded variant="expansion">
                        {CLUSTER_BUILD}
                      </ClipboardCopy>
                    </ExpandableSection>
                    <Content
                      component="small"
                      className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mt"
                    >
                      {t(
                        'If the build fails while pulling the OSC payload, the development Containerfile may need its payload image pinned to your installed operator’s digest — see the OpenShift sandboxed containers documentation.',
                      )}
                    </Content>
                  </>
                )}
              </CardBody>
            </Card>
          </GridItem>

          {/* STEP 2 — reference the image (the persisted config) + manifest */}
          <GridItem lg={5}>
            <Card className="osc-openshift-console-plugin__mb">
              <CardTitle>
                {existing ? t('Step 2 — Edit podvm-image-cm') : t('Step 2 — Reference the image')}
              </CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Pod VM image URI')} isRequired fieldId="pvi-uri">
                    <TextInput
                      id="pvi-uri"
                      value={uri}
                      placeholder="<registry>/<your-username>/podvm-bootc:latest"
                      onChange={(_e, v) => {
                        setUri(v);
                      }}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'The full location of the image you built in Step 1 — for example quay.io/yourname/podvm-bootc:latest. The operator pulls this to create your cloud image.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

                  <FormGroup
                    label={t('Wire the image into peer pods automatically')}
                    fieldId="pvi-update"
                  >
                    <Switch
                      id="pvi-update"
                      isChecked={updatePeerPodsCm}
                      onChange={(_e, c) => {
                        setUpdatePeerPodsCm(c);
                      }}
                      label={t('Update peer-pods-cm with the finished image')}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t(
                            'Recommended. After the operator builds the cloud image, it writes the name back into peer-pods-cm so your peer pods use it. Leave on unless you set the image name yourself.',
                          )}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

                  <ExpandableSection
                    toggleText={t('Advanced options')}
                    isExpanded={advancedOpen}
                    onToggle={(_e, x) => {
                      setAdvancedOpen(x);
                    }}
                  >
                    <FormGroup label={t('Image name')} fieldId="pvi-base">
                      <TextInput
                        id="pvi-base"
                        value={baseName}
                        onChange={(_e, v) => {
                          setBaseName(v);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t('Base name for the generated cloud image. Default: podvm-image.')}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label={t('Image version')} fieldId="pvi-version">
                      <TextInput
                        id="pvi-version"
                        value={version}
                        onChange={(_e, v) => {
                          setVersion(v);
                        }}
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t('Version suffix for the generated image name. Default: 0-0-0.')}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                    <FormGroup label={t('Install extra packages')} fieldId="pvi-install">
                      <Switch
                        id="pvi-install"
                        isChecked={installPackages}
                        onChange={(_e, c) => {
                          setInstallPackages(c);
                        }}
                        label={t('Add the packages listed in the build config')}
                      />
                    </FormGroup>
                    <FormGroup label={t('Disable cloud config')} fieldId="pvi-cloudcfg">
                      <Switch
                        id="pvi-cloudcfg"
                        isChecked={disableCloudConfig}
                        onChange={(_e, c) => {
                          setDisableCloudConfig(c);
                        }}
                        label={t('Stop cloud-init from reconfiguring the VM at boot')}
                      />
                    </FormGroup>
                    <FormGroup label={t('Boot in FIPS mode')} fieldId="pvi-fips">
                      <Switch
                        id="pvi-fips"
                        isChecked={bootFips}
                        onChange={(_e, c) => {
                          setBootFips(c);
                        }}
                        label={t('Build the image to boot with FIPS enabled')}
                      />
                    </FormGroup>
                    <FormGroup label={t('Bootc build config')} fieldId="pvi-bootc">
                      <TextArea
                        id="pvi-bootc"
                        value={bootcConfig}
                        rows={10}
                        onChange={(_e, v) => {
                          setBootcConfig(v);
                        }}
                        resizeOrientation="vertical"
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            {t(
                              'Customize the image users and disk layout (bootc TOML). The defaults match the Red Hat documentation.',
                            )}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  </ExpandableSection>

                  {error && (
                    <Alert variant="danger" isInline title={t('Could not save podvm-image-cm')}>
                      {error}
                    </Alert>
                  )}

                  <ActionGroup>
                    <Button
                      variant="primary"
                      onClick={() => void save()}
                      isLoading={busy}
                      isDisabled={busy || !loaded || uri.trim() === ''}
                    >
                      {existing ? t('Save') : t('Create')}
                    </Button>
                    <Button
                      variant="link"
                      onClick={() => {
                        navigate('/sandboxes/setup');
                      }}
                    >
                      {t('Cancel')}
                    </Button>
                  </ActionGroup>
                </Form>
              </CardBody>
            </Card>
            <Card>
              <CardTitle>{t('Manifest preview')}</CardTitle>
              <CardBody>
                <CodeBlock>
                  <CodeBlockCode>{toYaml(cm)}</CodeBlockCode>
                </CodeBlock>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default PodVmImageConfigWizard;
