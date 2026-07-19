-- 在 Supabase：SQL Editor → New query → 粘贴执行
-- 本文件可重复执行（idempotent）：已有对象会被跳过，新增列会自动加上。

create table if not exists public.app_state (
  id int primary key default 1 check (id = 1),
  people text[] not null default '{}',
  trips jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_state (id, people, trips)
values (
  1,
  array['黄', '张', '吴', '陈'],
  '[
    {"id":"d1","date":"2026-07-15","amount":16.98,"riders":["黄","张","吴"]},
    {"id":"d2","date":"2026-07-15","amount":17.09,"riders":["黄","张","吴"]},
    {"id":"d3","date":"2026-07-16","amount":18.01,"riders":["黄","张","吴","陈"]},
    {"id":"d4","date":"2026-07-16","amount":18.56,"riders":["黄","张","陈"]},
    {"id":"d5","date":"2026-07-16","amount":21.73,"riders":["黄","张","陈"]},
    {"id":"d6","date":"2026-07-16","amount":19.66,"riders":["黄","张","吴"]},
    {"id":"d7","date":"2026-07-17","amount":21.77,"riders":["黄","张","吴","陈"]},
    {"id":"d8","date":"2026-07-17","amount":18.69,"riders":["黄","张","吴"]}
  ]'::jsonb
)
on conflict (id) do nothing;

-- 迁移：给 app_state 加 ai_news / deepseek_api_key / tavily_api_key 列。
-- information_schema 检查保证重复执行不会报错。
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'app_state' and column_name = 'ai_news') then
    alter table public.app_state add column ai_news jsonb;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'app_state' and column_name = 'deepseek_api_key') then
    alter table public.app_state add column deepseek_api_key text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'app_state' and column_name = 'tavily_api_key') then
    alter table public.app_state add column tavily_api_key text;
  end if;
end $$;

-- 管理员/系统操作日志表。每条记录一次操作或自动事件。
--   kind:   'system'（系统自动触发，如 AI 日报抓取、月度自动结算）或 'admin'（管理员手动操作）
--   action: 简短动作名（如 'news_refresh'、'login'、'clear_trips'、'update_key'）
--   detail: 人类可读的描述（中文）
--   actor:  操作来源标识。system 写 'system'；admin 写 'admin'（暂不区分具体用户，因为只有一个管理员口令）
create table if not exists public.admin_logs (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null check (kind in ('system', 'admin')),
  action text not null,
  detail text not null default '',
  actor text not null default 'system'
);

create index if not exists admin_logs_ts_idx on public.admin_logs (ts desc);

alter table public.admin_logs enable row level security;

drop policy if exists "allow anon read admin_logs" on public.admin_logs;
drop policy if exists "allow anon write admin_logs" on public.admin_logs;
drop policy if exists "allow anon delete admin_logs" on public.admin_logs;

create policy "allow anon read admin_logs"
  on public.admin_logs for select
  to anon
  using (true);

create policy "allow anon write admin_logs"
  on public.admin_logs for insert
  to anon
  with check (true);

-- DELETE 仅通过服务端 /api/logs（校验管理员口令后）调用；不开放 UPDATE（防篡改）。
create policy "allow anon delete admin_logs"
  on public.admin_logs for delete
  to anon
  using (true);

alter table public.app_state enable row level security;

drop policy if exists "allow anon read app_state" on public.app_state;
drop policy if exists "allow anon write app_state" on public.app_state;

create policy "allow anon read app_state"
  on public.app_state for select
  to anon
  using (true);

create policy "allow anon write app_state"
  on public.app_state for all
  to anon
  using (true)
  with check (true);

-- 开启实时同步。若提示已在 publication 中，可忽略本行错误。
-- 也可在 Dashboard → Database → Publications → supabase_realtime 勾选 app_state
do $$
begin
  alter publication supabase_realtime add table public.app_state;
exception
  when duplicate_object then null;
  when others then
    raise notice 'realtime publication skip: %', sqlerrm;
end $$;
