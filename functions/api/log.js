// Cloudflare Pages Function: /api/log
// Writes a single entry to the admin_logs table.
//
// Two callers:
//   1. Frontend (admin): sends { adminPassword, action, detail } — verified against
//      ADMIN_PASSWORD env var, then written with kind='admin', actor='admin'.
//   2. Other Pages Functions (server-side): sends { systemToken, action, detail } where
//      systemToken must equal the SYSTEM_LOG_TOKEN env var (or fall back to a hash of
//      ADMIN_PASSWORD + SUPABASE_ANON_KEY if SYSTEM_LOG_TOKEN is not set). Written with
//      kind='system', actor='system'.
//
// This indirection exists so the frontend cannot forge system log entries, and so
// other server-side functions (ai-news, update-config) can call this endpoint without
// duplicating Supabase write logic. We do not import the logic directly because
// Cloudflare Pages Functions do not share module state across requests.
//
// Required env vars:
//   ADMIN_PASSWORD     - used to verify admin callers
//   SUPABASE_URL
//   SUPABASE_ANON_KEY

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ env, request }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "未配置 SUPABASE_URL / SUPABASE_ANON_KEY。" }),
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

  const { adminPassword, systemToken, action, detail } = body || {};
  const safeAction = typeof action === "string" ? action.slice(0, 64) : "";
  const safeDetail = typeof detail === "string" ? detail.slice(0, 500) : "";

  if (!safeAction) {
    return new Response(
      JSON.stringify({ ok: false, error: "缺少 action 字段。" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  // Determine kind + actor based on which credential was supplied.
  let kind = null;
  let actor = null;

  if (typeof systemToken === "string" && systemToken) {
    // Server-side caller. Verify token.
    const expected = env.SYSTEM_LOG_TOKEN || (await sha256Hex(`${env.ADMIN_PASSWORD || ""}:${env.SUPABASE_ANON_KEY || ""}`));
    if (systemToken !== expected) {
      return new Response(
        JSON.stringify({ ok: false, error: "system token 不正确。" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    kind = "system";
    actor = "system";
  } else if (typeof adminPassword === "string" && adminPassword) {
    if (!env.ADMIN_PASSWORD || adminPassword !== env.ADMIN_PASSWORD) {
      return new Response(
        JSON.stringify({ ok: false, error: "管理员口令不正确。" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    kind = "admin";
    actor = "admin";
  } else {
    return new Response(
      JSON.stringify({ ok: false, error: "缺少 adminPassword 或 systemToken。" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const url = `${env.SUPABASE_URL}/rest/v1/admin_logs`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ kind, action: safeAction, detail: safeDetail, actor }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ ok: false, error: `Supabase 写入失败: ${res.status} ${errText.slice(0, 200)}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "写入失败。" }),
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
