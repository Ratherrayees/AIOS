"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  createFollowUpSequence,
  createQualificationChecklistTemplate,
} from "../../actions/crm";
import { LoadingState } from "../../../components/ui/empty-state";
import { SettingsNavigation } from "../../../components/ui/settings-navigation";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import "./sales-workflows.css";
import "./sales-workflows-structured.css";

type QualificationTemplate = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};
type QualificationItem = {
  id: string;
  template_id: string;
  position: number;
  label: string;
  guidance: string | null;
  is_required: boolean;
};
type FollowUpSequence = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};
type FollowUpStep = {
  id: string;
  sequence_id: string;
  position: number;
  title: string;
  delay_days: number;
};

type QualificationDraftItem = {
  id: string;
  label: string;
  guidance: string;
  required: boolean;
};

type SequenceDraftStep = {
  id: string;
  delayDays: number;
  title: string;
};

const initialQualificationItems: QualificationDraftItem[] = [
  {
    id: "travel-dates",
    label: "Confirm travel dates",
    guidance: "Record flexibility and preferred departure",
    required: true,
  },
  {
    id: "traveller-count",
    label: "Validate traveller count",
    guidance: "",
    required: true,
  },
  {
    id: "working-budget",
    label: "Confirm working budget",
    guidance: "",
    required: true,
  },
  {
    id: "visa-support",
    label: "Record visa support preference",
    guidance: "",
    required: false,
  },
];

const initialSequenceSteps: SequenceDraftStep[] = [
  { id: "initial-brief", delayDays: 0, title: "Confirm the traveller brief" },
  { id: "itinerary-review", delayDays: 2, title: "Review itinerary direction" },
  { id: "decision-timeline", delayDays: 5, title: "Recheck decision timeline" },
];

function draftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadSalesWorkflows(organizationId: string) {
  const supabase = createSupabaseBrowserClient();
  const [
    { data: templateRows, error: templateError },
    { data: itemRows, error: itemError },
    { data: sequenceRows, error: sequenceError },
    { data: stepRows, error: stepError },
  ] = await Promise.all([
    supabase
      .from("qualification_checklist_templates")
      .select("id, name, description, is_active")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("qualification_checklist_items")
      .select(
        "id, template_id, position, label, guidance, is_required",
      )
      .eq("organization_id", organizationId)
      .order("position"),
    supabase
      .from("follow_up_sequences")
      .select("id, name, description, is_active")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("follow_up_sequence_steps")
      .select("id, sequence_id, position, title, delay_days")
      .eq("organization_id", organizationId)
      .order("position"),
  ]);
  const error = templateError || itemError || sequenceError || stepError;
  if (error) throw error;
  return {
    templates: (templateRows || []) as QualificationTemplate[],
    items: (itemRows || []) as QualificationItem[],
    sequences: (sequenceRows || []) as FollowUpSequence[],
    steps: (stepRows || []) as FollowUpStep[],
  };
}

