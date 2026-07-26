-- A bounded AIOS triage run may be retried. Keep at most one open automated
-- risk follow-up per deal while allowing a new task after the prior one closes.
create unique index tasks_aios_triage_open_per_deal_idx
  on public.tasks (organization_id, deal_id)
  where title like 'AIOS triage:%'
    and status in ('open', 'in_progress');
