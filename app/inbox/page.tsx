"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  addConversationNote,
  createConversation,
  createMessageDraft,
  createMessageTemplate,
  createSavedView,
  deleteSavedView,
  updateConversationAssignee,
  updateConversationSla,
  updateConversationStatus,
  updateMessageDraft,
  updateMessageTemplateStatus,
} from "../actions/crm";
import { prepareConversationReplyDraft } from "../actions/sales-copilot";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { SavedViewControls } from "../../components/ui/saved-view-controls";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { Json } from "../../types/database";
import "./inbox.css";

type Contact = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
};
type Deal = { id: string; title: string; stage: string };
type Conversation = {
  id: string;
  contact_id: string | null;
  deal_id: string | null;
  assignee_id: string | null;
  subject: string | null;
  status: "inbox" | "open" | "pending" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  response_due_at: string | null;
  sla_escalation_level: number;
  sla_escalated_at: string | null;
  last_message_at: string | null;
  created_at: string;
};
type ConversationStatus = Conversation["status"] | "all";
type ConversationSlaFilter = "all" | "overdue" | "due_soon" | "no_deadline";
type Member = { id: string; name: string; role: string };
type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound" | "internal";
  body: string;
  sent_at: string;
};
type MessageTemplate = {
  id: string;
  name: string;
  kind: "reply" | "signature";
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
};
type MessageDraft = {
  id: string;
  ai_run_id: string | null;
  conversation_id: string;
  template_id: string | null;
  channel: "email" | "whatsapp";
  recipient: string | null;
  subject: string | null;
  body: string;
  status: "draft" | "ready_for_review";
  scheduled_for: string | null;
  created_at: string;
};
type CopilotInsight = {
  summary: string;
  suggestedNextSteps: Array<{ action: string; rationale: string }>;
  missingInformation: string[];
  confidence: number;
};
type SavedView = {
  id: string;
  name: string;
  filters: Json;
  created_at: string;
};

function conversationPriority(value: unknown): Conversation["priority"] {
  return value === "low" ||
    value === "high" ||
    value === "urgent"
    ? value
    : "normal";
}

function messageTemplateKind(value: unknown): MessageTemplate["kind"] {
  return value === "signature" ? "signature" : "reply";
}

function messageChannel(
  value: unknown,
): MessageTemplate["channel"] | MessageDraft["channel"] {
  return value === "whatsapp" ? "whatsapp" : "email";
}

function messageDraftStatus(value: unknown): MessageDraft["status"] {
  return value === "ready_for_review" ? "ready_for_review" : "draft";
}

function inboxFiltersFromSavedView(savedView: SavedView | undefined) {
  const filters = savedView?.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    return null;
  const query = typeof filters.query === "string" ? filters.query : "";
  const status =
    filters.status === "inbox" ||
    filters.status === "open" ||
    filters.status === "pending" ||
    filters.status === "closed"
      ? filters.status
      : "all";
  const assigneeId =
    typeof filters.assigneeId === "string" ? filters.assigneeId : "all";
  const sla =
    filters.sla === "overdue" ||
    filters.sla === "due_soon" ||
    filters.sla === "no_deadline"
      ? filters.sla
      : "all";
  return { query, status, assigneeId, sla } satisfies {
    query: string;
    status: ConversationStatus;
    assigneeId: string;
    sla: ConversationSlaFilter;
  };
}

function isConversationOverdue(
  conversation: Conversation,
  comparisonTime: number,
) {
  return Boolean(
    conversation.response_due_at &&
    conversation.status !== "closed" &&
    new Date(conversation.response_due_at).getTime() < comparisonTime,
  );
}

function dateTimeLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function responseDeadlineLabel(conversation: Conversation) {
  if (!conversation.response_due_at) return "No response deadline";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(conversation.response_due_at));
}

function name(contact: Contact | undefined) {
  return contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ")
    : "Unlinked conversation";
}

