"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAuditEvent } from "../../lib/audit";
import { hasResendEnv } from "../../lib/email/resend";
import { sendWorkspaceWelcomeEmail } from "../../lib/email/templates";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const workspaceSchema = z.object({ name: z.string().trim().min(2).max(120) });

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function createWorkspace(formData: FormData) {
  const parsed = workspaceSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) redirect("/onboarding?error=validation");

  const sessionClient = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await sessionClient.auth.getClaims();
  const userId = claims?.claims.sub;
  if (claimsError || !userId) redirect("/sign-in?error=auth");

  const admin = createSupabaseAdminClient();
  const baseSlug = slugify(parsed.data.name) || "workspace";
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: organization, error: organizationError } = await admin.from("organizations").insert({ name: parsed.data.name, slug }).select().single();
  if (organizationError) throw organizationError;

  const { error: membershipError } = await admin.from("memberships").insert({ organization_id: organization.id, user_id: userId, role: "owner", status: "active" });
  if (membershipError) {
    await admin.from("organizations").delete().eq("id", organization.id);
    throw membershipError;
  }

  await recordAuditEvent({ organizationId: organization.id, eventType: "record.created", entityType: "organization", entityId: organization.id, metadata: { event: "organization.created" } });

  if (hasResendEnv()) {
    const { data: user } = await admin.auth.admin.getUserById(userId);
    if (user.user?.email) {
      try {
        const delivery = await sendWorkspaceWelcomeEmail({
          to: user.user.email,
          firstName: String(user.user.user_metadata.full_name || "there"),
          organizationName: parsed.data.name,
        });
        await recordAuditEvent({ organizationId: organization.id, eventType: "email.delivered", entityType: "organization", entityId: organization.id, metadata: { category: "workspace-welcome", delivery_id: delivery.id } });
      } catch {
        await recordAuditEvent({ organizationId: organization.id, eventType: "email.delivery_failed", entityType: "organization", entityId: organization.id, metadata: { category: "workspace-welcome" } });
      }
    }
  }
  redirect("/");
}
