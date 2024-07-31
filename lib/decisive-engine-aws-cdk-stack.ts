import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as yaml from 'js-yaml';
import { readFileSync } from 'fs';
import { Construct } from 'constructs';
import { KubectlV30Layer as KubectlLayer } from '@aws-cdk/lambda-layer-kubectl-v30';
import * as path from 'path';
import 'dotenv/config';
const config = require('config');

export class DecisiveEngineAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    if (config.get('MDAI_CONSOLE.ACM_ARN') === "") {
      throw new Error("MDAI_UI_ACM_ARN was not specified")
    }

    const engineMasterRole = new iam.Role(this, 'DecisiveEngineMasterRole', {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    const cluster = new eks.Cluster(this, config.get('CLUSTER.NAME'), {
      clusterName: config.get('CLUSTER.NAME'),
      version: eks.KubernetesVersion.V1_30,
      kubectlLayer: new KubectlLayer(this, 'kubectl'),
      mastersRole: engineMasterRole,
      defaultCapacity: Number(config.get('CLUSTER.CAPACITY')),
      defaultCapacityInstance: ec2.InstanceType.of(
        Object.values(ec2.InstanceClass).find(instanceClass => instanceClass === process.env.MDAI_EC2_INSTANCE_CLASS) || ec2.InstanceClass.T2 as ec2.InstanceClass,
        Object.values(ec2.InstanceSize).find(instanceSize => instanceSize === process.env.MDAI_EC2_INSTANCE_SIZE) || ec2.InstanceSize.MICRO as ec2.InstanceSize,
      ),
      // AWS ALB contoller
      albController: {
        version: eks.AlbControllerVersion.V2_6_2,
      },
    });

    // From: https://docs.aws.amazon.com/eks/latest/userguide/view-kubernetes-resources.html#view-kubernetes-resources-permissions
    const manifests = yaml.loadAll(readFileSync(path.join(__dirname, 'eks-console-full-access.yaml'), { encoding: 'utf-8' })) as Record<string, any>[];
    manifests.forEach((manifest, index) =>
      cluster.addManifest(
        `ConsoleAccess${manifest.kind || index}`,
        manifest as Record<string, any>
      )
    );

    // Based on https://docs.aws.amazon.com/eks/latest/userguide/view-kubernetes-resources.html#view-kubernetes-resources-permissions
    const consoleAccessPolicy = new iam.Policy(
      this,
      'DecisiveEngineConsoleAccessPolicy',
      {
        document: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'eks:ListFargateProfiles',
                'eks:DescribeNodegroup',
                'eks:ListNodegroups',
                'eks:ListUpdates',
                'eks:AccessKubernetesApi',
                'eks:ListAddons',
                'eks:DescribeCluster',
                'eks:DescribeAddonVersions',
                'eks:ListClusters',
                'eks:ListIdentityProviderConfigs',
                'iam:ListRoles',
              ],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter'],
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
      'DecisiveEngineConsoleAccessGroup',
      {
        groupName: `DecisiveEngineConsoleAccessGroup-${process.env.CDK_DEFAULT_REGION}`,
      }
    );

    consoleAccessGroup.attachInlinePolicy(consoleAccessPolicy);

    new cdk.CfnOutput(this, 'ConsoleAccessGroupArn', {
      description:
        'Add users that need console access to this cluster\'s resources to the group with this ARN',
      value: consoleAccessGroup.groupArn,
    });
    new cdk.CfnOutput(this, 'ConsoleAccessConfigMapping', {
      description:
        'Add users that should have access to this cluster\'s resources in the AWS console by following (3) here',
      value:
        'https://docs.aws.amazon.com/eks/latest/userguide/view-kubernetes-resources.html#view-kubernetes-resources-permissions',
    });

    const certManager = cluster.addHelmChart('certManager', {
      chart: config.get('CERT_MANAGER.CHART'),
      repository: config.get('CERT_MANAGER.REPO'),
      namespace: config.get('CERT_MANAGER.NAMESPACE'),
      createNamespace: true,
      release: config.get('CERT_MANAGER.RELEASE'),
      version: config.get('CERT_MANAGER.VERSION'),
      wait: true,
      values: {
        installCRDs: true
      },
    });

    const otelOperator = cluster.addHelmChart('otelOperator', {
      chart: config.get('OTEL_OPERATOR.CHART'),
      repository: config.get('OTEL_OPERATOR.REPO'),
      namespace: config.get('OTEL_OPERATOR.NAMESPACE'),
      createNamespace: true,
      release: config.get('OTEL_OPERATOR.RELEASE'),
      version: config.get('OTEL_OPERATOR.VERSION'),
      wait: true,
      values: {
        admissionWebhooks: {
          certManager: {
            enabled: true,
          },
        },
        manager: {
          image: {
            repository: config.get('OTEL_OPERATOR.MANAGER.REPO'),
            tag: config.get('OTEL_OPERATOR.MANAGER.VERSION'),
          },
        },
      },
    });
    otelOperator.node.addDependency(certManager);

    const mdaiOperator = cluster.addHelmChart('mdaiOperator', {
      chart: config.get('MDAI_OPERATOR.CHART'),
      repository: config.get('MDAI_OPERATOR.REPO'),
      namespace: config.get('MDAI_OPERATOR.NAMESPACE'),
      createNamespace: true,
      release: config.get('MDAI_OPERATOR.RELEASE'),
      version: config.get('MDAI_OPERATOR.VERSION'),
      wait: true,
      values: {},
    });
    mdaiOperator.node.addDependency(otelOperator);

    const mdaiOperatorCrManifest = yaml.load(readFileSync(path.join(__dirname, 'mdai-operator.yaml'), { encoding: 'utf-8' })) as Record<string, any>;
    cluster.addManifest('mdaiOperatorCrManifest', mdaiOperatorCrManifest).node.addDependency(mdaiOperator);

    const prometheus = cluster.addHelmChart('prometheus', {
      chart: config.get('PROMETHEUS.CHART'),
      repository: config.get('PROMETHEUS.REPO'),
      namespace: config.get('PROMETHEUS.NAMESPACE'),
      createNamespace: true,
      release: config.get('PROMETHEUS.RELEASE'),
      version: config.get('PROMETHEUS.VERSION'),
      wait: true,
      values: yaml.load(readFileSync(path.join(__dirname, '../templates/prometheus-values.yaml'), 'utf8')) as Record<string, any>,
    });
    prometheus.node.addDependency(otelOperator);

    const metricsServer = cluster.addHelmChart('metrics-server', {
      chart: config.get('METRICS_SERVER.CHART'),
      repository: config.get('METRICS_SERVER.REPO'),
      namespace: config.get('METRICS_SERVER.NAMESPACE'),
      createNamespace: false,
      release: config.get('METRICS_SERVER.RELEASE'),
      version: config.get('METRICS_SERVER.VERSION'),
      wait: true,
    });
    metricsServer.node.addDependency(prometheus);

    const mdaiApi = cluster.addHelmChart('mdai-api', {
      chart: config.get('MDAI_API.CHART'),
      repository: config.get('MDAI_API.REPO'),
      namespace: config.get('MDAI_API.NAMESPACE'),
      createNamespace: true,
      release: config.get('MDAI_API.RELEASE'),
      version: config.get('MDAI_API.VERSION'),
      wait: true,
    });
    mdaiApi.node.addDependency(prometheus);

    let mdaiAppClient = {} as cdk.aws_cognito.UserPoolClient,
      consoleIngress = {
        'enabled': true,
        'cognito': {
          'enabled': Boolean(config.get('MDAI_COGNITO.ENABLE')),
        },
        'acmArn': config.get('MDAI_CONSOLE.ACM_ARN'),
        'userPoolArn': '',
        'userPoolClientId': '',
        'userPoolDomain': '',
      }

    if (config.get('MDAI_COGNITO.ENABLE')) {
      const mdaiUserPool = new cognito.UserPool(this, 'mdai-user-pool', {
        userPoolName: 'mdai-user-pool',
        signInAliases: {
          email: true,
        },
        selfSignUpEnabled: false,
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
          domainPrefix: config.get('MDAI_COGNITO.USER_POOL_DOMAIN'),
        },
      });

      mdaiAppClient = mdaiUserPool.addClient('mdai-app-client', {
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
            `https://${config.get('MDAI_COGNITO.UI_HOSTNAME')}/oauth2/idpresponse`,
          ],
        },
      });
      mdaiAppClient.node.addDependency(mdaiUserPoolDomain);

      consoleIngress.userPoolArn = mdaiUserPool.userPoolArn
      consoleIngress.userPoolClientId = mdaiAppClient.userPoolClientId
      consoleIngress.userPoolDomain = config.get('MDAI_COGNITO.USER_POOL_DOMAIN')
    }

    const consoleConfig = {
      chart: config.get('MDAI_CONSOLE.CHART'),
      repository: config.get('MDAI_CONSOLE.REPO'),
      namespace: config.get('MDAI_CONSOLE.NAMESPACE'),
      createNamespace: true,
      release: config.get('MDAI_CONSOLE.RELEASE'),
      version: config.get('MDAI_CONSOLE.VERSION'),
      wait: true,
      values: {
        'ingress': consoleIngress,
      }
    };

    const mdaiConsole = cluster.addHelmChart("mdai-console", consoleConfig);
    if (config.get('MDAI_COGNITO.ENABLE') && mdaiAppClient) {
      mdaiConsole.node.addDependency(mdaiAppClient);
    } 

    //
    //    Karpenter
    //
    // steps (non-cdk way) taken from here
    // https://karpenter.sh/docs/getting-started/migrating-from-cas/
    if (config.get('KARPENTER.ENABLE')) {
      const karpenterNodeRole = new iam.Role(
          this,
          `KarpenterNodeRole-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`, 
          {
            roleName: `KarpenterNodeRole-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`,
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
            ],
          }
      );


      new iam.InstanceProfile(
          this,
          `KarpenterNodeInstanceProfile-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`, {
            instanceProfileName: `KarpenterNodeInstanceProfile-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`,
            role: karpenterNodeRole,
          });


      const conditions = new cdk.CfnJson(this, 'ConditionAudienceServiceAccount', {
        value: {
          [`${cluster.clusterOpenIdConnectIssuer}:aud`]: 'sts.amazonaws.com',
          [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${config.get('KARPENTER.NAMESPACE')}:karpenter`,
        },
      });

      const karpenterControllerRole = new iam.Role(
          this,
          `KarpenterControllerRole-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`, {
            roleName: `KarpenterControllerRole-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`,
            assumedBy: new iam.FederatedPrincipal(`arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:oidc-provider/${cluster.clusterOpenIdConnectIssuer}`, {
                  'StringEquals': conditions
                },
                'sts:AssumeRoleWithWebIdentity')
          }
      )

      const conditionsRequestTag = new cdk.CfnJson(this, 'ConditionTagRequestTag', {
        value: {
          [`aws:RequestTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:RequestTag/topology.kubernetes.io/region': `${cdk.Aws.REGION}`,
        },
      });

      const conditionsResourceTagRequestTag = new cdk.CfnJson(this, 'ConditionResourceTagRequestTag', {
        value: {
          [`aws:ResourceTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:ResourceTag/topology.kubernetes.io/region': `${cdk.Aws.REGION}`,
          [`aws:RequestTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:RequestTag/topology.kubernetes.io/region': `${cdk.Aws.REGION}`,
        },
      });

      const conditionsResourceTag = new cdk.CfnJson(this, 'ConditionResourceTag', {
        value: {
          [`aws:ResourceTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:ResourceTag/topology.kubernetes.io/region': `${cdk.Aws.REGION}`,
        },
      });

      const karpenterControllerPolicy = new iam.Policy(this, `KarpenterControllerPolicy-${config.get('CLUSTER.NAME')}-${process.env.AWS_REGION}`, {
        statements: [
          new iam.PolicyStatement({
            resources: ['*'],
            effect: iam.Effect.ALLOW,
            sid: 'Karpenter',
            actions: [
              'ssm:GetParameter',
              'ec2:DescribeImages',
              'ec2:RunInstances',
              'ec2:DescribeSubnets',
              'ec2:DescribeSecurityGroups',
              'ec2:DescribeLaunchTemplates',
              'ec2:DescribeInstances',
              'ec2:DescribeInstanceTypes',
              'ec2:DescribeInstanceTypeOfferings',
              'ec2:DescribeAvailabilityZones',
              'ec2:DeleteLaunchTemplate',
              'ec2:CreateTags',
              'ec2:CreateLaunchTemplate',
              'ec2:CreateFleet',
              'ec2:DescribeSpotPriceHistory',
              'pricing:GetProducts'
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ec2:TerminateInstances'],
            resources: ['*'],
            sid: 'ConditionalEC2Termination',
            conditions: {
              StringLike: {
                "ec2:ResourceTag/karpenter.sh/nodepool": "*"
              }
            }
          }),
          new iam.PolicyStatement({
            resources: [`arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/${karpenterNodeRole.roleName}`],
            effect: iam.Effect.ALLOW,
            sid: 'PassNodeIAMRole',
            actions: [
              'iam:PassRole'
            ],
          }),
          new iam.PolicyStatement({
            resources: [`arn:${cdk.Aws.PARTITION}:eks:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:cluster/${cluster.clusterName}`],
            effect: iam.Effect.ALLOW,
            sid: 'EKSClusterEndpointLookup',
            actions: [
              'eks:DescribeCluster'
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['iam:CreateInstanceProfile'],
            resources: ['*'],
            sid: 'AllowScopedInstanceProfileCreationActions',
            conditions: {
              StringEquals: conditionsRequestTag,
              StringLike: {
                'aws:RequestTag/karpenter.k8s.aws/ec2nodeclass': '*'
              }
            }
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['iam:TagInstanceProfile'],
            resources: ['*'],
            sid: 'AllowScopedInstanceProfileTagActions',
            conditions: {
              StringEquals: conditionsResourceTagRequestTag,
              StringLike: {
                'aws:RequestTag/karpenter.k8s.aws/ec2nodeclass': '*',
                'aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass': '*'
              }
            }
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'iam:AddRoleToInstanceProfile',
              'iam:RemoveRoleFromInstanceProfile',
              'iam:DeleteInstanceProfile'
            ],
            resources: ['*'],
            sid: 'AllowScopedInstanceProfileActions',
            conditions: {
              StringEquals: conditionsResourceTag,
              StringLike: {
                'aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass': '*'
              }
            }
          }),
          new iam.PolicyStatement({
            resources: [`*`],
            effect: iam.Effect.ALLOW,
            sid: 'AllowInstanceProfileReadActions',
            actions: [
              'iam:GetInstanceProfile'
            ],
          }),
        ],
      });
      karpenterControllerRole.attachInlinePolicy(karpenterControllerPolicy);

      // Karpenter: tagging subnets belonging to the cluster nodegroup
      // NB: might be better to do this outside of CDK and call aws cli commands from Makefile
      // because security groups tagging can not be done here anyways

      cdk.Tags.of(cluster).add('karpenter.sh\/discovery', `${config.get('CLUSTER.NAME')}`, {
        includeResourceTypes: ['AWS::EC2::Subnet'],
      });
    }
    
    // Add Datalyzer service to helm chart for installation
    
    cluster.addHelmChart("datalyzer", {
      chart: config.get('DATALYZER.CHART'),
      repository: config.get('DATALYZER.REPO'),
      namespace: config.get('DATALYZER.NAMESPACE'),
      createNamespace: true,
      release: config.get('DATALYZER.RELEASE'),
      version: config.get('DATALYZER.VERSION'),
      wait: true,
    });
  }
}
