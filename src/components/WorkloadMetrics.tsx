import { PrometheusEndpoint, usePrometheusPoll } from '@openshift-console/dynamic-plugin-sdk';
import { Card, CardBody, CardTitle, Grid, GridItem } from '@patternfly/react-core';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import './sandbox.css';

/** Minimal dependency-free sparkline from a series of numbers. */
const Sparkline: FC<{ values: number[]; color: string }> = ({ values, color }) => {
  if (!values.length) return <div className="osc-plugin__muted">—</div>;
  const w = 240;
  const h = 48;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="osc-plugin__spark" role="img">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
};

const useSeries = (query: string, namespace: string): { values: number[]; last?: number } => {
  const [response] = usePrometheusPoll({
    endpoint: PrometheusEndpoint.QUERY_RANGE,
    query,
    namespace,
    timespan: 30 * 60 * 1000,
  });
  const raw = (response?.data?.result?.[0]?.values ?? []) as [number, string][];
  const values = raw.map(([, v]) => Number(v)).filter((n) => !Number.isNaN(n));
  return { values, last: values[values.length - 1] };
};

const MetricCard: FC<{
  title: string;
  query: string;
  namespace: string;
  color: string;
  format: (n?: number) => string;
}> = ({ title, query, namespace, color, format }) => {
  const { values, last } = useSeries(query, namespace);
  return (
    <Card isCompact>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        <div className="osc-plugin__stat-value">{format(last)}</div>
        <Sparkline values={values} color={color} />
      </CardBody>
    </Card>
  );
};

/**
 * Live CPU/memory for a sandboxed workload. For Pods the queries are exact;
 * for Deployments we match pods by name prefix.
 */
export const WorkloadMetrics: FC<{
  kind: 'Pod' | 'Deployment';
  name: string;
  namespace: string;
  isPeerPod: boolean;
}> = ({ kind, name, namespace, isPeerPod }) => {
  const { t } = useTranslation('plugin__osc-plugin');
  const podSel = kind === 'Pod' ? `pod="${name}"` : `pod=~"${name}-.*"`;
  const base = `namespace="${namespace}",${podSel},container!="",container!="POD"`;
  const cpuQuery = `sum(rate(container_cpu_usage_seconds_total{${base}}[2m]))`;
  const memQuery = `sum(container_memory_working_set_bytes{${base}})`;

  return (
    <>
      {isPeerPod && (
        <p className="osc-plugin__muted osc-plugin__mb">
          {t(
            'Note: peer pods run in a remote VM, so node-side metrics may not reflect in-VM usage.',
          )}
        </p>
      )}
      <Grid hasGutter>
        <GridItem span={6}>
          <MetricCard
            title={t('CPU usage (cores)')}
            query={cpuQuery}
            namespace={namespace}
            color="var(--pf-t--global--icon--color--status--info--default, #2b9af3)"
            format={(n) => (n === undefined ? '—' : n.toFixed(3))}
          />
        </GridItem>
        <GridItem span={6}>
          <MetricCard
            title={t('Memory (working set)')}
            query={memQuery}
            namespace={namespace}
            color="var(--pf-t--global--icon--color--status--success--default, #3e8635)"
            format={(n) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} MiB`)}
          />
        </GridItem>
      </Grid>
    </>
  );
};
