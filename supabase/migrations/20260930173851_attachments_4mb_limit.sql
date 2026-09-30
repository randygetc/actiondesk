-- Attachments are limited to 4 MB, so an upload fits Vercel's 4.5 MB function
-- request body (R-22). Owner decision D-22 (2026-09-30): Option B of the
-- proposed ADR 0007; browser uploads to signed URLs were not adopted.

alter table public.attachments drop constraint attachments_size_bytes_check;
alter table public.attachments
  add constraint attachments_size_bytes_check check (size_bytes between 1 and 4194304);

update storage.buckets set file_size_limit = 4194304 where id = 'attachments';
