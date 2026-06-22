import {
  isGpuRuntimeClass,
  isolationForHandler,
  isSandboxRuntimeClass,
  nodeHasNvidiaGpu,
  platformLikelySupportsNestedVirt,
} from './runtime';

describe('isolationForHandler', () => {
  it('classifies kata-remote as a peer pod', () => {
    expect(isolationForHandler('kata-remote')).toBe('peerpod');
  });

  it('classifies other kata handlers as on-node', () => {
    expect(isolationForHandler('kata')).toBe('node');
    expect(isolationForHandler('kata-nvidia-gpu')).toBe('node');
  });

  it('classifies an unknown or missing handler as unknown', () => {
    expect(isolationForHandler('runc')).toBe('unknown');
    expect(isolationForHandler(undefined)).toBe('unknown');
  });
});

describe('isSandboxRuntimeClass', () => {
  it('is true for a kata handler and false for a non-kata one', () => {
    expect(isSandboxRuntimeClass({ handler: 'kata-remote' })).toBe(true);
    expect(isSandboxRuntimeClass({ handler: 'runc' })).toBe(false);
  });
});

describe('platformLikelySupportsNestedVirt', () => {
  it('returns true for bare metal and unmanaged (None) platforms', () => {
    expect(platformLikelySupportsNestedVirt('BareMetal')).toBe(true);
    expect(platformLikelySupportsNestedVirt('None')).toBe(true);
  });

  it('returns false for managed cloud platforms (case-insensitive)', () => {
    expect(platformLikelySupportsNestedVirt('GCP')).toBe(false);
    expect(platformLikelySupportsNestedVirt('AWS')).toBe(false);
    expect(platformLikelySupportsNestedVirt('Azure')).toBe(false);
    expect(platformLikelySupportsNestedVirt('vSphere')).toBe(false);
  });

  it('returns undefined for an unknown or empty platform (stay informational)', () => {
    expect(platformLikelySupportsNestedVirt(undefined)).toBeUndefined();
    expect(platformLikelySupportsNestedVirt('')).toBeUndefined();
    expect(platformLikelySupportsNestedVirt('SomethingNew')).toBeUndefined();
  });
});

describe('isGpuRuntimeClass', () => {
  it('matches GPU runtime classes by handler or name', () => {
    expect(isGpuRuntimeClass({ handler: 'kata-nvidia-gpu' })).toBe(true);
    expect(isGpuRuntimeClass({ metadata: { name: 'kata-nvidia-gpu' } })).toBe(true);
  });

  it('does not match non-GPU runtime classes', () => {
    expect(isGpuRuntimeClass({ handler: 'kata' })).toBe(false);
    expect(isGpuRuntimeClass({ handler: 'kata-remote' })).toBe(false);
    expect(isGpuRuntimeClass({})).toBe(false);
  });
});

describe('nodeHasNvidiaGpu', () => {
  it('detects the device-plugin allocatable', () => {
    expect(nodeHasNvidiaGpu({ status: { allocatable: { 'nvidia.com/gpu': '1' } } })).toBe(true);
  });

  it('detects the NFD NVIDIA PCI vendor label', () => {
    expect(
      nodeHasNvidiaGpu({
        metadata: { labels: { 'feature.node.kubernetes.io/pci-10de.present': 'true' } },
      }),
    ).toBe(true);
  });

  it('is false for a node with no GPU signal', () => {
    expect(nodeHasNvidiaGpu({ status: { allocatable: { cpu: '4' } } })).toBe(false);
    expect(nodeHasNvidiaGpu({})).toBe(false);
  });
});
