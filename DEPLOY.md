# ♿冲刺♿ · 部署与管理指南

## 当前线上信息

| 项目 | 内容 |
|------|------|
| 网址 | https://transportfunds.pages.dev |
| 访问方式 | 所有人打开网址即可查看，无需口令 |
| 管理员口令 | `heartunderblade`（登录后可编辑） |
| 网页托管 | Cloudflare Pages（项目名 `transportfunds`） |
| 数据存储 | Supabase 表 `app_state`（所有人共用一份） |
| AI 日报 | Cloudflare Pages Function `/api/ai-news`，每天 8 点后抓取，缓存于 Supabase |
| 代码仓库 | https://github.com/zuosi114514/transportfunds |

发给同伴时只需提供：**网址**。所有人打开链接即可查看车费数据；如需编辑，点右上角「管理员登录」并输入**管理员口令**。连续 5 次输错口令将锁定 30 分钟。

---

## 日常管理

### 1. 查看 / 分享网址

直接打开 https://transportfunds.pages.dev 即可。网址永久有效，更新网页后地址不变。

**默认权限**：所有人打开链接即可**查看**车费数据，无需口令。需要**编辑**（增删行程、改成员、清空、重置）时，点右上角「管理员登录」并输入管理员口令。

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

3. 把**新口令**通知需要编辑的同伴。旧口令立即失效；已登录的管理员需点右上角「退出」后重新输入。

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
| 平时增删行程 | 点「管理员登录」输入口令后，在网页上直接操作，会自动同步 |
| 恢复初始数据 | 管理员点「重置为初始数据」 |
| 清空行程 | 管理员点「清空行程」——只清空行程记录，**保留成员名单**，并自动保存一份历史结算快照 |
| 查看历史结算 | 网页底部「历史结算记录」区域（无需登录即可查看） |
| 后台查看原始数据 | [Supabase Dashboard](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa) → **Table Editor** → `app_state` |

**行程字段**：每条行程可填写日期、时间、车费、备注（默认「取经」）、乘车人。

**每月 31 号自动结算**：在有 31 天的月份（1、3、5、7、8、10、12 月）的 31 号，任何人打开页面时会自动触发结算——保存一份历史结算快照并清空行程记录，**保留成员名单**。同月只触发一次，多人打开不冲突。

**登录锁定**：连续 5 次输错口令，该浏览器锁定 30 分钟。锁定期间无法登录，需等待倒计时结束。

> **首次升级到带历史记录 / 自动结算的版本**：需在 [Supabase SQL Editor](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/sql/new) 执行一次以下语句为 `app_state` 表补加列（已执行过可跳过）：
>
> ```sql
> alter table public.app_state add column if not exists history jsonb not null default '[]'::jsonb;
> alter table public.app_state add column if not exists last_auto_settle text not null default '';
> alter table public.app_state add column if not exists ai_news jsonb default null;
> ```
>
> 执行前历史记录和自动结算月份只在当前会话内有效；执行后才会持久化到云端，所有人都能看到。`ai_news` 列用于缓存 AI 日报，未加列时日报仍可在当前会话显示，但不会跨用户共享。

### 7. AI 日报功能

页面底部「AI 日报」栏每天早上 8 点后自动抓取一次 AI 领域最新动态（新模型、新工具、新技术），由 Cloudflare Pages Function `/api/ai-news` 完成，结果缓存到 Supabase `app_state.ai_news` 列，所有用户共享同一份。新闻按分类（新模型 / 新工具 / 研究突破 / 开源项目 / 行业动态）分组展示，每条新闻附可靠来源链接（官方博客/论文/GitHub 等）。

**抓取流程**（两步走，确保新闻真实可信）：

1. **Tavily Search API** 拉取最近 2 天的真实 AI 新闻（含真实标题、URL、摘要片段、发布日期）。这一步保证 URL 都是搜索引擎返回的真实链接，不会被模型编造。
2. **DeepSeek chat API** 把 Tavily 返回的原始材料整理成 5 个分类的中文日报，写中文摘要。Prompt 明确要求模型**只基于搜索材料**，不允许使用材料以外的信息或编造 URL。代码里还会校验模型输出的 URL 必须在 Tavily 返回的 URL 集合里，否则丢弃。

**收起/展开**：AI 日报栏标题右侧有「收起/展开」按钮，点击可折叠整个模块。状态保存在浏览器 `localStorage`，刷新后保持。

**抓取频率**：每天最多调用 Tavily + DeepSeek 各 1 次。8 点后第一个访问者触发抓取，之后命中缓存，全天不再调用。月度约 30 次，远低于免费额度。

