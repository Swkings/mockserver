---
name: generate-mockserver-config
description: Generate or convert importable Mockserver YAML from API documentation, OpenAPI, cURL, Proto or source code.
---

# Generate Mockserver configuration

1. Read the inputs and identify each project's traffic direction. Use `apis` and `grpcMocks` for calls received by Mockserver. Use `clientApis` and `grpcClients` for calls sent by Mockserver. For ambiguous OpenAPI or cURL inputs, use the stated testing goal and identify any assumption in the handoff.
2. Build the YAML using the [configuration schema](schema.md). Use kebab-case identifiers and a unique `serviceKey` for each project. Set `enabled: false` and `grpcEnabled: false` for new Mock listeners. Use documented hosts, headers and payloads. Use local or reserved example addresses and placeholders when the input omits values. Keep credentials out of the file.
3. For outbound HTTP calls, separate the gateway base from the request path. Put the base in top-level `environments[].host`, set the project's `activeEnvironmentId`, and use `pathParams` and `queryParams` for parameter values. For gRPC, place the supplied Proto in `projects[].protos` and link each method by `protoId`. Consult the [examples](examples.md) for NodePort, file uploads and shared Proto definitions.
4. Save to `configs/<project-slug>.yaml` and run the validator from the repository root with the generated file path.

   ```bash
   node .cursor/skills/generate-mockserver-config/scripts/validate-config.js configs/example-project.yaml
   ```

5. Resolve validation errors and review warnings. Report the file path, project and interface counts by type, environment names, and any assumptions or remaining warnings. Users import the project file from the topbar settings menu.
