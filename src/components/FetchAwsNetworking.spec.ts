import { instanceIdFromProviderId, parseLog } from './FetchAwsNetworking';

describe('instanceIdFromProviderId', () => {
  it('extracts the instance id from an AWS providerID', () => {
    expect(instanceIdFromProviderId('aws:///eu-west-2a/i-0123456789abcdef0')).toBe(
      'i-0123456789abcdef0',
    );
  });
  it('returns undefined for non-AWS or malformed providerIDs', () => {
    expect(instanceIdFromProviderId(undefined)).toBeUndefined();
    expect(instanceIdFromProviderId('gce://project/zone/instance')).toBeUndefined();
    expect(instanceIdFromProviderId('aws:///eu-west-2a/not-an-instance')).toBeUndefined();
  });
});

describe('parseLog', () => {
  it('parses the three ids from the Job log', () => {
    const log = [
      'AWS_SUBNET_ID=subnet-0abc',
      'AWS_VPC_ID=vpc-0def',
      'AWS_SG_IDS=sg-1,sg-2',
      'some trailing noise',
    ].join('\n');
    expect(parseLog(log)).toEqual({
      subnetId: 'subnet-0abc',
      vpcId: 'vpc-0def',
      sgIds: 'sg-1,sg-2',
    });
  });
  it('treats "None"/empty AWS CLI output as unset (so the form field stays blank)', () => {
    const log = ['AWS_SUBNET_ID=subnet-x', 'AWS_VPC_ID=None', 'AWS_SG_IDS='].join('\n');
    expect(parseLog(log)).toEqual({ subnetId: 'subnet-x', vpcId: undefined, sgIds: undefined });
  });
  it('returns all-undefined when the keys are absent', () => {
    expect(parseLog('reconcile tick\nnothing here')).toEqual({
      subnetId: undefined,
      vpcId: undefined,
      sgIds: undefined,
    });
  });
});
