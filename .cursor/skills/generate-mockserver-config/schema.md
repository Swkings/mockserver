# Mockserver configuration schema

The import model and defaults are defined in [server/store.js](../../../server/store.js). [Examples](examples.md) include complete importable files.

## Configuration and environments

| Field | Meaning |
| --- | --- |
| `projects` | Project array. Stable IDs identify projects during import. |
| `environments` | Shared environment array. Use stable, unique IDs and unique names. Names are trimmed and compared case-insensitively after Unicode normalization. |
| `environmentLayout` | Optional tree containing `{ type: environment, id }` or `{ type: folder, id, name, children }` entries. Omit it to use a flat list. |

Each environment may include the following fields.

| Field | Meaning |
| --- | --- |
| `id`, `name` | Identifier referenced by projects and the display name. |
| `host` | HTTP service gateway base, including `http://` or `https://`. It can include a path prefix. |
| `grpcTarget` | gRPC gateway address, for example `grpc.example.com:50051`. The Client's `useTls` controls TLS in gateway mode. |
| `headers`, `cookies` | Shared HTTP defaults. Use key/value maps with string values. |
| `nodePorts` | Map from project `serviceKey` to an endpoint. HTTP uses `{ ip, port, protocol }`; gRPC can use a nested `grpc: { ip, port, protocol }` and otherwise falls back to the HTTP entry. |

For each NodePort, `ip` accepts an IP address or a host name, `port` is an integer from 1 through 65535, and `protocol` is `http` or `https`. The gRPC labels in the UI are plaintext and TLS.

## Project

| Field | Meaning |
| --- | --- |
| `id`, `name`, `description` | Identifier, display name and optional description. |
| `serviceKey` | Unique key used by NodePort. Use lowercase letters, digits, hyphens or underscores, starting with a letter or digit. |
| `host`, `port`, `enabled` | HTTP Mock listener. Use `0.0.0.0`, `3900` and `false` when the input supplies no listener settings. |
| `grpcHost`, `grpcPort`, `grpcEnabled` | gRPC Mock listener. Use port `50051` and set `grpcEnabled: false` for a new listener. |
| `activeEnvironmentId`, `nodePortEnabled` | Shared environment reference and the optional switch to direct NodePort connections. Configure the selected environment and service endpoint before enabling direct mode. |
| `clientHeaders`, `clientCookies` | Service-wide HTTP overrides. |
| `apis`, `clientApis`, `grpcMocks`, `grpcClients` | Inbound and outbound interface arrays. |
| `apiFolders`, `clientApiFolders`, `grpcMockFolders`, `grpcClientFolders` | Optional lists of `{ id, name, parentId }`. Associate an interface by setting its `folderId`. |
| `protos` | Shared project Proto definitions. Each definition has `id`, `name`, `filename` and `content`. |

## Inbound HTTP Mock

Use `apis[].match.method` and a path-only `apis[].match.path`. Paths support literal matches, `/items/:id`, `/items/{id}`, `pathPrefix: true` and wildcard or regex rules. Use `match.headers`, `bodyContains` or `jsonMatch` for request constraints. Higher `priority` is evaluated first. Set `response.status`, `response.headers`, `response.body` and optional `response.delayMs`.

Use a YAML block scalar for JSON response text. The HTTP Mock runtime supports `{{MESSAGE_TIME}}`, `{{MESSAGEGROUPSYSID}}`, `{{robotTaskCode}}` and `{{notifyNo}}`. The last two read request JSON. See [server/mockEngine.js](../../../server/mockEngine.js) for their fallbacks.

## Outbound HTTP Client

| Field | Meaning |
| --- | --- |
| `method`, `url` | HTTP method and request path such as `/items/:id`. Keep the scheme and host in the selected environment. |
| `pathParams`, `queryParams` | Parameter values. The optional `pathParamDescriptions` and `queryParamDescriptions` supply UI labels. |
| `headers`, `useProjectHeaders`, `useProjectCookies` | HTTP interface headers and inheritance switches. The merge order is environment, service, interface. Later values win, and Header names are compared case-insensitively. NodePort skips environment Cookies and proxy settings. |
| `bodyType` | `text` (default), `multipart` or `binary`. Choose the local upload file at send time. |
| `fileFieldName`, `body` | Multipart field name (default `file`), plus a JSON object encoded as text for optional multipart fields. With `text`, `body` is the request body. With `binary`, the chosen file is the request body. |
| `allowGetBody` | Opt-in to send a Body with GET. |

The response offers a download when the server supplies `Content-Disposition` or returns nonempty content recognized as binary. An interface needs no download flag.

## gRPC

Set `protoId`, `packageName`, `serviceName` and `methodName` on each method. Use `response` for a Mock response and `request` for a Client payload. Both fields accept JSON text. A Client can set `metadata`, `timeoutMs` and `useTls`. The Client resolves the target from the selected environment's gRPC gateway by default, falls back to the method's `target`, and uses the configured NodePort in direct mode. Set `useEnvironment: false` for a method-specific gateway-mode target.
