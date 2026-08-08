"use client";

import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useParams } from "next/navigation";

import {
  acknowledgeLeadResponse,
  applyFollowUpSequence,
  applyQualificationChecklist,
  createTask,
  updateDealCommercialPlan,
  updateDealOwner,
  updateDealStage,
  updateQualificationCheck,
  uploadTravelDocument,
} from "../../actions/crm";
import { routeUnassignedDeal } from "../../actions/agents";
import { LoadingState } from "../../../components/ui/empty-state";
import { FeatureHeader } from "../../../components/ui/feature-header";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import { buildSalesPriorityBrief, type PrioritySource } from "../../../lib/crm/sales-priority";
import {
  buildDealCommercialInsight,
  selectPrimaryCommercialQuote,
  type DealCommercialAcceptance,
  type DealCommercialQuote,
  type DealCommercialReceivable,
  type DealCommercialTerms,
  type DealCommercialVersion,
} from "../../../lib/crm/deal-commercial-insight";
import "./lead.css";

type Stage = "new" | "qualified" | "proposal" | "decision" | "won" | "lost";
type Deal = {
  id: string;
  contact_id: string | null;
  owner_id: string | null;
  title: string;
  stage: Stage;
  destination: string | null;
  value_amount: number | null;
  currency: string;
  probability: number;
  next_step: string | null;
  expected_close_at: string | null;
  source: string | null;
  source_campaign: string | null;
  created_at: string;
  last_activity_at: string | null;
  first_response_due_at: string | null;
  first_responded_at: string | null;
  follow_up_due_at: string | null;
  sla_escalation_level: number;
};
type Contact = {
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};
type Activity = {
  id: string;
  activity_type: string;
  body: string;
  created_at: string;
};
type TravelDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  sensitivity: "normal" | "restricted";
  storage_path: string;
  created_at: string;
};
type QualificationTemplate = { id: string; name: string };
type QualificationCheck = {
  id: string;
  label: string;
  guidance: string | null;
  is_required: boolean;
  is_complete: boolean;
};
type FollowUpSequence = { id: string; name: string };
type FollowUpSequenceRun = {
  id: string;
  sequence_id: string;
  tasks_created: number;
  created_at: string;
};
type QuoteEvidence = {
  id: string;
  title: string;
  status: "draft" | "shared" | "accepted" | "rejected" | "expired" | "superseded";
  currency: string;
  current_version: number;
  valid_until: string | null;
  accepted_at: string | null;
  updated_at: string;
};
type TaskEvidence = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  due_at: string | null;
};
type Member = { id: string; name: string; role: string };
type CommercialEvidence = {
  quote: DealCommercialQuote | null;
  version: DealCommercialVersion | null;
  terms: DealCommercialTerms | null;
  acceptance: DealCommercialAcceptance | null;
  receivables: DealCommercialReceivable[];
};

const prioritySourceHref: Record<PrioritySource, string> = {
  commercial: "#commercial-signal",
  owner: "#opportunity-owner",
  traveller: "#traveller-context",
  qualification: "#qualification-gate",
  quotes: "/quotes",
  tasks: "/tasks",
  activity: "#activity-timeline",
};

