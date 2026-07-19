# 车费分摊 · 免费部署指南（Netlify + Supabase）

按下面三步做完后，把链接和共享口令发给几个人即可共用同一份数据。

---

## 一、创建 Supabase 数据库（约 5 分钟）

1. 打开 [https://supabase.com](https://supabase.com) 注册并登录  
2. 点击 **New project**，设置项目名、数据库密码，选离你近的区域  
3. 进入项目后，左侧打开 **SQL Editor** → **New query**  
4. 打开本仓库的 `supabase/schema.sql`，全部复制粘贴到编辑器，点 **Run**  
5. 再打开 **Project Settings → API**，记下两样东西：  
   - **Project URL**（形如 `https://xxxx.supabase.co`）  
   - **anon public** key  

> 若最后一行 `alter publication ...` 报错说已存在，可忽略，说明实时表已启用。

可选检查实时：左侧 **Database → Publications → supabase_realtime**，确认勾选了 `app_state`。

---

## 二、部署到 Netlify（约 5 分钟）

### 方式 A：连接 GitHub（推荐）

1. 把本项目推到 GitHub（公开或私有均可）  
2. 打开 [https://app.netlify.com](https://app.netlify.com) 注册登录  
3. **Add new site → Import an existing project**，选你的 GitHub 仓库  
4. 构建设置一般会自动识别：  
   - Build command: `npm run build`  
   - Publish directory: `dist`  
5. 部署前先点 **Site configuration → Environment variables**，添加：

| 变量名 | 值 |
|--------|----|
| `VITE_SUPABASE_URL` | 上一步的 Project URL |
| `VITE_SUPABASE_ANON_KEY` | 上一步的 anon key |
| `VITE_APP_PASSWORD` | 你们约定的共享口令，如 `chefei123` |

6. 保存后重新 **Deploy**  
7. 得到类似 `https://xxxxx.netlify.app` 的网址

### 方式 B：用 Netlify CLI（本地上传）

```bash
npm install
npm install -g netlify-cli
netlify login
netlify init
netlify env:set VITE_SUPABASE_URL "https://xxxx.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "你的anon密钥"
netlify env:set VITE_APP_PASSWORD "chefei123"
netlify deploy --prod
```

---

### 方式 C：部署到 Vercel（同样免费）

1. 打开 [https://vercel.com](https://vercel.com)，用 GitHub 导入本仓库  
2. Framework Preset 选 **Vite**，其余默认  
3. 在 Environment Variables 填入与上面相同的三个 `VITE_*` 变量  
4. Deploy 后得到 `https://xxxxx.vercel.app`

---

## 三、本地先试一遍（可选）

1. 复制环境变量文件：

```bash
copy .env.example .env
```

2. 编辑 `.env`，填入 Supabase URL、anon key、口令  
3. 安装并启动：

```bash
npm install
npm run dev
```

4. 浏览器打开终端提示的本地地址，输入口令即可

---

## 四、发给同伴

把这两样发给黄/张/吴/陈：

1. 网站链接：`https://xxxxx.netlify.app`  
2. 共享口令：与 `VITE_APP_PASSWORD` 相同  

任何人改行程，其他人刷新或稍等片刻会看到同步结果（页面右上角有「已同步」状态）。

---

## 常见问题

**登录页提示未配置环境变量**  
→ Netlify 环境变量没配，或配完后没有重新 Deploy。

**进入后显示加载失败 / 无法连接**  
→ `schema.sql` 没跑成功，或 URL / anon key 填错。

**别人看不到我的修改**  
→ 确认 `app_state` 已加入 realtime；或让对方下拉刷新。

**口令安全说明**  
共享口令适合熟人小范围使用，能挡住随便点开链接的人；它不是银行级权限控制。不要把口令发到公开群。
