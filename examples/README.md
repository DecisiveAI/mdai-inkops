**NOTE: These examples are pulled directly from the [OTel Proto Docs](https://github.com/open-telemetry/opentelemetry-proto/tree/main/examples)**

# OTLP JSON request examples

This folder contains a collection of example OTLP JSON files for all signals
that can be used as request payloads.

HTTP
- Trace [trace.json](http_service/trace.json)
- Metrics [metrics.json](http_service/metrics.json)
- Logs [logs.json](http_service/logs.json)
 
gRPC
- Trace [trace.json](grpc_service/trace.json)
- Metrics [metrics.json](grpc_service/metrics.json)
- Logs [logs.json](grpc_service/logs.json)


# Sending a curl

Send a `curl` request to the collector (e.g. for Logs):

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
cat ./examples/grpc_service/logs.json |
grpcurl -vv \
    -d @ \
    -proto examples/protos/opentelemetry/proto/collector/logs/v1/logs_service.proto \
    -import-path examples/protos \
    otlp.grpc.endpoint.collector.your-domain.io \
    opentelemetry.proto.collector.logs.v1.LogsService/Export


cat ./examples/grpc_service/logs.json |
grpcurl -vv -insecure \
    -d @ \
    -proto examples/protos/opentelemetry/proto/collector/logs/v1/logs_service.proto \
    -import-path examples/protos \
    otlp.grpc.endpoint.collector.us-east-1.mydecisive.ai:443 \
    opentelemetry.proto.collector.logs.v1.LogsService/Export
```

> Remember to change the URL path when sending other signals (traces/metrics).
