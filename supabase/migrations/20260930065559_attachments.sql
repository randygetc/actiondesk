-- Step 2.7: uploaded notes (PDF, .docx, .txt, .vtt/.srt) for extraction.
-- docs/plan.md §3.2, §3.6. Files are deleted after review (D-21).

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/vtt'
  )),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  -- The object lives in the owner's folder, named by this row's id.
  check (storage_path ~ ('^' || owner_id::text || '/' || id::text || '\.(pdf|docx|txt|vtt|srt)$'))
);

alter table public.attachments enable row level security;

-- No updates: an attachment is written once and deleted after review.
revoke all on public.attachments from anon, authenticated;
grant select, delete on public.attachments to authenticated;
grant insert (id, storage_path, mime_type, size_bytes) on public.attachments to authenticated;

create policy "attachments: select own"
  on public.attachments for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "attachments: insert own"
  on public.attachments for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "attachments: delete own"
  on public.attachments for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- Storage ---------------------------------------------------------------------

-- Private bucket. Size and type limits here back up the server's own checks
-- (magic bytes, not the file name), which run first.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/vtt'
  ]
);

-- Objects: only in the caller's own folder, `<uid>/...` (plan §3.2).
create policy "attachments objects: select own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "attachments objects: insert own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "attachments objects: delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
