-- Local development fixtures only.
-- This file intentionally contains no production data, secrets, or real PII.
-- The placeholder Auth row has no password and cannot be used to sign in.

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000101',
  'demo-owner@example.invalid',
  '{"full_name":"AIOS Demo Owner"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles (id, full_name)
values (
  '00000000-0000-4000-8000-000000000101',
  'AIOS Demo Owner'
)
on conflict (id) do update
set full_name = excluded.full_name;

insert into public.organizations (id, name, slug)
values (
  '00000000-0000-4000-8000-000000000201',
  'AIOS Demo Travel',
  'aios-demo-travel'
)
on conflict (id) do update
set name = excluded.name;

insert into public.memberships (
  id,
  organization_id,
  user_id,
  role,
  status
)
values (
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'owner',
  'active'
)
on conflict (organization_id, user_id) do update
set role = excluded.role,
    status = excluded.status;

insert into public.companies (
  id,
  organization_id,
  name,
  website,
  owner_id
)
values (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000201',
  'Northstar Studio',
  'https://example.invalid',
  '00000000-0000-4000-8000-000000000101'
)
on conflict (id) do update
set name = excluded.name;

insert into public.contacts (
  id,
  organization_id,
  first_name,
  last_name,
  company_id,
  owner_id,
  preferred_channel,
  preferred_locale,
  time_zone
)
values (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000201',
  'Aarav',
  'Demo',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000101',
  'email',
  'en-IN',
  'Asia/Kolkata'
)
on conflict (id) do update
set first_name = excluded.first_name,
    last_name = excluded.last_name;

insert into public.deals (
  id,
  organization_id,
  contact_id,
  owner_id,
  title,
  stage,
  destination,
  value_amount,
  currency,
  probability,
  next_step,
  expected_close_at,
  source
)
values (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000101',
  'Japan discovery journey',
  'qualified',
  'Japan',
  450000,
  'INR',
  55,
  'Confirm preferred travel dates',
  current_date + 21,
  'local_seed'
)
on conflict (id) do update
set title = excluded.title,
    next_step = excluded.next_step;

insert into public.tasks (
  id,
  organization_id,
  contact_id,
  deal_id,
  title,
  status,
  due_at,
  assignee_id
)
values (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000501',
  'Review seeded Japan inquiry',
  'open',
  now() + interval '1 day',
  '00000000-0000-4000-8000-000000000101'
)
on conflict (id) do update
set title = excluded.title,
    due_at = excluded.due_at;
