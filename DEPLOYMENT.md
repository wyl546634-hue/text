# 国内部署说明

## 当前推荐

正式环境使用：

- GitHub 自动部署到 EdgeOne Pages
- CloudBase 作为数据层
- `/` 公开只读访问
- `/admin` 管理后台

## 长期稳定的关键

不要继续依赖临时 `CLOUDBASE_SESSION_TOKEN`。

正式环境建议固定使用下面这组变量：

```env
CLOUDBASE_ENV_ID=你的环境 ID
CLOUDBASE_REGION=ap-shanghai
CLOUDBASE_CREDENTIAL_MODE=long-lived
CLOUDBASE_SECRET_ID=你的长期 SecretId
CLOUDBASE_SECRET_KEY=你的长期 SecretKey
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_SESSION_SECRET=自定义随机长字符串
```

说明：

- `CLOUDBASE_CREDENTIAL_MODE=long-lived` 表示只走长期密钥
- 正式环境不要再配置 `CLOUDBASE_SESSION_TOKEN`
- `CLOUDBASE_REGION` 必须和 CloudBase 环境地域一致

## 临时救火模式

如果只是临时排障，可以短时间使用：

```env
CLOUDBASE_CREDENTIAL_MODE=temporary
CLOUDBASE_SECRET_ID=临时 SecretId
CLOUDBASE_SECRET_KEY=临时 SecretKey
CLOUDBASE_SESSION_TOKEN=临时 SessionToken
```

但这种方式会过期，不适合作为正式后台方案。

## EdgeOne Pages 构建配置

- Framework: `Next.js`
- Install Command: `npm install`
- Build Command: `npm run build`
- Start Command: `npm run start`
- Node Version: `22`

## 上线后检查

1. 打开 `/admin`
2. 使用 `admin / admin123` 登录
3. 确认 `/api/admin/runtime` 里没有“临时凭证”警告
4. 新建会议并保存
5. 发布会议后回到 `/` 查看
6. 刷新页面，确认数据仍在

## 建议

- 尽快把 `ADMIN_PASSWORD` 改掉，不要长期使用默认密码
- `ADMIN_SESSION_SECRET` 使用随机长字符串
- CloudBase 集合至少保留：
  - `meetings`
  - `public_state`
