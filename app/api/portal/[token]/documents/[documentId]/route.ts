import { NextResponse } from "next/server";
import { z } from "zod";

import { travelerPortalTokenSchema } from "../../../../../../lib/crm/traveler-portal";
import { travelerPortalTokenHash } from "../../../../../../lib/crm/traveler-portal-token";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ token: string; documentId: string }>;
  },
) {
  const { token, documentId } = await params;
  if (
    !travelerPortalTokenSchema.safeParse(token).success ||
    !z.uuid().safeParse(documentId).success
  ) {
    return new NextResponse("Not found", {
      status: 404,
      headers: noStoreHeaders,
    });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: document, error } = await admin
      .rpc("get_traveler_portal_document", {
        target_token_hash: travelerPortalTokenHash(token),
        target_document_id: documentId,
      })
      .maybeSingle();
    if (error || !document) {
      return new NextResponse("Not found", {
        status: 404,
        headers: noStoreHeaders,
      });
    }

    const { data: signed, error: signedError } = await admin.storage
      .from("travel-documents")
      .createSignedUrl(document.storage_path, 60, {
        download: document.file_name,
      });
    if (signedError || !signed?.signedUrl) {
      return new NextResponse("Not found", {
        status: 404,
        headers: noStoreHeaders,
      });
    }

    const response = NextResponse.redirect(signed.signedUrl, 307);
    for (const [name, value] of Object.entries(noStoreHeaders))
      response.headers.set(name, value);
    return response;
  } catch {
    return new NextResponse("Not found", {
      status: 404,
      headers: noStoreHeaders,
    });
  }
}
