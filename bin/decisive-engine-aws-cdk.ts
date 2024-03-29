#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DecisiveEngineAwsCdkStack } from '../lib/decisive-engine-aws-cdk-stack';
import { userInfo } from 'os';

const app = new cdk.App({
  context: {
    "defaults": {
      "cluster": {
        "name": "DecisiveEngineCluster",
        "instance": {
          "class": "t2",
          "size": "micro"
        },
        "capacity": 10
      },
      "otel_operator": {
        "namespace": "opentelemetry-operator-system",
        "repo": "https://decisiveai.github.io/mdai-helm-charts",
        "version": "0.43.1",
        "chart": "opentelemetry-operator",
        "release": "opentelemetry-operator",
        "manager": {
          "repo": "public.ecr.aws/p3k6k6h3/opentelemetry-operator",
          "version": "latest"
        }
      },
      "prometheus": {
        "namespace": "default",
        "repo": "https://prometheus-community.github.io/helm-charts",
        "version": "25.11.0",
        "chart": "prometheus",
        "release": "prometheus"
      },
      "mdai_api": {
        "namespace": "default",
        "repo": "https://decisiveai.github.io/mdai-helm-charts",
        "version": "0.0.3",
        "chart": "mdai-api",
        "release": "mdai-api"
      },
      "mdai_console": {
        "namespace": "default",
        "repo": "https://decisiveai.github.io/mdai-helm-charts",
        "version": "0.0.6-cognito",
        "chart": "mdai-console",
        "release": "mdai-console",
        "acm_arn": ""
      },
      "mdai_cognito": {
        "ui_hostname": "console.mydecisive.ai",
        "user_pool_domain": "mydecisive"
      }
    }
  }
});
const stackname = app.node.tryGetContext('stacksuffix') ? `DecisiveEngineAwsCdkStack-${app.node.tryGetContext('stacksuffix')}` : `DecisiveEngineAwsCdkStack`;
const theMdaiStack = new DecisiveEngineAwsCdkStack(app, stackname, {
  description: "Decisive Engine AWS CDK Stack",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION,
  }
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});
cdk.Tags.of(theMdaiStack).add("StackType", "DecisiveEngineAwsCdkStack")
cdk.Tags.of(theMdaiStack).add("Creator", userInfo().username)
