// Cloudflare Pages Function: /api/ai-news
// Refreshes the AI daily news once per day (after 8 AM China time).
// Caches the result in Supabase (app_state.ai_news) so all clients share one snapshot
// and we only call Tavily + DeepSeek once per day.
//
// Pipeline:
//   1. Tavily Search API — fetches real, recent AI news with true URLs (no LLM hallucination).
//   2. DeepSeek chat completions — organizes the raw results into the 5-category JSON
//      the frontend expects, writing Chinese summaries based on the Tavily snippets.
//
// Required env vars (set in Cloudflare Pages dashboard → Settings → Environment variables):
//   TAVILY_API_KEY      - Tavily API key (fallback if not set in DB)
//   DEEPSEEK_API_KEY    - DeepSeek API key (fallback if not set in DB)
//   SUPABASE_URL        - e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY   - anon key (RLS allows anon read/write on app_state)

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

const CATEGORIES = ["新模型", "新工具", "研究突破", "开源项目", "行业动态"];

// Raw materials from Tavily are injected here. The model is told to ONLY use these
// sources, never its own memory — so it cannot fabricate news or URLs.
const SYSTEM_PROMPT = `你是一名 AI 行业新闻编辑，每天为中文读者整理 AI 领域的最新动态。

我会给你一份今天从搜索引擎抓到的真实 AI 新闻原始材料（含标题、URL、摘要片段、发布日期）。请**只基于这些材料**整理当天的 AI 日报，不要使用材料以外的信息，不要凭记忆补充，不要编造任何 URL 或事实。如果材料不足以填满 6 条，就只输出能从材料中确认的条数，宁缺毋滥。

每条新闻必须归入以下分类之一：
- 新模型：新发布或更新的 AI 模型（如 OpenAI、Anthropic、Google、Meta、字节、阿里、DeepSeek、智谱、Moonshot/Kimi 等公司的新模型）
- 新工具：新的开发工具、SDK、平台、API、Agent 框架等
- 研究突破：重要的研究论文、技术突破、新方法
- 开源项目：新开源的模型、工具、数据集等
- 行业动态：融资、合作、政策、人事变动等重大行业事件

要求：
1. 输出必须是严格的 JSON，格式为 {"items": [{"category": "...", "title": "...", "source": "...", "url": "...", "summary": "..."}, ...]}
2. 列出 6 到 10 条最值得关注的动态（材料不足时可以更少，但不要编造）
3. category 必须是上述五个分类之一
4. title 不超过 30 字，简明扼要，用中文
5. source 填公司/机构名或来源（如 "OpenAI"、"DeepSeek"、"MIT"），不超过 15 字
6. url 必须直接复用我给你的材料中对应那条新闻的原始 URL，**逐字复制，不要修改、截断、拼接或替换**。如果两条材料共用同一个 URL，只能选其中一条进入日报，不要让两条新闻共用同一个 URL。每条新闻的 url 字段都必须互不相同。
7. summary 用 1-2 句中文简述要点，不超过 100 字，基于材料中的 snippet
8. 不要输出 JSON 以外的任何文字、不要 markdown 代码块`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// "Today 8 AM" in China time (UTC+8). 8 AM China = 00:00 UTC.
function today8amChinaISO() {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = china.getUTCFullYear();
  const m = String(china.getUTCMonth() + 1).padStart(2, "0");
  const d = String(china.getUTCDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

function isFresh(news) {
  if (!news || !news.fetchTime) return false;
  const fetchDate = new Date(news.fetchTime);
  if (isNaN(fetchDate.getTime())) return false;
  return fetchDate.getTime() >= today8amChinaISO().getTime();
}

async function supabaseGet(env) {
  // Use select=* so the request still succeeds when ai_news / deepseek_api_key /
  // tavily_api_key columns haven't been added yet (pre-migration databases).
  const url = `${env.SUPABASE_URL}/rest/v1/app_state?id=eq.1&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status}`);
  const rows = await res.json();
  if (!rows || !rows[0]) return { aiNews: null, deepseekKey: null, tavilyKey: null };
  const row = rows[0];
  return {
    aiNews: row.ai_news || null,
    deepseekKey: row.deepseek_api_key || null,
    tavilyKey: row.tavily_api_key || null,
  };
}

async function supabaseUpdateNews(env, aiNews) {
  const url = `${env.SUPABASE_URL}/rest/v1/app_state?id=eq.1`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ai_news: aiNews, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase PATCH failed: ${res.status}`);
}

// Write a system log entry directly to the admin_logs table via Supabase REST API.
// Best-effort: never throws, never blocks. Writes kind='system', actor='system'.
// (The frontend writes kind='admin' via /api/log after verifying the admin password;
// server-side functions write directly here since they already hold SUPABASE_ANON_KEY.)
async function writeSystemLog(env, action, detail) {
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/admin_logs`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        kind: "system",
        action: String(action).slice(0, 64),
        detail: String(detail).slice(0, 500),
        actor: "system",
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("writeSystemLog failed:", res.status, errText.slice(0, 200));
    }
  } catch (e) {
    console.error("writeSystemLog failed:", e.message);
  }
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    const match = t.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Call Tavily Search API to get real, recent AI news with true URLs.
// Returns an array of { title, url, content, published_date } or throws.
async function fetchTavilySearch(tavilyKey) {
  // Build a query that targets today's AI news. Tavily's "news" topic is best for
  // recent events; time_range="day" limits to the last 24h, "week" is a wider fallback.
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    api_key: tavilyKey,
    query: "AI artificial intelligence latest news new model release",
    topic: "news",
    days: 2,
    max_results: 15,
    search_depth: "advanced",
    include_answer: false,
    include_raw_content: false,
    include_domains: [],
    exclude_domains: ["reddit.com", "twitter.com", "x.com", "weibo.com", "douyin.com"],
  };

  const res = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Tavily API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  // Keep only items that actually have a title and URL — Tavily always returns them,
  // but be defensive. Also normalize the field names for the prompt.
  return results
    .filter((r) => r && r.title && r.url)
    .map((r) => ({
      title: String(r.title).slice(0, 200),
      url: String(r.url).slice(0, 300),
      snippet: String(r.content || "").slice(0, 500),
      published: r.published_date || "",
    }));
}

