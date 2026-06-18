import {
  isolationForHandler,
  isSandboxRuntimeClass,
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
