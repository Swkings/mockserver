# Mockserver

Mockserver 是一个带可视化管理界面的本地 Mock 服务工具，用于创建、运行和调试 HTTP 与 gRPC 服务。它支持在同一进程中管理多个项目，每个项目都可以独立配置服务地址、接口和运行状态。

## 功能

- 多项目管理，HTTP 与 gRPC Mock 服务可独立启停
- HTTP 请求匹配、自定义响应和延迟响应
- 基于 Proto 的 gRPC Mock 与 gRPC Client
- HTTP Client 支持 multipart 和二进制文件上传，以及响应文件下载
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

- Node.js 22 或更高版本，也支持 20.18.1 及以上的 20.x
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

## 接口工作台

1. 在管理界面中新建项目。
2. 点击左侧项目名称打开接口抽屉，选择 HTTP Server、HTTP Client、gRPC Server 或 gRPC Client。可直接点击其他项目切换，也可向右拖动抽屉标题或点击收起按钮。
3. 配置 Mock 的监听地址、匹配规则和响应后启动服务，或为 Client 选好环境后发送请求。HTTP 请求栏在路径前显示实际使用的网关或 NodePort 地址。
4. 在「记录」中查看调用信息，或在当前请求的响应区查看结果和实际请求。

接口支持按文件夹分类。HTTP 接口列表可导入 OpenAPI 3、Swagger 2（YAML 或 JSON）、cURL 文本和已有的单接口配置。桌面端可拖动分隔条独立调节项目栏和接口栏的宽度，也可聚焦分隔条后使用左右方向键。列表支持滚动，滚动条默认隐藏。

### HTTP 文件上传与下载

- 在 HTTP Client 的 Body 页签选择「文件上传 (multipart/form-data)」或「文件上传 (二进制)」，选择本地文件后发送。multipart 支持自定义文件字段名，并可用 JSON 对象填写附加表单字段。单文件上限为 25 MB。
- 响应包含 `Content-Disposition` 或被识别为二进制文件时，点击响应区的「下载文件」保存文件。

### 共享环境与 NodePort

1. 在顶部「环境管理」中新建环境，在「配置」中编辑服务网关地址、gRPC 网关地址、Headers 和 Cookies。环境名称必须唯一。左侧环境列表支持拖动排序和嵌套文件夹，被项目引用的环境显示引用角标。
2. 在「项目设置」中设置唯一的服务 Key，并为项目选择环境。HTTP 请求按「环境 → 服务 → 接口」合并 Headers 和 Cookies，同名值以后一级为准。Header 名称不区分大小写。
3. 在环境管理的服务列表搜索并点击服务，直接定位到该服务的 NodePort 配置。保存 HTTP 或 gRPC 直连地址后，在项目设置或请求栏将连接模式切到「NodePort 直连」。gRPC 直连地址留空时沿用同一服务的 HTTP NodePort。

桌面端的环境列表和服务列表可独立调宽。NodePort 直连时，HTTP 请求跳过代理和环境 Cookies，仍可继承环境 Headers 和服务 Cookies。

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

通过顶部设置菜单导入或导出配置，用于备份和迁移。生成配置后，在仓库根目录运行校验命令，将示例路径替换成要导入的文件。[配置生成 skill](.cursor/skills/generate-mockserver-config/SKILL.md) · [YAML 示例](.cursor/skills/generate-mockserver-config/examples.md)

```bash
node .cursor/skills/generate-mockserver-config/scripts/validate-config.js configs/example-project.yaml
```

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
├── shared/          # 前后端共用的地址解析和环境布局逻辑
├── data/            # 本地运行数据（首次运行后生成）
├── package.json
└── README.md
```

## 测试

```bash
npm test
```
