-- 在 Supabase：SQL Editor → New query → 粘贴执行

create table if not exists public.app_state (
  id int primary key default 1 check (id = 1),
  people text[] not null default '{}',
  trips jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
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

-- 若已有表，补加 history 列（已存在则忽略）
do $$
begin
  alter table public.app_state add column if not exists history jsonb not null default '[]'::jsonb;
exception
  when others then
    raise notice 'history column skip: %', sqlerrm;
end $$;

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