**管理员手动更新**：管理员登录后，AI 日报栏右上角出现「更新新闻」按钮，点击可强制重新抓取（无视缓存）。改完 API Key 后建议点一次验证生效。

**管理员更新 API Key**：管理员登录后，AI 日报栏右上角有「API Key」按钮，点击后输入管理员口令 + 新的 Tavily Key 和/或 DeepSeek Key 即可保存。Key 保存在 Supabase `app_state.tavily_api_key` / `app_state.deepseek_api_key` 列，服务端优先使用数据库里的值，若为空则回退到部署时的环境变量。留空保存则恢复使用环境变量。可只填需要改的那一项。

**首次启用步骤**：

1. 在 [Supabase SQL Editor](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/sql/new) 执行：
   ```sql
   alter table public.app_state add column if not exists ai_news jsonb default null;
   alter table public.app_state add column if not exists deepseek_api_key text default null;
   alter table public.app_state add column if not exists tavily_api_key text default null;
   ```
2. 在 [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages → `transportfunds` → **Settings** → **Environment variables** 中添加（**Production** 和 **Preview** 都加）：
   - `TAVILY_API_KEY` — Tavily API 密钥（在 [app.tavily.com](https://app.tavily.com) 申请，每月免费 1000 次搜索；也可不设此变量，登录后用「API Key」按钮在网页上设置）
   - `DEEPSEEK_API_KEY` — DeepSeek API 密钥（在 [platform.deepseek.com](https://platform.deepseek.com) 申请，也可不设此变量，登录后用「API Key」按钮在网页上设置）
   - `ADMIN_PASSWORD` — `heartunderblade`（服务端验证管理员身份用，与 `VITE_ADMIN_PASSWORD` 保持一致）
   - `SUPABASE_URL` — `https://nreyuviaobqhobppotfa.supabase.co`
   - `SUPABASE_ANON_KEY` — `sb_publishable_w5w3BaIjciCZKIlgiGMFsg_qYMSrbX-`
3. 运行 `npm run deploy` 重新部署。

**注意**：上述五个变量**不要**以 `VITE_` 开头——它们只在服务端（Pages Function）使用，不能注入到前端，否则会暴露密钥。

**Tavily 用量**：免费账户每月 1000 次搜索，本项目每天最多 1 次，月度约 30 次，足够用数年。

**DeepSeek 用量**：新账户赠送 500 万 token，单次日报约 2-4 千 token，足够用数年。

**手动清空缓存重新抓取**：在 Supabase Dashboard → Table Editor → `app_state` → 把 `ai_news` 列清空（设为 NULL），下次有人打开页面就会重新抓取。

### 8. 操作日志（管理员可见）

页面底部「操作日志」栏**仅管理员登录后显示**，记录两类事件：

| 类型 | 标签 | 触发场景 |
|------|------|---------|
| 系统 | `系统` | AI 日报自动抓取成功/失败、月度自动结算、打开/取消登录、登录失败/锁定 |
| 管理员 | `管理员` | 登录成功、退出、所有编辑操作与按钮点击（见下表） |

**会写入日志的操作（action）**：

| action | 含义 |
|--------|------|
| `open_login` / `cancel_login` / `click_login` | 打开登录、取消、点击登录 |
| `login` / `login_failed` / `login_locked` / `logout` | 登录成功、口令错误、锁定、退出 |
| `news_refresh` / `news_refresh_ok` / `news_error` | 点击更新新闻、成功、失败（前端）；服务端另有系统级抓取日志 |
| `news_toggle` | 收起/展开 AI 日报 |
| `open_key_modal` / `close_key_modal` / `update_key` | 打开/关闭 API Key、保存 Key |
| `add_person` / `remove_person` | 添加/删除成员 |
| `add_trip` / `remove_trip` / `clear_trips` / `load_demo` | 行程增删、清空、重置示例 |
| `auto_settle` | 月度自动结算 |
| `logs_refresh` / `clear_logs_click` / `clear_logs` | 刷新日志列表、点击清空、服务端清空完成 |

写入后若日志面板已打开，约 0.4 秒后自动刷新列表。前端优先直写 Supabase `admin_logs`（不依赖 Pages Function 口令是否一致）。

日志面板显示最近 50 条，按时间倒序。右上角按钮：

| 按钮 | 作用 |
|------|------|
| 刷新 | 重新拉取最近 50 条（本身也会记一条日志） |
| 清空日志 | 删除全部日志（需确认；服务端校验管理员口令）。清空后会留下一条 `clear_logs` 记录作为审计痕迹 |

**数据存储**：独立的 `public.admin_logs` 表（不在 `app_state` 里），每条记录含 `ts`（时间）、`kind`（system/admin）、`action`（动作名）、`detail`（中文描述）、`actor`。日志不可修改（无 UPDATE）；删除仅能通过网页「清空日志」或 SQL（RLS 开放 SELECT / INSERT / DELETE）。

**首次启用**：需在 [Supabase SQL Editor](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/sql/new) 执行一次 `supabase/schema.sql`（已包含 `admin_logs` 表与 DELETE 策略，幂等可重复执行）。若表已存在但还没加删除策略，只需执行：

```sql
drop policy if exists "allow anon delete admin_logs" on public.admin_logs;
create policy "allow anon delete admin_logs"
  on public.admin_logs for delete
  to anon
  using (true);
```

未执行时日志面板会显示「加载日志失败」或「清空失败」，但其他功能不受影响。

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

浏览器打开终端提示的地址即可查看。本地改的数据也会写入同一个 Supabase（与线上共用）。需要编辑时，点右上角「管理员登录」并输入 `.env` 里的口令。

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
→ `.env` 未填，或构建时没有带上三个 `VITE_*` 变量。注意：未配置时网页仍会以「仅查看」模式打开并提示无法连接 Supabase。

**进入后加载失败 / 无法连接**
→ `supabase/schema.sql` 未执行成功，或 URL / 密钥填错。

**别人看不到我的修改**
→ 确认 `app_state` 已加入 Realtime；或让对方下拉刷新。

**改了口令但还能用旧口令**
→ 没有重新 `npm run deploy`；或对方浏览器还开着旧页面，让他点「退出」或强制刷新。

**打开网页看不到「添加行程」等编辑按钮？**
→ 当前是「仅查看」模式。点右上角「管理员登录」并输入口令即可切换为管理员，编辑控件会自动出现。

**登录时提示「已锁定」**
→ 连续输错 5 次口令触发了锁定。等待 30 分钟后自动解锁，或清除浏览器 localStorage 后重试。

**点「清空行程」后成员没了？**
→ 不会。「清空行程」只清空行程记录，成员名单会保留。

**每月 31 号自动清空了行程，但我没点过？**
→ 这是自动结算功能。在有 31 天的月份的 31 号，系统会自动保存一份结算快照并清空行程，保留成员。可在「历史结算记录」查看结算详情。

**AI 日报显示「暂无法抓取」或「正在抓取」一直转？**
→ 检查 Cloudflare Pages 环境变量是否设置了 `TAVILY_API_KEY` / `DEEPSEEK_API_KEY` / `SUPABASE_URL` / `SUPABASE_ANON_KEY`；检查 Supabase 是否已添加 `ai_news` / `tavily_api_key` / `deepseek_api_key` 列；Tavily / DeepSeek API 余额是否充足。可在浏览器开发者工具 Network 面板查看 `/api/ai-news` 请求的具体错误。

**操作日志面板显示「加载日志失败」？**
→ `admin_logs` 表尚未创建。在 [Supabase SQL Editor](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa/sql/new) 执行一次 `supabase/schema.sql` 即可。其他功能不受影响。

**AI 日报内容好像不是今天的？**
→ 现在日报基于 Tavily 搜索引擎返回的真实结果，覆盖最近 2 天的 AI 新闻。如果某天没有重要 AI 新闻，Tavily 可能返回较少材料，DeepSeek 会按"宁缺毋滥"原则只整理能确认的条数。日报每天 8 点后刷新一次。

**AI 日报里的链接打不开？**
→ 现在所有 URL 都来自 Tavily 搜索引擎的真实结果，不是模型编造的。如果链接打不开，可能是源站临时故障或已删除文章。代码已校验模型输出的 URL 必须在 Tavily 返回的 URL 集合里，否则丢弃，所以不会出现完全虚构的 URL。

**口令安全说明**
共享口令适合熟人小范围使用，能挡住随便点开链接的人误改数据，不是银行级权限。**查看无需口令**，只有编辑需要。不要把口令发到公开群；定期更换更安全。连续输错锁定机制可防止暴力破解。

## 免费说明

当前方案基于两家服务商的免费额度，长期免费：

| 服务 | 用途 | 免费额度 | 注意事项 |
|------|------|---------|---------|
| Cloudflare Pages | 网页托管 | 无限带宽、无限请求、每月 500 次构建 | 本项目部署频率远低于上限，永久免费 |
| Supabase | 数据库 | 500MB 存储、5GB 出站流量、无需信用卡 | ⚠️ 连续 7 天无数据库活动会被自动暂停，需登录 Dashboard 手动恢复 |

**避免 Supabase 暂停**：只要每周有人打开网页查看或记录行程，数据库就会保持活跃。如果连续 7 天没人用，会被暂停（数据不丢，恢复即可）。如需保险，可设置 GitHub Actions 定时 ping 数据库。
