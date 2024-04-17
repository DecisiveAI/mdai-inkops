import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { KubectlV29Layer } from "@aws-cdk/lambda-layer-kubectl-v29";

export class DecisiveEngineAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const roleName = new cdk.CfnParameter(this, "RoleName", {
      type: "String",
      description: "An IAM role that will be added to the system:masters Kubernetes RBAC group.",
    })

    const clusterSize = new cdk.CfnParameter(this, "ClusterSize", {
      type: "Number",
      description: "The number of EC2 instances in the cluster.",
      default: 10,
    })

    const cluster = new eks.Cluster(this, "DecisiveEngineCluster", {
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlV29Layer(this, "kubectl"),
      mastersRole: iam.Role.fromRoleName(this, "Role", roleName.valueAsString),
      defaultCapacity: 0,
      albController: {
        version: eks.AlbControllerVersion.V2_6_2,
      },
    });

    cluster.addNodegroupCapacity('BottlerocketNG', {
      amiType: eks.NodegroupAmiType.BOTTLEROCKET_X86_64,
      maxSize: clusterSize.valueAsNumber,
      minSize: 2,
      instanceTypes: [new ec2.InstanceType(`t2.micro`)],
      capacityType: eks.CapacityType.SPOT,
    });
  }
}
