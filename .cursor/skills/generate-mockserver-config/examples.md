# Configuration examples

## HTTP Mock and Client with a shared environment

The system calls Mockserver at `POST /webhooks/orders`. The tester uses Mockserver to call the example service and upload a file. The same service can use the gateway or its NodePort.

```yaml
environments:
  - id: example-dev
    name: Example Dev
    host: https://gateway.example.com
    grpcTarget: grpc.example.com:443
    headers:
      X-Environment: dev
    nodePorts:
      orders:
        ip: 192.0.2.10
        port: 30080
        protocol: http
        grpc:
          ip: 192.0.2.10
          port: 30551
          protocol: http

projects:
  - id: orders
    name: Orders
    serviceKey: orders
    host: 0.0.0.0
    port: 3900
    enabled: false
    grpcEnabled: false
    activeEnvironmentId: example-dev
    nodePortEnabled: false
    clientHeaders:
      X-Client: mockserver
    apis:
      - id: order-webhook
        name: Order webhook
        match:
          method: POST
          path: /webhooks/orders
        response:
          status: 200
          headers:
            Content-Type: application/json
          body: |
            {"received":true,"timestamp":"{{MESSAGE_TIME}}"}
    clientApis:
      - id: get-order
        name: Get order
        method: GET
        url: /orders/:id
        pathParams:
          id: order-1
        pathParamDescriptions:
          id: 订单 ID
        queryParams:
          include: items
      - id: upload-order-attachment
        name: Upload order attachment
        method: POST
        url: /orders/:id/attachments
        pathParams:
          id: order-1
        bodyType: multipart
        fileFieldName: attachment
        body: |
          {"category":"receipt"}
```

## gRPC Client with a shared Proto

```yaml
environments:
  - id: echo-dev
    name: Echo Dev
    grpcTarget: grpc.example.com:50051

projects:
  - id: echo
    name: Echo
    serviceKey: echo
    enabled: false
    grpcEnabled: false
    activeEnvironmentId: echo-dev
    protos:
      - id: echo-proto
        name: Echo
        filename: echo.proto
        content: |
          syntax = "proto3";
          package example;
          service Echo {
            rpc Say (EchoMessage) returns (EchoMessage);
          }
          message EchoMessage {
            string text = 1;
          }
    grpcClients:
      - id: say
        name: Say
        protoId: echo-proto
        packageName: example
        serviceName: Echo
        methodName: Say
        request: |
          {"text":"hello"}
```
