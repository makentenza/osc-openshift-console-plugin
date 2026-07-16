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
      // Both ports are opened as TCP (per the Red Hat "Enabling ports" procedure).
      expect(command).toContain('IpProtocol=tcp,FromPort=15150,ToPort=15150');
      expect(command).toContain('IpProtocol=tcp,FromPort=9000,ToPort=9000');
      // Source is the security group itself.
      expect(command).toContain('GroupId=sg-0abc123');
      // No comment lines, so it pastes and runs as-is (#27).
      expect(command).not.toContain('#');
    });

    it('marks missing region and security group as placeholders', () => {
      const { command, placeholders } = buildFirewallCommand('aws', {});
      expect(command).toContain('<region>');
      expect(command).toContain('<sg-xxxxxxxx>');
      expect(placeholders).toEqual(['<region>', '<sg-xxxxxxxx>']);
    });
  });

  describe('azure', () => {
    it('fully resolves the command when resource group and nsg are known', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureResourceGroup: 'my-rg',
        azureNsg: 'my-nsg',
      });
      expect(placeholders).toEqual([]);
      expect(command).toContain('--resource-group my-rg');
      expect(command).toContain('--nsg-name my-nsg');
      expect(command).toContain('--destination-port-ranges 15150 9000');
      expect(command).not.toContain('#');
    });

    // peer-pods-cm stores AZURE_NSG_ID as a full ARM resource id, but --nsg-name takes the short
    // name: passing the id through makes az look up an NSG called "subscriptions" (issue #57).
    it('reduces a full ARM resource id to the nsg name', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureResourceGroup: 'my-rg',
        azureNsg:
          '/subscriptions/0000/resourceGroups/mak-spoke-rg/providers/Microsoft.Network/networkSecurityGroups/mak-spoke-mak-spoke-nsg',
      });
      expect(placeholders).toEqual([]);
      expect(command).toContain('--nsg-name mak-spoke-mak-spoke-nsg');
      expect(command).not.toContain('/subscriptions/');
    });

    // --resource-group must be the one that owns the NSG; the id names it, so it beats the
    // cluster's network resource group, which is not always the same one.
    it('takes the resource group from the nsg resource id over the supplied one', () => {
      const { command } = buildFirewallCommand('azure', {
        azureResourceGroup: 'vnet-rg',
        azureNsg:
          '/subscriptions/0000/resourceGroups/nsg-rg/providers/Microsoft.Network/networkSecurityGroups/my-nsg',
      });
      expect(command).toContain('--resource-group nsg-rg');
      expect(command).toContain('--nsg-name my-nsg');
    });

    it('resolves the resource group from the nsg id alone', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureNsg:
          '/subscriptions/0000/resourceGroups/nsg-rg/providers/Microsoft.Network/networkSecurityGroups/my-nsg',
      });
      expect(placeholders).toEqual([]);
      expect(command).toContain('--resource-group nsg-rg');
    });

    // ARM ids are case-insensitive and Azure tooling does emit '/resourcegroups/'.
    it('reads the resource group from an id whatever the segment casing', () => {
      const { command } = buildFirewallCommand('azure', {
        azureNsg:
          '/subscriptions/0000/resourcegroups/nsg-rg/providers/Microsoft.Network/networkSecurityGroups/my-nsg',
      });
      expect(command).toContain('--resource-group nsg-rg');
      expect(command).toContain('--nsg-name my-nsg');
    });

    // A truncated id must not mistake the resource group for the nsg name.
    it('falls back to the supplied resource group for a truncated id', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureResourceGroup: 'my-rg',
        azureNsg: '/subscriptions/0000/resourceGroups/only-rg',
      });
      expect(command).toContain('--resource-group my-rg');
      expect(command).toContain('--nsg-name only-rg');
      expect(placeholders).toEqual([]);
    });

    it('keeps the resolved resource group while marking the nsg as a placeholder', () => {
      const { command, placeholders } = buildFirewallCommand('azure', {
        azureResourceGroup: 'my-rg',
      });
      expect(command).toContain('--resource-group my-rg');
      expect(command).toContain('<nsg-name>');
      expect(placeholders).toEqual(['<nsg-name>']);
    });

    it('marks both as placeholders when neither is known', () => {
      const { placeholders } = buildFirewallCommand('azure', {});
      expect(placeholders).toEqual(['<resource-group>', '<nsg-name>']);
    });
  });
});
