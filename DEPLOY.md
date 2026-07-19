# 车费分摊 · 部署与管理指南

## 当前线上信息

| 项目 | 内容 |
|------|------|
| 网址 | https://transportfunds.pages.dev |
| 管理员口令 | `heartunderblade` |
| 网页托管 | Cloudflare Pages（项目名 `transportfunds`） |
| 数据存储 | Supabase 表 `app_state`（所有人共用一份） |
| 代码仓库 | https://github.com/zuosi114514/transportfunds |

发给同伴时只需提供：**网址 + 管理员口令**。所有人登录后均可编辑。连续 5 次输错口令将锁定 30 分钟。

---

## 日常管理

### 1. 查看 / 分享网址

直接打开 https://transportfunds.pages.dev 即可。网址永久有效，更新网页后地址不变。

### 2. 更改口令

口令在构建时通过环境变量注入，改完需重新构建并部署。现在只有一个管理员口令：

1. 编辑项目根目录的 `.env`，修改 `VITE_ADMIN_PASSWORD`：

```env
VITE_SUPABASE_URL=https://nreyuviaobqhobppotfa.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_w5w3BaIjciCZKIlgiGMFsg_qYMSrbX-
VITE_ADMIN_PASSWORD=新管理员口令
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
| 平时增删行程 | 登录后直接在网页上操作，会自动同步 |
| 恢复初始数据 | 点「重置为初始数据」 |
| 清空行程 | 点「清空行程」——只清空行程记录，**保留成员名单**，并自动保存一份历史结算快照 |
| 查看历史结算 | 网页底部「历史结算记录」区域 |
| 后台查看原始数据 | [Supabase Dashboard](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa) → **Table Editor** → `app_state` |

**行程字段**：每条行程可填写日期、时间、车费、备注（默认「取经」）、乘车人。

**每月 31 号自动结算**：在有 31 天的月份（1、3、5、7、8、10、12 月）的 31 号，任何人打开页面时会自动触发结算——保存一份历史结算快照并清空行程记录，**保留成员名单**。同月只触发一次，多人打开不冲突。

**登录锁定**：连续 5 次输错口令，该浏览器锁定 30 分钟。锁定期间无法登录，需等待倒计时结束。

> **首次升级到带历史记录 / 自动结算的版本**：需在 [Supabase SQL Editor](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/sql/new) 执行一次以下语句为 `app_state` 表补加列（已执行过可跳过）：
>
> ```sql
> alter table public.app_state add column if not exists history jsonb not null default '[]'::jsonb;
> alter table public.app_state add column if not exists last_auto_settle text not null default '';
> ```
>
> 执行前历史记录和自动结算月份只在当前会话内有效；执行后才会持久化到云端，所有人都能看到。

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
| `VITE_ADMIN_PASSWORD` | 管理员口令（登录后可编辑） |

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

**登录时提示「已锁定」**
→ 连续输错 5 次口令触发了锁定。等待 30 分钟后自动解锁，或清除浏览器 localStorage 后重试。

**点「清空行程」后成员没了？**
→ 不会。「清空行程」只清空行程记录，成员名单会保留。

**每月 31 号自动清空了行程，但我没点过？**
→ 这是自动结算功能。在有 31 天的月份的 31 号，系统会自动保存一份结算快照并清空行程，保留成员。可在「历史结算记录」查看结算详情。

**口令安全说明**
共享口令适合熟人小范围使用，能挡住随便点开链接的人，不是银行级权限。不要把口令发到公开群；定期更换更安全。连续输错锁定机制可防止暴力破解。

## 免费说明

当前方案基于两家服务商的免费额度，长期免费：

| 服务 | 用途 | 免费额度 | 注意事项 |
|------|------|---------|---------|
| Cloudflare Pages | 网页托管 | 无限带宽、无限请求、每月 500 次构建 | 本项目部署频率远低于上限，永久免费 |
| Supabase | 数据库 | 500MB 存储、5GB 出站流量、无需信用卡 | ⚠️ 连续 7 天无数据库活动会被自动暂停，需登录 Dashboard 手动恢复 |

**避免 Supabase 暂停**：只要每周有人打开网页查看或记录行程，数据库就会保持活跃。如果连续 7 天没人用，会被暂停（数据不丢，恢复即可）。如需保险，可设置 GitHub Actions 定时 ping 数据库。
