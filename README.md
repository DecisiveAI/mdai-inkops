# Decisive Engine deployment

## ⚠️ **Pre-Alpha Disclaimer**
This open-source project is currently under construction and is subject to frequent changes and updates. For more information about our pre-alpha release, see our [Pre-Alpha Disclaimer](./DISCLAIMER.md)

----

Creates an AWS CDK stack that deploys an EKS cluster with the following components:

- AWS Cert-Manager for managing TLS certificates
- OpenTelemetry Operator for deploying the OpenTelemetry Collector
- Prometheus for monitoring the cluster
- MyDecisive API and MyDecisive Engine UI, which are the main components of the Decisive Engine
## Deployment steps

- `make config` configures aws client, cdk stack and Otel CR
- `make bootstrap` bootstraps cdk stack deployment
- `make install` runs cdk stack deployment
- `make clean` cleans up environment, removes log files

## Destroy stack

- `cdk destroy`

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template

## Local Deployment commands

- `make create-mdai` deploy a local cluster from scratch
- `make delete-mdai` deletes mdai cluster deployed locally and all artifacts associated
- `make delete-mdai-all` deletes mdai cluster deployed locally and all artifacts associated, plus helm charts
- `make update-mdai-collector` updates mdai the collector to the latest configuration

_Make sure to update your `.bashrc` or `.zshrc` file with the following:_

```@bash
export GOBIN=${GOBIN:-$(go env GOPATH)/bin}
```

----

## 🚀 Coming Soon - Roadmap

We understand you may be curious about what we're working on next. We're hard at work planning out our next few phases of development. We will soon be posting a roadmap that will include exciting features and improvements that we have high hopes you will love! 

🍿 Stay tuned for updates and announcements.
