-- Snapchess: labelled scans for training the piece classifier.
-- Each anonymous user may only insert and read their own rows and files.
-- Files live in the private "scan-crops" bucket under "<user id>/...".

-- 1. Table ------------------------------------------------------------------

create table if not exists public.scan_labels (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id        uuid not null default auth.uid(),
  created_at        timestamptz not null default now(),

  -- storage paths inside the scan-crops bucket, e.g. "<user id>/<scan id>/photo.jpg"
  image_path        text not null,
  crops_path        text,

  image_width       integer not null check (image_width > 0),
  image_height      integer not null check (image_height > 0),
  rotation_steps_90 smallint not null default 0 check (rotation_steps_90 between 0 and 3),
  -- {"topLeft":{"x":..,"y":..},"topRight":..,"bottomRight":..,"bottomLeft":..} in photo pixels
  corners           jsonb not null,

  fen               text not null check (char_length(fen) between 15 and 100),  -- the label
  predicted_fen     text check (predicted_fen is null or char_length(predicted_fen) <= 100),
  mean_confidence   real check (mean_confidence is null or mean_confidence between 0 and 1),
  uncertain_squares text[] not null default '{}',
  model_version     text,

  constraint scan_labels_session_is_user check (session_id = user_id),
  constraint scan_labels_corners_shape check (
    corners ?& array['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
  )
);

create index if not exists scan_labels_user_created_idx
  on public.scan_labels (user_id, created_at desc);

-- 2. Row level security: insert and select own rows only ---------------------

alter table public.scan_labels enable row level security;

revoke all on public.scan_labels from anon, authenticated;
grant select, insert on public.scan_labels to authenticated;

drop policy if exists "scan_labels insert own" on public.scan_labels;
create policy "scan_labels insert own"
  on public.scan_labels
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and session_id = (select auth.uid())
    and split_part(image_path, '/', 1) = (select auth.uid())::text
    and (crops_path is null or split_part(crops_path, '/', 1) = (select auth.uid())::text)
  );

drop policy if exists "scan_labels select own" on public.scan_labels;
create policy "scan_labels select own"
  on public.scan_labels
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No update or delete policies: labels are append-only from the app.

-- 3. Storage bucket and policies ---------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-crops', 'scan-crops', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "scan-crops insert own folder" on storage.objects;
create policy "scan-crops insert own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'scan-crops'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "scan-crops select own folder" on storage.objects;
create policy "scan-crops select own folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'scan-crops'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No update/delete on files either; upload with upsert: false.
