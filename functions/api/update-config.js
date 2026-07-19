// Cloudflare Pages Function: /api/update-config
// Allows an admin to update API keys stored in Supabase (app_state):
//   - deepseek_api_key  (used by /api/ai-news for organizing news)
//   - tavily_api_key    (used by /api/ai-news for real news search)
// without redeploying. The admin password is verified server-side against
// the ADMIN_PASSWORD env var.
//
// Required env vars (Cloudflare Pages dashboard → Settings → Environment variables):
//   ADMIN_PASSWORD       - server-side admin password (same value as VITE_ADMIN_PASSWORD)
//   SUPABASE_URL         - e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY    - anon key (RLS allows anon read/write on app_state)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Best-effort system log. Writes directly to admin_logs via Supabase REST API.
// Never throws. kind='system', actor='system'.
async function writeSystemLog(env, action, detail) {
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/admin_logs`;
    await fetch(url, {
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
  } catch (e) {
    console.error("writeSystemLog failed:", e.message);
  }
}

export async function onRequestPost({ env, request }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "未配置 SUPABASE_URL / SUPABASE_ANON_KEY。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
  if (!env.ADMIN_PASSWORD) {
    return new Response(
      JSON.stringify({ ok: false, error: "未配置 ADMIN_PASSWORD 环境变量，无法验证管理员身份。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "请求体不是有效 JSON。" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const { adminPassword, deepseekKey, tavilyKey } = body || {};
  if (!adminPassword || adminPassword !== env.ADMIN_PASSWORD) {
    return new Response(
      JSON.stringify({ ok: false, error: "管理员口令不正确。" }),
      { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  // Build the PATCH body. Only fields that are actually provided (key === "string")
  // are written, so the client can update just one key without clearing the other.
  // Empty string -> null so we fall back to the env var.
  const patch = { updated_at: new Date().toISOString() };
  const messages = [];
  if (typeof deepseekKey === "string") {
    const value = deepseekKey.trim();
    patch.deepseek_api_key = value || null;
    messages.push(`DeepSeek API Key 已${value ? "更新" : "清空"}。`);
  }
  if (typeof tavilyKey === "string") {
    const value = tavilyKey.trim();
    patch.tavily_api_key = value || null;
    messages.push(`Tavily API Key 已${value ? "更新" : "清空"}。`);
  }

  if (Object.keys(patch).length === 1) {
    return new Response(
      JSON.stringify({ ok: false, error: "未提供要更新的字段（deepseekKey 或 tavilyKey）。" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const url = `${env.SUPABASE_URL}/rest/v1/app_state?id=eq.1`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ ok: false, error: `Supabase 更新失败: ${res.status} ${errText.slice(0, 200)}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    // Log the config change (system log, since this function is server-side).
    // Don't log the key values themselves — just which key(s) were updated or cleared.
    await writeSystemLog(env, "update_key", messages.join(" ").trim() || "API Key 已更新");
    return new Response(
      JSON.stringify({ ok: true, message: messages.join(" ") || "配置已更新。" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "更新失败。" }),
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
