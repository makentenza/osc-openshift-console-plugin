import { toGcpNetworkPath } from './gcp';

describe('toGcpNetworkPath', () => {
  it('qualifies a bare network name with the project (issue #11)', () => {
    expect(toGcpNetworkPath('cluster-vqbc6-jzfhk-network', 'cluster-vqbc6')).toBe(
      'projects/cluster-vqbc6/global/networks/cluster-vqbc6-jzfhk-network',
    );
  });

  it('leaves an already-qualified resource path unchanged', () => {
    const full = 'projects/cluster-vqbc6/global/networks/cluster-vqbc6-jzfhk-network';
    expect(toGcpNetworkPath(full, 'cluster-vqbc6')).toBe(full);
  });

  it('returns the bare name when the project is unknown', () => {
    expect(toGcpNetworkPath('some-network', undefined)).toBe('some-network');
  });

  it('passes through undefined', () => {
    expect(toGcpNetworkPath(undefined, 'cluster-vqbc6')).toBeUndefined();
  });
});
