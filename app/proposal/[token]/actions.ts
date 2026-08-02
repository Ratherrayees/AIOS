"use server";

import {
  publicQuoteAcceptanceInputSchema,
  type PublicQuoteAcceptanceInput,
} from "../../../lib/crm/quote-acceptance";
import { quoteShareTokenHash } from "../../../lib/crm/quote-share-token";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export async function acceptPublicQuote(input: PublicQuoteAcceptanceInput) {
  const accepted = publicQuoteAcceptanceInputSchema.parse(input);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .rpc("accept_quote_share", {
      target_token_hash: quoteShareTokenHash(accepted.token),
      target_signatory_name: accepted.signatoryName,
      target_statement_version: accepted.statementVersion,
    })
    .single();

  if (error || !data) {
    throw new Error(
      "This proposal could not be accepted. Refresh the page or contact your travel advisor.",
    );
  }

  return {
    acceptedAt: data.accepted_at,
    alreadyAccepted: data.already_accepted,
  };
}
