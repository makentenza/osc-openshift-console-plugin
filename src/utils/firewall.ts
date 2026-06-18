/**
 * Build the copy-paste cloud CLI that opens the peer pods communication ports for AWS and Azure.
 *
 * GCP is handled separately (it can be applied in-cluster via a CCO-minted credential and a gcloud
 * Job — see OpenPeerPodsFirewall.tsx). For AWS and Azure we do *not* build full Job automation;
 * instead we render a fully-resolved CLI command, filling in every value we can read from the
 * cluster (region, the cloud-api-adaptor's own networking from peer-pods-cm, the Azure resource
 * group) and leaving the rest as clearly-marked <PLACEHOLDERS> the user fills before running.
 *
 * Both ports the cloud-api-adaptor needs are opened: 15150 (kata agent) and 9000 (VXLAN tunnel).
 * AWS opens both as TCP, matching the Red Hat "Enabling ports" procedure; Azure opens both in one
 * rule with protocol '*'. The command is rendered comment-free so it pastes and runs as-is (#27).
 */

/** Cloud providers that get a resolved copy-paste CLI (GCP has its own in-cluster apply flow). */
export type FirewallProvider = 'aws' | 'azure';

/** Inputs resolved from the cluster (peer-pods-cm + Infrastructure); any may be missing. */
export interface FirewallParams {
  /** Cloud region, e.g. us-east-1 (AWS). */
  region?: string;
  /** AWS security group id (sg-…) the pod VMs use — from peer-pods-cm AWS_SG_IDS if present. */
  awsSecurityGroupId?: string;
  /** Azure resource group that owns the network security group. */
  azureResourceGroup?: string;
  /** Azure network security group name — from peer-pods-cm AZURE_NSG_ID if present. */
  azureNsgName?: string;
}

/** A placeholder token the user must replace; rendered verbatim and reported via `placeholders`. */
const PH = {
  region: '<region>',
  awsSg: '<sg-xxxxxxxx>',
  azureRg: '<resource-group>',
  azureNsg: '<nsg-name>',
} as const;

export interface FirewallCommand {
  /** The fully-rendered, multi-line shell command. */
  command: string;
  /** Placeholder tokens still present in `command` (empty ⇒ ready to paste as-is). */
  placeholders: string[];
}

const dedupe = (tokens: string[]): string[] => Array.from(new Set(tokens.filter(Boolean)));

/**
 * AWS: two `aws ec2 authorize-security-group-ingress` calls (TCP 15150, TCP 9000) against the pod
 * VM security group. The source is the same security group (worker↔pod-VM traffic stays inside it),
 * which is the cloud-api-adaptor default. Both ports use TCP, per the Red Hat "Enabling ports" docs.
 */
const awsCommand = (p: FirewallParams): FirewallCommand => {
  const region = p.region || PH.region;
  const sg = p.awsSecurityGroupId || PH.awsSg;
  const command = [
    `aws ec2 authorize-security-group-ingress \\`,
    `  --region ${region} \\`,
    `  --group-id ${sg} \\`,
    `  --ip-permissions \\`,
    `    'IpProtocol=tcp,FromPort=15150,ToPort=15150,UserIdGroupPairs=[{GroupId=${sg}}]' \\`,
    `    'IpProtocol=tcp,FromPort=9000,ToPort=9000,UserIdGroupPairs=[{GroupId=${sg}}]'`,
  ].join('\n');
  const placeholders = dedupe([p.region ? '' : PH.region, p.awsSecurityGroupId ? '' : PH.awsSg]);
  return { command, placeholders };
};

/**
 * Azure: one `az network nsg rule create` opening both ports (priority 1000) on the cluster's
 * network security group within its resource group.
 */
const azureCommand = (p: FirewallParams): FirewallCommand => {
  const rg = p.azureResourceGroup || PH.azureRg;
  const nsg = p.azureNsgName || PH.azureNsg;
  const command = [
    `az network nsg rule create \\`,
    `  --resource-group ${rg} \\`,
    `  --nsg-name ${nsg} \\`,
    `  --name allow-peer-pods \\`,
    `  --priority 1000 \\`,
    `  --direction Inbound \\`,
    `  --access Allow \\`,
    `  --protocol '*' \\`,
    `  --destination-port-ranges 15150 9000 \\`,
    `  --source-address-prefixes VirtualNetwork`,
  ].join('\n');
  const placeholders = dedupe([
    p.azureResourceGroup ? '' : PH.azureRg,
    p.azureNsgName ? '' : PH.azureNsg,
  ]);
  return { command, placeholders };
};

export const buildFirewallCommand = (
  provider: FirewallProvider,
  params: FirewallParams,
): FirewallCommand => (provider === 'aws' ? awsCommand(params) : azureCommand(params));
