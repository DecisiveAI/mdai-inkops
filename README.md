# Decisive Engine deployment 
сreates an AWS CDK stack that deploys an EKS cluster with the following components:

- AWS Cert-Manager for managing TLS certificates
- OpenTelemetry Operator for deploying the OpenTelemetry Collector
- Prometheus for monitoring the cluster
- MyDecisive API and MyDecisive Engine UI, which are the main components of the Decisive Engine
## Deployment steps

* `make config`     configures aws client, cdk stack and Otel CR
* `make bootstrap`  bootstraps cdk stack deployment
* `make install`    runs cdk stack deployment
* `make clean`      cleans up environment, removes log files

## Destroy stack
* `cdk destroy`

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

