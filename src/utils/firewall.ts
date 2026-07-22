/**
 * Build the copy-paste AWS CLI that opens the peer pods communication ports.
 *
 * GCP is handled separately (it can be applied in-cluster via a CCO-minted credential and a gcloud
 * Job — see OpenPeerPodsFirewall.tsx). Azure needs no rule at all: its default AllowVnetInBound
 * security rule already permits worker→pod-VM traffic inside the cluster VNet, so the command the
 * plugin used to render was a no-op (issue #67). For AWS we do *not* build full Job automation;
 * instead we render a fully-resolved CLI command, filling in every value we can read from the
 * cluster and leaving the rest as clearly-marked <PLACEHOLDERS> the user fills before running.
 *
 * Both ports the cloud-api-adaptor needs are opened: 15150 (kata agent) and 9000 (VXLAN tunnel),
 * both as TCP, matching the Red Hat "Enabling ports" procedure. The command is rendered
 * comment-free so it pastes and runs as-is (#27).
 */

/** Inputs resolved from the cluster (peer-pods-cm + Infrastructure); any may be missing. */
export interface FirewallParams {
  /** Cloud region, e.g. us-east-1. */
  region?: string;
  /** AWS security group id (sg-…) the pod VMs use — from peer-pods-cm AWS_SG_IDS if present. */
  securityGroupId?: string;
}

/** A placeholder token the user must replace; rendered verbatim and reported via `placeholders`. */
const PH = {
  region: '<region>',
  sg: '<sg-xxxxxxxx>',
} as const;

export interface FirewallCommand {
  /** The fully-rendered, multi-line shell command. */
  command: string;
  /** Placeholder tokens still present in `command` (empty ⇒ ready to paste as-is). */
  placeholders: string[];
}

const dedupe = (tokens: string[]): string[] => Array.from(new Set(tokens.filter(Boolean)));

/**
 * Two `aws ec2 authorize-security-group-ingress` calls (TCP 15150, TCP 9000) against the pod VM
 * security group. The source is the same security group (worker↔pod-VM traffic stays inside it),
 * which is the cloud-api-adaptor default.
 */
export const buildAwsFirewallCommand = (p: FirewallParams): FirewallCommand => {
  const region = p.region || PH.region;
  const sg = p.securityGroupId || PH.sg;
  const command = [
    `aws ec2 authorize-security-group-ingress \\`,
    `  --region ${region} \\`,
    `  --group-id ${sg} \\`,
    `  --ip-permissions \\`,
    `    'IpProtocol=tcp,FromPort=15150,ToPort=15150,UserIdGroupPairs=[{GroupId=${sg}}]' \\`,
    `    'IpProtocol=tcp,FromPort=9000,ToPort=9000,UserIdGroupPairs=[{GroupId=${sg}}]'`,
  ].join('\n');
  const placeholders = dedupe([p.region ? '' : PH.region, p.securityGroupId ? '' : PH.sg]);
  return { command, placeholders };
};
