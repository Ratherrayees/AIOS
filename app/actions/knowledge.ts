"use server";

import {
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  knowledgeSectionInputSchema,
  knowledgeSourceInputSchema,
  knowledgeTransitionInputSchema,
  type KnowledgeSectionInput,
  type KnowledgeSourceInput,
} from "../../lib/knowledge/schemas";
import {
  requireActiveMembership,
  requireOrganizationRole,
} from "../../lib/authorization";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const KNOWLEDGE_CURATOR_ROLES = [
  "owner",
  "admin",
  "trip_designer",
  "operations",
] as const;

export async function saveKnowledgeSource(input: KnowledgeSourceInput) {
  const data = knowledgeSourceInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, KNOWLEDGE_CURATOR_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: source, error } = await supabase
    .rpc("upsert_knowledge_source", {
      target_organization_id: data.organizationId,
      target_title: data.title,
      target_source_kind: data.sourceKind,
      target_authority: data.authority,
      target_sensitivity: data.sensitivity,
      target_version_label: data.versionLabel,
      ...(data.sourceId ? { target_source_id: data.sourceId } : {}),
      ...(data.sourceUrl ? { target_source_url: data.sourceUrl } : {}),
      ...(data.summary ? { target_summary: data.summary } : {}),
      ...(data.validFrom ? { target_valid_from: data.validFrom } : {}),
      ...(data.reviewDueOn
        ? { target_review_due_on: data.reviewDueOn }
        : {}),
    })
    .single();
  if (error || !source)
    throw error ?? new Error("The knowledge source could not be saved.");
  return source;
}

export async function addKnowledgeSection(input: KnowledgeSectionInput) {
  const data = knowledgeSectionInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, KNOWLEDGE_CURATOR_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: section, error } = await supabase
    .rpc("add_knowledge_section", {
      target_organization_id: data.organizationId,
      target_source_id: data.sourceId,
      target_heading: data.heading,
      target_content: data.content,
      target_citation_label: data.citationLabel,
      target_position: data.position,
    })
    .single();
  if (error || !section)
    throw error ?? new Error("The cited knowledge section could not be added.");
  return section;
}

export async function transitionKnowledgeSource(input: {
  organizationId: string;
  sourceId: string;
  status: "draft" | "in_review" | "approved" | "retired";
}) {
  const data = knowledgeTransitionInputSchema.parse(input);
  await requireOrganizationRole(data.organizationId, KNOWLEDGE_CURATOR_ROLES);
  const supabase = await createSupabaseServerClient();
  const { data: source, error } = await supabase
    .rpc("transition_knowledge_source", {
      target_organization_id: data.organizationId,
      target_source_id: data.sourceId,
      target_status: data.status,
    })
    .single();
  if (error || !source)
    throw error ?? new Error("The knowledge review state could not be changed.");
  return source;
}

export async function searchApprovedKnowledge(input: {
  organizationId: string;
  query: string;
  limit?: number;
}) {
  const data = knowledgeSearchInputSchema.parse(input);
  await requireActiveMembership(data.organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: results, error } = await supabase.rpc(
    "search_approved_knowledge",
    {
      target_organization_id: data.organizationId,
      target_query: data.query,
      target_limit: data.limit,
    },
  );
  if (error) throw error;
  return knowledgeSearchResultSchema.array().parse(results ?? []);
}
