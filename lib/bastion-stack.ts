import { Stack, StackProps, CfnOutput, Fn } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  BastionHostLinux,
  InstanceType,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";

export class BastionStack extends Stack {
  public readonly bastion: BastionHostLinux;
  public readonly bastionSg: SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      appName: string;
      vpc: Vpc;
      dbSg: SecurityGroup;
    },
  ) {
    super(scope, id, props);

    const dbEndpoint = Fn.importValue("goexpress-app-db-endpoint");

    // 踏み台SG（inboundは一切開けない）
    this.bastionSg = new SecurityGroup(this, "BastionSg", {
      vpc: props.vpc,
      description: "SSM-only Bastion SG (no inbound)",
      allowAllOutbound: true, // 最初は簡単に。後で最小化してもOK
    });

    // 踏み台EC2（isolatedに配置）
    this.bastion = new BastionHostLinux(this, "Bastion", {
      vpc: props.vpc,
      subnetSelection: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroup: this.bastionSg,
      instanceType: new InstanceType("t3.nano"),
      requireImdsv2: true,
    });

    // 念のため（明示的に）SSM Managed policy を付ける
    // BastionHostLinuxはSSM前提だが、環境差分を潰す目的で付与しておくと安全[7](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.BastionHostLinux.html)
    this.bastion.instance.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
    );

    // DB SG：踏み台SGから 5432 を許可（RDSのSGはSG参照で許可が定石）[6](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html)
    props.dbSg.addIngressRule(
      this.bastionSg,
      Port.tcp(5432),
      "Bastion to RDS PostgreSQL",
    );

    // SSM ポートフォワード用コマンド出力
    // RDSのようなremote hostへ転送するには ToRemoteHost を使う[4](https://techblog.nhn-techorus.com/archives/37887)[5](https://blog.serverworks.co.jp/aws-systems-manager-support-port-forwarding-remote-hosts-using-session-manager)
    new CfnOutput(this, "BastionInstanceId", {
      value: this.bastion.instanceId,
    });

    new CfnOutput(this, "SsmPortForwardToRds", {
      value:
        `aws ssm start-session --target ${this.bastion.instanceId} ` +
        `--document-name AWS-StartPortForwardingSessionToRemoteHost ` +
        `--parameters '{"host":["${dbEndpoint}"],"portNumber":["5432"],"localPortNumber":["15432"]}'`,
    });
  }
}
