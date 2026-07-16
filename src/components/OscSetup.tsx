import { DocumentTitle, ListPageHeader, ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  CodeBlock,
  CodeBlockCode,
  Content,
  ExpandableSection,
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
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useKataConfig } from '../k8s/hooks';
import {
  setFirewallOpened,
  useClusterPlatform,
  useFirewallOpened,
  usePeerPodsCm,
  useResolvedDeploymentMode,
} from '../k8s/setup';
import { KataConfigGVK, OSC_NAMESPACE, PODVM_IMAGE_JOB } from '../k8s/resources';
import { modeWillReboot } from '../utils/deploymentMode';
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
    return <CheckCircleIcon className="osc-openshift-console-plugin__icon-success" />;
  if (status === 'warn')
    return <ExclamationTriangleIcon className="osc-openshift-console-plugin__icon-warning" />;
  if (status === 'info')
    return <InfoCircleIcon className="osc-openshift-console-plugin__icon-info" />;
  return <PlusCircleIcon className="osc-openshift-console-plugin__muted" />;
};

/**
 * Opening the peer pods firewall ports is manual — the plugin can't see a cloud firewall rule
 * (especially on AWS/Azure) — so let the user mark the step done. That turns the check green and
 * keeps the checklist consistent with every other step (issue #13). Persisted in-cluster via the
 * setup ConfigMap, so it's shared across admins and survives reloads.
 */
const FirewallDoneToggle: FC<{ opened: boolean }> = ({ opened }) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [busy, setBusy] = useState(false);
  const toggle = async (checked: boolean) => {
    setBusy(true);
    try {
      await setFirewallOpened(checked);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Checkbox
      id="osc-firewall-done"
      className="osc-openshift-console-plugin__mt"
      isChecked={opened}
      isDisabled={busy}
      onChange={(_e, checked) => void toggle(checked)}
      label={t('Mark this step as done')}
      description={t(
        'Tick this once you have opened the firewall ports in your cloud — it turns the step green. The GCP "Apply in cluster" action ticks it for you.',
      )}
    />
  );
};

// §3.4 troubleshooting: the operator builds the pod VM image in a Job; surface its events and logs
// for when the image hasn't shown up yet.
const PODVM_IMAGE_TROUBLESHOOT_CLI = [
  `oc get events -n ${OSC_NAMESPACE} \\`,
  `  --field-selector involvedObject.name=${PODVM_IMAGE_JOB}`,
  `oc logs -n ${OSC_NAMESPACE} jobs/${PODVM_IMAGE_JOB}`,
].join('\n');

const PodvmImageTroubleshoot: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [open, setOpen] = useState(false);
  return (
    <ExpandableSection
      toggleText={t('Taking too long? Troubleshoot the image build')}
      isExpanded={open}
      onToggle={(_e, x) => {
        setOpen(x);
      }}
      className="osc-openshift-console-plugin__mt"
    >
      <Content component="p" className="osc-openshift-console-plugin__muted">
        {t(
          'The operator builds the image in a Job. If it has not appeared after a few minutes, check the Job events and logs:',
        )}
      </Content>
      <CodeBlock>
        <CodeBlockCode>{PODVM_IMAGE_TROUBLESHOOT_CLI}</CodeBlockCode>
      </CodeBlock>
    </ExpandableSection>
  );
};

