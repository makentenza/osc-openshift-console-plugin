import { DocumentTitle, ListPageHeader, ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Label,
  PageSection,
  Spinner,
} from '@patternfly/react-core';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InfoCircleIcon,
  PlusCircleIcon,
} from '@patternfly/react-icons';
import type { FC, ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useKataConfig } from '../k8s/hooks';
import { usePeerPodsCm, usePodvmImageCm, useClusterPlatform } from '../k8s/setup';
import { KataConfigGVK } from '../k8s/resources';
import { kataConfigReadiness } from '../utils/status';
import OpenPeerPodsFirewall from './OpenPeerPodsFirewall';
import './sandbox.css';

type Status = 'done' | 'todo' | 'warn' | 'info';

interface Step {
  title: string;
  status: Status;
  detail: ReactNode;
  action?: { label: string; href: string };
}

const StatusIcon: FC<{ status: Status }> = ({ status }) => {
  if (status === 'done')
    return (
      <CheckCircleIcon
        className="osc-openshift-console-plugin__icon-info"
        color="var(--pf-t--global--icon--color--status--success--default)"
      />
    );
  if (status === 'warn')
    return <ExclamationTriangleIcon className="osc-openshift-console-plugin__icon-warning" />;
  if (status === 'info')
    return (
      <InfoCircleIcon
        className="osc-openshift-console-plugin__icon-info"
        color="var(--pf-t--global--icon--color--status--info--default)"
      />
    );
  return <PlusCircleIcon className="osc-openshift-console-plugin__muted" />;
};

