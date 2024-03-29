import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as yaml from "js-yaml";
import * as path from "path";
import { readFileSync } from "fs";
import { Construct } from "constructs";
import { KubectlV28Layer } from "@aws-cdk/lambda-layer-kubectl-v28";

export class DecisiveEngineAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const defaults = scope.node.tryGetContext('defaults');

    const engineMasterRole = new iam.Role(this, "DecisiveEngineMasterRole", {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    const cluster = new eks.Cluster(this, defaults.cluster.name, {
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlV28Layer(this, "kubectl"),
      mastersRole: engineMasterRole,
      defaultCapacity: 0,
      albController: {
        version: eks.AlbControllerVersion.V2_6_2,
      },
      tags: {
        Creator: require('os').userInfo().username,
      }
    });

    cluster.addNodegroupCapacity('BottlerocketNG', {
      amiType: eks.NodegroupAmiType.BOTTLEROCKET_X86_64,
      desiredSize: defaults.cluster.capacity,
      minSize: defaults.cluster.capacity,
      instanceTypes: [ec2.InstanceType.of(
        defaults.cluster.instance.class,
        defaults.cluster.instance.size,
      )],
      capacityType: eks.CapacityType.SPOT,
    });

    // From: https://docs.aws.amazon.com/eks/latest/userguide/view-kubernetes-resources.html#view-kubernetes-resources-permissions
    const manifests = yaml.loadAll(readFileSync(path.join(__dirname, "eks-console-full-access.yaml"), { encoding: "utf-8" })) as Record<string, any>[];
    manifests.forEach((manifest, index) =>
      cluster.addManifest(
        `ConsoleAccess${manifest.kind || index}`,
        manifest as Record<string, any>
      )
    );

    // Based on https://docs.aws.amazon.com/eks/latest/userguide/view-kubernetes-resources.html#view-kubernetes-resources-permissions
    const consoleAccessPolicy = new iam.Policy(
      this,
      "DecisiveEngineConsoleAccessPolicy",
      {
        document: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "eks:ListFargateProfiles",
                "eks:DescribeNodegroup",
                "eks:ListNodegroups",
                "eks:ListUpdates",
                "eks:AccessKubernetesApi",
                "eks:ListAddons",
                "eks:DescribeCluster",
                "eks:DescribeAddonVersions",
                "eks:ListClusters",
                "eks:ListIdentityProviderConfigs",
                "iam:ListRoles",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ssm:GetParameter"],
              resources: [
                // TODO: Is this a durable way to propagate the account?
                `arn:aws:ssm:*:${process.env.CDK_DEFAULT_ACCOUNT}:parameter/*`,
              ],
            }),
          ],
        }),
      }
    );

    const consoleAccessGroup = new iam.Group(
      this,
      "DecisiveEngineConsoleAccessGroup",
      {
        groupName: `DecisiveEngineConsoleAccessGroup-${process.env.CDK_DEFAULT_REGION}`,
      }
    );

    consoleAccessGroup.attachInlinePolicy(consoleAccessPolicy);

    new cdk.CfnOutput(this, "ConsoleAccessGroupArn", {
      description:
        "Add users that need console access to this cluster's resources to the group with this ARN",
      value: consoleAccessGroup.groupArn,
    });
    new cdk.CfnOutput(this, "ConsoleAccessConfigMapping", {
      description:
        "Add users that should have access to this cluster's resources in the AWS console by following (3) here",
      value:
        "https://docs.aws.amazon.com/eks/latest/userguide/view-kubernetes-resources.html#view-kubernetes-resources-permissions",
    });

    const otelOperator = cluster.addHelmChart("otelOperator", {
      chart: defaults.otel_operator.chart,
      repository: defaults.otel_operator.repo,
      namespace: defaults.otel_operator.namespace,
      createNamespace: true,
      release: defaults.otel_operator.release,
      version: defaults.otel_operator.version,
      wait: true,
      values: {
        admissionWebhooks: {
          certManager: {
            enabled: false,
          },
          autoGenerateCert: {
            enabled: true,
          },
        },
        leaderElection: {
          enabled: false,
        },
        manager: {
          image: {
            repository: defaults.otel_operator.manager.repo,
            tag: defaults.otel_operator.manager.version,
          },
        },
      },
    });

    const collectorCrManifest = yaml.load(readFileSync(path.join(__dirname, "otelcol.yaml"), { encoding: "utf-8" })) as Record<string, any>;
    cluster.addManifest("collectorCrManifest", collectorCrManifest).node.addDependency(otelOperator);

    const prometheus = cluster.addHelmChart("prometheus", {
      chart: defaults.prometheus.chart,
      repository: defaults.prometheus.repo,
      namespace: defaults.prometheus.namespace,
      createNamespace: true,
      release: defaults.prometheus.release,
      version: defaults.prometheus.version,
      wait: true,
      values: yaml.load(readFileSync(path.join(__dirname, "../templates/prometheus-values.yaml"), "utf8")) as Record<string, any>,
    });
    prometheus.node.addDependency(otelOperator);

    const mdaiApi = cluster.addHelmChart("mdai-api", {
      chart: defaults.mdai_api.chart,
      repository: defaults.mdai_api.repo,
      namespace: defaults.mdai_api.namespace,
      createNamespace: true,
      release: defaults.mdai_api.release,
      version: defaults.mdai_api.version,
      wait: true,
    });
    mdaiApi.node.addDependency(prometheus);

    const mdaiUserPool = new cognito.UserPool(this, 'mdai-user-pool', {
      userPoolName: 'mdai-user-pool',
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
      },
      userVerification: {
        emailSubject: 'You need to verify your email',
        emailBody: 'Thanks for signing up Your verification code is {####}', // # This placeholder is a must if code is selected as preferred verification method
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    mdaiUserPool.node.addDependency(mdaiApi);

    const mdaiUserPoolDomain = mdaiUserPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: defaults.mdai_cognito.user_pool_domain,
      },
    });

    const mdaiAppClient = mdaiUserPool.addClient('mdai-app-client', {
      userPoolClientName: 'mdai-app-client',
      authFlows: {
        userPassword: true,
      },
      generateSecret: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL],
        callbackUrls: [
          `https://${defaults.mdai_cognito.ui_hostname}/oauth2/idpresponse`,
        ],
      },
    });
    mdaiAppClient.node.addDependency(mdaiUserPoolDomain);

    const mdaiConsole = cluster.addHelmChart("mdai-console", {
      chart: defaults.mdai_console.chart,
      repository: defaults.mdai_console.repo,
      namespace: defaults.mdai_console.namespace,
      createNamespace: true,
      release: defaults.mdai_console.release,
      version: defaults.mdai_console.version,
      wait: true,
      values: {
        'ingress': {
          'userPoolArn': mdaiUserPool.userPoolArn,
          'userPoolClientId': mdaiAppClient.userPoolClientId,
          'userPoolDomain': defaults.mdai_cognito.user_pool_domain,
          'acmArn': process.env.MDAI_UI_ACM_ARN,
        },
      }
    });
    mdaiConsole.node.addDependency(mdaiAppClient);
  }
}
