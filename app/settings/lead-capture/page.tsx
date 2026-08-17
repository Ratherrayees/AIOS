"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import {
  createLeadCaptureForm,
  updateLeadCaptureFormStatus,
} from "../../actions/crm";
import { LoadingState } from "../../../components/ui/empty-state";
import { SettingsNavigation } from "../../../components/ui/settings-navigation";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import "./lead-capture-settings.css";

type Member = { id: string; name: string; role: string };
type CaptureForm = {
  id: string;
  public_token: string;
  name: string;
  headline: string;
  source: string;
  default_owner_id: string | null;
  first_response_minutes: number;
  is_active: boolean;
  created_at: string;
};
type Submission = {
  id: string;
  lead_capture_form_id: string;
  status: string;
  created_at: string;
};

export default function LeadCaptureSettingsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [forms, setForms] = useState<CaptureForm[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

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
      const [{ data: formRows }, { data: submissionRows }, { data: memberRows }] =
        await Promise.all([
          supabase
            .from("lead_capture_forms")
            .select(
              "id, public_token, name, headline, source, default_owner_id, first_response_minutes, is_active, created_at",
            )
            .eq("organization_id", active.organization_id)
            .order("created_at", { ascending: false }),
          supabase
            .from("lead_submissions")
            .select("id, lead_capture_form_id, status, created_at")
            .eq("organization_id", active.organization_id)
            .order("created_at", { ascending: false })
            .limit(200),
          supabase
            .from("memberships")
            .select("user_id, role")
            .eq("organization_id", active.organization_id)
            .eq("status", "active")
            .in("role", ["owner", "admin", "sales", "agent"]),
        ]);
      const memberIds = (memberRows || []).map((member) => member.user_id);
      const { data: profiles } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [] };
      const names = new Map(
        (profiles || []).map((profile) => [profile.id, profile.full_name]),
      );
      setMembers(
        (memberRows || []).map((member) => ({
          id: member.user_id,
          name: names.get(member.user_id) || "Team member",
          role: member.role,
        })),
      );
      setForms((formRows || []) as CaptureForm[]);
      setSubmissions((submissionRows || []) as Submission[]);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load lead capture settings.");
      setLoading(false);
    });
  }, []);

  function createForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const target = event.currentTarget;
    const data = new FormData(target);
    startTransition(async () => {
      try {
        const form = await createLeadCaptureForm({
          organizationId,
          name: String(data.get("name") || ""),
          headline: String(data.get("headline") || ""),
          source: String(data.get("source") || ""),
          defaultOwnerId: String(data.get("defaultOwnerId") || "") || null,
          firstResponseMinutes: Number(data.get("firstResponseMinutes")),
        });
        setForms((current) => [form as CaptureForm, ...current]);
        target.reset();
        setNotice("Lead capture form is live and ready to share.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that form.",
        );
      }
    });
  }

  function toggleForm(form: CaptureForm) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const updated = await updateLeadCaptureFormStatus({
          organizationId,
          formId: form.id,
          isActive: !form.is_active,
        });
        setForms((current) =>
          current.map((item) =>
            item.id === form.id
              ? { ...item, is_active: updated.is_active }
              : item,
          ),
        );
        setNotice(updated.is_active ? "Form resumed." : "Form paused.");
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "The form was not updated.",
        );
      }
    });
  }

  async function copyLink(form: CaptureForm) {
    const url = `${window.location.origin}/lead/${form.public_token}`;
    await navigator.clipboard.writeText(url);
    setNotice("Public lead form link copied.");
  }

  return (
    <main className="capture-settings" id="main-content" tabIndex={-1}>
      <SettingsNavigation />
      <OperationalPageHeader
        section="Administration"
        title="Lead capture"
        meta={`${forms.filter((form) => form.is_active).length} live forms · ${forms.length} total`}
      />
      {notice && (
        <p className="capture-settings-notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <LoadingState label="Loading capture operations" rows={4} />
      ) : (
        <section className="capture-settings-grid">
          <article className="capture-settings-panel create">
            <header>
              <p>NEW ENDPOINT</p>
              <h2>Launch a secure intake surface.</h2>
            </header>
            <form onSubmit={createForm}>
              <label>
                Internal form name
                <input name="name" maxLength={80} placeholder="StateAI website" required />
              </label>
              <label>
                Traveller-facing headline
                <input
                  name="headline"
                  maxLength={140}
                  defaultValue="Plan an extraordinary journey"
                  required
                />
              </label>
              <div className="capture-settings-fields">
                <label>
                  Attribution source
                  <input name="source" maxLength={120} defaultValue="Website" required />
                </label>
                <label>
                  Response target
                  <select name="firstResponseMinutes" defaultValue="15">
                    <option value="5">5 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="240">4 hours</option>
                  </select>
                </label>
              </div>
              <label>
                Default owner
                <select name="defaultOwnerId" defaultValue="">
                  <option value="">Leave unassigned for AIOS routing</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {member.role}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={pending || !organizationId}>
                Create live form
              </button>
            </form>
          </article>
          <section className="capture-settings-list">
            <header>
              <div>
                <p>CAPTURE SURFACES</p>
                <h2>Live forms and response signals</h2>
              </div>
              <span>{submissions.length} recent submissions</span>
            </header>
            {forms.length ? (
              forms.map((form) => {
                const captured = submissions.filter(
                  (submission) => submission.lead_capture_form_id === form.id,
                );
                return (
                  <article className="capture-form-row" key={form.id}>
                    <div className="capture-form-status">
                      <span className={form.is_active ? "live" : "paused"} />
                      {form.is_active ? "Live" : "Paused"}
                    </div>
                    <div>
                      <h3>{form.name}</h3>
                      <p>{form.headline}</p>
                      <small>
                        {form.source} · {form.first_response_minutes} min SLA ·{" "}
                        {captured.length} recent
                      </small>
                    </div>
                    <div className="capture-form-actions">
                      <button type="button" onClick={() => void copyLink(form)}>
                        Copy link
                      </button>
                      <a href={`/lead/${form.public_token}`} target="_blank">
                        Preview
                      </a>
                      <button type="button" onClick={() => toggleForm(form)}>
                        {form.is_active ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="capture-settings-empty">
                <b>No capture surface yet.</b>
                <p>Create one here; no external form vendor is required.</p>
              </div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}
