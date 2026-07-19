// Cloudflare Pages Function: /api/logs
// GET  — returns the most recent admin_logs entries, newest first.
// DELETE — clears all admin_logs (requires adminPassword in JSON body).
//
// Query params (GET):
//   limit  - number of entries to return (default 50, max 200)
//
// Required env vars:
//   ADMIN_PASSWORD     - used to verify DELETE callers
//   SUPABASE_URL
//   SUPABASE_ANON_KEY

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestGet({ env, request }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "未配置 SUPABASE_URL / SUPABASE_ANON_KEY。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const urlObj = new URL(request.url);
  let limit = parseInt(urlObj.searchParams.get("limit") || "50", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  try {
    const url = `${env.SUPABASE_URL}/rest/v1/admin_logs?order=ts.desc&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ ok: false, error: `Supabase 读取失败: ${res.status} ${errText.slice(0, 200)}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    const rows = await res.json();
    return new Response(
      JSON.stringify({ ok: true, items: rows || [] }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "读取失败。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

export async function onRequestDelete({ env, request }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "未配置 SUPABASE_URL / SUPABASE_ANON_KEY。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
  if (!env.ADMIN_PASSWORD) {
    return new Response(
      JSON.stringify({ ok: false, error: "未配置 ADMIN_PASSWORD 环境变量。" }),
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

  const { adminPassword } = body || {};
  if (!adminPassword || adminPassword !== env.ADMIN_PASSWORD) {
    return new Response(
      JSON.stringify({ ok: false, error: "管理员口令不正确。" }),
      { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    // PostgREST requires a filter for DELETE. id >= 1 matches all identity rows.
    const url = `${env.SUPABASE_URL}/rest/v1/admin_logs?id=gte.1`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Supabase 清空失败: ${res.status} ${errText.slice(0, 200)}。若提示 RLS / permission，请在 SQL Editor 执行 schema.sql 中的 delete 策略。`,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Leave a single breadcrumb so the clear action itself is auditable.
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/admin_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          kind: "admin",
          action: "clear_logs",
          detail: "管理员清空了全部操作日志",
          actor: "admin",
        }),
      });
    } catch {
      // Breadcrumb is best-effort.
    }

    return new Response(
      JSON.stringify({ ok: true, message: "操作日志已清空。" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "清空失败。" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
