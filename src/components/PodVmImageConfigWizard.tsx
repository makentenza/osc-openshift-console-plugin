import {
  DocumentTitle,
  k8sCreate,
  k8sUpdate,
  ListPageHeader,
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
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  HelperText,
  HelperTextItem,
  PageSection,
  Switch,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { ConfigMapModel, OSC_NAMESPACE, PODVM_IMAGE_CM } from '../k8s/resources';
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

const BUILD_COMMANDS = `# Build the pod VM image off-cluster (needs podman + registry access), then push it.
git clone https://github.com/openshift/sandboxed-containers-operator.git
cd sandboxed-containers-operator/config/peerpods/podvm/bootc

# Containerfile.rhel pulls from registry.redhat.io
podman login registry.redhat.io
IMG="<container_registry_url>/<username>/podvm-bootc:latest"
podman build -t "\${IMG}" -f Containerfile.rhel .

# Push to your own registry, then paste \${IMG} into "Pod VM image URI".
podman login <container_registry_url>
podman push "\${IMG}"`;

const PodVmImageConfigWizard: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const navigate = useNavigate();
  const [existing, loaded] = usePodvmImageCm();

  const d = existing?.data ?? {};
  const [imageType, setImageType] = useState(d.IMAGE_TYPE ?? 'pre-built');
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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
        <Alert
          variant="info"
          isInline
          title={t('Build the image first, then reference it here')}
          className="osc-openshift-console-plugin__mb"
        >
          {t(
            'Peer pods boot from a prebuilt QCOW2 pod VM image. The console cannot build it — run the commands below on a workstation with podman, push the image to your registry, then paste its URI into this form. With UPDATE_PEERPODS_CM enabled, the operator writes the resulting image into the peer-pods-cm automatically.',
          )}
        </Alert>
        <Grid hasGutter>
          <GridItem md={6}>
            <Card>
              <CardTitle>
                {existing ? t('Edit podvm-image-cm') : t('Create podvm-image-cm')}
              </CardTitle>
              <CardBody>
                <Form>
                  <FormGroup label={t('Image type')} fieldId="pvi-type">
                    <FormSelect
                      id="pvi-type"
                      value={imageType}
                      onChange={(_e, v) => {
                        setImageType(v);
                      }}
                    >
                      <FormSelectOption value="pre-built" label="pre-built" />
                    </FormSelect>
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t('The operator registers the image you built and pushed (pre-built).')}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

                  <FormGroup label={t('Pod VM image URI')} isRequired fieldId="pvi-uri">
                    <TextInput
                      id="pvi-uri"
                      value={uri}
                      placeholder="<registry>/<username>/podvm-bootc:latest"
                      onChange={(_e, v) => {
                        setUri(v);
                      }}
                    />
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {t('PODVM_IMAGE_URI — the image you pushed in the build step.')}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  </FormGroup>

                  <FormGroup label={t('Update peer-pods-cm')} fieldId="pvi-update">
                    <Switch
                      id="pvi-update"
                      isChecked={updatePeerPodsCm}
                      onChange={(_e, c) => {
                        setUpdatePeerPodsCm(c);
                      }}
                      label={t('Let the operator write the built image into peer-pods-cm')}
                    />
                  </FormGroup>

                  <ExpandableSection
                    toggleText={t('Advanced options')}
                    isExpanded={advancedOpen}
                    onToggle={(_e, x) => {
                      setAdvancedOpen(x);
                    }}
                  >
                    <FormGroup label={t('Image base name')} fieldId="pvi-base">
                      <TextInput
                        id="pvi-base"
                        value={baseName}
                        onChange={(_e, v) => {
                          setBaseName(v);
                        }}
                      />
                    </FormGroup>
                    <FormGroup label={t('Image version')} fieldId="pvi-version">
                      <TextInput
                        id="pvi-version"
                        value={version}
                        onChange={(_e, v) => {
                          setVersion(v);
                        }}
                      />
                    </FormGroup>
                    <FormGroup label={t('Install packages')} fieldId="pvi-install">
                      <Switch
                        id="pvi-install"
                        isChecked={installPackages}
                        onChange={(_e, c) => {
                          setInstallPackages(c);
                        }}
                        label={t('INSTALL_PACKAGES')}
                      />
                    </FormGroup>
                    <FormGroup label={t('Disable cloud config')} fieldId="pvi-cloudcfg">
                      <Switch
                        id="pvi-cloudcfg"
                        isChecked={disableCloudConfig}
                        onChange={(_e, c) => {
                          setDisableCloudConfig(c);
                        }}
                        label={t('DISABLE_CLOUD_CONFIG')}
                      />
                    </FormGroup>
                    <FormGroup label={t('Boot in FIPS mode')} fieldId="pvi-fips">
                      <Switch
                        id="pvi-fips"
                        isChecked={bootFips}
                        onChange={(_e, c) => {
                          setBootFips(c);
                        }}
                        label={t('BOOT_FIPS')}
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
                            {t('BOOTC_BUILD_CONFIG — user and filesystem customizations (TOML).')}
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
          </GridItem>
          <GridItem md={6}>
            <Card className="osc-openshift-console-plugin__mb">
              <CardTitle>{t('Build the image')}</CardTitle>
              <CardBody>
                <ClipboardCopy
                  isReadOnly
                  isExpanded
                  variant="expansion"
                  hoverTip={t('Copy')}
                  clickTip={t('Copied')}
                >
                  {BUILD_COMMANDS}
                </ClipboardCopy>
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
