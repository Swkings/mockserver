# Mockserver Agent Instructions

## Implementation

- Configuration, shared environments, import and export live in [server/store.js](server/store.js). Use top-level `environments` for generated configurations and connect projects through `activeEnvironmentId`.
- HTTP URL, gRPC target, NodePort, Headers and Cookies resolution share [shared/environment.js](shared/environment.js). Update the shared resolver when an editor preview and the actual request need the same behavior.
- HTTP Mock matching and response templates live in [server/matcher.js](server/matcher.js) and [server/mockEngine.js](server/mockEngine.js). HTTP Client sends and file transfers live in [server/routes.js](server/routes.js). The gRPC runtime is in [server/grpcRuntime.js](server/grpcRuntime.js).
- Preserve the selected interface, filter, scroll position and unsaved edits when changing workbench navigation or panel layout. Reuse the existing controls and theme tokens in [client/src/](client/src/).
- Run `npm test` for server and shared logic changes and `npm run build` for frontend changes. Use synthetic hosts, payloads and credentials in test fixtures.

## Generating configurations

For requests to generate or convert Mockserver YAML from API documentation, OpenAPI, cURL, Proto or source code, follow the [generate-mockserver-config skill](.cursor/skills/generate-mockserver-config/SKILL.md). It specifies how to classify traffic, choose the current schema, write the file under `configs/` and validate it before delivery.
