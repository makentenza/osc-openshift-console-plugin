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
  /**
   * Azure network security group, as either a bare name or a full ARM resource id — peer-pods-cm
   * stores AZURE_NSG_ID as an id, which is not what `az … --nsg-name` takes (issue #57).
   */
  azureNsg?: string;
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
 * Split an NSG reference into the short name and the resource group that owns it. Accepts a bare
 * name or a full ARM resource id
 * (/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/networkSecurityGroups/<name>),
 * which is the form peer-pods-cm's AZURE_NSG_ID takes. `az network nsg rule create` wants the two
 * split apart: an id in `--nsg-name` makes the CLI look up an NSG literally called "subscriptions".
 */
const parseNsg = (value?: string): { name?: string; resourceGroup?: string } => {
  const v = value?.trim();
  if (!v) return {};
  if (!v.includes('/')) return { name: v };
  const segments = v.split('/').filter(Boolean);
  const name = segments[segments.length - 1];
  const rgIndex = segments.findIndex((s) => s.toLowerCase() === 'resourcegroups');
  // Guard against a malformed id whose "resource group" is also its last segment (i.e. the name).
  const resourceGroup =
    rgIndex >= 0 && rgIndex + 1 < segments.length - 1 ? segments[rgIndex + 1] : undefined;
  return { name, resourceGroup };
};

/**
 * Azure: one `az network nsg rule create` opening both ports (priority 1000) on the cluster's
 * network security group within its resource group.
 */
const azureCommand = (p: FirewallParams): FirewallCommand => {
  const { name: nsgName, resourceGroup: nsgResourceGroup } = parseNsg(p.azureNsg);
  // When the NSG came in as a resource id it names its own resource group — prefer that over the
  // cluster's network resource group, which does not always own the NSG.
  const rg = nsgResourceGroup || p.azureResourceGroup || PH.azureRg;
  const nsg = nsgName || PH.azureNsg;
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
    rg === PH.azureRg ? PH.azureRg : '',
    nsg === PH.azureNsg ? PH.azureNsg : '',
  ]);
  return { command, placeholders };
};

export const buildFirewallCommand = (
  provider: FirewallProvider,
  params: FirewallParams,
): FirewallCommand => (provider === 'aws' ? awsCommand(params) : azureCommand(params));
