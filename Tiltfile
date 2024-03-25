# restrict to the kind-mdai-local cluster so we don't accidentally deploy to a cloud cluster
allow_k8s_contexts('kind-mdai-local')

load('ext://helm_remote', 'helm_remote')

helm_remote('opentelemetry-operator',
            repo_name='opentelemetry',
            repo_url='https://decisiveai.github.io/mdai-helm-charts',
            set=['admissionWebhooks.certManager.enabled=false',
                 'admissionWebhooks.certManager.autoGenerateCert=true',
                 'manager.image.repository=public.ecr.aws/p3k6k6h3/opentelemetry-operator',
                 'manager.image.tag=latest'],
            version='0.43.1')
k8s_resource(
    workload='opentelemetry-operator',
    labels=['opentelemetry-operator']
)

# load otel collector
k8s_yaml('lib/otelcol.yaml')

# create a resource to check for opentelemetry-operator and
# depend on by the test-collector so it starts after it
local_resource(
  name='verify-collector-operator',
  cmd='kubectl wait --for=condition=Available --timeout=300s -n default deployment/opentelemetry-operator',
  resource_deps=['opentelemetry-operator'],
  labels=['opentelemetry-operator']
)

k8s_resource(
    new_name='test-collector',
    objects=['test-collector'],
    resource_deps=['verify-collector-operator'],
    labels=['collector']
)


helm_remote('prometheus',
            repo_name='prometheus-community',
            repo_url='https://prometheus-community.github.io/helm-charts',
            values=['./templates/prometheus-values.yaml'])

k8s_resource(
  workload='prometheus-server',
  port_forwards=[
    port_forward(9090, 9090, 'prometheus-server')
  ],
  labels=['prometheus']
)
k8s_resource(
    workload='prometheus-kube-state-metrics',
    labels=['prometheus']
)


# helm_remote('mdai-api', repo_name='mydecisive', repo_url='https://decisiveai.github.io/mdai-helm-charts')
# helm_remote('mdai-console', repo_name='mydecisive', repo_url='https://decisiveai.github.io/mdai-helm-charts')

yaml = helm('../mdai-api/deployment/',
            # The release name, equivalent to helm --name
            name='mdai-api',
            # The namespace to install in, equivalent to helm --namespace
            namespace='default',
            # The values file to substitute into the chart.
            values=['../mdai-api/deployment/values.yaml']
            # Values to set from the command-line
            # set=['service.port=1234', 'ingress.enabled=true']
            )
k8s_yaml(yaml)
k8s_resource(
  workload='mdai-api',
  resource_deps=['prometheus-server'],
  labels='backend'
)

yaml = helm('../mdai-console/deployment/',
            # The release name, equivalent to helm --name
            name='mdai-console',
            # The namespace to install in, equivalent to helm --namespace
            namespace='default',
            # The values file to substitute into the chart.
            values=['../mdai-console/deployment/values.yaml']
            # Values to set from the command-line
            # set=['service.port=1234', 'ingress.enabled=true']
            )
k8s_yaml(yaml)
k8s_resource(
  workload='mdai-console',
  port_forwards=[
    port_forward(5555, 5173, 'mdai-console')
  ],
  labels=['frontend']
)
