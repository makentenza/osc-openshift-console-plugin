import {
  caaContainerName,
  diagnoseCaaLog,
  peerPodNeedsDiagnostics,
  podWaitingText,
} from './caaDiagnostics';
import type { PodKind } from '../k8s/types';

describe('diagnoseCaaLog', () => {
  it('returns undefined for no text or unrecognized text', () => {
    expect(diagnoseCaaLog(undefined)).toBeUndefined();
    expect(diagnoseCaaLog('')).toBeUndefined();
    expect(diagnoseCaaLog('reconcile loop tick; nothing to do')).toBeUndefined();
  });

  it('maps the image_guest_pull timeout to the NAT-gateway / outbound cause (issue #50)', () => {
    const dx = diagnoseCaaLog(
      'CreateContainer source:quay.io/x driver:image_guest_pull → CreateContainerError: context deadline exceeded',
    );
    expect(dx?.key).toBe('image-pull-no-egress');
    expect(dx?.fix).toMatch(/NAT gateway/i);
    expect(dx?.docHref).toBeDefined();
  });

  it('maps "not available in the current region" to the region cause', () => {
    const dx = diagnoseCaaLog(
      'InvalidParameter: VM size Standard_DC2as_v5 is not available in the current region',
    );
    expect(dx?.key).toBe('size-not-in-region');
  });

  it('maps the empty allow-list / verify-instance-type error', () => {
    const dx = diagnoseCaaLog(
      'failed to verify instance type: requested Standard_B4als_v2 is not default … and supported instance types list is empty',
    );
    expect(dx?.key).toBe('instance-not-allowed');
    expect(dx?.fix).toMatch(/AZURE_INSTANCE_SIZES/);
  });

  it('maps the disk-too-small error to ROOT_VOLUME_SIZE', () => {
    const dx = diagnoseCaaLog(
      'OperationNotAllowed: specified disk size 6 GB is smaller than the size of the VM image: 10 GB',
    );
    expect(dx?.key).toBe('root-volume-too-small');
    expect(dx?.fix).toMatch(/ROOT_VOLUME_SIZE/);
  });

  it('checks the most specific signature first (image-pull beats a bare timeout)', () => {
    // A bare "context deadline exceeded" with image_guest_pull must resolve to the egress cause,
    // not be swallowed by a generic timeout match.
    const dx = diagnoseCaaLog('driver:image_guest_pull … context deadline exceeded');
    expect(dx?.key).toBe('image-pull-no-egress');
  });
});

describe('peerPodNeedsDiagnostics', () => {
  const pod = {} as PodKind;
  it('is true for a non-healthy peer pod', () => {
    expect(peerPodNeedsDiagnostics(pod, 'ContainerCreating')).toBe(true);
    expect(peerPodNeedsDiagnostics(pod, 'CreateContainerError')).toBe(true);
  });
  it('is false when running or when there is no pod', () => {
    expect(peerPodNeedsDiagnostics(pod, 'Running')).toBe(false);
    expect(peerPodNeedsDiagnostics(undefined, 'ContainerCreating')).toBe(false);
  });
});

describe('caaContainerName / podWaitingText', () => {
  it('prefers the adaptor container, falling back to the first', () => {
    expect(
      caaContainerName({
        spec: { containers: [{ name: 'foo' }, { name: 'cloud-api-adaptor-con' }] },
      }),
    ).toBe('cloud-api-adaptor-con');
    expect(caaContainerName({ spec: { containers: [{ name: 'only' }] } })).toBe('only');
    expect(caaContainerName(undefined)).toBeUndefined();
  });

  it('joins container waiting reason + message', () => {
    const pod: PodKind = {
      status: {
        containerStatuses: [
          {
            name: 'c',
            ready: false,
            restartCount: 0,
            state: { waiting: { reason: 'CreateContainerError', message: 'image_guest_pull …' } },
          },
        ],
      },
    };
    expect(podWaitingText(pod)).toBe('CreateContainerError: image_guest_pull …');
  });
});
