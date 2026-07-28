export type PipelineStage = "new" | "qualified" | "proposal" | "decision";
export type DealStage = PipelineStage | "won" | "lost";

const PIPELINE_TRANSITIONS: Record<DealStage, readonly PipelineStage[]> = {
  new: ["qualified"],
  qualified: ["new", "proposal"],
  proposal: ["qualified", "decision"],
  decision: ["proposal"],
  won: [],
  lost: [],
};

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  new: "New inquiry",
  qualified: "Qualified",
  proposal: "Proposal",
  decision: "Decision",
};

/** Mirrors the open-stage adjacency contract enforced by transition_deal_stage. */
export function allowedPipelineTransitions(stage: DealStage) {
  return PIPELINE_TRANSITIONS[stage];
}

export function isAllowedPipelineTransition(
  from: DealStage,
  to: PipelineStage,
) {
  return PIPELINE_TRANSITIONS[from].includes(to);
}
