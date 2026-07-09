import { consoleFetchText, ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  ExpandableSection,
  List,
  ListItem,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom-v5-compat';
import { useTranslation } from 'react-i18next';
import { useCaaPodForNode, usePodEvents } from '../k8s/hooks';
import { OSC_NAMESPACE, PodGVK } from '../k8s/resources';
import { useClusterPlatform } from '../k8s/setup';
import type { PodKind } from '../k8s/types';
import {
  caaContainerName,
  cloudProviderFromPlatform,
  commonCaaCauses,
  diagnoseCaaLog,
  podWaitingText,
} from '../utils/caaDiagnostics';
import './sandbox.css';

const CAA_TAIL_LINES = 200;
// Lines worth showing from the tail — the adaptor logs a lot of reconcile noise.
const NOISE_RE = /error|fail|deadline|invalid|not available|instance|disk|quota|image_guest_pull/i;

/**
 * Diagnostics for a peer pod (`kata-remote`) that has not started. The kubelet only ever emits a
 * generic `create container timeout … unknown` Event; the real cause lives in the cloud-api-adaptor
 * (osc-caa-ds) logs or the pod's own container-waiting message. This panel frames the opaque event,
 * links to (and tails) the adaptor logs on the pod's node, and pattern-matches the common failures
 * into a plain-language cause + supported fix — including the missing-NAT-gateway case (issues #49, #50).
 */
const PeerPodDiagnostics: FC<{ pod: PodKind }> = ({ pod }) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const ns = pod.metadata?.namespace;
  const name = pod.metadata?.name;
  const nodeName = pod.spec?.nodeName;

  const [caaPod] = useCaaPodForNode(nodeName);
  const [events] = usePodEvents(ns, name);
  // The cloud the cluster runs on, so the cause/fix text names this cloud's peer-pods-cm keys and
  // egress prerequisite — never another cloud's (issue #56).
  const provider = cloudProviderFromPlatform(useClusterPlatform());

  const sandboxEvent = useMemo(
    () =>
      events.find(
        (e) =>
          e.reason === 'FailedCreatePodSandBox' ||
          /create container timeout|failedcreatepodsandbox/i.test(e.message ?? ''),
      ),
    [events],
  );

  const caaName = caaPod?.metadata?.name;
  const caaContainer = caaContainerName(caaPod);
  const [log, setLog] = useState<string | undefined>();
  const [logError, setLogError] = useState(false);
  // Derived (not stored) so the effect never calls setState synchronously — loading is simply "the
  // caa pod is known but we don't yet have its log and haven't errored".
  const logLoading = Boolean(caaName) && log === undefined && !logError;

  // Fetch the adaptor log tail through the console k8s proxy (uses the viewer's own token).
  useEffect(() => {
    if (!caaName) return;
    let cancelled = false;
    const params = new URLSearchParams({ tailLines: String(CAA_TAIL_LINES) });
    if (caaContainer) params.set('container', caaContainer);
    consoleFetchText(
      `/api/kubernetes/api/v1/namespaces/${OSC_NAMESPACE}/pods/${caaName}/log?${params.toString()}`,
    )
      .then((text) => {
        if (!cancelled) setLog(text);
      })
      .catch(() => {
        if (!cancelled) setLogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [caaName, caaContainer]);

  // Diagnose across the pod's own waiting message, the sandbox event, and the adaptor log tail — the
  // signature can surface in any of the three.
  const dx = useMemo(
    () =>
      diagnoseCaaLog(
        [podWaitingText(pod), sandboxEvent?.message, log].filter(Boolean).join('\n'),
        provider,
      ),
    [pod, sandboxEvent, log, provider],
  );

  // Only the lines that mention this pod or an error, so we don't dump 200 noisy reconcile lines.
  const relevantLog = useMemo(() => {
    if (!log) return '';
    const lines = log
      .split('\n')
      .filter((l) => NOISE_RE.test(l) || (name ? l.includes(name) : false));
    return (lines.length ? lines : log.split('\n').slice(-20)).slice(-40).join('\n');
  }, [log, name]);

  const logsHref = caaName ? `/k8s/ns/${OSC_NAMESPACE}/pods/${caaName}/logs` : undefined;

  return (
    <Card>
      <CardTitle>{t('Peer pod diagnostics')}</CardTitle>
      <CardBody>
        <Stack hasGutter>
          {sandboxEvent?.message && (
            <StackItem>
              <span className="osc-openshift-console-plugin__muted">{t('Reported event:')} </span>
              <span className="osc-openshift-console-plugin__mono">{sandboxEvent.message}</span>
            </StackItem>
          )}

          <StackItem>
            <Alert
              isInline
              variant={dx ? 'danger' : 'info'}
              title={
                dx
                  ? dx.cause
                  : t(
                      'Peer-VM provisioning errors are only in the cloud-api-adaptor logs, never in Kubernetes events.',
                    )
              }
            >
              {dx && (
                <p className="osc-openshift-console-plugin__mb">
                  {dx.fix}
                  {dx.docHref && (
                    <>
                      {' '}
                      <Button
                        variant="link"
                        isInline
                        component="a"
                        href={dx.docHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('View documentation')}
                      </Button>
                    </>
                  )}
                </p>
              )}

              {!dx && logError && (
                <>
                  <p className="osc-openshift-console-plugin__mb">{t('Common causes to check:')}</p>
                  <List>
                    {commonCaaCauses(provider).map((c) => (
                      <ListItem key={c}>{c}</ListItem>
                    ))}
                  </List>
                </>
              )}

              {caaName ? (
                <p>
                  {t('cloud-api-adaptor on node {{node}}: ', { node: nodeName ?? '—' })}
                  {logsHref && <Link to={logsHref}>{t('View adaptor logs')}</Link>}
                  {' · '}
                  <ResourceLink
                    groupVersionKind={PodGVK}
                    name={caaName}
                    namespace={OSC_NAMESPACE}
                    linkTo
                    inline
                  />
                </p>
              ) : (
                <p className="osc-openshift-console-plugin__muted">
                  {t('Could not locate the osc-caa-ds pod for node {{node}}.', {
                    node: nodeName ?? '—',
                  })}
                </p>
              )}
            </Alert>
          </StackItem>

          {logLoading && (
            <StackItem>
              <Spinner size="md" /> {t('Reading cloud-api-adaptor logs…')}
            </StackItem>
          )}

          {relevantLog && (
            <StackItem>
              <ExpandableSection toggleText={t('cloud-api-adaptor log tail')}>
                <CodeBlock>
                  <CodeBlockCode>{relevantLog}</CodeBlockCode>
                </CodeBlock>
              </ExpandableSection>
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
};

export default PeerPodDiagnostics;
