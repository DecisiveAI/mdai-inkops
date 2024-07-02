import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DecisiveEngineAwsCdkStack } from "../lib/decisive-engine-aws-cdk-stack";

let app: cdk.App, stack: cdk.Stack, template: Template;

beforeAll(() => {
  app = new cdk.App();
  const stack = new DecisiveEngineAwsCdkStack(app, "DecisiveEngine");
  template = Template.fromStack(stack);
});

describe("DecisiveEngine", () => {
  describe("VPCs", () => {
    it("should have a VPC", () => {
      template.hasResourceProperties(
        "AWS::EC2::VPC",
        Match.objectLike({
          EnableDnsHostnames: true,
        })
      );
    });
  });
  describe("Nodegroups", () => {
    it("should have a Nodegroup", () => {
      template.hasResourceProperties(
        "AWS::EKS::Nodegroup",
        Match.objectLike({
          AmiType: "AL2_x86_64",
          InstanceTypes: ["t2.micro"],
        })
      );
    });
  });
  describe("Helm charts", () => {
    it("should have a CertManager Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://charts.jetstack.io",
          Namespace: "cert-manager",
          CreateNamespace: true,
          Release: "cert-manager",
          Version: "1.13.1",
          Wait: true,
          Values: '{"installCRDs":true}',
        })
      );
    });
    it("should have an OTELOperator Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://decisiveai.github.io/mdai-helm-charts",
          Namespace: "opentelemetry-operator-system",
          CreateNamespace: true,
          Release: "opentelemetry-operator",
          Version: "0.43.1",
          Wait: true,
          Values:
            '{"admissionWebhooks":{"certManager":{"enabled":true}},"manager":{"image":{"repository":"public.ecr.aws/p3k6k6h3/opentelemetry-operator","tag":"latest"}}}',
        })
      );
    });
    it("should have a Prometheus Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://prometheus-community.github.io/helm-charts",
          Namespace: "default",
          CreateNamespace: true,
          Release: "prometheus",
          Version: "25.21.0",
          Wait: true,
          Values:
            '{"prometheus":{"enabled":true},"alertmanager":{"enabled":false},"configmapReload":{"prometheus":{"enabled":false}},"kube-state-metrics":{"enabled":true},"prometheus-node-exporter":{"enabled":false},"prometheus-pushgateway":{"enabled":false},"server":{"retention":"3d","extraFlags":["enable-feature=exemplar-storage","enable-feature=otlp-write-receiver","enable-feature=promql-experimental-functions"],"global":{"scrape_interval":"10s","scrape_timeout":"5s","evaluation_interval":"30s"},"persistentVolume":{"enabled":false,"storageClass":"-","volumeName":"prometheus-pv","size":"5Gi"},"service":{"servicePort":9090},"resources":{"limits":{"memory":"300Mi"}}},"serverFiles":{"prometheus.yml":{"scrape_configs":[{"job_name":"otel-collector","honor_labels":true,"tls_config":{"insecure_skip_verify":true},"kubernetes_sd_configs":[{"role":"pod"}],"relabel_configs":[{"source_labels":["__meta_kubernetes_pod_label_app_kubernetes_io_component","__meta_kubernetes_pod_annotation_prometheus_io_scrape"],"separator":";","regex":"opentelemetry-collector;true","action":"keep"},{"source_labels":["__address__"],"regex":".*:(431[78]|14250)","action":"drop"}]}]}}}',
        })
      );
    });
    it("should have an MDAI API Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://decisiveai.github.io/mdai-helm-charts",
          Namespace: "default",
          CreateNamespace: true,
          Release: "mdai-api",
          Version: "0.0.3",
          Wait: true,
        })
      );
    });
    it("should have an MDAI Console Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://decisiveai.github.io/mdai-helm-charts",
          Namespace: "default",
          CreateNamespace: true,
          Release: "mdai-console",
          Version: "0.1.1",
          Wait: true,
        })
      );
    });
    it("should have a Datalyzer Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://decisiveai.github.io/mdai-helm-charts",
          Namespace: "default",
          CreateNamespace: true,
          Release: "datalyzer",
          Version: "0.0.4",
          Wait: true,
        })
      );
    });
    it("should have a Metrics Server Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://kubernetes-sigs.github.io/metrics-server/",
          Namespace: "kube-system",
          Release: "metrics-server",
          Version: "3.12.1",
          Wait: true,
        })
      );
    });
    it("should have an MDAI Operator Helm chart", () => {
      template.hasResourceProperties(
        "Custom::AWSCDK-EKS-HelmChart",
        Match.objectLike({
          Repository: "https://decisiveai.github.io/mdai-helm-charts",
          Namespace: "mydecisive-engine-operator-system",
          CreateNamespace: true,
          Release: "mydecisive-engine-operator",
          Version: "0.0.3",
          Wait: true,
        })
      );
    });
  });
  describe("Kubernetes resources", () => {
    it("should have resources", () => {
      template.resourceCountIs("AWS::EKS::Nodegroup", 1);
      template.resourceCountIs("AWS::EC2::VPC", 1);
      template.resourceCountIs("Custom::AWSCDK-EKS-HelmChart", 9);
      template.resourceCountIs("AWS::EC2::Subnet", 4);
      template.resourceCountIs("AWS::EC2::NatGateway", 2);
      template.resourceCountIs("AWS::EC2::InternetGateway", 1);
      template.resourceCountIs("Custom::AWSCDK-EKS-KubernetesResource", 5);
    });
  });
});
