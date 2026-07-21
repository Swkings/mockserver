# Mockserver

Mockserver 是一个带可视化管理界面的本地 Mock 服务工具，用于创建、运行和调试 HTTP 与 gRPC 服务。它支持在同一进程中管理多个项目，每个项目都可以独立配置服务地址、接口和运行状态。

## 功能

- 多项目管理，HTTP 与 gRPC Mock 服务可独立启停
- HTTP 请求匹配、自定义响应和延迟响应
- 基于 Proto 的 gRPC Mock 与 gRPC Client
- HTTP Client 请求管理，支持环境、公共 Headers 和 Cookies
- 实时请求记录，查看请求、响应、耗时和匹配结果
- 使用目录组织 HTTP、gRPC Mock 和 Client 配置
- 项目配置导入与导出
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

HTTP Mock、HTTP Client、gRPC Mock 和 gRPC Client 均可使用目录进行分类管理。项目配置可通过界面导入或导出，便于备份和迁移。

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
