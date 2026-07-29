import "server-only";

import { z } from "zod";

import {
  knowledgeAnswerEvidenceSchema,
  type KnowledgeAnswerEvidence,
} from "../ai/knowledge-answer";
import { createSupabaseAdminClient } from "../supabase/admin";

const curatorRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
]);

export const knowledgeAnswerRunReferenceSchema = z
  .object({
    workflow: z.literal("knowledge_answer"),
    prompt_version: z.string().trim().min(3).max(120),
    question: z.string().trim().min(2).max(240),
    section_ids: z.array(z.uuid()).min(1).max(8),
  })
  .passthrough();

/**
 * Revalidates stored passage references for durable retries. Service-role
 * reads never become authorization: the initiating member, source status,
 * sensitivity, tenant, and freshness are all checked again.
 */
export async function loadKnowledgeAnswerEvidenceForActor(input: {
  organizationId: string;
  actorId: string;
  sectionIds: string[];
}): Promise<KnowledgeAnswerEvidence[]> {
  const referenceIds = z.array(z.uuid()).min(1).max(8).parse(input.sectionIds);
  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role, status")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.actorId)
    .maybeSingle();
  if (
    membershipError ||
    !membership ||
    membership.status !== "active"
  )
    throw membershipError ??
      new Error("The Answer Desk initiator is no longer an active member.");

  const { data: sections, error: sectionError } = await admin
    .from("knowledge_sections")
    .select("id, source_id, heading, content, citation_label")
    .eq("organization_id", input.organizationId)
    .in("id", referenceIds);
  if (sectionError) throw sectionError;
  const sourceIds = [
    ...new Set((sections ?? []).map((section) => section.source_id)),
  ];
  if (sourceIds.length === 0) return [];
  const { data: sources, error: sourceError } = await admin
    .from("knowledge_sources")
    .select(
      "id, title, version_label, source_url, review_due_on, sensitivity, status",
    )
    .eq("organization_id", input.organizationId)
    .in("id", sourceIds);
  if (sourceError) throw sourceError;
  const sourceById = new Map((sources ?? []).map((source) => [source.id, source]));
  const sectionById = new Map((sections ?? []).map((section) => [section.id, section]));
  const today = new Date().toISOString().slice(0, 10);
  const mayReadRestricted = curatorRoles.has(membership.role);

  return referenceIds.flatMap((sectionId) => {
    const section = sectionById.get(sectionId);
    const source = section ? sourceById.get(section.source_id) : null;
    if (
      !section ||
      !source ||
      source.status !== "approved" ||
      (source.sensitivity === "restricted" && !mayReadRestricted)
    )
      return [];
    return [
      knowledgeAnswerEvidenceSchema.parse({
        sectionId: section.id,
        sourceId: source.id,
        sourceTitle: source.title,
        versionLabel: source.version_label,
        sourceUrl: source.source_url,
        heading: section.heading,
        excerpt: section.content.slice(0, 500),
        citationLabel: section.citation_label,
        reviewDueOn: source.review_due_on,
        isStale:
          source.review_due_on === null || source.review_due_on < today,
      }),
    ];
  });
}
