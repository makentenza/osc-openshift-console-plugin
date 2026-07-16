/**
 * The Red Hat "Creating the peer pods config map" procedure for reading AWS values off a worker
 * instance — the manual fallback for ids the cluster doesn't expose for prefill (issue #28).
 *
 * Two screens need it: the peer pods config map wizard, and the firewall step, which needs the
 * security group id to render a runnable rule. Both offer "Fetch from AWS" first; this is what they
 * fall back to when the Cloud Credential Operator can't mint a credential (Manual/STS mode).
 *
 * It reads the ids off a worker Node's providerID rather than a MachineSet, so it works on hosted
 * (HCP) clusters too — those have no machine-api in the guest cluster at all (issue #63).
 */
export const AWS_DESCRIBE_CLI = [
  `INSTANCE_ID=$(oc get nodes -l node-role.kubernetes.io/worker \\`,
  `  -o jsonpath='{.items[0].spec.providerID}' | sed 's#[^ ]*/##g')`,
  `AWS_REGION=$(oc get infrastructure/cluster -o jsonpath='{.status.platformStatus.aws.region}')`,
  `aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" \\`,
  `  --query 'Reservations[*].Instances[*].SubnetId' --output text   # AWS_SUBNET_ID`,
  `aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" \\`,
  `  --query 'Reservations[*].Instances[*].VpcId' --output text      # AWS_VPC_ID`,
  `aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$AWS_REGION" \\`,
  `  --query 'Reservations[*].Instances[*].SecurityGroups[*].GroupId' --output json \\`,
  `  | jq -r '.[][]' | paste -sd ","                                 # AWS_SG_IDS`,
].join('\n');
