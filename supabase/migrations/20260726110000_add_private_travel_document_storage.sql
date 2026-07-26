-- Private travel-document storage. Object names must follow:
--   <organization UUID>/<document UUID>/<safe filename>
-- The bucket is never public, browser clients cannot overwrite or delete
-- objects, and every permitted operation is tenant-, role-, and MFA-scoped.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'travel-documents',
  'travel-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authorized members may read travel documents"
  on storage.objects;
create policy "authorized members may read travel documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'travel-documents'
    and public.meets_mfa_requirement()
    and exists (
      select 1
      from public.memberships membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id::text = (storage.foldername(name))[1]
        and membership.status = 'active'
        and membership.role in (
          'owner',
          'admin',
          'trip_designer',
          'operations',
          'agent'
        )
    )
  );

drop policy if exists "authorized members may upload travel documents"
  on storage.objects;
create policy "authorized members may upload travel documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'travel-documents'
    and owner_id = (select auth.uid()::text)
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and public.meets_mfa_requirement()
    and exists (
      select 1
      from public.memberships membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id::text = (storage.foldername(name))[1]
        and membership.status = 'active'
        and membership.role in (
          'owner',
          'admin',
          'trip_designer',
          'operations',
          'agent'
        )
    )
  );
