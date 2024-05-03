import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import { InstanceType } from "aws-cdk-lib/aws-ec2";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { KubectlV29Layer } from "@aws-cdk/lambda-layer-kubectl-v29";
//import { load as YAMLLoad } from "js-yaml";
//import { readFileSync } from "fs";
//import * as path from "path";

export class DecisiveEngine extends cdk.Stack {
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

    const cluster = new eks.Cluster(this, "DecisiveEngine", {
      clusterName: "DecisiveEngine",
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlV29Layer(this, "kubectl"),
      mastersRole: Role.fromRoleName(this, "Role", roleName.valueAsString),
      defaultCapacity: 0,
      albController: {
        version: eks.AlbControllerVersion.V2_6_2,
      },
    });

    //cluster.addAutoScalingGroupCapacity('Bottlerocket', {
    cluster.addNodegroupCapacity('Bottlerocket', {
      amiType: eks.NodegroupAmiType.BOTTLEROCKET_X86_64,
      maxSize: 10,
      minSize: 10,
      instanceTypes: [new InstanceType(`t2.micro`)],
      capacityType: eks.CapacityType.SPOT,
    });
/*
    const certManager = cluster.addHelmChart("CertManager", {
      chart: "cert-manager",
      repository: "https://charts.jetstack.io",
      namespace: "cert-manager",
      createNamespace: true,
      release: "cert-manager",
      version: "1.13.1",
      wait: true,
      values: {
        installCRDs: true
      },
    });

    const otelOperator = cluster.addHelmChart("OTELOperator", {
      chart: "opentelemetry-operator",
      repository: "https://decisiveai.github.io/mdai-helm-charts",
      namespace: "opentelemetry-operator-system",
      createNamespace: true,
      release: "opentelemetry-operator",
      version: "0.43.1",
      wait: true,
      values: {
        admissionWebhooks: {
          certManager: {
            enabled: true,
          },
        },
        manager: {
          image: {
            repository: "public.ecr.aws/p3k6k6h3/opentelemetry-operator",
            tag: "latest",
          },
        },
      },
    });
    otelOperator.node.addDependency(certManager);

    const collectorCrManifest = YAMLLoad(readFileSync(path.join(__dirname, "otelcol.yaml"), { encoding: "utf-8" })) as Record<string, any>;
    cluster.addManifest("collectorCrManifest", collectorCrManifest).node.addDependency(otelOperator);

    const prometheus = cluster.addHelmChart("Prometheus", {
      chart: "prometheus",
      repository: "https://prometheus-community.github.io/helm-charts",
      namespace: "default",
      createNamespace: true,
      release: "prometheus",
      version: "25.11.0",
      wait: true,
      values: YAMLLoad(readFileSync(path.join(__dirname, "../templates/prometheus-values.yaml"), "utf8")) as Record<string, any>,
    });
    prometheus.node.addDependency(otelOperator);

    const mdaiApi = cluster.addHelmChart("MDAIAPI", {
      chart: "mdai-api",
      repository: "https://decisiveai.github.io/mdai-helm-charts",
      namespace: "default",
      createNamespace: true,
      release: "mdai-api",
      version: "0.0.3",
      wait: true,
    });
    mdaiApi.node.addDependency(prometheus)

    const mdaiConsole = cluster.addHelmChart("MDAIConsole", {
      chart: "mdai-console",
      repository: "https://decisiveai.github.io/mdai-helm-charts",
      namespace: "default",
      createNamespace: true,
      release: "mdai-console",
      version: "0.0.7-nonroot",
      wait: true,
      values: {
        'ingress': {
          'userPoolArn': '',
          'userPoolClientId': '',
          'userPoolDomain': '',
          'acmArn': '',
          'enabled': false,
        },
      }
    });
    mdaiConsole.node.addDependency(mdaiApi);
    */
  }
}