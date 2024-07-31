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

    if (config.get('mdai-console.acm-arn') === "") {
      throw new Error("MDAI_UI_ACM_ARN was not specified")
    }

    const engineMasterRole = new iam.Role(this, 'DecisiveEngineMasterRole', {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    const cluster = new eks.Cluster(this, config.get('cluster.name'), {
      clusterName: config.get('cluster.name'),
      version: eks.KubernetesVersion.V1_30,
      kubectlLayer: new KubectlLayer(this, 'kubectl'),
      mastersRole: engineMasterRole,
      defaultCapacity: Number(config.get('cluster.capacity')),
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
      ...config.util.toObject(config.get('cert-manager'))
    });

    const otelOperator = cluster.addHelmChart('otelOperator', {
      ...config.util.toObject(config.get('otel-operator'))
    });
    otelOperator.node.addDependency(certManager);

    const mdaiOperator = cluster.addHelmChart('mdaiOperator', {
      ...config.util.toObject(config.get('mdai-operator'))
    });
    mdaiOperator.node.addDependency(otelOperator);

    const mdaiOperatorCrManifest = yaml.load(readFileSync(path.join(__dirname, 'mdai-operator.yaml'), { encoding: 'utf-8' })) as Record<string, any>;
    cluster.addManifest('mdaiOperatorCrManifest', mdaiOperatorCrManifest).node.addDependency(mdaiOperator);

    const prometheus = cluster.addHelmChart('prometheus', {
      ...config.util.toObject(config.get('prometheus')),
      values: yaml.load(readFileSync(path.join(__dirname, '../templates/prometheus-values.yaml'), 'utf8')) as Record<string, any>,
    });
    prometheus.node.addDependency(otelOperator);

    const metricsServer = cluster.addHelmChart('metrics-server', {
      ...config.util.toObject(config.get('metrics-server')),
    });
    metricsServer.node.addDependency(prometheus);

    const mdaiApi = cluster.addHelmChart('mdai-api', {
      ...config.util.toObject(config.get('mdai-api')),
    });
    mdaiApi.node.addDependency(prometheus);

    let mdaiAppClient = {} as cdk.aws_cognito.UserPoolClient,
      consoleIngress = {
        'enabled': true,
        'cognito': {
          'enabled': Boolean(config.get('mdai-cognito.enable')),
        },
        'acmArn': config.get('mdai-console.acm-arn'),
        'userPoolArn': '',
        'userPoolClientId': '',
        'userPoolDomain': '',
      }

    if (config.get('mdai-cognito.enable')) {
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
          domainPrefix: config.get('mdai-cognito.user-pool-domain'),
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
            `https://${config.get('mdai-cognito.ui-hostname')}/oauth2/idpresponse`,
          ],
        },
      });
      mdaiAppClient.node.addDependency(mdaiUserPoolDomain);

      consoleIngress.userPoolArn = mdaiUserPool.userPoolArn
      consoleIngress.userPoolClientId = mdaiAppClient.userPoolClientId
      consoleIngress.userPoolDomain = config.get('mdai-cognito.user-pool-domain')
    }

    const consoleConfig = {
      ...config.util.toObject(config.get('mdai-console')),
      values: {
        'ingress': consoleIngress,
      }
    };

    const mdaiConsole = cluster.addHelmChart("mdai-console", consoleConfig);
    if (config.get('mdai-cognito.enable') && mdaiAppClient) {
      mdaiConsole.node.addDependency(mdaiAppClient);
    } 

    //
    //    Karpenter
    //
    // steps (non-cdk way) taken from here
    // https://karpenter.sh/docs/getting-started/migrating-from-cas/
    if (config.get('karpenter.enable')) {
      const karpenterNodeRole = new iam.Role(
          this,
          `KarpenterNodeRole-${config.get('cluster.name')}-${process.env.AWS_REGION}`, 
          {
            roleName: `KarpenterNodeRole-${config.get('cluster.name')}-${process.env.AWS_REGION}`,
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
          `KarpenterNodeInstanceProfile-${config.get('cluster.name')}-${process.env.AWS_REGION}`, {
            instanceProfileName: `KarpenterNodeInstanceProfile-${config.get('cluster.name')}-${process.env.AWS_REGION}`,
            role: karpenterNodeRole,
          });


      const conditions = new cdk.CfnJson(this, 'ConditionAudienceServiceAccount', {
        value: {
          [`${cluster.clusterOpenIdConnectIssuer}:aud`]: 'sts.amazonaws.com',
          [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${config.get('karpenter.namespace')}:karpenter`,
        },
      });

      const karpenterControllerRole = new iam.Role(
          this,
          `KarpenterControllerRole-${config.get('cluster.name')}-${process.env.AWS_REGION}`, {
            roleName: `KarpenterControllerRole-${config.get('cluster.name')}-${process.env.AWS_REGION}`,
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

      const karpenterControllerPolicy = new iam.Policy(this, `KarpenterControllerPolicy-${config.get('cluster.name')}-${process.env.AWS_REGION}`, {
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

      cdk.Tags.of(cluster).add('karpenter.sh\/discovery', `${config.get('cluster.name')}`, {
        includeResourceTypes: ['AWS::EC2::Subnet'],
      });
    }
    
    // Add Datalyzer service to helm chart for installation
    
    cluster.addHelmChart("datalyzer", {
      ...config.util.toObject(config.get('datalyzer'))
    });
  }
}
