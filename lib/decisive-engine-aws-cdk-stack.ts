import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as yaml from 'js-yaml';
import { readFileSync } from 'fs';
import { Construct } from 'constructs';
import { KubectlV28Layer } from '@aws-cdk/lambda-layer-kubectl-v28';
import * as path from 'path';
import 'dotenv/config'
import {CfnJson} from 'aws-cdk-lib/core/lib';

export class DecisiveEngineAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = {
      CLUSTER: {
        NAME: process.env.MDAI_CLUSTER_NAME || 'DecisiveEngineCluster',
        CAPACITY: Number(process.env.MDAI_CLUSTER_CAPACITY) || 10,
        INSTANCE: {
          CLASS: Object.values(ec2.InstanceClass).find(instanceClass => instanceClass === process.env.MDAI_EC2_INSTANCE_CLASS) || ec2.InstanceClass.T2 as ec2.InstanceClass,
          SIZE: Object.values(ec2.InstanceSize).find(instanceSize => instanceSize === process.env.MDAI_EC2_INSTANCE_SIZE) || ec2.InstanceSize.MICRO as ec2.InstanceSize,
        },
      },
      CERT_MANAGER: {
        NAMESPACE: 'cert-manager',
        REPO: 'https://charts.jetstack.io',
        VERSION: process.env.MDAI_CERT_MANAGER_VERSION || '1.13.1',
        CHART: 'cert-manager',
        RELEASE: 'cert-manager',
      },
      OTEL_OPERATOR: {
        NAMESPACE: 'opentelemetry-operator-system',
        REPO: 'https://decisiveai.github.io/mdai-helm-charts',
        VERSION: process.env.MDAI_OTEL_OPERATOR_VERSION || '0.43.1',
        CHART: 'opentelemetry-operator',
        RELEASE: 'opentelemetry-operator',
        MANAGER: {
          REPO: process.env.MDAI_OTEL_OPERATOR_MANAGER_REPO || 'public.ecr.aws/p3k6k6h3/opentelemetry-operator',
          VERSION: process.env.MDAI_OTEL_OPERATOR_MANAGER_VERSION || 'latest',
        },
      },
      PROMETHEUS: {
        NAMESPACE: 'default',
        REPO: 'https://prometheus-community.github.io/helm-charts',
        VERSION: process.env.MDAI_PROMETHEUS_VERSION || '25.11.0',
        CHART: 'prometheus',
        RELEASE: 'prometheus',
      },
      MDAI_API: {
        NAMESPACE: 'default',
        REPO: 'https://decisiveai.github.io/mdai-helm-charts',
        VERSION: process.env.MDAI_API_VERSION || '0.0.3',
        CHART: 'mdai-api',
        RELEASE: 'mdai-api',
      },
      MDAI_UI: {
        NAMESPACE: 'default',
        REPO: 'https://decisiveai.github.io/mdai-helm-charts',
        VERSION: process.env.MDAI_CONSOLE_VERSION || '0.0.6-cognito',
        CHART: 'mdai-console',
        RELEASE: 'mdai-console',
        ACM_ARN: process.env.MDAI_UI_ACM_ARN,
      },
      MDAI_COGNITO: {
        UI_HOSTNAME: process.env.MDAI_UI_HOSTNAME || 'console.mydecisive.ai',
        USER_POOL_DOMAIN: process.env.MDAI_UI_USER_POOL_DOMAIN || 'mydecisive',
      },
      KARPENTER: {
        ENABLE: process.env.KARPENTER || 'true',
        AWS_PARTITION: process.env.AWS_PARTITION || 'aws',
        NAMESPACE: 'kube-system'
      },
    }

    if (config.MDAI_UI.ACM_ARN == undefined) {
      throw new Error('MDAI_UI_ACM_ARN was not specified')
    }

    const engineMasterRole = new iam.Role(this, 'DecisiveEngineMasterRole', {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    const cluster = new eks.Cluster(this, config.CLUSTER.NAME, {
      clusterName: config.CLUSTER.NAME,
      version: eks.KubernetesVersion.V1_28,
      kubectlLayer: new KubectlV28Layer(this, 'kubectl'),
      mastersRole: engineMasterRole,
      defaultCapacity: config.CLUSTER.CAPACITY,
      defaultCapacityInstance: ec2.InstanceType.of(
        config.CLUSTER.INSTANCE.CLASS,
        config.CLUSTER.INSTANCE.SIZE,
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
      chart: config.CERT_MANAGER.CHART,
      repository: config.CERT_MANAGER.REPO,
      namespace: config.CERT_MANAGER.NAMESPACE,
      createNamespace: true,
      release: config.CERT_MANAGER.RELEASE,
      version: config.CERT_MANAGER.VERSION,
      wait: true,
      values: {
        installCRDs: true
      },
    });

    const otelOperator = cluster.addHelmChart('otelOperator', {
      chart: config.OTEL_OPERATOR.CHART,
      repository: config.OTEL_OPERATOR.REPO,
      namespace: config.OTEL_OPERATOR.NAMESPACE,
      createNamespace: true,
      release: config.OTEL_OPERATOR.RELEASE,
      version: config.OTEL_OPERATOR.VERSION,
      wait: true,
      values: {
        admissionWebhooks: {
          certManager: {
            enabled: true,
          },
        },
        manager: {
          image: {
            repository: config.OTEL_OPERATOR.MANAGER.REPO,
            tag: config.OTEL_OPERATOR.MANAGER.VERSION,
          },
        },
      },
    });
    otelOperator.node.addDependency(certManager);

    const collectorCrManifest = yaml.load(readFileSync(path.join(__dirname, 'otelcol.yaml'), { encoding: 'utf-8' })) as Record<string, any>;
    cluster.addManifest('collectorCrManifest', collectorCrManifest).node.addDependency(otelOperator);

    const prometheus = cluster.addHelmChart('prometheus', {
      chart: config.PROMETHEUS.CHART,
      repository: config.PROMETHEUS.REPO,
      namespace: config.PROMETHEUS.NAMESPACE,
      createNamespace: true,
      release: config.PROMETHEUS.RELEASE,
      version: config.PROMETHEUS.VERSION,
      wait: true,
      values: yaml.load(readFileSync(path.join(__dirname, '../templates/prometheus-values.yaml'), 'utf8')) as Record<string, any>,
    });
    prometheus.node.addDependency(otelOperator);

    const mdaiApi = cluster.addHelmChart('mdai-api', {
      chart: config.MDAI_API.CHART,
      repository: config.MDAI_API.REPO,
      namespace: config.MDAI_API.NAMESPACE,
      createNamespace: true,
      release: config.MDAI_API.RELEASE,
      version: config.MDAI_API.VERSION,
      wait: true,
    });
    mdaiApi.node.addDependency(prometheus);

    const mdaiUserPool= new cognito.UserPool(this, 'mdai-user-pool', {
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
        domainPrefix: config.MDAI_COGNITO.USER_POOL_DOMAIN,
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
          `https://${config.MDAI_COGNITO.UI_HOSTNAME}/oauth2/idpresponse`,
        ],
      },
    });
    mdaiAppClient.node.addDependency(mdaiUserPoolDomain);

    const mydecisiveEngineUi = cluster.addHelmChart('mdai-console', {
      chart: config.MDAI_UI.CHART,
      repository: config.MDAI_UI.REPO,
      namespace: config.MDAI_UI.NAMESPACE,
      createNamespace: true,
      release: config.MDAI_UI.RELEASE,
      version: config.MDAI_UI.VERSION,
      wait: true,
      values: {
        'ingress': {
          'userPoolArn': mdaiUserPool.userPoolArn,
          'userPoolClientId': mdaiAppClient.userPoolClientId,
          'userPoolDomain': config.MDAI_COGNITO.USER_POOL_DOMAIN,
        },
        'env': {
          'MDAI_UI_ACM_ARN': process.env.MDAI_UI_ACM_ARN,
        }
      }
    });
    mydecisiveEngineUi.node.addDependency(mdaiAppClient);

    //
    //    Karpenter
    //
    // steps (non-cdk way) taken from here
    // https://karpenter.sh/docs/getting-started/migrating-from-cas/
    if (config.KARPENTER.ENABLE === 'true') {

      const karpenterNodeRole = new iam.Role(
          this,
          'KarpenterNodeRole-' + config.CLUSTER.NAME, {
            roleName: 'KarpenterNodeRole-' + config.CLUSTER.NAME,
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
              iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
            ],
          });


      const karpenterInstanceProfile = new iam.InstanceProfile(
          this,
          'KarpenterNodeInstanceProfile', {
            instanceProfileName: 'KarpenterNodeInstanceProfile',
            role: karpenterNodeRole,
          });


      const conditions = new CfnJson(this, 'ConditionJson', {
        value: {
          [`${cluster.clusterOpenIdConnectIssuer}:aud`]: 'sts.amazonaws.com',
          [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${config.KARPENTER.NAMESPACE}:karpenter`,
        },
      });

      const karpenterControllerRole = new iam.Role(
          this,
          'KarpenterControllerRole-' + config.CLUSTER.NAME, {
            roleName: 'KarpenterControllerRole-' + config.CLUSTER.NAME,
            assumedBy: new iam.FederatedPrincipal(`arn:${config.KARPENTER.AWS_PARTITION}:iam::${process.env.AWS_ACCOUNT}:oidc-provider/${cluster.clusterOpenIdConnectIssuer}`, {
                  'StringEquals': conditions
                },
                'sts:AssumeRoleWithWebIdentity')
          }
      )

      const conditions2 = new CfnJson(this, 'ConditionJson2', {
        value: {
          [`aws:RequestTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:RequestTag/topology.kubernetes.io/region': `${process.env.AWS_REGION}`,
        },
      });

      const conditions3 = new CfnJson(this, 'ConditionJson3', {
        value: {
          [`aws:ResourceTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:ResourceTag/topology.kubernetes.io/region': `${process.env.AWS_REGION}`,
          [`aws:RequestTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:RequestTag/topology.kubernetes.io/region': `${process.env.AWS_REGION}`,
        },
      });

      const conditions4 = new CfnJson(this, 'ConditionJson4', {
        value: {
          [`aws:ResourceTag/kubernetes.io/cluster/${cluster.clusterName}`]: 'owned',
          'aws:ResourceTag/topology.kubernetes.io/region': `${process.env.AWS_REGION}`,
        },
      });

      const karpenterControllerPolicy = new iam.Policy(this, 'KarpenterControllerPolicy', {
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
            resources: [`arn:${config.KARPENTER.AWS_PARTITION}:iam::${process.env.AWS_ACCOUNT}:role/${karpenterNodeRole.roleName}`],
            effect: iam.Effect.ALLOW,
            sid: 'PassNodeIAMRole',
            actions: [
              'iam:PassRole'
            ],
          }),
          new iam.PolicyStatement({
            resources: [`arn:${config.KARPENTER.AWS_PARTITION}:eks:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT}:cluster/${cluster.clusterName}`],
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
              StringEquals: conditions2,
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
              StringEquals: conditions3,
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
              StringEquals: conditions4,
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

      const subnetsPub = cluster.vpc.selectSubnets(
          {
            subnetType: ec2.SubnetType.PUBLIC
          },
      ).subnets;

      const subnetsPriv = cluster.vpc.selectSubnets(
          {
            subnetType: ec2.SubnetType.PRIVATE
          },
      ).subnets;
      const subnets = subnetsPub.concat(subnetsPriv)

      cdk.Tags.of(this).add('karpenter.sh\/discovery', `${config.CLUSTER.NAME}`, {
        includeResources: subnets,
      });

      const vpcDefaultSecurityGroup = cluster.vpc.vpcDefaultSecurityGroup

      cdk.Tags.of(this).add('karpenter.sh\/discovery', `${config.CLUSTER.NAME}`, {
        includeResources: vpcDefaultSecurityGroup,
      });

    }


  }
}
