ifneq (,$(wildcard ./.env))
    include .env
    export
endif

include make/Makefile-local-recipes

.EXPORT_ALL_VARIABLES:
# parameters values
PARAMS_AWS_FILE=values/aws.env
PARAMS_OTEL_FILE=values/params-values-otel.yaml
# templates
OTEL_TMPL_FILE=templates/otel-tmpl.yaml
OTELCOL_CFG_FILE=values/otelcol-config.yaml
# out files
OTELCOL_OUT_FILE= lib/otelcol.yaml
# kubectl config
CDK_OUTPUTS_FILE=cdk-output.json
KUBECTL_CFG_CMD=kubectl-cfg-command

TMPL_RESOLVER_AWS_CDK=resolve_aws_templates.go
TMPL_RESOLVER_OTEL=resolve_otel_templates.go

KARPENTER_VERSION=0.36.1
KARPENTER_NAMESPACE=kube-system

.PHONY: build
.SILENT: build
build: mdai-install

.SILENT: mdai-install
mdai-install:
	go build -o mdai-install ./*.go

.SILENT: .env
dot-env:
	@touch .env

.PHONY: config-aws
.SILENT: config-aws
config-aws: dot-env
	cat ${PARAMS_AWS_FILE} | while read line; \
	do  \
		name=`echo $${line} | cut -d = -f 1`; \
		grep -v $${name} .env >> .env.tmp && mv .env.tmp .env; \
		echo $${line} >> .env; \
	done;

.PHONY: config-otel
.SILENT: config-otel
config-otel: build
	./mdai-install otel;

.PHONY: go-mod
.SILENT: go-mod
go-mod:
	go mod tidy;

.PHONY: go-test
.SILENT: go-test
go-test:
	go test -v;

.PHONY: test
.SILENT: test
test: go-test

.PHONY: npm-init
.SILENT: npm-init
npm-init:
	npm install;

.PHONY: npm-build
.SILENT: npm-build
npm-build:
	npm run build;

.PHONY: config
.SILENT: config
config: go-mod config-aws config-otel

.PHONY: cdk
.SILENT: cdk
cdk:
	cdk deploy --outputs-file ${CDK_OUTPUTS_FILE};

.PHONY: kubectl-config
.SILENT: kubectl-config
kubectl-config: build
	./mdai-install kubecfg; \
	`cat $(KUBECTL_CFG_CMD)`;

.PHONY: get-aws-role
.SILENT: get-aws-role
get-aws-role:
	SSOROLE=$(shell aws sts get-caller-identity --query Arn --output text --profile ${AWS_PROFILE} | cut -d/ -f2); \
    ACCOUNT=$(shell aws sts get-caller-identity --query Account --output text --profile  ${AWS_PROFILE}); \
    grep -v "AWS_SSO_ROLE" .env > .env.tmp && mv .env.tmp .env; \
    echo "AWS_SSO_ROLE=arn:aws:iam::$${ACCOUNT}:role/$${SSOROLE}" >> .env;

.PHONY: set-role-map
.SILENT: set-role-map
set-role-map: get-aws-role build dot-env
	export $(shell sed '/^\#/d' .env) ; \
	./mdai-install ekscfg

.PHONY: bootstrap
.SILENT: bootstrap
bootstrap:
	@if aws cloudformation describe-stacks --stack-name CDKToolkit  > /dev/null 2>&1; then \
		echo "CDKToolkit exists for the region, skipping bootstrap."; \
	else \
		echo "Running 'cdk bootstrap'."; \
		cdk bootstrap; \
	fi

.PHONY: clean
.SILENT: clean
clean:
	rm -rf mdai-install cdk.out node_modules cdk-output.json kubectl-cfg-command .cdk.staging

.PHONY: realclean
.SILENT: realclean
realclean:
	git clean -fxd

.PHONY: install
.SILENT: install
ifeq ($(KARPENTER),true)
install: npm-init bootstrap cdk kubectl-config set-role-map karpenter
else
install: npm-init bootstrap cdk kubectl-config set-role-map
endif


.PHONY: cert-gen
.SILENT: cert-gen
cert-gen: config-aws
	@ACM_ARN=$(shell openssl req -new -x509 -sha256 -nodes -newkey rsa:2048 -keyout /tmp/private_mdai.key -out /tmp/certificate_mdai.crt -subj "/CN=${MDAI_UI_HOSTNAME}" && \
	aws acm import-certificate --region ${AWS_REGION} --profile ${AWS_PROFILE} --certificate fileb:///tmp/certificate_mdai.crt --private-key fileb:///tmp/private_mdai.key --output text) ; \
	grep -v "MDAI_UI_ACM_ARN" .env > .env.tmp && mv .env.tmp .env; \
	echo "MDAI_UI_ACM_ARN=$${ACM_ARN}" >> .env; \
	sed  -i .tmp -E "s|(service.beta.kubernetes.io\/aws-load-balancer-ssl-cert: )[^#]*( #.*){0,1}|\1$${ACM_ARN}\2|; s|(alb.ingress.kubernetes.io\/certificate-arn: )[^#]*( #.*){0,1}|\1$${ACM_ARN}\2|" ${PARAMS_OTEL_FILE} && \
	rm ${PARAMS_OTEL_FILE}.tmp ; \
	echo "If desired, copy your cert's ARN for your records: $${ACM_ARN}"; \
	echo "You can view your cert here: https://${AWS_REGION}.console.aws.amazon.com/acm/home?region=${AWS_REGION}#/certificates/list" ; \
	rm -f /tmp/certificate_mdai.crt /tmp/private_mdai.key ; \

.PHONY: cert
.SILENT: cert
cert: cert-gen config

.PHONY: karpenter
karpenter: karpenter-tag-sg karpenter-update-aws-auth karpenter-crd karpenter-helm karpenter-nodeclass

.PHONY: karpenter-tag-sg
karpenter-tag-sg:
	@SECURITY_GROUPS=$(shell aws eks describe-cluster --name ${MDAI_CLUSTER_NAME} --query "cluster.resourcesVpcConfig.clusterSecurityGroupId" --profile ${AWS_PROFILE} --region ${AWS_REGION}) && \
	aws ec2 create-tags --tags "Key=karpenter.sh/discovery,Value=${MDAI_CLUSTER_NAME}" --resources $${SECURITY_GROUPS} --profile ${AWS_PROFILE} --region ${AWS_REGION}

.PHONY: karpenter-update-aws-auth
karpenter-update-aws-auth:
	eksctl create iamidentitymapping --cluster ${MDAI_CLUSTER_NAME} --username system:node:{{EC2PrivateDNSName}} \
	--group system:bootstrappers,system:nodes --arn arn:aws:iam::${AWS_ACCOUNT}:role/KarpenterNodeRole-${MDAI_CLUSTER_NAME}-${AWS_REGION} \
	--profile ${AWS_PROFILE} --region ${AWS_REGION}

.PHONY: karpenter-crd
karpenter-crd:
	kubectl create namespace "${KARPENTER_NAMESPACE}" || true
	kubectl apply -f "https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${KARPENTER_VERSION}/pkg/apis/crds/karpenter.sh_nodepools.yaml"
	kubectl apply -f "https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${KARPENTER_VERSION}/pkg/apis/crds/karpenter.k8s.aws_ec2nodeclasses.yaml"
	kubectl apply -f "https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${KARPENTER_VERSION}/pkg/apis/crds/karpenter.sh_nodeclaims.yaml"

.PHONY: karpenter-helm
karpenter-helm:
	@NODEGROUP=$(shell aws eks list-nodegroups --cluster-name "${MDAI_CLUSTER_NAME}" --query 'nodegroups[0]' --output text --profile ${AWS_PROFILE}) && \
	helm upgrade -i karpenter oci://public.ecr.aws/karpenter/karpenter --version ${KARPENTER_VERSION} --namespace ${KARPENTER_NAMESPACE} \
        --set settings.clusterName=${MDAI_CLUSTER_NAME} \
        --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=arn:aws:iam::${AWS_ACCOUNT}:role/KarpenterControllerRole-${MDAI_CLUSTER_NAME}-${AWS_REGION}" \
        --set-json "affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution={\"nodeSelectorTerms\":[{\"matchExpressions\":[{\"key\":\"karpenter.sh/kubectl createkubectl createnodepool\",\"operator\":\"DoesNotExist\"}]},{\"matchExpressions\":[{\"key\":\"eks.amazonaws.com/nodegroup\",\"operator\":\"In\",\"values\":[\""$${NODEGROUP}"\"]}]}]}" \
        --set controller.resources.requests.cpu=250m \
        --set controller.resources.requests.memory=250Mi \
        --set controller.resources.limits.cpu=500m \
        --set controller.resources.limits.memory=500Mi

.PHONY: karpenter-nodeclass
karpenter-nodeclass:
	touch .k8s_version .arm_ami_parameter_name .arm_ami_id .amd_ami_parameter_name .amd_ami_id && \
	aws eks describe-cluster --name ${MDAI_CLUSTER_NAME} --query cluster.version --out text --profile ${AWS_PROFILE} > .k8s_version && \
	echo "/aws/service/eks/optimized-ami/`cat .k8s_version`/amazon-linux-2-arm64/recommended/image_id" > .arm_ami_parameter_name && \
    echo "/aws/service/eks/optimized-ami/`cat .k8s_version`/amazon-linux-2/recommended/image_id" > .amd_ami_parameter_name && \
	aws ssm get-parameter --name `cat .arm_ami_parameter_name` --query Parameter.Value --output text --profile ${AWS_PROFILE} > .arm_ami_id && \
	aws ssm get-parameter --name `cat .amd_ami_parameter_name` --query Parameter.Value --output text --profile ${AWS_PROFILE} > .amd_ami_id
	export ARM_AMI_ID=`cat .arm_ami_id`&& export AMD_AMI_ID=`cat .amd_ami_id` && \
	cat templates/karpenter-ec2nodeclass.yaml | envsubst > templates/karpenter-ec2nodeclass-values.yaml && \
	rm .k8s_version .arm_ami_parameter_name .arm_ami_id .amd_ami_parameter_name .amd_ami_id
	kubectl apply -f templates/karpenter-nodepool.yaml
	kubectl apply -f templates/karpenter-ec2nodeclass-values.yaml