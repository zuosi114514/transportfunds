# 车费分摊 · 部署与管理指南

## 当前线上信息

| 项目 | 内容 |
|------|------|
| 网址 | https://transportfunds.pages.dev |
| 共享口令 | `chefei123` |
| 网页托管 | Cloudflare Pages（项目名 `transportfunds`） |
| 数据存储 | Supabase 表 `app_state`（所有人共用一份） |
| 代码仓库 | https://github.com/zuosi114514/transportfunds |

发给同伴时只需提供：**网址 + 共享口令**。

---

## 日常管理

### 1. 查看 / 分享网址

直接打开 https://transportfunds.pages.dev 即可。网址永久有效，更新网页后地址不变。

### 2. 更改共享口令

口令在构建时通过环境变量注入，改完需重新构建并部署。

1. 编辑项目根目录的 `.env`，修改 `VITE_APP_PASSWORD`：

```env
VITE_SUPABASE_URL=https://nreyuviaobqhobppotfa.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_w5w3BaIjciCZKIlgiGMFsg_qYMSrbX-
VITE_APP_PASSWORD=新口令
```

2. 构建并部署：

```bash
npm run deploy
```

3. 把**新口令**通知同伴。旧口令立即失效；已登录的人需点右上角「退出」后重新输入。

### 3. 更新网页（改了界面或功能后）

本地改完代码后，一条命令完成构建和部署：

```bash
npm run deploy
```

部署完成后让同伴**强制刷新**页面（手机可清缓存或用无痕窗口）。

### 4. 管理 / 清空车费数据

数据在 Supabase 数据库，不在网页文件里。

| 操作 | 做法 |
|------|------|
| 平时增删行程 | 直接在网页上操作，会自动同步 |
| 恢复示例数据 | 网页里点「载入示例」 |
| 清空全部 | 网页里点「清空全部」 |
| 后台查看原始数据 | [Supabase Dashboard](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa) → **Table Editor** → `app_state` |

### 5. 暂时下线网站

任选其一：

- Cloudflare Dashboard → Pages → `transportfunds` → **Pause deployment**
- 或改口令且不告诉别人（链接还在，但进不去）

恢复：取消暂停，或重新 `npm run deploy`。

### 6. 更换 / 轮换 Supabase 密钥

1. [Supabase Dashboard](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/settings/api-keys) → 复制新的 **Publishable key**
2. 更新 `.env` 里的 `VITE_SUPABASE_ANON_KEY`
3. 运行 `npm run deploy`

---

## 本地开发

```bash
npm install
npm run dev
```

浏览器打开终端提示的地址，用 `.env` 里的口令登录。本地改的数据也会写入同一个 Supabase（与线上共用）。

---

## 首次部署（已完成，仅供参考）

### A. Supabase 数据库

在 [Supabase SQL Editor](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/sql/new) 执行 `supabase/schema.sql`，创建 `app_state` 表并启用实时同步。

### B. Cloudflare Pages

```bash
# 登录 Cloudflare（首次，会打开浏览器授权）
npx wrangler login

# 创建 Pages 项目
npx wrangler pages project create transportfunds --production-branch=main

# 构建并部署
npm run deploy
```

部署成功后得到 https://transportfunds.pages.dev。

### C. 环境变量

`.env` 文件包含三个变量，构建时会被注入到网页中：

| 变量名 | 说明 |
|--------|------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Publishable / anon 密钥 |
| `VITE_APP_PASSWORD` | 共享口令 |

---

## 常见问题

**登录页提示未配置环境变量**
→ `.env` 未填，或构建时没有带上三个 `VITE_*` 变量。

**进入后加载失败 / 无法连接**
→ `supabase/schema.sql` 未执行成功，或 URL / 密钥填错。

**别人看不到我的修改**
→ 确认 `app_state` 已加入 Realtime；或让对方下拉刷新。

**改了口令但还能用旧口令**
→ 没有重新 `npm run deploy`；或对方浏览器还开着旧页面，让他点「退出」或强制刷新。

**口令安全说明**
共享口令适合熟人小范围使用，能挡住随便点开链接的人，不是银行级权限。不要把口令发到公开群；定期更换更安全。
