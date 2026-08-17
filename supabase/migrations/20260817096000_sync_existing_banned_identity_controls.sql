-- Align accounts that were already banned through Supabase Auth before the
-- canonical AIOS identity security state existed.

update public.identity_security_controls control
set status = 'suspended',
    sessions_valid_after = statement_timestamp()
from auth.users identity
where identity.id = control.user_id
  and identity.banned_until > statement_timestamp()
  and control.status <> 'suspended';

