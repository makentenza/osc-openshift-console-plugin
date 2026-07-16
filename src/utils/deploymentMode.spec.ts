import {
  DAEMONSET_FALLBACK,
  isHostedTopology,
  modeWillReboot,
  resolveDeploymentMode,
} from './deploymentMode';

describe('isHostedTopology', () => {
  it('reports External as hosted', () => {
    expect(isHostedTopology('External')).toBe(true);
  });

  it('reports standalone topologies as not hosted', () => {
    expect(isHostedTopology('HighlyAvailable')).toBe(false);
    expect(isHostedTopology('SingleReplica')).toBe(false);
  });

  it('stays undefined while Infrastructure has not loaded', () => {
    expect(isHostedTopology(undefined)).toBeUndefined();
  });
});

describe('resolveDeploymentMode', () => {
  it('honours an explicit mode regardless of topology', () => {
    expect(resolveDeploymentMode('DaemonSet', false)).toBe('DaemonSet');
    expect(resolveDeploymentMode('MachineConfig', true)).toBe('MachineConfig');
  });

  // An explicit mode needs no topology, so the caller should not be left waiting on one.
  it('honours an explicit mode before the topology is known', () => {
    expect(resolveDeploymentMode('DaemonSet', undefined)).toBe('DaemonSet');
    expect(resolveDeploymentMode('MachineConfig', undefined)).toBe('MachineConfig');
  });

  it('falls back to DaemonSet on a hosted cluster (no MachineConfig Operator)', () => {
    expect(resolveDeploymentMode(DAEMONSET_FALLBACK, true)).toBe('DaemonSet');
  });

  it('falls back to MachineConfig on a standalone cluster', () => {
    expect(resolveDeploymentMode(DAEMONSET_FALLBACK, false)).toBe('MachineConfig');
  });

  // No ConfigMap at all leaves the operator's own fallback in charge — same as DaemonSetFallback.
  it('treats an absent or unrecognised gate as the fallback', () => {
    expect(resolveDeploymentMode(undefined, true)).toBe('DaemonSet');
    expect(resolveDeploymentMode(undefined, false)).toBe('MachineConfig');
    expect(resolveDeploymentMode('', true)).toBe('DaemonSet');
    expect(resolveDeploymentMode('daemonset', true)).toBe('DaemonSet');
    expect(resolveDeploymentMode('nonsense', false)).toBe('MachineConfig');
  });

  it('stays undefined when the fallback applies but the topology is unknown', () => {
    expect(resolveDeploymentMode(DAEMONSET_FALLBACK, undefined)).toBeUndefined();
    expect(resolveDeploymentMode(undefined, undefined)).toBeUndefined();
  });
});

describe('modeWillReboot', () => {
  it('only MachineConfig reboots', () => {
    expect(modeWillReboot('MachineConfig')).toBe(true);
    expect(modeWillReboot('DaemonSet')).toBe(false);
  });

  it('stays undefined until the mode is known', () => {
    expect(modeWillReboot(undefined)).toBeUndefined();
  });
});
