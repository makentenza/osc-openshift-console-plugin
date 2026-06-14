import { Timestamp, useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { Card, CardBody, CardTitle, Flex, FlexItem, Label, Skeleton } from '@patternfly/react-core';
import { ExclamationTriangleIcon, InfoCircleIcon } from '@patternfly/react-icons';
import type { FC } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EventGVK, OSC_NAMESPACE } from '../k8s/resources';
import type { EventKind } from '../k8s/types';
import './sandbox.css';

const RecentEventsCard: FC<{ limit?: number }> = ({ limit = 5 }) => {
  const { t } = useTranslation('plugin__osc-openshift-console-plugin');
  const [events, loaded] = useK8sWatchResource<EventKind[]>({
    groupVersionKind: EventGVK,
    namespace: OSC_NAMESPACE,
    isList: true,
  });

  const recent = useMemo(
    () =>
      [...(events ?? [])]
        .sort((a, b) =>
          (b.lastTimestamp ?? b.eventTime ?? '').localeCompare(
            a.lastTimestamp ?? a.eventTime ?? '',
          ),
        )
        .slice(0, limit),
    [events, limit],
  );

  return (
    <Card>
      <CardTitle>{t('Recent events')}</CardTitle>
      <CardBody>
        {!loaded ? (
          <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} height="1.25rem" />
            ))}
          </Flex>
        ) : recent.length === 0 ? (
          <span className="osc-openshift-console-plugin__muted">{t('No recent events.')}</span>
        ) : (
          <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
            {recent.map((ev) => (
              <Flex
                key={ev.metadata?.uid}
                alignItems={{ default: 'alignItemsCenter' }}
                gap={{ default: 'gapSm' }}
              >
                <FlexItem>
                  {ev.type === 'Warning' ? (
                    <ExclamationTriangleIcon className="osc-openshift-console-plugin__icon-warning" />
                  ) : (
                    <InfoCircleIcon className="osc-openshift-console-plugin__icon-info" />
                  )}
                </FlexItem>
                <FlexItem>
                  <Label isCompact>{ev.reason}</Label>
                </FlexItem>
                <FlexItem grow={{ default: 'grow' }}>
                  <span className="osc-openshift-console-plugin__event-message">{ev.message}</span>
                </FlexItem>
                <FlexItem>
                  <Timestamp
                    timestamp={ev.lastTimestamp ?? ev.eventTime}
                    className="osc-openshift-console-plugin__muted"
                  />
                </FlexItem>
              </Flex>
            ))}
          </Flex>
        )}
      </CardBody>
    </Card>
  );
};

export default RecentEventsCard;
