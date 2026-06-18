import {
  namespacePhase,
  parseEnvLines,
  parseKeyValueLines,
  suggestWorkloadName,
  workloadNameExists,
} from './workload';
import type { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

const named = (...names: string[]): K8sResourceCommon[] =>
  names.map((name) => ({ metadata: { name } }));

describe('workloadNameExists', () => {
  const pods = named('alpha', 'beta');
  const deployments = named('gamma');

  it('flags a Pod name that already exists among Pods', () => {
    expect(workloadNameExists('Pod', 'alpha', pods, deployments)).toBe(true);
  });

  it('does not flag a Pod name that only exists as a Deployment (independent kinds)', () => {
    expect(workloadNameExists('Pod', 'gamma', pods, deployments)).toBe(false);
  });

  it('flags a Deployment name that already exists among Deployments', () => {
    expect(workloadNameExists('Deployment', 'gamma', pods, deployments)).toBe(true);
  });

  it('does not flag a name that exists only as a Pod when creating a Deployment', () => {
    expect(workloadNameExists('Deployment', 'alpha', pods, deployments)).toBe(false);
  });

  it('returns false for a free name', () => {
    expect(workloadNameExists('Pod', 'delta', pods, deployments)).toBe(false);
  });
});

describe('namespacePhase', () => {
  const nsList = [
    { metadata: { name: 'default' }, status: { phase: 'Active' } },
    { metadata: { name: 'closing' }, status: { phase: 'Terminating' } },
    { metadata: { name: 'nostatus' } },
  ];

  it('returns unknown until the namespace list has loaded', () => {
    expect(namespacePhase('default', [], false)).toBe('unknown');
  });

  it('reports active for an Active namespace', () => {
    expect(namespacePhase('default', nsList, true)).toBe('active');
  });

  it('reports terminating for a Terminating namespace', () => {
    expect(namespacePhase('closing', nsList, true)).toBe('terminating');
  });

  it('reports missing when the namespace is absent from a loaded list', () => {
    expect(namespacePhase('ghost', nsList, true)).toBe('missing');
  });

  it('treats a namespace with no status phase as active', () => {
    expect(namespacePhase('nostatus', nsList, true)).toBe('active');
  });
});

describe('suggestWorkloadName', () => {
  it('appends a suffix to the base and is a valid RFC 1123 label', () => {
    const name = suggestWorkloadName();
    expect(name).toMatch(/^my-sandbox-[a-z0-9]+$/);
  });

  it('respects a custom base', () => {
    expect(suggestWorkloadName('demo')).toMatch(/^demo-[a-z0-9]+$/);
  });

  it('produces different names across calls', () => {
    const a = suggestWorkloadName();
    const b = suggestWorkloadName();
    expect(a).not.toBe(b);
  });
});

describe('parseEnvLines', () => {
  it('parses KEY=value lines into env entries', () => {
    expect(parseEnvLines('FOO=bar\nBAZ=qux')).toEqual([
      { name: 'FOO', value: 'bar' },
      { name: 'BAZ', value: 'qux' },
    ]);
  });

  it('keeps everything after the first = (values may contain =)', () => {
    expect(parseEnvLines('URL=https://x?a=b')).toEqual([{ name: 'URL', value: 'https://x?a=b' }]);
  });

  it('skips blank lines, lines without =, and empty keys', () => {
    expect(parseEnvLines('FOO=bar\n\nnotavar\n=novalue\n  ')).toEqual([
      { name: 'FOO', value: 'bar' },
    ]);
  });

  it('trims surrounding whitespace on key and value', () => {
    expect(parseEnvLines('  FOO = bar  ')).toEqual([{ name: 'FOO', value: 'bar' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseEnvLines('')).toEqual([]);
  });
});

describe('parseKeyValueLines', () => {
  it('parses KEY=value lines into a string map', () => {
    expect(parseKeyValueLines('tier=frontend\nteam=payments')).toEqual({
      tier: 'frontend',
      team: 'payments',
    });
  });

  it('lets a later duplicate key win', () => {
    expect(parseKeyValueLines('app=a\napp=b')).toEqual({ app: 'b' });
  });

  it('skips blank and malformed lines, and keeps = in values', () => {
    expect(parseKeyValueLines('k=v=1\n\njunk\n=novalue')).toEqual({ k: 'v=1' });
  });

  it('returns an empty object for empty input', () => {
    expect(parseKeyValueLines('')).toEqual({});
  });
});