// Build the user message that contains the raw Tavily materials.
function buildUserMessage(tavilyResults) {
  const today = new Date().toISOString().slice(0, 10);
  const materials = tavilyResults
    .map((r, i) => {
      const pub = r.published ? `（发布于 ${r.published.slice(0, 10)}）` : "";
      return `[${i + 1}] 标题：${r.title}${pub}
URL：${r.url}
摘要：${r.snippet}`;
    })
    .join("\n\n");

  return `今天是 ${today}。以下是从搜索引擎抓到的真实 AI 新闻原始材料，共 ${tavilyResults.length} 条。请只基于这些材料整理今天的 AI 日报，按分类组织，输出严格 JSON。

原始材料：

${materials}`;
}

// Call DeepSeek to organize raw Tavily results into the structured JSON the frontend expects.
async function fetchDeepSeekNews(env, apiKey, tavilyResults) {
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(tavilyResults) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 4000,
    stream: false,
  };

  const res = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("DeepSeek 返回内容无法解析为 { items: [...] }");
  }
  const validCats = new Set(CATEGORIES);
  // Build a set of URLs that Tavily actually returned, so we can reject any URL the
  // model fabricated (defensive — the prompt says not to, but models sometimes do).
  const allowedUrls = new Set(tavilyResults.map((r) => r.url));
  const items = parsed.items.slice(0, 15).map((it) => {
    const cat = validCats.has(it.category) ? it.category : "行业动态";
    // Sanitize URL: must be http/https AND must be one of the Tavily URLs.
    // If the model tampered with or invented a URL, drop it (empty string).
    let url = "";
    if (typeof it.url === "string") {
      const trimmed = it.url.trim();
      if (/^https?:\/\//i.test(trimmed) && allowedUrls.has(trimmed)) {
        url = trimmed.slice(0, 300);
      }
    }
    return {
      category: cat,
      title: String(it.title || "").slice(0, 60),
      source: String(it.source || "").slice(0, 20),
      url,
      summary: String(it.summary || "").slice(0, 200),
    };
  }).filter((it) => it.title); // drop empty titles
  return {
    fetchTime: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    items,
    source: "tavily+deepseek",
  };
}

export async function onRequestPost({ env, request }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({ error: "未配置 SUPABASE_URL / SUPABASE_ANON_KEY 环境变量。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    // Read cache + API keys from Supabase.
    const { aiNews, deepseekKey, tavilyKey } = await supabaseGet(env);

    // Determine if a forced refresh is requested by admin.
    let force = false;
    try {
      const body = await request.json();
      if (body && body.force === true) force = true;
    } catch {
      // No body or invalid JSON — normal auto-refresh path.
    }

    // 1. Return cache if fresh and not forced.
    if (!force && isFresh(aiNews)) {
      return new Response(JSON.stringify(aiNews), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 2. Resolve Tavily key (DB first, env fallback).
    const resolvedTavilyKey = tavilyKey || env.TAVILY_API_KEY;
    if (!resolvedTavilyKey) {
      return new Response(
        JSON.stringify({ error: "未配置 Tavily API Key。管理员可在网页上点击「API Key」按钮设置，或在 Cloudflare Pages 环境变量里加 TAVILY_API_KEY。" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 3. Resolve DeepSeek key (DB first, env fallback).
    const resolvedDeepseekKey = deepseekKey || env.DEEPSEEK_API_KEY;
    if (!resolvedDeepseekKey) {
      return new Response(
        JSON.stringify({ error: "未配置 DeepSeek API Key。管理员可在网页上点击「API Key」按钮设置。" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 4. Call Tavily to get real news with true URLs.
    const tavilyResults = await fetchTavilySearch(resolvedTavilyKey);
    if (!tavilyResults.length) {
      return new Response(
        JSON.stringify({ error: "Tavily 未返回任何搜索结果，可能是 API 额度用尽或网络异常。" }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 5. Call DeepSeek to organize the raw results into the structured JSON.
    const news = await fetchDeepSeekNews(env, resolvedDeepseekKey, tavilyResults);

    // 6. Save to Supabase (ignore write errors so UI still works pre-migration).
    try {
      await supabaseUpdateNews(env, news);
    } catch (e) {
      console.error("Supabase update failed (column may be missing):", e.message);
    }

    // 7. Log the refresh (system log). Distinguish forced vs auto.
    await writeSystemLog(env, "news_refresh", `AI 日报${force ? "强制" : "自动"}刷新成功，共 ${news.items.length} 条（Tavily 返回 ${tavilyResults.length} 条原始材料）`);

    return new Response(JSON.stringify(news), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    console.error("ai-news error:", err);
    await writeSystemLog(env, "news_error", `AI 日报抓取失败: ${(err.message || "").slice(0, 300)}`);
    return new Response(
      JSON.stringify({ error: err.message || "抓取 AI 新闻失败" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
