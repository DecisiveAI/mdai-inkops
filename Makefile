ifneq (,$(wildcard ./.env))
    include .env
    export
endif

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
install: npm-init bootstrap cdk kubectl-config set-role-map
