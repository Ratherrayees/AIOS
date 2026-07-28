import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { LeadCaptureExperience } from "./lead-capture-experience";
import "./lead-capture.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Plan your journey",
  robots: { index: false, follow: false },
};

export default async function PublicLeadCapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const form = await (async () => {
    try {
      const { token } = await params;
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from("lead_capture_forms")
        .select("public_token, name, headline")
        .eq("public_token", token)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    } catch {
      return null;
    }
  })();
  if (!form) notFound();
  return (
    <main className="capture-page">
      <LeadCaptureExperience
        formToken={form.public_token}
        formName={form.name}
        headline={form.headline}
      />
    </main>
  );
}
