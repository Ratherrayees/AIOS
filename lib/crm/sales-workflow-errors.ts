export type SalesWorkflowOperation =
  | "create_qualification"
  | "create_sequence"
  | "apply_qualification"
  | "update_qualification"
  | "apply_sequence";

const SAFE_SALES_WORKFLOW_MESSAGES = [
  "The qualification template is invalid.",
  "Every qualification item needs a valid label and requirement flag.",
  "The follow-up sequence is invalid.",
  "Every sequence step needs a valid title and delay.",
  "Sequence delays must not move backwards.",
  "That opportunity is not available.",
  "That qualification template is not active.",
  "This qualification checklist is already applied.",
  "That qualification check is not available.",
  "That follow-up sequence is not active.",
  "That follow-up sequence has no steps.",
  "Assign an opportunity owner before applying a follow-up sequence.",
  "This follow-up sequence is already applied to the opportunity.",
] as const;

const FALLBACK_MESSAGES: Record<SalesWorkflowOperation, string> = {
  create_qualification: "The qualification template was not created.",
  create_sequence: "The follow-up sequence was not created.",
  apply_qualification: "The qualification checklist was not applied.",
  update_qualification: "The qualification check was not updated.",
  apply_sequence: "The follow-up sequence was not applied.",
};

/** Returns reviewed user guidance while withholding unexpected database details. */
export function safeSalesWorkflowError(
  operation: SalesWorkflowOperation,
  message: string | null | undefined,
  code?: string | null,
) {
  const reviewed = message
    ? SAFE_SALES_WORKFLOW_MESSAGES.find((candidate) =>
        message.includes(candidate),
      )
    : undefined;
  if (reviewed) return reviewed;
  if (code === "23505") {
    if (operation === "create_qualification")
      return "A qualification template with that name already exists.";
    if (operation === "create_sequence")
      return "A follow-up sequence with that name already exists.";
  }
  return FALLBACK_MESSAGES[operation];
}
