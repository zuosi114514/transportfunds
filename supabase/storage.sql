-- 用 Supabase Storage 托管网页：在 SQL Editor 执行本文件

insert into storage.buckets (id, name, public)
values ('site', 'site', true)
on conflict (id) do update set public = true;

drop policy if exists "public read site" on storage.objects;
drop policy if exists "anon write site" on storage.objects;
drop policy if exists "anon update site" on storage.objects;
drop policy if exists "anon delete site" on storage.objects;

create policy "public read site"
  on storage.objects for select
  using (bucket_id = 'site');

create policy "anon write site"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'site');

create policy "anon update site"
  on storage.objects for update
  to anon
  using (bucket_id = 'site')
  with check (bucket_id = 'site');

create policy "anon delete site"
  on storage.objects for delete
  to anon
  using (bucket_id = 'site');
