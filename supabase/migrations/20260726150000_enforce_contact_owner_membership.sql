-- Contact ownership is a tenant relationship, not just a profile reference.
-- The composite key prevents a guessed profile UUID from another organization
-- being assigned through a direct Data API call.

alter table public.contacts
  drop constraint contacts_owner_id_fkey,
  add constraint contacts_owner_same_organization_fkey
    foreign key (organization_id, owner_id)
    references public.memberships (organization_id, user_id)
    on delete set null (owner_id);

create index contacts_owner_active_idx
  on public.contacts (organization_id, owner_id, updated_at desc)
  where archived_at is null;

alter table public.activity_events
  drop constraint activity_events_activity_type_check,
  add constraint activity_events_activity_type_check
  check (
    activity_type in (
      'note',
      'contact_created',
      'contact_preferences_updated',
      'contact_owner_changed',
      'contact_merged',
      'company_created',
      'deal_created',
      'deal_stage_changed',
      'task_created',
      'task_status_changed',
      'ai_observation'
    )
  );