export default function InboxPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>(
    [],
  );
  const [messageDrafts, setMessageDrafts] = useState<MessageDraft[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus>("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [slaFilter, setSlaFilter] =
    useState<ConversationSlaFilter>("all");
  const [draftTemplateId, setDraftTemplateId] = useState("");
  const [editingDraftId, setEditingDraftId] = useState("");
  const [draftChannel, setDraftChannel] =
    useState<MessageDraft["channel"]>("email");
  const [draftRecipient, setDraftRecipient] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftScheduledFor, setDraftScheduledFor] = useState("");
  const [draftStatus, setDraftStatus] =
    useState<MessageDraft["status"]>("draft");
  const [copilotInsight, setCopilotInsight] =
    useState<CopilotInsight | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterTimestamp, setFilterTimestamp] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      const [
        { data: contactRows },
        { data: dealRows },
        { data: memberRows },
        { data: conversationRows },
        { data: messageRows },
        { data: templateRows },
        { data: draftRows },
        { data: savedViewRows },
      ] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, first_name, last_name, email")
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .order("first_name"),
        supabase
          .from("deals")
          .select("id, title, stage")
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .not("stage", "in", "(won,lost)")
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        supabase
          .from("conversations")
          .select(
            "id, contact_id, deal_id, assignee_id, subject, status, priority, response_due_at, sla_escalation_level, sla_escalated_at, last_message_at, created_at",
          )
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .order("last_message_at", { ascending: false })
          .limit(50),
        supabase
          .from("messages")
          .select("id, conversation_id, direction, body, sent_at")
          .eq("organization_id", membership.organization_id)
          .order("sent_at", { ascending: true })
          .limit(200),
        supabase
          .from("message_templates")
          .select("id, name, kind, channel, subject, body")
          .eq("organization_id", membership.organization_id)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("message_drafts")
          .select(
            "id, ai_run_id, conversation_id, template_id, channel, recipient, subject, body, status, scheduled_for, created_at",
          )
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("saved_views")
          .select("id, name, filters, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("feature", "inbox")
          .order("updated_at", { ascending: false }),
      ]);
      const nextConversations: Conversation[] = (conversationRows || []).map(
        (conversation) => ({
          ...conversation,
          priority: conversationPriority(conversation.priority),
        }),
      );
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
      setContacts(contactRows || []);
      setDeals(dealRows || []);
      setMembers(
        (memberRows || []).map((member) => ({
          id: member.user_id,
          name: names.get(member.user_id) || "Team member",
          role: member.role,
        })),
      );
      setConversations(nextConversations);
      setMessages(messageRows || []);
      setMessageTemplates(
        (templateRows || []).map((template) => ({
          ...template,
          kind: messageTemplateKind(template.kind),
          channel: messageChannel(template.channel),
        })),
      );
      setMessageDrafts(
        (draftRows || []).map((draft) => ({
          ...draft,
          channel: messageChannel(draft.channel),
          status: messageDraftStatus(draft.status),
        })),
      );
      setSavedViews(savedViewRows || []);
      setFilterTimestamp(Date.now());
      setSelectedId(nextConversations[0]?.id || null);
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load the communication hub.");
      setLoading(false);
    });
  }, []);

  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const dealById = useMemo(
    () => new Map(deals.map((deal) => [deal.id, deal])),
    [deals],
  );
  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ||
    null;
  const selectedContact =
    selected?.contact_id ? contactById.get(selected.contact_id) : undefined;
  const selectedMessages = messages.filter(
    (message) => message.conversation_id === selectedId,
  );
  const selectedDrafts = messageDrafts.filter(
    (draft) => draft.conversation_id === selectedId,
  );
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (statusFilter !== "all" && conversation.status !== statusFilter)
        return false;
      if (
        assigneeFilter === "unassigned"
          ? conversation.assignee_id !== null
          : assigneeFilter !== "all" &&
            conversation.assignee_id !== assigneeFilter
      )
        return false;
      if (slaFilter === "overdue") {
        if (!isConversationOverdue(conversation, filterTimestamp))
          return false;
      }
      if (slaFilter === "no_deadline" && conversation.response_due_at)
        return false;
      if (slaFilter === "due_soon") {
        if (
          !conversation.response_due_at ||
          conversation.status === "closed"
        )
          return false;
        const dueAt = new Date(conversation.response_due_at).getTime();
        if (
          dueAt < filterTimestamp ||
          dueAt > filterTimestamp + 24 * 60 * 60 * 1000
        )
          return false;
      }
      if (!normalizedQuery) return true;
      const contact = conversation.contact_id
        ? contactById.get(conversation.contact_id)
        : undefined;
      const deal = conversation.deal_id
        ? dealById.get(conversation.deal_id)
        : undefined;
      return [conversation.subject, name(contact), deal?.title]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [
    assigneeFilter,
    contactById,
    conversations,
    dealById,
    query,
    filterTimestamp,
    slaFilter,
    statusFilter,
  ]);

  function selectSavedView(savedViewId: string) {
    setSelectedSavedViewId(savedViewId);
    if (!savedViewId) return;
    const filters = inboxFiltersFromSavedView(
      savedViews.find((view) => view.id === savedViewId),
    );
    if (!filters) {
      setNotice("That saved Inbox view could not be read.");
      return;
    }
    setQuery(filters.query);
    setStatusFilter(filters.status);
    setAssigneeFilter(filters.assigneeId);
    setSlaFilter(filters.sla);
  }

  function saveCurrentView(name: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const savedView = await createSavedView({
          organizationId,
          feature: "inbox",
          name,
          filters: {
            query,
            status: statusFilter,
            assigneeId: assigneeFilter,
            sla: slaFilter,
          },
        });
        setSavedViews((current) => [savedView, ...current]);
        setSelectedSavedViewId(savedView.id);
        setNotice(`Saved “${savedView.name}” as a private Inbox view.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save that Inbox view.",
        );
      }
    });
  }

  function removeSavedView() {
    if (!organizationId || !selectedSavedViewId || pending) return;
    startTransition(async () => {
      try {
        await deleteSavedView({
          organizationId,
          savedViewId: selectedSavedViewId,
          feature: "inbox",
        });
        setSavedViews((current) =>
          current.filter((view) => view.id !== selectedSavedViewId),
        );
        setSelectedSavedViewId("");
        setNotice("The private Inbox view was removed.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not remove that Inbox view.",
        );
      }
    });
  }

  function submitConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const subject = String(form.get("subject") || "").trim();
    if (!subject) return;
    startTransition(async () => {
      try {
        const conversation = await createConversation({
          organizationId,
          contactId: String(form.get("contactId") || "") || null,
          dealId: String(form.get("dealId") || "") || null,
          subject,
        });
        const next: Conversation = {
          id: conversation.id,
          contact_id: conversation.contact_id,
          deal_id: conversation.deal_id,
          assignee_id: conversation.assignee_id,
          subject: conversation.subject,
          status: conversation.status,
          priority: conversationPriority(conversation.priority),
          response_due_at: conversation.response_due_at,
          sla_escalation_level: conversation.sla_escalation_level,
          sla_escalated_at: conversation.sla_escalated_at,
          last_message_at: conversation.last_message_at,
          created_at: conversation.created_at,
        };
        setConversations((current) => [next, ...current]);
        setSelectedId(next.id);
        setDraftTemplateId("");
        setEditingDraftId("");
        setDraftChannel("email");
        setDraftRecipient(
          next.contact_id ? contactById.get(next.contact_id)?.email || "" : "",
        );
        setDraftSubject("");
        setDraftBody("");
        setDraftScheduledFor("");
        setDraftStatus("draft");
        formElement.reset();
        setNotice(
          "Internal conversation opened. No external message was sent.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not open that conversation.",
        );
      }
    });
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selected || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("body") || "").trim();
    if (!body) return;
    startTransition(async () => {
      try {
        const message = await addConversationNote({
          organizationId,
          conversationId: selected.id,
          body,
        });
        setMessages((current) => [
          ...current,
          {
            id: message.id,
            conversation_id: message.conversation_id,
            direction: message.direction,
            body: message.body,
            sent_at: message.sent_at,
          },
        ]);
        formElement.reset();
        setNotice("Internal note recorded.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save that note.",
        );
      }
    });
  }

  function changeStatus(status: Conversation["status"]) {
    if (!organizationId || !selected || pending || status === selected.status)
      return;
    startTransition(async () => {
      try {
        const updated = await updateConversationStatus({
          organizationId,
          conversationId: selected.id,
          status,
        });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === updated.id
              ? {
                  ...conversation,
                  status: updated.status,
                  ...(updated.status === "closed"
                    ? {
                        sla_escalation_level: 0,
                        sla_escalated_at: null,
                      }
                    : {}),
                }
              : conversation,
          ),
        );
        setNotice(`Conversation marked ${updated.status}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update this conversation.",
        );
      }
    });
  }

  function changeAssignee(assigneeId: string | null) {
    if (
      !organizationId ||
      !selected ||
      pending ||
      assigneeId === selected.assignee_id
    )
      return;
    startTransition(async () => {
      try {
        const updated = await updateConversationAssignee({
          organizationId,
          conversationId: selected.id,
          assigneeId,
        });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === updated.id
              ? { ...conversation, assignee_id: updated.assignee_id }
              : conversation,
          ),
        );
        setNotice(
          updated.assignee_id
            ? "Conversation ownership updated."
            : "Conversation returned to the shared inbox.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not change conversation ownership.",
        );
      }
    });
  }

  function submitSla(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selected || pending) return;
    const form = new FormData(event.currentTarget);
    const priority = String(form.get("priority") || "normal") as
      | "low"
      | "normal"
      | "high"
      | "urgent";
    const deadline = String(form.get("responseDueAt") || "");
    startTransition(async () => {
      try {
        const updated = await updateConversationSla({
          organizationId,
          conversationId: selected.id,
          priority,
          responseDueAt: deadline ? new Date(deadline).toISOString() : null,
        });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === updated.id
              ? {
                  ...conversation,
                  priority: conversationPriority(updated.priority),
                  response_due_at: updated.response_due_at,
                  sla_escalation_level: updated.sla_escalation_level,
                  sla_escalated_at: updated.sla_escalated_at,
                }
              : conversation,
          ),
        );
        setFilterTimestamp(Date.now());
        setNotice(
          updated.response_due_at
            ? "Response priority and deadline recorded."
            : "Response priority recorded; deadline cleared.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update the response SLA.",
        );
      }
    });
  }

  function selectConversation(conversation: Conversation) {
    setSelectedId(conversation.id);
    setDraftTemplateId("");
    setEditingDraftId("");
    setDraftChannel("email");
    setDraftRecipient(
      conversation.contact_id
        ? contactById.get(conversation.contact_id)?.email || ""
        : "",
    );
    setDraftSubject("");
    setDraftBody("");
    setDraftScheduledFor("");
    setDraftStatus("draft");
    setCopilotInsight(null);
  }

  function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const templateName = String(form.get("name") || "").trim();
    const body = String(form.get("body") || "").trim();
    if (!templateName || !body) return;
    startTransition(async () => {
      try {
        const template = await createMessageTemplate({
          organizationId,
          name: templateName,
          kind: String(form.get("kind") || "reply") as
            | "reply"
            | "signature",
          channel: String(form.get("channel") || "email") as
            | "email"
            | "whatsapp",
          subject: String(form.get("subject") || "").trim() || null,
          body,
        });
        setMessageTemplates((current) => [
          {
            id: template.id,
            name: template.name,
            kind: messageTemplateKind(template.kind),
            channel: messageChannel(template.channel),
            subject: template.subject,
            body: template.body,
          },
          ...current,
        ]);
        formElement.reset();
        setNotice(
          `Template “${template.name}” saved for internal drafting.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save that reply template.",
        );
      }
    });
  }

  function applyDraftTemplate(templateId: string) {
    setDraftTemplateId(templateId);
    const template = messageTemplates.find((item) => item.id === templateId);
    if (!template) return;
    if (template.kind === "signature") {
      setDraftBody((current) =>
        [current.trim(), template.body].filter(Boolean).join("\n\n"),
      );
      return;
    }
    setDraftChannel(template.channel);
    setDraftSubject(template.subject || "");
    setDraftBody(template.body);
  }

  function retireTemplate(templateId: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const template = await updateMessageTemplateStatus({
          organizationId,
          templateId,
          isActive: false,
        });
        setMessageTemplates((current) =>
          current.filter((item) => item.id !== template.id),
        );
        if (draftTemplateId === template.id) setDraftTemplateId("");
        setNotice(
          `Template “${template.name}” retired. Existing drafts were preserved.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not retire that reply template.",
        );
      }
    });
  }

  function editDraft(draft: MessageDraft) {
    setEditingDraftId(draft.id);
    setDraftTemplateId(draft.template_id || "");
    setDraftChannel(draft.channel);
    setDraftRecipient(draft.recipient || "");
    setDraftSubject(draft.subject || "");
    setDraftBody(draft.body);
    setDraftScheduledFor(dateTimeLocalValue(draft.scheduled_for));
    setDraftStatus(draft.status);
  }

  function cancelDraftEdit() {
    setEditingDraftId("");
    setDraftTemplateId("");
    setDraftChannel("email");
    setDraftRecipient(selectedContact?.email || "");
    setDraftSubject("");
    setDraftBody("");
    setDraftScheduledFor("");
    setDraftStatus("draft");
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selected || pending || !draftBody.trim()) return;
    startTransition(async () => {
      try {
        const draftInput = {
          organizationId,
          templateId: draftTemplateId || null,
          channel: draftChannel,
          recipient: draftRecipient.trim() || null,
          subject: draftSubject.trim() || null,
          body: draftBody.trim(),
          status: draftStatus,
          scheduledFor: draftScheduledFor
            ? new Date(draftScheduledFor).toISOString()
            : null,
        };
        const draft = editingDraftId
          ? await updateMessageDraft({
              ...draftInput,
              draftId: editingDraftId,
            })
          : await createMessageDraft({
              ...draftInput,
              conversationId: selected.id,
            });
        const nextDraft: MessageDraft = {
          id: draft.id,
          ai_run_id: draft.ai_run_id,
          conversation_id: draft.conversation_id,
          template_id: draft.template_id,
          channel: messageChannel(draft.channel),
          recipient: draft.recipient,
          subject: draft.subject,
          body: draft.body,
          status: messageDraftStatus(draft.status),
          scheduled_for: draft.scheduled_for,
          created_at: draft.created_at,
        };
        setMessageDrafts((current) =>
          editingDraftId
            ? current.map((item) =>
                item.id === nextDraft.id ? nextDraft : item,
              )
            : [nextDraft, ...current],
        );
        setEditingDraftId("");
        setDraftTemplateId("");
        setDraftSubject("");
        setDraftBody("");
        setDraftScheduledFor("");
        setDraftStatus("draft");
        setNotice(
          editingDraftId
            ? "Internal draft revised. Nothing was sent."
            : draft.status === "ready_for_review"
            ? "Draft queued for human review. Nothing was sent."
            : "Internal draft saved. Nothing was sent.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save that message draft.",
        );
      }
    });
  }

  function runSalesCopilot() {
    if (!organizationId || !selected || pending) return;
    startTransition(async () => {
      try {
        const result = await prepareConversationReplyDraft({
          organizationId,
          conversationId: selected.id,
          channel: draftChannel,
        });
        setNotice(result.message);
        if (result.status !== "succeeded") return;
        const nextDraft: MessageDraft = {
          id: result.draft.id,
          ai_run_id: result.draft.ai_run_id,
          conversation_id: result.draft.conversation_id,
          template_id: result.draft.template_id,
          channel: messageChannel(result.draft.channel),
          recipient: result.draft.recipient,
          subject: result.draft.subject,
          body: result.draft.body,
          status: messageDraftStatus(result.draft.status),
          scheduled_for: result.draft.scheduled_for,
          created_at: result.draft.created_at,
        };
        setMessageDrafts((current) => [
          nextDraft,
          ...current.filter((draft) => draft.id !== nextDraft.id),
        ]);
        setEditingDraftId(nextDraft.id);
        setDraftTemplateId("");
        setDraftChannel(nextDraft.channel);
        setDraftRecipient(selectedContact?.email || "");
        setDraftSubject(nextDraft.subject || "");
        setDraftBody(nextDraft.body);
        setDraftScheduledFor("");
        setDraftStatus("ready_for_review");
        setCopilotInsight({
          summary: result.summary,
          suggestedNextSteps: result.suggestedNextSteps,
          missingInformation: result.missingInformation,
          confidence: result.confidence,
        });
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not prepare an internal reply draft.",
        );
      }
    });
  }

  const overdueCount = conversations.filter((conversation) =>
    isConversationOverdue(conversation, filterTimestamp),
  ).length;

  return (
    <main className="inbox-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[{ href: "/", label: "Back to command center" }]}
      />
      <section className="inbox-hero">
        <p>COMMUNICATION HUB</p>
        <h1>Keep every relationship conversation in one place.</h1>
        <span>
          Start internal conversation records now. Inbound email and approved
          outbound delivery activate after Resend is connected.
        </span>
      </section>
      {notice && (
        <p className="inbox-notice" role="status">
          {notice}
        </p>
      )}
      <section className="inbox-new">
        <form onSubmit={submitConversation}>
          <select
            name="contactId"
            defaultValue=""
            aria-label="Conversation contact"
          >
            <option value="">No linked contact</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {name(contact)}
                {contact.email ? ` · ${contact.email}` : ""}
              </option>
            ))}
          </select>
          <select
            name="dealId"
            defaultValue=""
            aria-label="Conversation opportunity"
          >
            <option value="">No linked opportunity</option>
            {deals.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.title} · {deal.stage}
              </option>
            ))}
          </select>
          <input
            name="subject"
            placeholder="Start an internal conversation"
            required
          />
          <button disabled={pending || !organizationId}>
            Open conversation
          </button>
        </form>
      </section>
      <section className="inbox-sla-summary" aria-label="Inbox SLA summary">
        <div>
          <small>OVERDUE</small>
          <b>{overdueCount}</b>
          <span>response deadlines need attention</span>
        </div>
        <div>
          <small>URGENT</small>
          <b>
            {
              conversations.filter(
                (conversation) =>
                  conversation.priority === "urgent" &&
                  conversation.status !== "closed",
              ).length
            }
          </b>
          <span>open urgent conversations</span>
        </div>
        <div>
          <small>ESCALATED</small>
          <b>
            {
              conversations.filter(
                (conversation) =>
                  conversation.sla_escalation_level >= 2 &&
                  conversation.status !== "closed",
              ).length
            }
          </b>
          <span>manager or critical tier</span>
        </div>
        <p>
          AIOS may surface internal SLA risks. It cannot send a reply or change
          a customer commitment without the external-action approval gate.
        </p>
      </section>
      <section className="inbox-saved-views">
        <SavedViewControls
          areaLabel="Inbox"
          disabled={pending || !organizationId}
          selectedId={selectedSavedViewId}
          views={savedViews}
          onSelect={selectSavedView}
          onSave={saveCurrentView}
          onRemove={removeSavedView}
        />
      </section>
      <section className="inbox-template-library">
        <div>
          <p>REPLY LIBRARY</p>
          <h2>Reusable copy, governed by humans.</h2>
          <span>
            Templates accelerate drafting only. They cannot contact a traveler
            or bypass the outbound approval gate.
          </span>
          <small>{messageTemplates.length} active templates</small>
          {messageTemplates.length > 0 && (
            <div className="template-list" aria-label="Active reply templates">
              {messageTemplates.slice(0, 5).map((template) => (
                <div key={template.id}>
                  <span>
                    <b>{template.name}</b>
                    <em>
                      {template.kind} · {template.channel}
                    </em>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => retireTemplate(template.id)}
                  >
                    Retire
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <form onSubmit={submitTemplate}>
          <input
            name="name"
            placeholder="Template name"
            aria-label="Template name"
            maxLength={100}
            required
          />
          <select name="channel" defaultValue="email" aria-label="Channel">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <select
            name="kind"
            defaultValue="reply"
            aria-label="Content type"
          >
            <option value="reply">Reply template</option>
            <option value="signature">Signature</option>
          </select>
          <input
            name="subject"
            placeholder="Subject (optional)"
            aria-label="Template subject"
            maxLength={300}
          />
          <textarea
            name="body"
            placeholder="Reusable reply body"
            aria-label="Template body"
            maxLength={10_000}
            required
          />
          <button disabled={pending || !organizationId}>
            Save template
          </button>
        </form>
      </section>
      <section className="inbox-workspace">
        <aside>
          <header>
            <div>
              <p>INBOX</p>
              <h2>Conversations</h2>
            </div>
            <span>{conversations.length}</span>
          </header>
          <div className="inbox-filters">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedSavedViewId("");
              }}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as ConversationStatus);
                setSelectedSavedViewId("");
              }}
              aria-label="Filter conversations by status"
            >
              <option value="all">All statuses</option>
              <option value="inbox">Inbox</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </select>
            <select
              value={assigneeFilter}
              onChange={(event) => {
                setAssigneeFilter(event.target.value);
                setSelectedSavedViewId("");
              }}
              aria-label="Filter conversations by owner"
            >
              <option value="all">Every owner</option>
              <option value="unassigned">Shared inbox</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <select
              value={slaFilter}
              onChange={(event) => {
                setSlaFilter(event.target.value as ConversationSlaFilter);
                setSelectedSavedViewId("");
              }}
              aria-label="Filter conversations by response deadline"
            >
              <option value="all">Any deadline</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due in 24 hours</option>
              <option value="no_deadline">No deadline</option>
            </select>
          </div>
          {loading ? (
            <LoadingState label="Loading conversations" rows={4} />
          ) : visibleConversations.length === 0 ? (
            <EmptyState
              compact
              title={
                conversations.length
                  ? "No matching conversations"
                  : "No conversations yet"
              }
              description={
                conversations.length
                  ? "Change the search or status filter to see more results."
                  : "Open a conversation to begin the shared history."
              }
            />
          ) : (
            visibleConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={[
                  conversation.id === selectedId ? "selected" : "",
                  isConversationOverdue(conversation, filterTimestamp)
                    ? "sla-overdue"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => selectConversation(conversation)}
              >
                <i>
                  {name(
                    conversation.contact_id
                      ? contactById.get(conversation.contact_id)
                      : undefined,
                  )
                    .slice(0, 2)
                    .toUpperCase()}
                </i>
                <span>
                  <b>{conversation.subject || "Untitled conversation"}</b>
                  <small>
                    {name(
                      conversation.contact_id
                        ? contactById.get(conversation.contact_id)
                        : undefined,
                    )}
                  </small>
                </span>
                <em>
                  {conversation.priority} · {conversation.status}
                </em>
                {conversation.sla_escalation_level > 0 && (
                  <strong className="sla-level">
                    L{conversation.sla_escalation_level}
                  </strong>
                )}
              </button>
            ))
          )}
        </aside>
        <section className="thread">
          {selected ? (
            <>
              <header>
                <div>
                  <p>{selected.status.toUpperCase()} CONVERSATION</p>
                  <h2>{selected.subject || "Untitled conversation"}</h2>
                  <span>
                    {name(
                      selected.contact_id
                        ? contactById.get(selected.contact_id)
                        : undefined,
                    )}
                  </span>
                  {selected.deal_id && dealById.get(selected.deal_id) && (
                    <Link
                      className="thread-deal-link"
                      href={`/leads/${selected.deal_id}`}
                    >
                      Opportunity: {dealById.get(selected.deal_id)?.title}
                    </Link>
                  )}
                </div>
                <label>
                  Workflow status
                  <select
                    value={selected.status}
                    disabled={pending}
                    onChange={(event) =>
                      changeStatus(event.target.value as Conversation["status"])
                    }
                  >
                    <option value="inbox">Inbox</option>
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label>
                  Owner
                  <select
                    value={selected.assignee_id || ""}
                    disabled={pending}
                    onChange={(event) =>
                      changeAssignee(String(event.target.value) || null)
                    }
                  >
                    <option value="">Shared inbox</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.role}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
              <form
                className="thread-sla"
                key={`${selected.id}-${selected.priority}-${selected.response_due_at || "none"}`}
                onSubmit={submitSla}
              >
                <div>
                  <p>RESPONSE SLA</p>
                  <b>{responseDeadlineLabel(selected)}</b>
                  <small>
                    {isConversationOverdue(selected, filterTimestamp)
                      ? "Deadline passed—human attention required."
                      : "Internal tracking only; this does not send a message."}
                  </small>
                  {selected.sla_escalation_level > 0 && (
                    <em className="thread-sla-level">
                      AIOS escalation level {selected.sla_escalation_level}
                    </em>
                  )}
                </div>
                <label>
                  Priority
                  <select name="priority" defaultValue={selected.priority}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label>
                  Respond by
                  <input
                    type="datetime-local"
                    name="responseDueAt"
                    defaultValue={dateTimeLocalValue(
                      selected.response_due_at,
                    )}
                  />
                </label>
                <button type="submit" disabled={pending}>
                  Save SLA
                </button>
              </form>
              <section className="thread-drafts">
                <header>
                  <div>
                    <p>DRAFT DESK</p>
                    <h3>
                      {editingDraftId
                        ? "Revise the selected draft"
                        : "Prepare the next response"}
                    </h3>
                  </div>
                  <div className="draft-header-actions">
                    <span>Internal only · review does not send</span>
                    <button
                      type="button"
                      onClick={runSalesCopilot}
                      disabled={pending || selectedMessages.length === 0}
                    >
                      Ask Sales Copilot
                    </button>
                  </div>
                </header>
                {copilotInsight ? (
                  <aside
                    className="copilot-insight"
                    aria-label="Sales Copilot evidence summary"
                  >
                    <header>
                      <b>AIOS evidence summary</b>
                      <span>
                        {Math.round(copilotInsight.confidence * 100)}%
                        confidence
                      </span>
                    </header>
                    <p>{copilotInsight.summary}</p>
                    <ul>
                      {copilotInsight.suggestedNextSteps.map((step) => (
                        <li key={`${step.action}:${step.rationale}`}>
                          <b>{step.action.replaceAll("_", " ")}</b>
                          {step.rationale}
                        </li>
                      ))}
                    </ul>
                    {copilotInsight.missingInformation.length ? (
                      <small>
                        Confirm before use:{" "}
                        {copilotInsight.missingInformation.join(" · ")}
                      </small>
                    ) : null}
                  </aside>
                ) : null}
                <form onSubmit={submitDraft}>
                  <label>
                    Template
                    <select
                      value={draftTemplateId}
                      onChange={(event) =>
                        applyDraftTemplate(event.target.value)
                      }
                    >
                      <option value="">Start from scratch</option>
                      {messageTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} · {template.channel}
                          {template.kind === "signature" ? " · signature" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Channel
                    <select
                      value={draftChannel}
                      onChange={(event) =>
                        setDraftChannel(
                          event.target.value as MessageDraft["channel"],
                        )
                      }
                    >
                      <option value="email">Email</option>
                      <option value="whatsapp">WhatsApp</option>
                    </select>
                  </label>
                  <label>
                    Intended recipient
                    <input
                      value={draftRecipient}
                      onChange={(event) =>
                        setDraftRecipient(event.target.value)
                      }
                      placeholder={selectedContact?.email || "Not set"}
                      maxLength={320}
                    />
                  </label>
                  <label className="draft-subject">
                    Subject
                    <input
                      value={draftSubject}
                      onChange={(event) =>
                        setDraftSubject(event.target.value)
                      }
                      placeholder="Optional subject"
                      maxLength={300}
                    />
                  </label>
                  <label className="draft-body">
                    Draft
                    <textarea
                      value={draftBody}
                      onChange={(event) => setDraftBody(event.target.value)}
                      placeholder="Write a reply for human review"
                      maxLength={10_000}
                      required
                    />
                  </label>
                  <label>
                    Planned time
                    <input
                      type="datetime-local"
                      value={draftScheduledFor}
                      onChange={(event) =>
                        setDraftScheduledFor(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Workflow
                    <select
                      value={draftStatus}
                      onChange={(event) =>
                        setDraftStatus(
                          event.target.value as MessageDraft["status"],
                        )
                      }
                    >
                      <option value="draft">Keep as draft</option>
                      <option value="ready_for_review">
                        Ready for review
                      </option>
                    </select>
                  </label>
                  <div className="draft-actions">
                    <button disabled={pending || !draftBody.trim()}>
                      {editingDraftId ? "Save revision" : "Save internal draft"}
                    </button>
                    {editingDraftId && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={pending}
                        onClick={cancelDraftEdit}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
                {selectedDrafts.length > 0 && (
                  <div
                    className="draft-list"
                    aria-label="Saved drafts for this conversation"
                  >
                    {selectedDrafts.map((draft) => (
                      <article key={draft.id} className="draft-card">
                        <header>
                          <b>{draft.subject || "Untitled response"}</b>
                          <div className="draft-card-actions">
                            <span>{draft.status.replaceAll("_", " ")}</span>
                            {draft.ai_run_id ? <em>AIOS</em> : null}
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => editDraft(draft)}
                            >
                              Edit
                            </button>
                          </div>
                        </header>
                        <p>{draft.body}</p>
                        <small>
                          {draft.channel}
                          {draft.recipient
                            ? ` · intended for ${draft.recipient}`
                            : " · recipient not set"}
                          {draft.scheduled_for
                            ? ` · planned ${new Date(
                                draft.scheduled_for,
                              ).toLocaleString()}`
                            : ""}
                        </small>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <div className="thread-messages">
                {selectedMessages.length === 0 ? (
                  <p className="empty">
                    No messages yet. Add an internal note below.
                  </p>
                ) : (
                  selectedMessages.map((message) => (
                    <article key={message.id} className={message.direction}>
                      <i>{message.direction === "internal" ? "•" : "↗"}</i>
                      <div>
                        <b>
                          {message.direction === "internal"
                            ? "Internal note"
                            : message.direction}
                        </b>
                        <p>{message.body}</p>
                        <small>
                          {new Date(message.sent_at).toLocaleString()}
                        </small>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <form className="note-box" onSubmit={submitNote}>
                <input
                  name="body"
                  placeholder="Write an internal note—this will not email anyone"
                  disabled={pending}
                />
                <button disabled={pending}>Record note</button>
              </form>
            </>
          ) : (
            <p className="empty thread-empty">Select or open a conversation.</p>
          )}
        </section>
      </section>
    </main>
  );
}
