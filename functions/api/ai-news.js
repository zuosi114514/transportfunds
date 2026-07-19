// Cloudflare Pages Function: /api/ai-news
// Refreshes the AI daily news once per day (after 8 AM China time).
// Caches the result in Supabase (app_state.ai_news) so all clients share one snapshot
// and we only call DeepSeek once per day.
//
// The DeepSeek API key is read from Supabase (app_state.deepseek_api_key) first,
// falling back to the DEEPSEEK_API_KEY env var. Admins can update the key via the
// /api/update-config endpoint without redeploying.
//
// Required env vars (set in Cloudflare Pages dashboard → Settings → Environment variables):
//   DEEPSEEK_API_KEY     - DeepSeek API key (fallback if not set in DB)
//   SUPABASE_URL         - e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY    - anon key (RLS allows anon read/write on app_state)

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

const CATEGORIES = ["新模型", "新工具", "研究突破", "开源项目", "行业动态"];

const SYSTEM_PROMPT = `你是一名 AI 行业新闻编辑，每天为中文读者整理 AI 领域的最新动态。
请基于你所掌握的最新信息，列出当天（或最近一两天）AI 领域值得关注的进展。

每条新闻必须归入以下分类之一：
- 新模型：新发布或更新的 AI 模型（如 OpenAI、Anthropic、Google、Meta、字节、阿里、DeepSeek、智谱等公司的新模型）
- 新工具：新的开发工具、SDK、平台、API、Agent 框架等
- 研究突破：重要的研究论文、技术突破、新方法
- 开源项目：新开源的模型、工具、数据集等
- 行业动态：融资、合作、政策、人事变动等重大行业事件

要求：
1. 输出必须是严格的 JSON，格式为 {"items": [{"category": "...", "title": "...", "source": "...", "url": "...", "summary": "..."}, ...]}
2. 列出 6 到 10 条最值得关注的动态
3. category 必须是上述五个分类之一
4. title 不超过 30 字，简明扼要
5. source 填公司/机构名或来源（如 "OpenAI"、"DeepSeek"、"MIT"），不超过 15 字
6. url 必须是该新闻最可靠的官方来源网址，优先填官方博客、官方公告、论文链接、GitHub 仓库、权威新闻媒体等真实可访问的 URL。如果不确定确切链接，可填该机构官网首页或该产品的官方页面。不要编造不存在的 URL。
7. summary 用 1-2 句中文简述要点，不超过 100 字
8. 如果不确定某条信息是否为最新，可标注"（基于近期信息）"
9. 不要输出 JSON 以外的任何文字、不要 markdown 代码块`;

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
  // Use select=* so the request still succeeds when ai_news / deepseek_api_key
  // columns haven't been added yet (pre-migration databases).
  const url = `${env.SUPABASE_URL}/rest/v1/app_state?id=eq.1&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status}`);
  const rows = await res.json();
  if (!rows || !rows[0]) return { aiNews: null, deepseekKey: null };
  const row = rows[0];
  return {
    aiNews: row.ai_news || null,
    deepseekKey: row.deepseek_api_key || null,
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

async function fetchDeepSeekNews(env, apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `今天是 ${today}。请给出今天（或最近一两天）AI 领域的重要动态，按分类组织。` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.6,
    max_tokens: 2500,
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
  const items = parsed.items.slice(0, 15).map((it) => {
    const cat = validCats.has(it.category) ? it.category : "行业动态";
    // Sanitize URL: only keep http/https links, strip anything else.
    let url = "";
    if (typeof it.url === "string") {
      const trimmed = it.url.trim();
      if (/^https?:\/\//i.test(trimmed)) url = trimmed.slice(0, 300);
    }
    return {
      category: cat,
      title: String(it.title || "").slice(0, 60),
      source: String(it.source || "").slice(0, 20),
      url,
      summary: String(it.summary || "").slice(0, 200),
    };
  });
  return {
    fetchTime: new Date().toISOString(),
    date: today,
    items,
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
    // Read cache + DeepSeek key from Supabase.
    const { aiNews, deepseekKey } = await supabaseGet(env);

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

    // 2. Need to call DeepSeek. Resolve the API key (DB first, env fallback).
    const apiKey = deepseekKey || env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "未配置 DeepSeek API Key。管理员可在网页上点击「DeepSeek Key」按钮设置。" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 3. Call DeepSeek.
    const news = await fetchDeepSeekNews(env, apiKey);

    // 4. Save to Supabase (ignore write errors so UI still works pre-migration).
    try {
      await supabaseUpdateNews(env, news);
    } catch (e) {
      console.error("Supabase update failed (column may be missing):", e.message);
    }

    return new Response(JSON.stringify(news), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    console.error("ai-news error:", err);
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