const stages: { value: Stage; label: string }[] = [
  { value: "new", label: "New inquiry" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "decision", label: "Decision" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

function money(value: number | null, currency: string) {
  return value === null
    ? "TBC"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value);
}

function commercialMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function label(type: string) {
  return (
    (
      {
        deal_created: "Opportunity created",
        deal_stage_changed: "Stage changed",
        deal_response_recorded: "First response recorded",
        deal_sla_escalated: "Response SLA escalated",
        document_uploaded: "Travel document secured",
        qualification_checklist_applied: "Qualification checklist applied",
        qualification_check_updated: "Qualification evidence updated",
        follow_up_sequence_applied: "Follow-up sequence applied",
        task_created: "Follow-up created",
        task_status_changed: "Follow-up updated",
        deal_commercial_plan_updated: "Commercial plan updated",
        note: "Private note",
        ai_observation: "AIOS observation",
      } as Record<string, string>
    )[type] || "Activity"
  );
}

export default function LeadDetailPage() {
  const params = useParams<{ dealId: string }>();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [documents, setDocuments] = useState<TravelDocument[]>([]);
  const [qualificationTemplates, setQualificationTemplates] = useState<
    QualificationTemplate[]
  >([]);
  const [qualificationChecks, setQualificationChecks] = useState<
    QualificationCheck[]
  >([]);
  const [followUpSequences, setFollowUpSequences] = useState<
    FollowUpSequence[]
  >([]);
  const [followUpRuns, setFollowUpRuns] = useState<FollowUpSequenceRun[]>([]);
  const [quotes, setQuotes] = useState<QuoteEvidence[]>([]);
  const [tasks, setTasks] = useState<TaskEvidence[]>([]);
  const [commercialEvidence, setCommercialEvidence] =
    useState<CommercialEvidence>({
      quote: null,
      version: null,
      terms: null,
      acceptance: null,
      receivables: [],
    });
  const [commercialEvidenceAvailable, setCommercialEvidenceAvailable] =
    useState(false);
  const [priorityEvidenceAvailable, setPriorityEvidenceAvailable] =
    useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPriorityEvidenceAvailable(false);
      setCommercialEvidenceAvailable(false);
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      const { data: dealRow, error } = await supabase
        .from("deals")
        .select(
          "id, contact_id, owner_id, title, stage, destination, value_amount, currency, probability, next_step, expected_close_at, source, source_campaign, created_at, last_activity_at, first_response_due_at, first_responded_at, follow_up_due_at, sla_escalation_level",
        )
        .eq("id", params.dealId)
        .eq("organization_id", membership.organization_id)
        .maybeSingle();
      if (error || !dealRow) {
        setNotice("This opportunity is not available in your workspace.");
        setLoading(false);
        return;
      }
      const [
        { data: contactRow, error: contactError },
        { data: activityRows },
        { data: memberRows },
        { data: documentRows },
        { data: qualificationTemplateRows },
        { data: qualificationCheckRows, error: qualificationCheckError },
        { data: followUpSequenceRows },
        { data: followUpRunRows },
        { data: quoteRows, error: quoteError },
        { data: taskRows, error: taskError },
        { data: receivableRows, error: receivableError },
      ] = await Promise.all([
        dealRow.contact_id
          ? supabase
              .from("contacts")
              .select("first_name, last_name, email, phone")
              .eq("id", dealRow.contact_id)
              .eq("organization_id", membership.organization_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("activity_events")
          .select("id, activity_type, body, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("deal_id", dealRow.id)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        dealRow.contact_id
          ? supabase
              .from("documents")
              .select(
                "id, file_name, mime_type, byte_size, sensitivity, storage_path, created_at",
              )
              .eq("organization_id", membership.organization_id)
              .eq("contact_id", dealRow.contact_id)
              .order("created_at", { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] }),
        supabase
          .from("qualification_checklist_templates")
          .select("id, name")
          .eq("organization_id", membership.organization_id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("deal_qualification_checks")
          .select("id, label, guidance, is_required, is_complete")
          .eq("organization_id", membership.organization_id)
          .eq("deal_id", dealRow.id)
          .order("created_at"),
        supabase
          .from("follow_up_sequences")
          .select("id, name")
          .eq("organization_id", membership.organization_id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("deal_follow_up_sequence_runs")
          .select("id, sequence_id, tasks_created, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("deal_id", dealRow.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("quotes")
          .select(
            "id, title, status, currency, current_version, valid_until, accepted_at, updated_at",
          )
          .eq("organization_id", membership.organization_id)
          .eq("deal_id", dealRow.id)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("tasks")
          .select("id, title, status, due_at")
          .eq("organization_id", membership.organization_id)
          .eq("deal_id", dealRow.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("payments")
          .select(
            "quote_id, quote_version_id, quote_acceptance_id, invoice_issuance_id, direction, currency, amount, paid_amount, status",
          )
          .eq("organization_id", membership.organization_id)
          .eq("deal_id", dealRow.id)
          .eq("direction", "receivable")
          .limit(100),
      ]);

      const normalizedQuotes = ((quoteRows || []) as QuoteEvidence[]).map(
        (quote) => ({
          id: quote.id,
          title: quote.title,
          status: quote.status,
          currency: quote.currency,
          currentVersion: quote.current_version,
          validUntil: quote.valid_until,
          acceptedAt: quote.accepted_at,
          updatedAt: quote.updated_at,
        }),
      );
      const primaryQuote = selectPrimaryCommercialQuote(normalizedQuotes);
      let exactVersion: DealCommercialVersion | null = null;
      let exactTerms: DealCommercialTerms | null = null;
      let exactAcceptance: DealCommercialAcceptance | null = null;
      let commercialReadError = quoteError || receivableError;

      if (primaryQuote) {
        const { data: versionRow, error: versionError } = await supabase
          .from("quote_versions")
          .select("id, quote_id, version, net_amount, tax_amount, total_amount")
          .eq("organization_id", membership.organization_id)
          .eq("quote_id", primaryQuote.id)
          .eq("version", primaryQuote.currentVersion)
          .maybeSingle();
        commercialReadError ||= versionError;

        if (versionRow) {
          exactVersion = {
            id: versionRow.id,
            quoteId: versionRow.quote_id,
            version: versionRow.version,
            netAmount: versionRow.net_amount,
            taxAmount: versionRow.tax_amount,
            totalAmount: versionRow.total_amount,
          };
          const [termsResult, acceptanceResult] = await Promise.all([
            supabase
              .from("quote_version_commercial_terms")
              .select(
                "quote_version_id, estimated_cost_amount, net_sell_amount, gross_markup_amount, gross_markup_percent, estimated_commission_amount, post_commission_margin_amount, post_commission_margin_percent",
              )
              .eq("organization_id", membership.organization_id)
              .eq("quote_version_id", versionRow.id)
              .maybeSingle(),
            supabase
              .from("quote_acceptances")
              .select("id, quote_id, quote_version_id, accepted_at")
              .eq("organization_id", membership.organization_id)
              .eq("quote_id", primaryQuote.id)
              .eq("quote_version_id", versionRow.id)
              .maybeSingle(),
          ]);
          commercialReadError ||= termsResult.error || acceptanceResult.error;
          if (termsResult.data) {
            exactTerms = {
              quoteVersionId: termsResult.data.quote_version_id,
              estimatedCostAmount: termsResult.data.estimated_cost_amount,
              netSellAmount: termsResult.data.net_sell_amount,
              grossMarkupAmount: termsResult.data.gross_markup_amount,
              grossMarkupPercent: termsResult.data.gross_markup_percent,
              estimatedCommissionAmount:
                termsResult.data.estimated_commission_amount,
              postCommissionMarginAmount:
                termsResult.data.post_commission_margin_amount,
              postCommissionMarginPercent:
                termsResult.data.post_commission_margin_percent,
            };
          }
          if (acceptanceResult.data) {
            exactAcceptance = {
              id: acceptanceResult.data.id,
              quoteId: acceptanceResult.data.quote_id,
              quoteVersionId: acceptanceResult.data.quote_version_id,
              acceptedAt: acceptanceResult.data.accepted_at,
            };
          }
        }
      }
      const memberIds = (memberRows || []).map((member) => member.user_id);
      const { data: profileRows } = memberIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", memberIds)
        : { data: [] };
      const names = new Map(
        (profileRows || []).map((profile) => [profile.id, profile.full_name]),
      );
      setMembers(
        (memberRows || []).map((member) => ({
          id: member.user_id,
          name: names.get(member.user_id) || "Team member",
          role: member.role,
        })),
      );
      setDeal(dealRow as Deal);
      setContact(contactRow as Contact | null);
      setActivities((activityRows || []) as Activity[]);
      setDocuments((documentRows || []) as TravelDocument[]);
      setQualificationTemplates(
        (qualificationTemplateRows || []) as QualificationTemplate[],
      );
      setQualificationChecks(
        (qualificationCheckRows || []) as QualificationCheck[],
      );
      setFollowUpSequences(
        (followUpSequenceRows || []) as FollowUpSequence[],
      );
      setFollowUpRuns((followUpRunRows || []) as FollowUpSequenceRun[]);
      setQuotes((quoteRows || []) as QuoteEvidence[]);
      setTasks((taskRows || []) as TaskEvidence[]);
      setCommercialEvidence({
        quote: primaryQuote,
        version: exactVersion,
        terms: exactTerms,
        acceptance: exactAcceptance,
        receivables: ((receivableRows || []) as Array<{
          quote_id: string | null;
          quote_version_id: string | null;
          quote_acceptance_id: string | null;
          invoice_issuance_id: string | null;
          direction: string;
          currency: string;
          amount: number;
          paid_amount: number;
          status: string;
        }>).map((payment) => ({
          quoteId: payment.quote_id,
          quoteVersionId: payment.quote_version_id,
          quoteAcceptanceId: payment.quote_acceptance_id,
          invoiceIssuanceId: payment.invoice_issuance_id,
          direction: payment.direction,
          currency: payment.currency,
          amount: payment.amount,
          paidAmount: payment.paid_amount,
          status: payment.status,
        })),
      });
      setCommercialEvidenceAvailable(!commercialReadError);
      setPriorityEvidenceAvailable(
        !contactError &&
          !qualificationCheckError &&
          !quoteError &&
          !taskError,
      );
      setLoadedAt(Date.now());
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load this opportunity.");
      setLoading(false);
    });
  }, [params.dealId]);

  function moveStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !deal || pending) return;
    const stage = String(
      new FormData(event.currentTarget).get("stage"),
    ) as Stage;
    const lostReason = String(
      new FormData(event.currentTarget).get("lostReason") || "",
    ).trim();
    startTransition(async () => {
      try {
        const result = await updateDealStage({
          organizationId,
          dealId: deal.id,
          stage,
          lostReason: lostReason || null,
        });
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        const updated = result.deal;
        setDeal((current) =>
          current
            ? {
                ...current,
                stage: updated.stage,
                last_activity_at: updated.last_activity_at,
                first_responded_at: updated.first_responded_at,
              }
            : current,
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "deal_stage_changed",
            body: `Deal moved to ${updated.stage}.`,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice(`Opportunity moved to ${stage}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update this opportunity.",
        );
      }
    });
  }

  function addFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !deal || pending) return;
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const title = String(
      formData.get("task") || "",
    ).trim();
    const assigneeId = String(
      formData.get("assigneeId") || "",
    ).trim();
    const dueAtValue = String(
      formData.get("dueAt") || "",
    ).trim();
    if (!title) return;
    const dueAt = dueAtValue ? new Date(dueAtValue) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      setNotice("Choose a valid follow-up deadline.");
      return;
    }
    startTransition(async () => {
      try {
        const task = await createTask({
          organizationId,
          contactId: deal.contact_id,
          dealId: deal.id,
          title,
          assigneeId: assigneeId || null,
          dueAt: dueAt?.toISOString() || null,
        });
        setTasks((current) => [task as TaskEvidence, ...current]);
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "task_created",
            body: `Task created: ${task.title}`,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        formElement.reset();
        setNotice("Follow-up added to Tasks and linked to this opportunity.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that follow-up.",
        );
      }
    });
  }

  function changeOwner(ownerId: string | null) {
    if (!organizationId || !deal || pending || ownerId === deal.owner_id)
      return;
    startTransition(async () => {
      try {
        const updated = await updateDealOwner({
          organizationId,
          dealId: deal.id,
          ownerId,
        });
        setDeal((current) =>
          current ? { ...current, owner_id: updated.owner_id } : current,
        );
        setNotice(
          updated.owner_id
            ? "Opportunity owner updated."
            : "Opportunity returned to the unassigned queue.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update the opportunity owner.",
        );
      }
    });
  }

  function routeWithAios() {
    if (!organizationId || !deal || pending || deal.owner_id) return;
    startTransition(async () => {
      try {
        const result = await routeUnassignedDeal({
          organizationId,
          dealId: deal.id,
        });
        if (result.status === "routed") {
          setDeal((current) =>
            current ? { ...current, owner_id: result.deal.owner_id } : current,
          );
          setNotice(
            "AIOS routed this opportunity using current active-workload balance.",
          );
        } else if (result.status === "approval_required")
          setNotice(
            "AIOS proposed a route and sent it to the human approval queue.",
          );
        else
          setNotice(
            "AIOS did not route this opportunity under the current autonomy policy.",
          );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not route this opportunity.",
        );
      }
    });
  }

  function saveCommercialPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !deal || pending) return;
    const formData = new FormData(event.currentTarget);
    const probability = Number(formData.get("probability"));
    const valueText = String(formData.get("valueAmount") || "").trim();
    const valueAmount = valueText ? Number(valueText) : null;
    const destination = String(formData.get("destination") || "").trim();
    const nextStep = String(formData.get("nextStep") || "").trim();
    const expectedCloseAt = String(
      formData.get("expectedCloseAt") || "",
    ).trim();
    const followUpValue = String(
      formData.get("followUpDueAt") || "",
    ).trim();
    const followUpDueAt = followUpValue ? new Date(followUpValue) : null;
    if (followUpDueAt && Number.isNaN(followUpDueAt.getTime())) {
      setNotice("Choose a valid follow-up deadline.");
      return;
    }
    startTransition(async () => {
      try {
        const updated = await updateDealCommercialPlan({
          organizationId,
          dealId: deal.id,
          probability,
          valueAmount,
          destination: destination || null,
          nextStep: nextStep || null,
          expectedCloseAt: expectedCloseAt || null,
          followUpDueAt: followUpDueAt?.toISOString() || null,
        });
        setDeal((current) =>
          current
            ? {
                ...current,
                probability: updated.probability,
                value_amount: updated.value_amount,
                destination: updated.destination,
                next_step: updated.next_step,
                expected_close_at: updated.expected_close_at,
                follow_up_due_at: updated.follow_up_due_at,
                last_activity_at: updated.last_activity_at,
              }
            : current,
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "deal_commercial_plan_updated",
            body: "Commercial plan updated.",
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice("Commercial plan saved for pipeline review.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update this commercial plan.",
        );
      }
    });
  }

  function markResponded() {
    if (!organizationId || !deal || pending || deal.first_responded_at) return;
    startTransition(async () => {
      try {
        const updated = await acknowledgeLeadResponse({
          organizationId,
          dealId: deal.id,
        });
        setDeal((current) =>
          current
            ? {
                ...current,
                first_responded_at: updated.first_responded_at,
                sla_escalation_level: updated.sla_escalation_level,
                last_activity_at: updated.last_activity_at,
              }
            : current,
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "deal_response_recorded",
            body: "The first traveller response was recorded.",
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice("First response recorded and SLA escalation cleared.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not record the response.",
        );
      }
    });
  }

  function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !organizationId ||
      !deal ||
      !deal.contact_id ||
      pending
    )
      return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setNotice("Choose a travel document to upload.");
      return;
    }
    startTransition(async () => {
      try {
        const document = await uploadTravelDocument(
          {
            organizationId,
            dealId: deal.id,
            contactId: deal.contact_id!,
          },
          formData,
        );
        setDocuments((current) => [document as TravelDocument, ...current]);
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "document_uploaded",
            body: `Private travel document uploaded: ${document.file_name}`,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        form.reset();
        setNotice(
          "Travel document encrypted in private storage and linked to this traveller.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not secure that travel document.",
        );
      }
    });
  }

  function applyChecklist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !deal || pending) return;
    const templateId = String(
      new FormData(event.currentTarget).get("templateId") || "",
    );
    if (!templateId) return;
    startTransition(async () => {
      try {
        const result = await applyQualificationChecklist({
          organizationId,
          dealId: deal.id,
          templateId,
        });
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        const supabase = createSupabaseBrowserClient();
        const { data: rows, error } = await supabase
          .from("deal_qualification_checks")
          .select("id, label, guidance, is_required, is_complete")
          .eq("organization_id", organizationId)
          .eq("deal_id", deal.id)
          .order("created_at");
        if (error) throw error;
        setQualificationChecks((rows || []) as QualificationCheck[]);
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "qualification_checklist_applied",
            body: `Qualification checklist applied with ${result.itemCount} items.`,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice(
          `${result.itemCount} qualification checks added to this opportunity.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The qualification checklist was not applied.",
        );
      }
    });
  }

  function toggleQualificationCheck(check: QualificationCheck) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const updated = await updateQualificationCheck({
          organizationId,
          checkId: check.id,
          isComplete: !check.is_complete,
        });
        if (!updated.ok) {
          setNotice(updated.message);
          return;
        }
        const updatedCheck = updated.check;
        setQualificationChecks((current) =>
          current.map((item) =>
            item.id === check.id
              ? { ...item, is_complete: updatedCheck.is_complete }
              : item,
          ),
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "qualification_check_updated",
            body: `Qualification check ${updatedCheck.is_complete ? "completed" : "reopened"}: ${updatedCheck.label}`,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice(
          updatedCheck.is_complete
            ? "Qualification evidence recorded."
            : "Qualification check reopened.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The qualification check was not updated.",
        );
      }
    });
  }

  function applySequence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !deal || pending) return;
    const sequenceId = String(
      new FormData(event.currentTarget).get("sequenceId") || "",
    );
    if (!sequenceId) return;
    startTransition(async () => {
      try {
        const result = await applyFollowUpSequence({
          organizationId,
          dealId: deal.id,
          sequenceId,
        });
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        const run = result.run;
        setFollowUpRuns((current) => [
          {
            id: run.run_id,
            sequence_id: sequenceId,
            tasks_created: run.tasks_created,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        const supabase = createSupabaseBrowserClient();
        const { data: taskRows, error: taskError } = await supabase
          .from("tasks")
          .select("id, title, status, due_at")
          .eq("organization_id", organizationId)
          .eq("deal_id", deal.id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (taskError) throw taskError;
        setTasks((taskRows || []) as TaskEvidence[]);
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            activity_type: "follow_up_sequence_applied",
            body: `Internal follow-up sequence created ${run.tasks_created} tasks.`,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice(
          `${run.tasks_created} internal follow-up tasks created and assigned.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The follow-up sequence was not applied.",
        );
      }
    });
  }

  if (loading)
    return (
      <main className="lead-page" id="main-content" tabIndex={-1}>
        <div className="lead-loading">
          <LoadingState label="Loading opportunity" rows={4} />
        </div>
      </main>
    );
  if (!deal)
    return (
      <main className="lead-page" id="main-content" tabIndex={-1}>
        <FeatureHeader
          links={[{ href: "/", label: "Back to command center" }]}
        />
        <p className="lead-loading">{notice || "Opportunity not found."}</p>
      </main>
    );

  const traveller = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ")
    : "Traveller details not yet collected";
  const requiredQualificationChecks = qualificationChecks.filter(
    (check) => check.is_required,
  );
  const completedRequiredChecks = requiredQualificationChecks.filter(
    (check) => check.is_complete,
  ).length;
  const priorityBrief = priorityEvidenceAvailable
    ? buildSalesPriorityBrief(
        {
          deal: {
            stage: deal.stage,
            createdAt: deal.created_at,
            contactId: deal.contact_id,
            ownerId: deal.owner_id,
            destination: deal.destination,
            valueAmount: deal.value_amount,
            probability: deal.probability,
            nextStep: deal.next_step,
            expectedCloseAt: deal.expected_close_at,
            lastActivityAt: deal.last_activity_at,
            firstResponseDueAt: deal.first_response_due_at,
            firstRespondedAt: deal.first_responded_at,
            followUpDueAt: deal.follow_up_due_at,
          },
          contact,
          qualifications: qualificationChecks.map((check) => ({
            isRequired: check.is_required,
            isComplete: check.is_complete,
          })),
          quotes: quotes.map((quote) => ({
            status: quote.status,
            validUntil: quote.valid_until,
          })),
          tasks: tasks.map((task) => ({
            status: task.status,
            dueAt: task.due_at,
          })),
        },
        new Date(loadedAt),
      )
    : null;
  const commercialInsight = buildDealCommercialInsight({
    evidenceAvailable: commercialEvidenceAvailable,
    deal: {
      stage: deal.stage,
      currency: deal.currency,
      valueAmount: deal.value_amount,
    },
    quote: commercialEvidence.quote,
    version: commercialEvidence.version,
    terms: commercialEvidence.terms,
    acceptance: commercialEvidence.acceptance,
    receivables: commercialEvidence.receivables,
    now: new Date(loadedAt),
  });
  return (
    <main className="lead-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/", label: "Pipeline" },
          { href: "/tasks", label: "Tasks" },
          { href: "/settings/sales-workflows", label: "Sales workflows" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />
      <section className="lead-hero">
        <div>
          <p>OPPORTUNITY WORKSPACE</p>
          <h1>{deal.title}</h1>
          <span>
            {deal.destination || "Destination to be qualified"} · {traveller}
          </span>
        </div>
        <b className={`lead-stage ${deal.stage}`}>
          {stages.find((item) => item.value === deal.stage)?.label}
        </b>
      </section>
      {notice && (
        <p className="lead-notice" role="status">
          {notice}
        </p>
      )}
      <section className="lead-layout">
        <section className="lead-main">
          {priorityBrief ? (
            <article
              className={`lead-panel priority-brief ${priorityBrief.priority.tone}`}
              id="sales-priority-brief"
              aria-labelledby="sales-priority-title"
            >
            <header>
              <div>
                <p>AIOS SALES PRIORITY</p>
                <h2 id="sales-priority-title">{priorityBrief.priority.label}</h2>
              </div>
              <b className="priority-score">
                <span>{priorityBrief.readinessScore}</span>/100 readiness
              </b>
            </header>
            <p className="priority-explainer">
              AIOS ranked current operational urgency from CRM evidence. Readiness
              measures evidence completeness—not conversion probability—and this
              brief changes nothing automatically.
            </p>
            <div className="priority-grid">
              <section aria-labelledby="priority-actions-title">
                <h3 id="priority-actions-title">Do next</h3>
                {priorityBrief.actions.length ? (
                  <ol className="priority-actions">
                    {priorityBrief.actions.map((action) => (
                      <li key={action.code}>
                        <a href={prioritySourceHref[action.source]}>{action.label}</a>
                        <span>{action.reason}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="priority-empty">No open action is proposed for this closed record.</p>
                )}
              </section>
              <section aria-labelledby="priority-risks-title">
                <h3 id="priority-risks-title">Why it is prioritized</h3>
                {priorityBrief.risks.length ? (
                  <ul className="priority-risks">
                    {priorityBrief.risks.map((risk) => (
                      <li key={risk.code} className={risk.severity}>
                        <a href={prioritySourceHref[risk.source]}>{risk.label}</a>
                        <span>{risk.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="priority-empty">No current SLA, timing, or evidence risk was detected.</p>
                )}
              </section>
            </div>
            <details className="priority-evidence">
              <summary>Show the exact readiness calculation</summary>
              <div>
                {priorityBrief.evidence.map((item) => (
                  <a key={item.code} href={prioritySourceHref[item.source]}>
                    <span><b>{item.label}</b><small>{item.detail}</small></span>
                    <strong>{item.earned}/{item.possible}</strong>
                  </a>
                ))}
              </div>
            </details>
            <footer>
              <span>{priorityBrief.engine}</span>
              <span>0 model calls · 0 record changes · 0 external actions</span>
            </footer>
            </article>
          ) : (
            <article
              className="lead-panel priority-brief unavailable"
              id="sales-priority-brief"
              aria-labelledby="sales-priority-title"
            >
              <header>
                <div>
                  <p>AIOS SALES PRIORITY</p>
                  <h2 id="sales-priority-title">Brief unavailable</h2>
                </div>
              </header>
              <p className="priority-explainer">
                AIOS could not verify every supporting record, so it has shown
                no score or recommendation. Reload this opportunity to try
                again.
              </p>
              <footer>
                <span>Fail-closed evidence boundary</span>
                <span>0 model calls · 0 record changes · 0 external actions</span>
              </footer>
            </article>
          )}
          <article
            className={`lead-panel commercial-truth ${commercialInsight.tone}`}
            id="commercial-truth"
            aria-labelledby="commercial-truth-title"
          >
            <header>
              <div>
                <p>COMMERCIAL TRUTH</p>
                <h2 id="commercial-truth-title">{commercialInsight.headline}</h2>
              </div>
              <span className="commercial-boundary">Evidence, not prediction</span>
            </header>
            <p className="commercial-truth-summary">{commercialInsight.summary}</p>
            {commercialInsight.available ? (
              <>
                <ol className="commercial-progress" aria-label="Commercial evidence trail">
                  {commercialInsight.progress.map((step) => (
                    <li key={step.code} className={step.state}>
                      <i aria-hidden="true" />
                      <span>
                        <b>{step.label}</b>
                        <small>{step.detail}</small>
                      </span>
                    </li>
                  ))}
                </ol>
                {commercialInsight.economics ? (
                  <section
                    className="commercial-economics"
                    aria-labelledby="commercial-economics-title"
                  >
                    <div className="commercial-economics-heading">
                      <div>
                        <h3 id="commercial-economics-title">
                          Exact current-version economics
                        </h3>
                        <p>
                          Customer tax stays outside net sell and margin. Protected
                          cost figures appear only for authorized commercial roles.
                        </p>
                      </div>
                      <span>
                        {commercialEvidence.quote
                          ? `Quote v${commercialEvidence.quote.currentVersion}`
                          : "Current quote"}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Customer total</dt>
                        <dd>
                          {commercialMoney(
                            commercialInsight.economics.customerTotal,
                            commercialInsight.economics.currency,
                          )}
                        </dd>
                        <small>
                          Includes {commercialMoney(
                            commercialInsight.economics.tax,
                            commercialInsight.economics.currency,
                          )} tax
                        </small>
                      </div>
                      <div>
                        <dt>Net sell</dt>
                        <dd>
                          {commercialMoney(
                            commercialInsight.economics.netSell,
                            commercialInsight.economics.currency,
                          )}
                        </dd>
                        <small>Customer tax excluded</small>
                      </div>
                      <div>
                        <dt>Gross margin estimate</dt>
                        <dd>
                          {commercialInsight.economics.grossMargin === null
                            ? "Role protected"
                            : commercialMoney(
                                commercialInsight.economics.grossMargin,
                                commercialInsight.economics.currency,
                              )}
                        </dd>
                        <small>
                          {commercialInsight.economics.grossMarginPercent === null
                            ? "Cost evidence is not visible"
                            : `${commercialInsight.economics.grossMarginPercent.toFixed(1)}% of net sell`}
                        </small>
                      </div>
                      <div>
                        <dt>After commission estimate</dt>
                        <dd>
                          {commercialInsight.economics.postCommissionMargin === null
                            ? "Role protected"
                            : commercialMoney(
                                commercialInsight.economics.postCommissionMargin,
                                commercialInsight.economics.currency,
                              )}
                        </dd>
                        <small>
                          {commercialInsight.economics.postCommissionMarginPercent ===
                          null
                            ? "No protected commercial snapshot"
                            : `${commercialInsight.economics.postCommissionMarginPercent.toFixed(1)}% after estimated commission`}
                        </small>
                      </div>
                    </dl>
                  </section>
                ) : (
                  <p className="commercial-empty">
                    No exact current-version economics exist yet. Start in Quotes;
                    AIOS will not estimate missing commercial facts.
                  </p>
                )}
                {commercialInsight.receivables.count > 0 &&
                  commercialInsight.economics && (
                    <div className="commercial-receivables">
                      <span>
                        <b>{commercialInsight.receivables.count}</b> exact receivable
                        {commercialInsight.receivables.count === 1 ? "" : "s"}
                      </span>
                      <span>
                        <b>
                          {commercialMoney(
                            commercialInsight.receivables.total,
                            commercialInsight.economics.currency,
                          )}
                        </b>{" "}
                        scheduled
                      </span>
                      <span>
                        <b>
                          {commercialMoney(
                            commercialInsight.receivables.paid,
                            commercialInsight.economics.currency,
                          )}
                        </b>{" "}
                        recorded paid
                      </span>
                    </div>
                  )}
                {commercialInsight.alerts.length > 0 && (
                  <ul className="commercial-alerts" aria-label="Commercial evidence warnings">
                    {commercialInsight.alerts.map((alert) => (
                      <li key={alert}>{alert}</li>
                    ))}
                  </ul>
                )}
                <a className="commercial-next-action" href={commercialInsight.action.href}>
                  <span>
                    <small>NEXT EVIDENCE-BACKED ACTION</small>
                    <b>{commercialInsight.action.label}</b>
                    <em>{commercialInsight.action.detail}</em>
                  </span>
                  <strong aria-hidden="true">→</strong>
                </a>
              </>
            ) : (
              <p className="commercial-empty">
                Reload before using this panel for a commercial decision. No
                fallback totals or guessed margins are shown.
              </p>
            )}
            <footer>
              <span>Deterministic · tenant-authorized source records</span>
              <span>0 model calls · 0 record changes · 0 external actions</span>
            </footer>
          </article>
          <article className="lead-panel qualification" id="commercial-signal">
            <header>
              <p>COMMERCIAL SIGNAL</p>
              <h2>Move the opportunity with intent.</h2>
            </header>
            <div className="lead-stats">
              <div>
                <small>PROBABILITY</small>
                <b>{deal.probability}%</b>
              </div>
              <div>
                <small>ESTIMATED VALUE</small>
                <b>{money(deal.value_amount, deal.currency)}</b>
              </div>
              <div>
                <small>SOURCE</small>
                <b>
                  {deal.source || "Manual"}
                  {deal.source_campaign ? ` · ${deal.source_campaign}` : ""}
                </b>
              </div>
              <div>
                <small>EXPECTED CLOSE</small>
                <b>
                  {deal.expected_close_at
                    ? new Date(
                        `${deal.expected_close_at}T00:00:00`,
                      ).toLocaleDateString()
                    : "Not planned"}
                </b>
              </div>
            </div>
            <div
              className={`lead-response-sla ${
                deal.first_responded_at
                  ? "complete"
                  : deal.first_response_due_at &&
                      new Date(deal.first_response_due_at).getTime() < loadedAt
                    ? "overdue"
                    : "open"
              }`}
            >
              <div>
                <small>FIRST RESPONSE SLA</small>
                <b>
                  {deal.first_responded_at
                    ? `Recorded ${new Date(deal.first_responded_at).toLocaleString()}`
                    : deal.first_response_due_at
                      ? `Due ${new Date(deal.first_response_due_at).toLocaleString()}`
                      : "No deadline"}
                </b>
                {deal.sla_escalation_level > 0 && (
                  <span>AIOS escalation level {deal.sla_escalation_level}</span>
                )}
              </div>
              {!deal.first_responded_at && (
                <button type="button" onClick={markResponded} disabled={pending}>
                  Mark first response
                </button>
              )}
            </div>
            <div className="next-step">
              <small>NEXT STEP</small>
              <p>
                {deal.next_step ||
                  "Set a concrete follow-up from the pipeline."}
              </p>
            </div>
            <form className="commercial-form" onSubmit={saveCommercialPlan}>
              <label>
                Win probability
                <input
                  name="probability"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={deal.probability}
                  required
                />
              </label>
              <label>
                Opportunity value
                <input
                  name="valueAmount"
                  type="number"
                  min="0"
                  step="1000"
                  defaultValue={deal.value_amount ?? ""}
                  placeholder="Estimated budget"
                />
              </label>
              <label>
                Destination
                <input
                  name="destination"
                  defaultValue={deal.destination || ""}
                  placeholder="Destination or route"
                />
              </label>
              <label>
                Expected close
                <input
                  name="expectedCloseAt"
                  type="date"
                  defaultValue={deal.expected_close_at || ""}
                />
              </label>
              <label>
                Follow-up deadline
                <input
                  name="followUpDueAt"
                  type="datetime-local"
                  defaultValue={
                    deal.follow_up_due_at
                      ? new Date(deal.follow_up_due_at)
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                />
              </label>
              <label className="commercial-next-step">
                Next commercial step
                <input
                  name="nextStep"
                  defaultValue={deal.next_step || ""}
                  placeholder="e.g. Present revised family itinerary"
                />
              </label>
              <button type="submit" disabled={pending}>
                Save plan
              </button>
            </form>
            <div className="stage-contract">
              <b>Governed movement</b>
              <span>
                Qualification needs an owner, destination, next step, expected
                close, and 20% probability. Proposal adds a positive value.
                Decision requires 50% probability. Applied required checklist
                items must be complete before Proposal, Decision, or Won. Only
                managers can reopen closed deals.
              </span>
            </div>
            <form className="stage-form" onSubmit={moveStage}>
              <label>
                Pipeline stage
                <select name="stage" defaultValue={deal.stage}>
                  {stages.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Loss reason
                <input
                  name="lostReason"
                  placeholder="Required only when moving to Lost"
                />
              </label>
              <button type="submit" disabled={pending}>
                Update stage
              </button>
            </form>
          </article>
          <article className="lead-panel qualification-workflow" id="qualification-gate">
            <header>
              <p>QUALIFICATION GATE</p>
              <h2>Evidence before commercial movement.</h2>
            </header>
            <div className="qualification-progress">
              <div>
                <b>
                  {completedRequiredChecks}/{requiredQualificationChecks.length}
                </b>
                <span>required checks complete</span>
              </div>
              <i
                style={{
                  "--qualification-progress": `${
                    requiredQualificationChecks.length
                      ? (completedRequiredChecks /
                          requiredQualificationChecks.length) *
                        100
                      : 0
                  }%`,
                } as CSSProperties}
              />
            </div>
            {qualificationTemplates.length > 0 ? (
              <form className="workflow-apply" onSubmit={applyChecklist}>
                <label>
                  Reusable checklist
                  <select name="templateId" defaultValue="" required>
                    <option value="" disabled>
                      Choose a qualification contract
                    </option>
                    {qualificationTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={pending}>
                  Apply checklist
                </button>
              </form>
            ) : (
              <a
                className="workflow-create-link"
                href="/settings/sales-workflows"
              >
                Create a qualification template
              </a>
            )}
            <div className="qualification-checks">
              {qualificationChecks.length ? (
                qualificationChecks.map((check) => (
                  <label
                    key={check.id}
                    className={check.is_complete ? "complete" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={check.is_complete}
                      disabled={pending}
                      onChange={() => toggleQualificationCheck(check)}
                    />
                    <span>
                      <b>{check.label}</b>
                      <small>
                        {check.guidance ||
                          (check.is_required
                            ? "Required before proposal"
                            : "Optional context")}
                      </small>
                    </span>
                    <em>{check.is_required ? "required" : "optional"}</em>
                  </label>
                ))
              ) : (
                <p className="lead-empty">
                  No checklist applied. The built-in stage contract still
                  protects commercial movement.
                </p>
              )}
            </div>
          </article>
          <article className="lead-panel" id="activity-timeline">
            <header>
              <p>ACTIVITY TIMELINE</p>
              <h2>Context for every handoff.</h2>
            </header>
            <div className="activity-list">
              {activities.length === 0 ? (
                <p className="lead-empty">No linked activity yet.</p>
              ) : (
                activities.map((activity) => (
                  <article key={activity.id}>
                    <i>
                      {activity.activity_type === "task_created" ? "✓" : "✦"}
                    </i>
                    <div>
                      <b>{label(activity.activity_type)}</b>
                      <p>{activity.body}</p>
                      <small>
                        {new Date(activity.created_at).toLocaleString()}
                      </small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </section>
        <aside className="lead-side">
          <article className="lead-panel" id="opportunity-owner">
            <p>OPPORTUNITY OWNER</p>
            <h2>
              {members.find((member) => member.id === deal.owner_id)?.name ||
                "Unassigned queue"}
            </h2>
            <label className="lead-owner">
              Responsible member
              <select
                value={deal.owner_id || ""}
                disabled={pending}
                onChange={(event) => changeOwner(event.target.value || null)}
              >
                <option value="">Unassigned queue</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.role}
                  </option>
                ))}
              </select>
            </label>
            {!deal.owner_id && (
              <button
                className="lead-route"
                type="button"
                disabled={pending}
                onClick={routeWithAios}
              >
                ✦ Route with AIOS
              </button>
            )}
          </article>
          <article className="lead-panel" id="traveller-context">
            <p>TRAVELLER CONTEXT</p>
            <h2>{traveller}</h2>
            <dl>
              <div>
                <dt>Email</dt>
                <dd>{contact?.email || "Not collected"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{contact?.phone || "Not collected"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(deal.created_at).toLocaleDateString()}</dd>
              </div>
            </dl>
          </article>
          <article className="lead-panel document-vault">
            <p>PRIVATE DOCUMENT VAULT</p>
            <h2>Traveller files, tenant locked.</h2>
            <span>
              PDFs and travel-document images stay private, MFA-aware, and
              audit logged. Maximum file size: 15 MB.
            </span>
            {deal.contact_id ? (
              <form onSubmit={uploadDocument}>
                <label>
                  Travel document
                  <input
                    name="file"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                    required
                  />
                </label>
                <button type="submit" disabled={pending}>
                  Secure document
                </button>
              </form>
            ) : (
              <p className="lead-empty">
                Link a traveller before adding private documents.
              </p>
            )}
            <div className="document-list">
              {documents.length === 0 ? (
                <small>No private documents linked yet.</small>
              ) : (
                documents.map((document) => (
                  <article key={document.id}>
                    <i aria-hidden="true">PDF</i>
                    <div>
                      <b>{document.file_name}</b>
                      <small>
                        {(document.byte_size / 1024).toFixed(1)} KB ·{" "}
                        {new Date(document.created_at).toLocaleDateString()}
                      </small>
                    </div>
                    <em>{document.sensitivity}</em>
                  </article>
                ))
              )}
            </div>
          </article>
          <article className="lead-panel sequence-panel">
            <p>FOLLOW-UP PLAYBOOK</p>
            <h2>Schedule the internal sequence.</h2>
            <span>
              Every step becomes an internal task assigned to the opportunity
              owner. Nothing is sent to the traveller.
            </span>
            {followUpSequences.length ? (
              <form onSubmit={applySequence}>
                <label>
                  Internal sequence
                  <select name="sequenceId" defaultValue="" required>
                    <option value="" disabled>
                      Choose a playbook
                    </option>
                    {followUpSequences.map((sequence) => (
                      <option key={sequence.id} value={sequence.id}>
                        {sequence.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={pending}>
                  Create sequence tasks
                </button>
              </form>
            ) : (
              <a
                className="workflow-create-link"
                href="/settings/sales-workflows"
              >
                Create an internal sequence
              </a>
            )}
            {followUpRuns.length > 0 && (
              <div className="sequence-runs">
                {followUpRuns.map((run) => (
                  <small key={run.id}>
                    <b>
                      {followUpSequences.find(
                        (sequence) => sequence.id === run.sequence_id,
                      )?.name || "Sequence"}
                    </b>
                    {run.tasks_created} tasks ·{" "}
                    {new Date(run.created_at).toLocaleDateString()}
                  </small>
                ))}
              </div>
            )}
          </article>
          <article className="lead-panel follow-up">
            <p>FOLLOW-UP</p>
            <h2>Create focused work.</h2>
            <span>
              This is an internal task only. AIOS cannot send a message or make
              a booking from here.
            </span>
            <form onSubmit={addFollowUp}>
              <input
                name="task"
                placeholder="e.g. Confirm preferred travel dates"
                required
              />
              <label>
                Responsible member
                <select name="assigneeId" defaultValue="">
                  <option value="">Unassigned queue</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {member.role}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Follow-up deadline
                <input name="dueAt" type="datetime-local" />
              </label>
              <button type="submit" disabled={pending}>
                Add internal task
              </button>
            </form>
          </article>
        </aside>
      </section>
    </main>
  );
}
