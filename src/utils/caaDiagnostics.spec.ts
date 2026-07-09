import {
  caaContainerName,
  cloudProviderFromPlatform,
  commonCaaCauses,
  diagnoseCaaLog,
  DEPLOY_DOCS,
  peerPodNeedsDiagnostics,
  podWaitingText,
} from './caaDiagnostics';
import type { PodKind } from '../k8s/types';

describe('cloudProviderFromPlatform', () => {
  it('maps the Infrastructure platform values (case-insensitive)', () => {
    expect(cloudProviderFromPlatform('AWS')).toBe('aws');
    expect(cloudProviderFromPlatform('Azure')).toBe('azure');
    expect(cloudProviderFromPlatform('GCP')).toBe('gcp');
    expect(cloudProviderFromPlatform('gcp')).toBe('gcp');
  });

  it('maps peer-pods-cm CLOUD_PROVIDER values', () => {
    expect(cloudProviderFromPlatform('aws')).toBe('aws');
    expect(cloudProviderFromPlatform('azure')).toBe('azure');
  });

  it('returns undefined for platforms that do not run peer pods', () => {
    expect(cloudProviderFromPlatform('BareMetal')).toBeUndefined();
    expect(cloudProviderFromPlatform('None')).toBeUndefined();
    expect(cloudProviderFromPlatform('')).toBeUndefined();
    expect(cloudProviderFromPlatform(undefined)).toBeUndefined();
  });
});

describe('diagnoseCaaLog', () => {
  it('returns undefined for empty or unrecognized input', () => {
    expect(diagnoseCaaLog(undefined, 'aws')).toBeUndefined();
    expect(diagnoseCaaLog('', 'aws')).toBeUndefined();
    expect(diagnoseCaaLog('just some ordinary reconcile noise', 'aws')).toBeUndefined();
  });

  describe('image pull with no egress', () => {
    const log = 'failed image_guest_pull for docker.io/library/nginx: context deadline exceeded';

    it('names the AWS subnet and NAT gateway on AWS', () => {
      const dx = diagnoseCaaLog(log, 'aws');
      expect(dx?.key).toBe('image-pull-no-egress');
      expect(dx?.fix).toContain('AWS_SUBNET_ID');
      expect(dx?.fix).toContain('NAT gateway');
      expect(dx?.docHref).toBe(DEPLOY_DOCS.aws);
    });

    it('names the Azure subnet on Azure', () => {
      const dx = diagnoseCaaLog(log, 'azure');
      expect(dx?.fix).toContain('AZURE_SUBNET_ID');
      expect(dx?.docHref).toBe(DEPLOY_DOCS.azure);
    });

    it('names the GCP subnetwork and Cloud NAT on GCP', () => {
      const dx = diagnoseCaaLog(log, 'gcp');
      expect(dx?.fix).toContain('GCP_SUBNETWORK');
      expect(dx?.fix).toContain('Cloud NAT');
      expect(dx?.docHref).toBe(DEPLOY_DOCS.gcp);
    });

    // Issue #56: an AWS cluster must never see Azure terminology in the diagnosis.
    it('never mentions Azure when the cluster is AWS', () => {
      const dx = diagnoseCaaLog(log, 'aws');
      expect(dx?.fix.toLowerCase()).not.toContain('azure');
      expect(dx?.docHref).not.toContain('azure');
    });

    // Regression guard: the most specific signature beats a bare timeout.
    it('checks the most specific signature first (image-pull beats a bare timeout)', () => {
      const dx = diagnoseCaaLog('driver:image_guest_pull … context deadline exceeded', 'aws');
      expect(dx?.key).toBe('image-pull-no-egress');
    });
  });

  describe('instance size not available in region', () => {
    const log = 'SkuNotAvailable: VM size Standard_D4as_v5 is not available in the current region';

    it('uses AWS instance-type keys and region on AWS', () => {
      const dx = diagnoseCaaLog(log, 'aws');
      expect(dx?.key).toBe('size-not-in-region');
      expect(dx?.fix).toContain('PODVM_INSTANCE_TYPE');
      expect(dx?.fix).toContain('AWS_REGION');
      expect(dx?.fix.toLowerCase()).not.toContain('azure');
    });

    it('uses the GCP machine type and zone on GCP', () => {
      const dx = diagnoseCaaLog(log, 'gcp');
      expect(dx?.cause).toContain('machine type');
      expect(dx?.cause).toContain('zone');
      expect(dx?.fix).toContain('GCP_MACHINE_TYPE');
      expect(dx?.fix).toContain('GCP_ZONE');
      // GCP has no allow-list, so it must not reference one.
      expect(dx?.fix).not.toContain('GCP_MACHINE_TYPES');
    });
  });

  describe('instance not in the allow-list', () => {
    const log =
      'failed to verify instance type: requested … and supported instance types list is empty';

    it('points at the AWS allow-list on AWS', () => {
      const dx = diagnoseCaaLog(log, 'aws');
      expect(dx?.key).toBe('instance-not-allowed');
      expect(dx?.fix).toContain('PODVM_INSTANCE_TYPES');
    });

    it('points at the Azure allow-list on Azure', () => {
      const dx = diagnoseCaaLog(log, 'azure');
      expect(dx?.fix).toContain('AZURE_INSTANCE_SIZES');
    });
  });

  it('maps the disk-too-small error to ROOT_VOLUME_SIZE', () => {
    const dx = diagnoseCaaLog(
      'OperationNotAllowed: specified disk size 6 GB is smaller than the size of the VM image: 10 GB',
      'aws',
    );
    expect(dx?.key).toBe('root-volume-too-small');
    expect(dx?.fix).toMatch(/ROOT_VOLUME_SIZE/);
  });

  describe('auth failure', () => {
    it('recognizes AWS auth errors and names AWS credentials', () => {
      const dx = diagnoseCaaLog('AuthFailure: the security token is invalid', 'aws');
      expect(dx?.key).toBe('auth-failed');
      expect(dx?.fix).toContain('access key');
      expect(dx?.fix.toLowerCase()).not.toContain('client id');
    });

    it('recognizes Azure auth errors and names Azure credentials', () => {
      const dx = diagnoseCaaLog('AADSTS7000215: Invalid client secret provided', 'azure');
      expect(dx?.key).toBe('auth-failed');
      expect(dx?.fix).toContain('client id');
    });
  });

  it('falls back to cloud-neutral text when the provider is unknown', () => {
    const dx = diagnoseCaaLog('image_guest_pull ... context deadline exceeded', undefined);
    expect(dx?.key).toBe('image-pull-no-egress');
    expect(dx?.fix.toLowerCase()).not.toContain('azure');
    expect(dx?.fix.toLowerCase()).not.toContain('aws');
    expect(dx?.fix.toLowerCase()).not.toContain('gcp');
  });
});

describe('commonCaaCauses', () => {
  it('lists AWS keys on AWS and no Azure keys', () => {
    const causes = commonCaaCauses('aws').join('\n');
    expect(causes).toContain('PODVM_INSTANCE_TYPE');
    expect(causes).toContain('AWS_SUBNET_ID');
    expect(causes.toLowerCase()).not.toContain('azure');
  });

  it('lists GCP keys and no allow-list on GCP', () => {
    const causes = commonCaaCauses('gcp').join('\n');
    expect(causes).toContain('GCP_MACHINE_TYPE');
    expect(causes).toContain('GCP_SUBNETWORK');
    expect(causes).not.toContain('GCP_MACHINE_TYPES');
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
