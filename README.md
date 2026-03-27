# 智能排座系统

一个基于 `Next.js 16 + React 19 + TypeScript` 的会议排座系统，适合内部小规模使用。

## 当前形态

- `/`：公开只读页，普通人直接查看已发布会议
- `/admin`：管理员后台，用于编辑会议、人员、布局和发布状态
- 默认管理员账号：`admin`
- 默认管理员密码：`admin123`

## 功能

- 多会议管理
- 大型报告厅、U 型、回形布局
- 自动排座与缺席递补
- Excel 导入
- 拖拽或点选交换座位
- PNG 导出
- 多个会议发布到公开页并切换查看

## 本地运行

先复制环境变量模板：

```powershell
Copy-Item .env.example .env.local
```

然后安装依赖并启动：

```powershell
npm install
npm run dev
```

默认地址：

- 公开页：[http://localhost:3000](http://localhost:3000)
- 后台：[http://localhost:3000/admin](http://localhost:3000/admin)

## 长期稳定配置

正式环境推荐使用长期 CloudBase 密钥：

- `CLOUDBASE_CREDENTIAL_MODE=long-lived`
- `CLOUDBASE_SECRET_ID`
- `CLOUDBASE_SECRET_KEY`
- `CLOUDBASE_REGION`

不要把临时 `CLOUDBASE_SESSION_TOKEN` 当成正式配置。

详细部署方式见 [DEPLOYMENT.md](/C:/Users/Administrator/.codex/worktrees/1fe9/zuowei/DEPLOYMENT.md)。