const OscSetup: FC = () => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [kataConfig] = useKataConfig();
  const [peerPodsCm] = usePeerPodsCm();
  const platform = useClusterPlatform();
  const [firewallOpened] = useFirewallOpened();
  // How the operator installs the runtime here — DaemonSet installs live, MachineConfig drains and
  // reboots. Same resolution the KataConfig wizard uses, so the two screens can't contradict each
  // other about rebooting (issue #58). undefined until known: say nothing rather than guess wrong.
  const willReboot = modeWillReboot(useResolvedDeploymentMode());

  const ppData = peerPodsCm?.data ?? {};
  const ppProvider = ppData.CLOUD_PROVIDER;
  const ppConfigured = Boolean(ppProvider);
  const peerPodsEnabled = Boolean(kataConfig?.spec?.enablePeerPods);
  const kata = kataConfigReadiness(kataConfig);
  const podvmImageName = ppData.PODVM_IMAGE_NAME ?? ppData.PODVM_AMI_ID ?? ppData.AZURE_IMAGE_ID;

  // peer-pods-cm must exist *before* KataConfig: the operator reads it while reconciling, and a
  // KataConfig created first comes up without peer pods wired and has to be recreated. This template
  // installs the kata-remote (peer pods) runtime, so gate the Create-KataConfig CTA until
  // peer-pods-cm is configured (issue: peer-pods-cm ordering). Once KataConfig exists the order no
  // longer matters, so only guard while it's still absent.
  const blockedOnPeerPodsCm = kata.phase === 'absent' && !ppConfigured;
  // A node-count-aware estimate while KataConfig is rolling out.
  const installingNodeCount = kata.totalNodes > 0 ? kata.totalNodes : undefined;

  // What creating a KataConfig will do to the user's nodes. A DaemonSet install touches neither, so
  // the reboot copy would be plainly false on a hosted cluster.
  const createKataDetail = (): string =>
    willReboot === true
      ? t(
          'Install the kata runtime on your workers by creating a KataConfig with peer pods enabled. Each node reboots to install it, so this takes a few minutes.',
        )
      : willReboot === false
        ? t(
            'Install the kata runtime on your workers by creating a KataConfig with peer pods enabled. A DaemonSet installs it live, without draining or rebooting nodes, so this takes a few minutes.',
          )
        : t(
            'Install the kata runtime on your workers by creating a KataConfig with peer pods enabled. This takes a few minutes.',
          );

  // The same distinction while it rolls out — a reboot window is a much longer wait than a
  // DaemonSet rollout, so the estimate has to follow the mode too.
  const installingDetail = (): string => {
    if (willReboot === undefined) return t('The runtime is installing on each worker.');
    if (willReboot)
      return installingNodeCount
        ? t(
            'Each node drains and reboots to install the runtime — expect roughly 5–20 min for {{nodes}} worker(s).',
            { nodes: installingNodeCount },
          )
        : t(
            'Each node drains and reboots to install the runtime — expect roughly 5–20 min per worker.',
          );
    return installingNodeCount
      ? t(
          'Each worker installs the runtime live via a DaemonSet — no drain or reboot. Usually a few minutes for {{nodes}} worker(s).',
          { nodes: installingNodeCount },
        )
      : t(
          'Each worker installs the runtime live via a DaemonSet — no drain or reboot. Usually a few minutes.',
        );
  };

  const steps: Step[] = [
    {
      title: t('OpenShift sandboxed containers operator'),
      // Every Sandboxes route is gated by the OSC_KATACONFIG flag (KataConfig CRD present), so the
      // operator is installed whenever this page renders — this step is always done (issue #54).
      status: 'done',
      detail: t('Installed — the KataConfig CRD is present on this cluster.'),
    },
    {
      title: t('Open the peer pods port'),
      status: firewallOpened ? 'done' : 'info',
      detail: (
        <>
          <OpenPeerPodsFirewall />
          <FirewallDoneToggle opened={firewallOpened} />
        </>
      ),
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
      title: t('KataConfig'),
      // Creating the object only starts a node-by-node rollout — stay "in progress" (not green)
      // until the runtime is actually installed and registered (issue #6).
      status: kata.blockedByExistingPods
        ? 'warn'
        : kata.phase === 'absent'
          ? 'todo'
          : kata.phase === 'ready'
            ? 'done'
            : kata.phase === 'failed'
              ? 'warn'
              : 'info',
      detail:
        kata.phase === 'absent' ? (
          <>
            {createKataDetail()}
            {blockedOnPeerPodsCm && (
              <div className="osc-openshift-console-plugin__mt">
                <ExclamationTriangleIcon className="osc-openshift-console-plugin__icon-warning" />{' '}
                {t(
                  'Configure the peer pods config map first. The operator reads peer-pods-cm while installing KataConfig — creating KataConfig before it means recreating KataConfig later.',
                )}
              </div>
            )}
          </>
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
                {installingDetail()} {t('The step turns green once the runtime is ready.')}
              </div>
            )}
            {kata.blockedByExistingPods && (
              <div className="osc-openshift-console-plugin__mt">
                <ExclamationTriangleIcon className="osc-openshift-console-plugin__icon-warning" />{' '}
                {t(
                  'Existing pods still use the kata-remote runtime class, which blocks deleting this KataConfig. Delete those workloads first, then retry.',
                )}{' '}
                <Link to="/sandboxes/workloads">{t('View sandboxed workloads')}</Link>
              </div>
            )}
          </>
        ),
      // Gate the CTA until peer-pods-cm exists so users can't create KataConfig in the wrong order.
      action:
        kata.phase === 'absent' && !blockedOnPeerPodsCm
          ? { label: t('Create KataConfig'), href: '/sandboxes/setup/kataconfig' }
          : undefined,
    },
    {
      title: t('Pod VM image'),
      // The operator builds and registers the pod VM image itself once KataConfig installs — there
      // is no manual build step. Just surface the image it generated (issue #7).
      status: podvmImageName ? 'done' : 'info',
      detail: podvmImageName ? (
        <>
          <span className="osc-openshift-console-plugin__mono">{podvmImageName}</span>
          <div className="osc-openshift-console-plugin__muted osc-openshift-console-plugin__mt">
            {t(
              'Registered automatically by the operator — peer pods boot from this image. No manual build needed.',
            )}
          </div>
        </>
      ) : kata.ready ? (
        <>
          {t(
            'KataConfig is installed — the operator is registering the pod VM image. It appears here automatically once ready.',
          )}
          <PodvmImageTroubleshoot />
        </>
      ) : (
        t(
          'No action needed — the operator builds and registers the pod VM image automatically when KataConfig finishes installing.',
        )
      ),
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
            {t('Setup checklist')}
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
