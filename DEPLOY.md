# 车费分摊 · 部署与日常管理

## 当前线上信息

| 项目 | 内容 |
|------|------|
| 网址 | https://nreyuviaobqhobppotfa.supabase.co/storage/v1/object/public/site/app.svg |
| 共享口令 | 与本地 `.env` 里的 `VITE_APP_PASSWORD` 相同（当前为 `chefei123`） |
| 数据存储 | Supabase 表 `app_state`（所有人共用一份） |
| 网页文件 | Supabase Storage 公开桶 `site`（入口为 `app.svg`，不要用 `index.html`） |

> 说明：Supabase Storage 会把 `.html` 强制成纯文本导致中文乱码，所以用 `app.svg` 作为入口。

发给同伴时，只需提供：**网址 + 共享口令**。

---

## 日常管理

### 1. 查看 / 分享网址

请打开 **`app.svg`** 链接（不要用 `index.html`，那个会被当成纯文本，出现乱码）。

也可在后台复制地址：

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard/project/nreyuviaobqhobppotfa)
2. 左侧 **Storage** → 桶 **site**
3. 点开 `app.svg` → **Get URL**

重新上传后链接不变。

### 2. 更改共享口令

口令写在构建时的环境变量里，改完后必须重新打包并上传。

1. 编辑项目根目录的 `.env`：

```env
VITE_SUPABASE_URL=https://nreyuviaobqhobppotfa.supabase.co
VITE_SUPABASE_ANON_KEY=你的密钥
VITE_APP_PASSWORD=新口令
```

2. 在项目目录执行：

```bash
npm run build
node --env-file=.env scripts/deploy-supabase.mjs
```

3. 把**新口令**通知同伴（旧口令立即失效）。  
   大家需要重新打开网页并输入新口令；已登录的人可点右上角「退出」后再进。

> 若用 Netlify / Vercel 部署：到对应网站后台改环境变量 `VITE_APP_PASSWORD`，再触发一次重新 Deploy。

### 3. 更新网页（改了界面或功能后）

本地改完代码后：

```bash
npm run build
node --env-file=.env scripts/deploy-supabase.mjs
```

上传成功后，让同伴**强制刷新**页面（手机可清缓存或用无痕窗口打开）。

### 4. 管理 / 清空车费数据

数据在数据库，不在网页文件里。

| 操作 | 做法 |
|------|------|
| 平时增删行程 | 直接在网页上操作，会自动同步 |
| 恢复示例数据 | 网页里点「载入示例」 |
| 清空全部 | 网页里点「清空全部」 |
| 后台查看原始数据 | Supabase → **Table Editor** → `app_state` |

### 5. 暂时下线 / 停用网站

任选其一：

- **Storage** → `site` → 删除 `index.html`（或整个桶里的文件）→ 链接失效  
- 或把桶 `site` 改为非公开（需在后台改桶设置）  
- 或改口令且不告诉别人（链接还在，但进不去）

恢复：再执行一次上面的「更新网页」上传命令即可。

### 6. 更换 / 轮换 API 密钥

1. Supabase → **Project Settings → API Keys**  
2. 复制新的 **Publishable** 或 **Legacy anon** 密钥  
3. 更新 `.env` 里的 `VITE_SUPABASE_ANON_KEY`  
4. 重新 `npm run build` 并执行 `scripts/deploy-supabase.mjs`

---

## 首次部署（已完成可跳过）

### A. 数据库（车费数据）

在 **SQL Editor** 执行：`supabase/schema.sql`

### B. 网页托管权限（Storage）

在 **SQL Editor** 执行：`supabase/storage.sql`

### C. 本地配置并发布

```bash
copy .env.example .env
# 编辑 .env，填入 URL、密钥、口令

npm install
npm run build
node --env-file=.env scripts/deploy-supabase.mjs
```

成功后终端会打印公开网址。

### D. 可选：改用 Netlify / Vercel

若希望短域名（如 `xxx.netlify.app`）：

1. 推送代码到 GitHub，在 Netlify/Vercel 导入项目  
2. 配置环境变量：

| 变量名 | 说明 |
|--------|------|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Publishable / anon key |
| `VITE_APP_PASSWORD` | 共享口令 |

3. Build command: `npm run build`  
4. Publish directory: `dist`  
5. 部署完成后，把新短链接发给同伴（口令不变，数据仍在同一 Supabase）

改口令时：在 Netlify/Vercel 改 `VITE_APP_PASSWORD` → 重新 Deploy → 通知同伴新口令。

---

## 本地开发

```bash
copy .env.example .env
npm install
npm run dev
```

浏览器打开终端提示的地址，用 `.env` 里的口令登录。本地改的数据也会写入同一个 Supabase（与线上共用）。

---

## 常见问题

**登录页提示未配置环境变量**  
→ `.env` 未填，或部署时没有带上三个 `VITE_*` 变量就构建了。

**进入后加载失败 / 无法连接**  
→ `schema.sql` 未执行成功，或 URL / 密钥填错。

**别人看不到我的修改**  
→ 确认 `app_state` 已加入 Realtime；或让对方下拉刷新。

**改了口令但还能用旧口令**  
→ 没有重新 build + 上传；或对方浏览器还开着旧页面，让他点「退出」或强制刷新。

**上传报 Bucket not found / RLS**  
→ 再执行一次 `supabase/storage.sql`。

**口令安全说明**  
共享口令适合熟人小范围使用，能挡住随便点开链接的人，不是银行级权限。不要把口令发到公开群；定期更换更安全。
