import { kataConfigReadiness } from './status';
import type { KataConfigKind } from '../k8s/types';

const kc = (status: KataConfigKind['status']): KataConfigKind => ({
  apiVersion: 'kataconfiguration.openshift.io/v1',
  kind: 'KataConfig',
  metadata: { name: 'example-kataconfig' },
  status,
});

describe('kataConfigReadiness', () => {
  it('reports absent when there is no KataConfig', () => {
    const r = kataConfigReadiness(undefined);
    expect(r.phase).toBe('absent');
    expect(r.ready).toBe(false);
  });

  it('is installing while the InProgress condition is True', () => {
    const r = kataConfigReadiness(
      kc({
        conditions: [{ type: 'InProgress', status: 'True' }],
        kataNodes: { nodeCount: 4, readyNodeCount: 1 },
      }),
    );
    expect(r.phase).toBe('installing');
    expect(r.ready).toBe(false);
    expect(r.readyNodes).toBe(1);
    expect(r.totalNodes).toBe(4);
  });

  it('is installing when status has not populated yet (nascent object)', () => {
    const r = kataConfigReadiness(kc({}));
    expect(r.phase).toBe('installing');
    expect(r.ready).toBe(false);
  });

  it('is installing when settled but not every node is ready yet', () => {
    const r = kataConfigReadiness(
      kc({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 4, readyNodeCount: 3 },
        runtimeClasses: ['kata', 'kata-remote'],
      }),
    );
    expect(r.phase).toBe('installing');
    expect(r.ready).toBe(false);
  });

  it('is ready when settled, all nodes installed, and runtime classes registered', () => {
    const r = kataConfigReadiness(
      kc({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: {
          nodeCount: 4,
          readyNodeCount: 4,
          installed: ['n1', 'n2', 'n3', 'n4'],
        },
        runtimeClasses: ['kata-cc', 'kata', 'kata-remote'],
      }),
    );
    expect(r.phase).toBe('ready');
    expect(r.ready).toBe(true);
    expect(r.readyNodes).toBe(4);
    expect(r.totalNodes).toBe(4);
  });

  it('is not ready when settled with all nodes counted but no runtime classes registered', () => {
    const r = kataConfigReadiness(
      kc({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 4, readyNodeCount: 4 },
        runtimeClasses: [],
      }),
    );
    expect(r.phase).toBe('installing');
    expect(r.ready).toBe(false);
  });

  it('is failed when the rollout settles with nodes in failedToInstall', () => {
    const r = kataConfigReadiness(
      kc({
        conditions: [{ type: 'InProgress', status: 'False' }],
        kataNodes: { nodeCount: 4, readyNodeCount: 2, failedToInstall: ['n3', 'n4'] },
        runtimeClasses: ['kata'],
      }),
    );
    expect(r.phase).toBe('failed');
    expect(r.ready).toBe(false);
    expect(r.failedNodes).toBe(2);
  });

  it('stays installing (not failed) while still in progress even if a node transiently failed', () => {
    const r = kataConfigReadiness(
      kc({
        conditions: [{ type: 'InProgress', status: 'True' }],
        kataNodes: { nodeCount: 4, readyNodeCount: 1, failedToInstall: ['n2'] },
      }),
    );
    expect(r.phase).toBe('installing');
  });
});
