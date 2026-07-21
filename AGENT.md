# Mockserver Agent Instructions

## Scope

This repository provides a visual HTTP and gRPC mock service. Follow the existing project structure and treat the implementation as the source of truth:

- Project and configuration normalization: `server/store.js`
- HTTP request matching: `server/matcher.js`
- HTTP Mock runtime: `server/mockEngine.js`
- gRPC runtime: `server/grpcEngine.js` and `server/grpcRuntime.js`
- Client URL resolution: `server/utils/environment.js`
- Configuration UI behavior: `client/src/`

Do not introduce business-specific endpoints, credentials, hosts, or assumptions unless the user supplies them for the current task.

## Generating Mockserver configurations

When asked to generate or convert a Mockserver configuration from API documentation, OpenAPI/Swagger, curl examples, or source code, create importable YAML under `configs/`.

Use this workflow:

1. Read all provided inputs and identify project metadata.
2. Classify each endpoint as an inbound `api` or outbound `clientApi`.
3. Generate YAML that follows the current configuration schema.
4. Validate the generated file.
5. Save it as `configs/<project-slug>.yaml` and summarize the result.

Read `.cursor/skills/generate-mockserver-config/schema.md` when field-level details are needed.

## Endpoint direction

| Type | Direction | Mockserver role | Typical source signal |
| --- | --- | --- | --- |
| `api` | Inbound | Receives HTTP requests on the project Mock port and returns configured responses | Server routes, handlers, callbacks, webhooks, notifications, or requests made by the system under test |
| `clientApi` | Outbound | Sends HTTP requests from the Mockserver UI to an external service | HTTP client code, `fetch`, `axios`, curl requests targeting the system under test, or user-triggered test calls |

Rule of thumb:

- The system under test calls Mockserver: use `api`.
- The tester sends a request from Mockserver to the system under test: use `clientApi`.

## Input analysis

For each endpoint, extract only information supported by the provided input:

- HTTP method and path
- Path and query parameters
- Shared and endpoint-specific headers
- Request body
- Expected response status, headers, and body
- Endpoint direction

For server-side routes, map the route and handler behavior to `apis[].match` and `apis[].response`.

For outbound HTTP client code:

- Split a full URL into `environments[].host` and a path-only `clientApis[].url`.
- Put shared authentication or common headers in `clientHeaders`.
- Keep endpoint-specific headers and bodies on the corresponding `clientApi`.

Do not invent undocumented request fields, responses, or credentials. If required information is missing, use safe local defaults and clearly state the assumption.

## Configuration rules

1. Use `projects:` as the root key and generate one project unless multiple projects are requested.
2. Write IDs as unique kebab-case slugs.
3. Default new projects to `host: 0.0.0.0`, `port: 3900`, and `enabled: false`.
4. Define at least one environment and ensure `activeEnvironmentId` matches an environment ID when `clientApis` are present.
5. Keep `clientApis[].url` as a path such as `/items/:id`, never as a full URL.
6. Keep `apis[].match.path` as a path; inbound mocks listen on the project HTTP host and port.
7. Store path parameter values in `pathParams` and query parameter values in `queryParams`.
8. Use `pathParamDescriptions` and `queryParamDescriptions` only for UI labels; they are not sent with requests.
9. Put shared headers in `clientHeaders` and endpoint-specific overrides in `clientApis[].headers`.
10. Use YAML block scalars for multiline JSON request or response bodies.
11. Never include secrets or production credentials in generated configurations.

The final outbound URL is resolved from the active environment host, the `clientApi` path, substituted path parameters, and query parameters.

## Response templates

HTTP Mock response bodies support template variables. Variables provided by the runtime include:

| Variable | Value |
| --- | --- |
| `{{MESSAGE_TIME}}` | Current timestamp |
| `{{MESSAGEGROUPSYSID}}` | Generated identifier |
| `{{robotTaskCode}}` | `robotTaskCode` from the request JSON body |
| `{{notifyNo}}` | `notifyNo` from the request JSON body, or a generated identifier |

Verify template behavior against `server/mockEngine.js` before adding new documented variables.

## Validation

Validation is required for every generated configuration:

```bash
node .cursor/skills/generate-mockserver-config/scripts/validate-config.js configs/<project-slug>.yaml
```

Resolve validation errors before delivery. Review warnings and either fix them or explain why they are acceptable.

After validation, report:

- The generated file path
- The number of projects, `apis`, and `clientApis`
- The configured environments
- Any assumptions or remaining validation warnings

Users can load the result through the import action in the management UI. Avoid documenting internal control endpoints unless the user explicitly requests API-level integration details.
