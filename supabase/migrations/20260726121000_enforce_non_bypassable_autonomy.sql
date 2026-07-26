-- The database mirrors AIOS's code-level safety catalog so an owner, admin, or
-- integration using the Data API cannot persist Auto for an external effect.

alter table public.ai_autonomy_policies
  add constraint ai_autonomy_external_effect_requires_approval
  check (
    action not in (
      'external_message.send',
      'supplier.follow_up.send',
      'quote.share',
      'pricing.override',
      'booking.confirm',
      'payment.refund',
      'document.share'
    )
    or mode = 'approval_required'
  ),
  add constraint ai_autonomy_approval_roles_are_authorized
  check (
    cardinality(approval_roles) > 0
    and approval_roles <@
      array['owner', 'admin', 'operations', 'finance']::public.app_role[]
  );
