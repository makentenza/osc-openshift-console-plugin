import { buildAwsFirewallCommand } from './firewall';

describe('buildAwsFirewallCommand', () => {
  it('fully resolves the command when region and security group are known', () => {
    const { command, placeholders } = buildAwsFirewallCommand({
      region: 'us-east-1',
      securityGroupId: 'sg-0abc123',
    });
    expect(placeholders).toEqual([]);
    expect(command).toContain('--region us-east-1');
    expect(command).toContain('--group-id sg-0abc123');
    // Both ports are opened as TCP (per the Red Hat "Enabling ports" procedure).
    expect(command).toContain('IpProtocol=tcp,FromPort=15150,ToPort=15150');
    expect(command).toContain('IpProtocol=tcp,FromPort=9000,ToPort=9000');
    // Source is the security group itself.
    expect(command).toContain('GroupId=sg-0abc123');
    // No comment lines, so it pastes and runs as-is (#27).
    expect(command).not.toContain('#');
  });

  it('marks missing region and security group as placeholders', () => {
    const { command, placeholders } = buildAwsFirewallCommand({});
    expect(command).toContain('<region>');
    expect(command).toContain('<sg-xxxxxxxx>');
    expect(placeholders).toEqual(['<region>', '<sg-xxxxxxxx>']);
  });

  it('keeps the resolved region while marking the security group as a placeholder', () => {
    const { command, placeholders } = buildAwsFirewallCommand({ region: 'eu-west-2' });
    expect(command).toContain('--region eu-west-2');
    expect(command).toContain('<sg-xxxxxxxx>');
    expect(placeholders).toEqual(['<sg-xxxxxxxx>']);
  });
});
