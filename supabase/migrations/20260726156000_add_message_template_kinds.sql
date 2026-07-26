-- Distinguish full reply copy from reusable signatures while keeping both
-- inside the same tenant-scoped, non-delivery content library.

alter table public.message_templates
  add column kind text not null default 'reply'
    check (kind in ('reply', 'signature'));

drop index message_templates_org_active_idx;
create index message_templates_org_active_idx
  on public.message_templates (organization_id, kind, channel, updated_at desc)
  where is_active;