const OscSetup: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [kataConfig] = useKataConfig();
  const [peerPodsCm] = usePeerPodsCm();
  const [podvmImageCm] = usePodvmImageCm();
  const platform = useClusterPlatform();

  const ppData = peerPodsCm?.data ?? {};
  const ppProvider = ppData.CLOUD_PROVIDER;
  const peerPodsEnabled = Boolean(kataConfig?.spec?.enablePeerPods);
  const kata = kataConfigReadiness(kataConfig);
  const podvmImageName = ppData.PODVM_IMAGE_NAME ?? ppData.PODVM_AMI_ID ?? ppData.AZURE_IMAGE_ID;
  const podvmImageReady = Boolean(podvmImageCm) || Boolean(podvmImageName);

  const steps: Step[] = [
    {
      title: t('OpenShift sandboxed containers operator'),
      status: 'done',
      detail: t('Installed — the KataConfig CRD is present on this cluster.'),
    },
    {
      title: t('Open the peer pods port'),
      status: 'info',
      detail: <OpenPeerPodsFirewall />,
    },
    {
      title: t('Peer pods config map'),
      status: ppProvider ? 'done' : 'todo',
      detail: ppProvider
        ? t('peer-pods-cm is configured for {{provider}}.', { provider: ppProvider })
        : t('Set the cloud provider, networking, and pod VM sizing the cloud-api-adaptor uses.'),
      action: {
        label: ppProvider ? t('Edit peer pods config') : t('Configure peer pods'),
        href: '/sandboxes/setup/peer-pods',
      },
    },
    {
      title: t('Pod VM image'),
      status: podvmImageReady ? 'done' : ppProvider ? 'warn' : 'todo',
      detail: podvmImageName ? (
        <span className="osc-openshift-console-plugin__mono">{podvmImageName}</span>
      ) : podvmImageCm ? (
        t('podvm-image-cm is set — the operator will register the image and update peer-pods-cm.')
      ) : (
        t('Build a pod VM image, then create podvm-image-cm so peer pods have an image to boot.')
      ),
      action: {
        label: podvmImageCm ? t('Edit pod VM image') : t('Configure pod VM image'),
        href: '/sandboxes/setup/podvm-image',
      },
    },
    {
      title: t('KataConfig'),
      // Creating the object only starts a node-by-node rollout — stay "in progress" (not green)
      // until the runtime is actually installed and registered (issue #6).
      status:
        kata.phase === 'absent'
          ? 'todo'
          : kata.phase === 'ready'
            ? 'done'
            : kata.phase === 'failed'
              ? 'warn'
              : 'info',
      detail:
        kata.phase === 'absent' ? (
          t(
            'Install the kata runtime on your workers by creating a KataConfig with peer pods enabled. Each node reboots to install it, so this takes a few minutes.',
          )
        ) : (
          <>
            <Flex
              alignItems={{ default: 'alignItemsCenter' }}
              gap={{ default: 'gapSm' }}
              flexWrap={{ default: 'wrap' }}
            >
              <FlexItem>
                <ResourceLink
                  groupVersionKind={KataConfigGVK}
                  name={kataConfig?.metadata?.name}
                  inline
                />
              </FlexItem>
              {kata.phase === 'installing' && (
                <>
                  <FlexItem>
                    <Spinner size="md" aria-label={t('Installing the kata runtime')} />
                  </FlexItem>
                  <FlexItem>
                    <Label isCompact color="blue">
                      {kata.totalNodes > 0
                        ? t('installing — {{ready}}/{{total}} nodes ready', {
                            ready: kata.readyNodes,
                            total: kata.totalNodes,
                          })
                        : t('installing…')}
                    </Label>
                  </FlexItem>
                </>
              )}
              {kata.phase === 'ready' && (
                <FlexItem>
                  <Label isCompact color="green">
                    {t('runtime ready')}
                  </Label>
                </FlexItem>
              )}
              {kata.phase === 'failed' && (
                <FlexItem>
                  <Label isCompact color="red">
                    {t('install failed on {{nodes}} node(s)', { nodes: kata.failedNodes })}
                  </Label>
                </FlexItem>
              )}
              <FlexItem>
                <Label isCompact color={peerPodsEnabled ? 'green' : 'orange'}>
                  {peerPodsEnabled ? t('peer pods enabled') : t('peer pods off')}
                </Label>
              </FlexItem>
            </Flex>
            {kata.phase === 'installing' && (
              <div className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mt">
                {t(
                  'Nodes reboot during install, so this can take several minutes depending on how many workers you have. The step turns green once the runtime is ready.',
                )}
              </div>
            )}
          </>
        ),
      action:
        kata.phase === 'absent'
          ? { label: t('Create KataConfig'), href: '/sandboxes/setup/kataconfig' }
          : undefined,
    },
    {
      title: t('Run a sandboxed workload'),
      // Only offer this once the runtime is genuinely ready — not just because the object exists.
      status: kata.ready ? 'info' : 'todo',
      detail: kata.ready
        ? t('Deploy a workload with runtimeClassName: kata-remote to run it in a pod VM.')
        : kata.phase === 'absent'
          ? t('Available once the KataConfig install completes and kata-remote is registered.')
          : t('Waiting for the kata runtime to finish installing before workloads can run.'),
      action: kata.ready
        ? { label: t('Create workload'), href: '/sandboxes/workloads/~new' }
        : undefined,
    },
  ];

  return (
    <>
      <DocumentTitle>{t('Sandboxes setup')}</DocumentTitle>
      <ListPageHeader title={t('Sandboxes setup')} />
      <PageSection>
        <Card>
          <CardTitle>
            {t('Configuration checklist')}
            {platform && (
              <>
                {' '}
                <Label className="osc-openshift-console-plugin__mono" isCompact>
                  {platform}
                </Label>
              </>
            )}
          </CardTitle>
          <CardBody>
            <Flex direction={{ default: 'column' }} gap={{ default: 'gapLg' }}>
              {steps.map((step) => (
                <FlexItem key={step.title}>
                  <Flex
                    alignItems={{ default: 'alignItemsCenter' }}
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                  >
                    <FlexItem grow={{ default: 'grow' }}>
                      <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                        <FlexItem>
                          <StatusIcon status={step.status} />
                        </FlexItem>
                        <FlexItem>
                          <strong>{step.title}</strong>
                          <div className="osc-openshift-console-plugin__muted">{step.detail}</div>
                        </FlexItem>
                      </Flex>
                    </FlexItem>
                    {step.action && (
                      <FlexItem>
                        <Link to={step.action.href}>
                          <Button
                            variant={step.status === 'done' ? 'secondary' : 'primary'}
                            icon={<ArrowRightIcon />}
                            iconPosition="end"
                          >
                            {step.action.label}
                          </Button>
                        </Link>
                      </FlexItem>
                    )}
                  </Flex>
                </FlexItem>
              ))}
            </Flex>
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
};

export default OscSetup;
