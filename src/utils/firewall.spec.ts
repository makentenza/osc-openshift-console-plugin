import { buildFirewallCommand } from './firewall';

describe('buildFirewallCommand', () => {
  describe('aws', () => {
    it('fully resolves the command when region and security group are known', () => {
      const { command, placeholders } = buildFirewallCommand('aws', {
        region: 'us-east-1',
        awsSecurityGroupId: 'sg-0abc123',
      });
      expect(placeholders).toEqual([]);
      expect(command).toContain('--region us-east-1');
      expect(command).toContain('--group-id sg-0abc123');
      // Both ports are opened.
      expect(command).toContain('FromPort=15150,ToPort=15150');
      expect(command).toContain('FromPort=9000,ToPort=9000');
      // Source is the security group itself.
      expect(command).toContain('GroupId=sg-0abc123');
    });

    it('marks missing region and security group as placeholders', () => {
      const { command, placeholders } = buildFirewallCommand('aws', {});
      expect(command).toContain('<region>');
      expect(command).toContain('<sg-xxxxxxxx>');
      expect(placeholders).toEqual(['<region>', '<sg-xxxxxxxx>']);
    });

    it('includes the VPC as a comment hint when known but does not treat it as a placeholder', () => {
      const { command, placeholders } = buildFirewallCommand('aws', {
        region: 'eu-west-1',
        awsSecurityGroupId: 'sg-1',
        awsVpcId: 'vpc-9',
      });
      expect(command).toContain('VPC vpc-9');
      expect(placeholders).toEqual([]);
    });
  });

  describe('azure', () => {
    it('fully resolves the command when resource group and nsg are known', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureResourceGroup: 'my-rg',
        azureNsgName: 'my-nsg',
      });
      expect(placeholders).toEqual([]);
      expect(command).toContain('--resource-group my-rg');
      expect(command).toContain('--nsg-name my-nsg');
      expect(command).toContain('--destination-port-ranges 15150 9000');
    });

    it('keeps the resolved resource group while marking the nsg as a placeholder', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureResourceGroup: 'my-rg',
      });
      expect(command).toContain('--resource-group my-rg');
      expect(command).toContain('<nsg-name>');
      expect(placeholders).toEqual(['<nsg-name>']);
    });
  });
});
