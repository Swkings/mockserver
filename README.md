# Mockserver

Mockserver 是一个带可视化管理界面的本地 Mock 服务工具，用于创建、运行和调试 HTTP 与 gRPC 服务。它支持在同一进程中管理多个项目，每个项目都可以独立配置服务地址、接口和运行状态。

## 功能

- 多项目管理，HTTP 与 gRPC Mock 服务可独立启停
- HTTP 请求匹配、自定义响应和延迟响应
- 基于 Proto 的 gRPC Mock 与 gRPC Client
- 全局环境管理，支持公共 Headers、Cookies 和按服务 Key 配置的 NodePort
- 实时请求记录，查看请求、响应、耗时和匹配结果
- 使用目录组织 HTTP、gRPC Mock 和 Client 配置
- 项目配置导入与导出，支持从 OpenAPI / Swagger 文件或 cURL 命令导入 HTTP 接口
- 深色与浅色主题

## 技术栈

- Node.js
- Express
- React
- Vite
- `@grpc/grpc-js`

## 环境要求

- Node.js 18 或更高版本
- npm

## 开发运行

安装依赖并启动开发环境：

```bash
npm install
npm run dev
```

启动后访问：

- 管理界面：<http://localhost:5173>
- 服务端：<http://localhost:3888>

开发模式会同时启动服务端和 Vite 前端开发服务器，前端请求会代理到服务端。

## 生产运行

构建前端并启动服务：

```bash
npm run build
npm start
```

启动后访问 <http://localhost:3888>。

## 基本使用

1. 在管理界面中新建项目。
2. 进入项目设置，配置 HTTP 或 gRPC 服务的监听地址和端口。
3. 新建 Mock 或 Client，并保存项目。
4. 启动对应的 Mock 服务。
5. 在请求记录中查看实时调用信息和匹配结果。

HTTP Mock、HTTP Client、gRPC Mock 和 gRPC Client 均可使用目录进行分类管理。接口列表中的导入面板支持 OpenAPI 3、Swagger 2（YAML / JSON）和 cURL 文本；原有的单接口配置文件也可以继续导入。项目配置可通过界面导入或导出，便于备份和迁移。

### 共享环境与 NodePort

1. 在顶部「环境管理」中新建环境，配置服务网关地址、gRPC 网关地址和公共 Headers、Cookies。环境列表支持拖动排序、嵌套文件夹和引用计数。
2. 在「项目设置」中设置唯一的服务 Key，并为项目选择环境。HTTP 请求按「环境 → 服务 → 接口」合并 Headers 和 Cookies，同名值以后一级为准。Header 名称不区分大小写。
3. 若要直连，在 NodePort 页签中配置各服务的 HTTP 和 gRPC 直连地址。回到项目或接口调试器，将连接模式切到「NodePort 直连」。留空的 gRPC 直连地址沿用同一服务的 HTTP NodePort。直连时 HTTP 跳过环境的公共 Cookies，并保留公共 Headers、服务 Cookies 与接口 Cookies。

旧配置中的项目环境列表会迁入全局环境。旧的项目级 Headers 和 Cookies 会继续作为服务覆盖项。配置文件将共享环境保存于顶层 `environments`，项目通过 `activeEnvironmentId` 引用。

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动服务端与前端开发服务器 |
| `npm run build` | 构建前端静态资源 |
| `npm start` | 以生产模式启动服务 |
| `npm test` | 运行服务端测试 |

## 配置与数据

项目配置保存在 `data/projects.yaml` 中。保存时会通过临时文件替换原配置，并在需要时保留 `data/projects.yaml.bak` 作为备份。

`data/`、`dist/` 和依赖目录不会提交到版本库。需要迁移配置时，建议使用管理界面的导入、导出功能。

管理服务默认监听 `3888` 端口，可通过环境变量修改：

```bash
CONTROL_PORT=4000 npm start
```

## 项目结构

```text
.
├── client/          # React 管理界面
├── server/          # 服务端、Mock 运行时与请求匹配逻辑
│   └── test/        # 服务端测试
├── data/            # 本地运行数据（首次运行后生成）
├── package.json
└── README.md
```

## 测试

```bash
npm test
```
