**NOTE: These examples are pulled directly from the [OTel Proto Docs](https://github.com/open-telemetry/opentelemetry-proto/tree/main/examples)**

# OTLP JSON request examples

This folder contains a collection of example OTLP JSON files for all signals
that can be used as request payloads.

- Trace [trace.json](trace.json)
- Metrics [metrics.json](metrics.json)
- Logs [logs.json](logs.json)

## Trying it out

First run a OpenTelemetry collector with the following configuration:

```yaml
receivers:
  otlp:
    protocols:
      http:

exporters:
  logging:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [logging]
    metrics:
      receivers: [otlp]
      exporters: [logging]
    logs:
      receivers: [otlp]
      exporters: [logging]
```

Then send a curl request to the collector (e.g. for Logs):

```shell
# Set OTLP endpoint
export OTLP_ENDPOINT=HOST:PORT

# execute the request using the data from the example log data file
curl -X POST -H "Content-Type: application/json" -d @./examples/http_service/logs.json -i http://${OTLP_ENDPOINT}/v1/logs
```

You can also send a gcurl request to the collector (e.g. for Logs):

## Install grpcurl

Find your method for downloading using their [Installation Guide](https://github.com/fullstorydev/grpcurl)

or 

Via homebrew
```shell
brew install grpcurl
```

```shell
# Set OTLP endpoint
export OTLP_ENDPOINT=HOST:PORT

# use data from ./examples/grpc_service/logs.json AND
# run the request using the data (as stdin) copied from above
cat ./examples/grpc_service/metrics.json |
grpcurl \
  -d @ \
  -proto examples/protos/opentelemetry/proto/collector/metrics/v1/metrics_service.proto \
  -import-path examples/protos \
  -plaintext \
  ${OTLP_ENDPOINT} \
  opentelemetry.proto.collector.metrics.v1.MetricsService/Export
```

> Remember to change the URL path when sending other signals (traces/metrics).
