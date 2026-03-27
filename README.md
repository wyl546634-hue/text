# 智能排座系统

一个基于 `Next.js 16 + React 19 + TypeScript` 的会议排座系统，适合内部小规模使用。

当前产品形态：
- `/` 公开只读页，普通人无需登录即可查看已发布会议
- `/admin` 管理后台，仅管理员可编辑会议、人员、布局和发布状态
- 管理员默认账号：`admin`
- 管理员默认密码：`admin123`

## 核心能力
- 多会议管理
- 大型报告厅、U 型、回形布局
- 自动排座与缺席递补
- Excel 导入
- 拖拽或点选交换座位
- PNG 导出
- 发布多个会议到公开页并切换查看

## 本地运行
先准备环境变量，参考 [`.env.example`](/D:/zuowei/.env.example)。

```powershell
npm install
npm run dev
```

默认地址：
- 公开页：[http://localhost:3000](http://localhost:3000)
- 后台：[http://localhost:3000/admin](http://localhost:3000/admin)

## 生产部署
当前推荐路线是：
- 代码托管到 GitHub
- 连接国内可访问的腾讯系前端平台做自动部署
- CloudBase 继续承载数据层

详细步骤见 [DEPLOYMENT.md](/D:/zuowei/DEPLOYMENT.md)。
