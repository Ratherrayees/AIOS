"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  createFollowUpSequence,
  createQualificationChecklistTemplate,
} from "../../actions/crm";
import { LoadingState } from "../../../components/ui/empty-state";
import { FeatureHeader } from "../../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import "./sales-workflows.css";

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

function qualificationLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const optional = line.startsWith("?");
      const content = optional ? line.slice(1).trim() : line;
      const [label, ...guidanceParts] = content.split("::");
      return {
        label: label.trim(),
        guidance: guidanceParts.join("::").trim() || null,
        required: !optional,
      };
    });
}

function sequenceLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("|");
      if (separator < 1) return { delayDays: Number.NaN, title: line };
      return {
        delayDays: Number(line.slice(0, separator).trim()),
        title: line.slice(separator + 1).trim(),
      };
    });
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
    const parsedItems = qualificationLines(
      String(data.get("checklistItems") || ""),
    );
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
    const parsedSteps = sequenceLines(String(data.get("sequenceSteps") || ""));
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
      <FeatureHeader
        links={[
          { href: "/", label: "Pipeline" },
          { href: "/settings/lead-capture", label: "Lead capture" },
          { href: "/analytics", label: "Analytics" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />
      <section className="sales-workflows-hero">
        <div>
          <p>REUSABLE SALES OPERATIONS</p>
          <h1>Qualify consistently. Follow up without drift.</h1>
          <span>
            Checklists gate commercial advancement. Sequences create
            tenant-scoped internal tasks only—never messages or commitments.
          </span>
        </div>
        <aside>
          <div>
            <b>{templates.length}</b>
            <span>CHECKLISTS</span>
          </div>
          <div>
            <b>{sequences.length}</b>
            <span>SEQUENCES</span>
          </div>
        </aside>
      </section>
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
                Prefix an optional item with <code>?</code>. Add guidance after{" "}
                <code>::</code>.
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
                <label>
                  Checklist items
                  <textarea
                    name="checklistItems"
                    rows={6}
                    defaultValue={
                      "Confirm travel dates :: Record flexibility and preferred departure\nValidate traveller count\nConfirm working budget\n? Record visa support preference"
                    }
                    required
                  />
                </label>
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
                Enter one step per line as <code>delay days | task title</code>.
                Delays must increase.
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
                <label>
                  Sequence steps
                  <textarea
                    name="sequenceSteps"
                    rows={6}
                    defaultValue={
                      "0 | Confirm the traveller brief\n2 | Review itinerary direction\n5 | Recheck decision timeline"
                    }
                    required
                  />
                </label>
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