export default function SalesWorkflowsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QualificationTemplate[]>([]);
  const [items, setItems] = useState<QualificationItem[]>([]);
  const [sequences, setSequences] = useState<FollowUpSequence[]>([]);
  const [steps, setSteps] = useState<FollowUpStep[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [qualificationDraftItems, setQualificationDraftItems] = useState(
    initialQualificationItems,
  );
  const [sequenceDraftSteps, setSequenceDraftSteps] = useState(
    initialSequenceSteps,
  );

  async function refresh(organization: string) {
    const rows = await loadSalesWorkflows(organization);
    setTemplates(rows.templates);
    setItems(rows.items);
    setSequences(rows.sequences);
    setSteps(rows.steps);
  }

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) {
        setNotice("No active workspace is available.");
        setLoading(false);
        return;
      }
      setOrganizationId(active.organization_id);
      setRole(active.role);
      await refresh(active.organization_id);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load sales workflows.");
      setLoading(false);
    });
  }, []);

  function createChecklist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsedItems = qualificationDraftItems
      .map((item) => ({
        label: item.label.trim(),
        guidance: item.guidance.trim() || null,
        required: item.required,
      }))
      .filter((item) => item.label.length > 0);
    startTransition(async () => {
      try {
        const result = await createQualificationChecklistTemplate({
          organizationId,
          name: String(data.get("checklistName") || ""),
          description:
            String(data.get("checklistDescription") || "").trim() || null,
          items: parsedItems,
        });
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        await refresh(organizationId);
        form.reset();
        setQualificationDraftItems(initialQualificationItems);
        setNotice("Qualification checklist is ready for live opportunities.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The qualification checklist was not created.",
        );
      }
    });
  }

  function createSequence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsedSteps = sequenceDraftSteps
      .map((step) => ({
        delayDays: Number(step.delayDays),
        title: step.title.trim(),
      }))
      .filter((step) => step.title.length > 0);
    startTransition(async () => {
      try {
        const result = await createFollowUpSequence({
          organizationId,
          name: String(data.get("sequenceName") || ""),
          description:
            String(data.get("sequenceDescription") || "").trim() || null,
          steps: parsedSteps,
        });
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        await refresh(organizationId);
        form.reset();
        setSequenceDraftSteps(initialSequenceSteps);
        setNotice("Internal follow-up sequence is ready to apply.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The follow-up sequence was not created.",
        );
      }
    });
  }

  const canManage = role === "owner" || role === "admin" || role === "sales";

  return (
    <main className="sales-workflows" id="main-content" tabIndex={-1}>
      <SettingsNavigation />
      <OperationalPageHeader
        section="Administration"
        title="Sales workflows"
        meta={`${templates.length} checklists · ${sequences.length} sequences`}
      />
      {notice && (
        <p className="sales-workflows-notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <LoadingState label="Loading sales playbooks" rows={4} />
      ) : (
        <section className="sales-workflows-grid">
          <section className="workflow-column qualification">
            <header>
              <p>QUALIFICATION CONTRACTS</p>
              <h2>Required evidence before proposal.</h2>
              <span>
                Add the evidence your sales team must capture. Mark only the
                items that can be skipped.
              </span>
            </header>
            {canManage && (
              <form onSubmit={createChecklist}>
                <label>
                  Qualification template name
                  <input
                    name="checklistName"
                    maxLength={100}
                    placeholder="Premium leisure qualification"
                    required
                  />
                </label>
                <label>
                  Purpose
                  <input
                    name="checklistDescription"
                    maxLength={500}
                    placeholder="Evidence required before itinerary pricing"
                  />
                </label>
                <fieldset className="workflow-structured-list">
                  <legend>Checklist items</legend>
                  {qualificationDraftItems.map((item, index) => (
                    <div className="workflow-structured-row qualification-row" key={item.id}>
                      <label>
                        Evidence item {index + 1}
                        <input
                          value={item.label}
                          maxLength={180}
                          required
                          onChange={(event) =>
                            setQualificationDraftItems((current) =>
                              current.map((candidate) =>
                                candidate.id === item.id
                                  ? { ...candidate, label: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Guidance for the team
                        <input
                          value={item.guidance}
                          maxLength={500}
                          placeholder="Optional clarification"
                          onChange={(event) =>
                            setQualificationDraftItems((current) =>
                              current.map((candidate) =>
                                candidate.id === item.id
                                  ? { ...candidate, guidance: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="workflow-requirement">
                        Requirement
                        <select
                          value={item.required ? "required" : "optional"}
                          onChange={(event) =>
                            setQualificationDraftItems((current) =>
                              current.map((candidate) =>
                                candidate.id === item.id
                                  ? { ...candidate, required: event.target.value === "required" }
                                  : candidate,
                              ),
                            )
                          }
                        >
                          <option value="required">Required</option>
                          <option value="optional">Optional</option>
                        </select>
                      </label>
                      <button
                        className="workflow-row-remove"
                        type="button"
                        disabled={qualificationDraftItems.length === 1}
                        aria-label={`Remove evidence item ${index + 1}`}
                        onClick={() =>
                          setQualificationDraftItems((current) =>
                            current.filter((candidate) => candidate.id !== item.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="workflow-row-add"
                    type="button"
                    onClick={() =>
                      setQualificationDraftItems((current) => [
                        ...current,
                        { id: draftId("qualification"), label: "", guidance: "", required: true },
                      ])
                    }
                  >
                    Add evidence item
                  </button>
                </fieldset>
                <button type="submit" disabled={pending}>
                  Create checklist
                </button>
              </form>
            )}
            <div className="workflow-library">
              {templates.length ? (
                templates.map((template) => {
                  const templateItems = items.filter(
                    (item) => item.template_id === template.id,
                  );
                  return (
                    <article key={template.id}>
                      <div>
                        <small>{templateItems.length} ITEMS</small>
                        <h3>{template.name}</h3>
                        <p>{template.description || "No description"}</p>
                      </div>
                      <ol>
                        {templateItems.map((item) => (
                          <li key={item.id}>
                            <span>{item.label}</span>
                            <em>{item.is_required ? "required" : "optional"}</em>
                          </li>
                        ))}
                      </ol>
                    </article>
                  );
                })
              ) : (
                <p className="workflow-empty">No qualification template yet.</p>
              )}
            </div>
          </section>
          <section className="workflow-column sequence">
            <header>
              <p>INTERNAL TASK SEQUENCES</p>
              <h2>Turn a playbook into owned work.</h2>
              <span>
                Define when each internal task becomes due. Delays must move
                forward through the sequence.
              </span>
            </header>
            {canManage && (
              <form onSubmit={createSequence}>
                <label>
                  Follow-up sequence name
                  <input
                    name="sequenceName"
                    maxLength={100}
                    placeholder="Qualified lead momentum"
                    required
                  />
                </label>
                <label>
                  Purpose
                  <input
                    name="sequenceDescription"
                    maxLength={500}
                    placeholder="Internal milestones after qualification"
                  />
                </label>
                <fieldset className="workflow-structured-list">
                  <legend>Sequence steps</legend>
                  {sequenceDraftSteps.map((step, index) => (
                    <div className="workflow-structured-row sequence-row" key={step.id}>
                      <label>
                        Due after days
                        <input
                          type="number"
                          min={0}
                          max={365}
                          step={1}
                          value={step.delayDays}
                          required
                          onChange={(event) =>
                            setSequenceDraftSteps((current) =>
                              current.map((candidate) =>
                                candidate.id === step.id
                                  ? { ...candidate, delayDays: Number(event.target.value) }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Internal task {index + 1}
                        <input
                          value={step.title}
                          maxLength={180}
                          required
                          onChange={(event) =>
                            setSequenceDraftSteps((current) =>
                              current.map((candidate) =>
                                candidate.id === step.id
                                  ? { ...candidate, title: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        className="workflow-row-remove"
                        type="button"
                        disabled={sequenceDraftSteps.length === 1}
                        aria-label={`Remove sequence step ${index + 1}`}
                        onClick={() =>
                          setSequenceDraftSteps((current) =>
                            current.filter((candidate) => candidate.id !== step.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="workflow-row-add"
                    type="button"
                    onClick={() =>
                      setSequenceDraftSteps((current) => [
                        ...current,
                        {
                          id: draftId("sequence"),
                          delayDays: (current.at(-1)?.delayDays ?? -1) + 1,
                          title: "",
                        },
                      ])
                    }
                  >
                    Add sequence step
                  </button>
                </fieldset>
                <button type="submit" disabled={pending}>
                  Create internal sequence
                </button>
              </form>
            )}
            <div className="workflow-library">
              {sequences.length ? (
                sequences.map((sequence) => {
                  const sequenceSteps = steps.filter(
                    (step) => step.sequence_id === sequence.id,
                  );
                  return (
                    <article key={sequence.id}>
                      <div>
                        <small>{sequenceSteps.length} INTERNAL TASKS</small>
                        <h3>{sequence.name}</h3>
                        <p>{sequence.description || "No description"}</p>
                      </div>
                      <ol>
                        {sequenceSteps.map((step) => (
                          <li key={step.id}>
                            <span>{step.title}</span>
                            <em>
                              {step.delay_days === 0
                                ? "today"
                                : `day ${step.delay_days}`}
                            </em>
                          </li>
                        ))}
                      </ol>
                    </article>
                  );
                })
              ) : (
                <p className="workflow-empty">No internal sequence yet.</p>
              )}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
