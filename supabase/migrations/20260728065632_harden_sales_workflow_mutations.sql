-- Default Data API privileges can differ between hosted and local projects.
-- Keep these evidence and playbook tables read-only to authenticated browsers;
-- every mutation must pass through the guarded, audit-writing RPCs.
revoke all on table public.qualification_checklist_templates
  from anon, authenticated;
revoke all on table public.qualification_checklist_items
  from anon, authenticated;
revoke all on table public.deal_qualification_checks
  from anon, authenticated;
revoke all on table public.follow_up_sequences
  from anon, authenticated;
revoke all on table public.follow_up_sequence_steps
  from anon, authenticated;
revoke all on table public.deal_follow_up_sequence_runs
  from anon, authenticated;

grant select on table public.qualification_checklist_templates
  to authenticated;
grant select on table public.qualification_checklist_items
  to authenticated;
grant select on table public.deal_qualification_checks
  to authenticated;
grant select on table public.follow_up_sequences
  to authenticated;
grant select on table public.follow_up_sequence_steps
  to authenticated;
grant select on table public.deal_follow_up_sequence_runs
  to authenticated;
