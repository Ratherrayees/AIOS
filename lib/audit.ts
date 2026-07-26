import { createSupabaseServerClient } from "./supabase/server";
import type { SecurityEventType } from "./security";
import type { Json } from "../types/database";

/** Writes append-only business/security events. Call only after authorization. */
export async function recordAuditEvent(input: {
  organizationId: string;
  eventType: SecurityEventType;
  entityType: string;
  entityId?: string;
  metadata?: Json;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const actorId = claims?.claims.sub ?? null;

  const { error } = await supabase.from("audit_events").insert({
    organization_id: input.organizationId,
    actor_id: actorId,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) throw error;
}
