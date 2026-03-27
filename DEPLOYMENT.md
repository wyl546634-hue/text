# GitHub 自动部署说明

## 当前推荐方案
今晚不再使用 `CloudBase Framework CLI` 发布。

正式上线方式改为：
1. 把当前仓库推到 GitHub
2. 在腾讯系国内可访问平台连接 GitHub 仓库
3. 平台自动构建并发布
4. 运行时继续读取 CloudBase 数据

这样后续每次推送代码，都可以自动更新线上版本。

## 仓库要求
当前仓库已经满足自动部署前提：
- `npm run build` 可通过
- `npm run start` 可作为生产启动命令
- `next.config.ts` 已启用 `output: "standalone"`
- 公开页和后台结构已固定

## 推荐平台配置
推荐把当前仓库连到支持 `Next.js` 全栈自动部署的平台。

构建配置统一使用：
- 安装命令：`npm install`
- 构建命令：`npm run build`
- 启动命令：`npm run start`
- 服务端口：`3000`

## 线上环境变量
至少配置这些变量：

```env
CLOUDBASE_ENV_ID=test-1g02c1uk63f209a8
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_SESSION_SECRET=seat-admin-secret
```

如需启用 AI 识图，再补：

```env
ARK_API_KEY=
ARK_VISION_MODEL=
ARK_BASE_URL=
```

## 上线后验证
1. 打开正式网址 `/`
2. 确认公开页可加载
3. 打开 `/admin`
4. 使用 `admin / admin123` 登录
5. 新建并发布两个会议
6. 返回 `/`，确认两个会议都能查看和切换
7. 修改一个会议后刷新公开页，确认变更生效

## 当前说明
- 代码已经切到 CloudBase 数据层
- 管理后台继续是单管理员模式
- 公开页继续是多已发布会议切换模式
- 旧的 `CloudBase Framework CLI` 文件不再作为正式发布入口
