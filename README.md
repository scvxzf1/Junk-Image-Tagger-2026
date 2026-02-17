# 打标器（Labeler Web）

一个基于 Node.js + Express 的本地化图像打标工具，内置：

- 渠道管理（OpenAI 兼容接口）
- 调度组与多步骤重试规则
- 文件分组与图像批量读取
- 图像打标与实时预览
- 打标补全（按阈值筛选）
- Tag 管理与结果保存

> 默认访问地址：`http://127.0.0.1:30101`

---

## 功能概览

- **渠道管理**：配置 API URL、多 Key 轮询、拉取模型列表。
- **调度组-渠道规则**：多级步骤、并发、超时、重试与间隔控制。
- **文件目录管理**：管理数据分组，支持跨平台文件夹选择。
- **图像打标**：批量打标，任务执行过程中即时渲染预览。
- **打标补全**：按“失败阈值”筛选短文本，补全后手动保存（不再自动覆盖）。
- **打标日志**：记录请求过程与关键事件，便于定位问题。
- **配置中心**：导入导出状态数据，快速迁移配置。

---

## 运行环境

- Node.js 18+
- npm 8+
- Windows / Linux / macOS

---

## 本地开发启动

```bash
npm install
npm start
```

等价于：

```bash
node server.js
```

可通过环境变量修改端口：

```bash
PORT=30101 npm start
```

---

## 一键部署（无 Docker）

项目已提供三端独立的一键部署脚本：

- Linux：`deploy/deploy-linux.sh`
- macOS：`deploy/deploy-macos.sh`
- Windows：`deploy/deploy-windows.bat`

根目录也有快捷入口：

- `deploy-linux.sh`
- `deploy-macos.sh`
- `deploy-windows.bat`

### Linux（systemd 用户服务）

```bash
bash deploy-linux.sh
```

### macOS（LaunchAgent）

```bash
bash deploy-macos.sh
```

### Windows（登录自启）

双击运行：

```text
deploy-windows.bat
```

> 详细命令见 `DEPLOY.md`

---

## 数据持久化说明

- 运行时数据文件：`data.json`
- 打包模式首次运行会由 `data.default.json` 初始化
- 前端静态资源目录：`public/`

> 建议定期备份 `data.json`，避免误操作造成配置丢失。

---

## 打包发布（Windows EXE）

项目使用 `pkg` 进行打包，仓库中已包含示例产物：

- `dist/labeler-web.exe`

如需重新打包，可在项目根目录执行（示例）：

```bash
npx pkg server.js --targets node18-win-x64 --output dist/labeler-web.exe
```

---

## 常见问题

### 1) 页面提示接口返回 HTML（`Unexpected token '<'`）

通常是后端未正确启动或路由未命中。

处理方式：

1. 确认 `server.js` 已启动
2. 打开 `http://127.0.0.1:30101/api/health` 检查返回
3. 清理旧进程后重启服务

### 2) 预览图像偶发加载失败

当前已做失败重试与占位兜底；若仍频繁失败，优先检查：

- 源图路径是否存在
- 文件读权限是否正常
- 并发设置是否过高

### 3) 打标补全是否会自动覆盖原文？

不会。当前策略为：

- 补全任务只更新界面结果
- 只有你手动点击保存时才写入文件

---

## 目录结构

```text
.
├── server.js                # 后端服务入口
├── public/                  # 前端页面与脚本样式
├── deploy/                  # 三端部署脚本
├── dist/                    # 打包产物目录
├── data.default.json        # 默认数据模板
├── data.json                # 运行时配置与状态
├── DEPLOY.md                # 部署细节说明
└── README.md
```

---

## 许可与使用

当前仓库未单独声明 License。若用于团队或商用场景，建议先补充许可证与使用规范。
