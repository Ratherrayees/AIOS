"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  addActivityNote,
  createCompany,
  createContact,
  createSavedView,
  deleteSavedView,
  importContacts,
  mergeDuplicateContacts,
  updateContactOwner,
  updateContactPreferences,
} from "../actions/crm";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionNotice,
} from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { OperationalPageHeader } from "../../components/ui/operational-page-header";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { findContactDuplicateCandidates } from "../../lib/crm/contact-duplicates";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { WorkspaceRole } from "../../lib/workspace/active-workspace";
import type { Json } from "../../types/database";
import "./contacts.css";
import "./contacts-duplicates.css";
import "./contacts-saved-views.css";

type Company = { id: string; name: string };
const contactWriteRoles = new Set<WorkspaceRole>([
  "owner",
  "admin",
  "sales",
  "trip_designer",
  "operations",
  "agent",
]);
type Contact = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  owner_id: string | null;
  communication_consent: "unknown" | "granted" | "withdrawn";
  consent_recorded_at: string | null;
  consent_source: string | null;
  preferred_channel: "email" | "phone" | "whatsapp" | "none";
  preferred_locale: string | null;
  time_zone: string | null;
  created_at: string;
};
type Activity = {
  id: string;
  contact_id: string | null;
  activity_type: string;
  body: string;
  created_at: string;
};
type SavedView = {
  id: string;
  name: string;
  filters: Json;
  created_at: string;
};
type Member = { id: string; name: string; role: string };

function fullName(contact: {
  first_name: string;
  last_name: string | null;
}) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ");
}

function activityLabel(type: string) {
  return (
    (
      {
        note: "Note",
        contact_created: "Contact added",
        company_created: "Company added",
        deal_created: "Deal created",
        deal_stage_changed: "Deal updated",
        task_created: "Task created",
        task_status_changed: "Task updated",
        contact_owner_changed: "Owner updated",
        conversation_sla_updated: "Response SLA updated",
        message_draft_created: "Reply draft created",
        contact_preferences_updated: "Preferences updated",
        ai_observation: "AIOS observation",
      } as Record<string, string>
    )[type] || "Activity"
  );
}

function queryFromSavedView(savedView: SavedView | undefined) {
  if (
    !savedView ||
    !savedView.filters ||
    typeof savedView.filters !== "object" ||
    Array.isArray(savedView.filters)
  )
    return "";
  return typeof savedView.filters.query === "string"
    ? savedView.filters.query
    : "";
}

export default function ContactsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [contactQuery, setContactQuery] = useState("");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [notice, setNotice] = useState("");
  const [mergeReview, setMergeReview] = useState<{
    primaryId: string;
    duplicateId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const canWrite = role ? contactWriteRoles.has(role) : false;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError("");
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setLoadError("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      setRole(membership.role);
      const [
        { data: companyRows, error: companyError },
        { data: contactRows, error: contactError },
        { data: activityRows, error: activityError },
        { data: savedViewRows, error: savedViewError },
        { data: memberRows, error: memberError },
      ] = await Promise.all([
        supabase
          .from("companies")
          .select("id, name")
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .order("name"),
        supabase
          .from("contacts")
          .select(
            "id, first_name, last_name, email, phone, company_id, owner_id, communication_consent, consent_recorded_at, consent_source, preferred_channel, preferred_locale, time_zone, created_at",
          )
          .eq("organization_id", membership.organization_id)
          .is("archived_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("activity_events")
          .select("id, contact_id, activity_type, body, created_at")
          .eq("organization_id", membership.organization_id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("saved_views")
          .select("id, name, filters, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("feature", "contacts")
          .order("updated_at", { ascending: false }),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
      ]);
      const loadFailure =
        companyError ??
        contactError ??
        activityError ??
        savedViewError ??
        memberError;
      if (loadFailure) throw loadFailure;

      const memberIds = (memberRows || []).map((member) => member.user_id);
      const profileResult = memberIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", memberIds)
        : { data: [], error: null };
      if (profileResult.error) throw profileResult.error;
      const profileRows = profileResult.data;
      const names = new Map(
        (profileRows || []).map((profile) => [profile.id, profile.full_name]),
      );
      const nextContacts = contactRows || [];
      setCompanies(companyRows || []);
      setContacts(nextContacts);
      setActivities(activityRows || []);
      setSavedViews(savedViewRows || []);
      setMembers(
        (memberRows || []).map((member) => ({
          id: member.user_id,
          name: names.get(member.user_id) || "Team member",
          role: member.role,
        })),
      );
      setSelectedContactId(nextContacts[0]?.id || null);
      setLoading(false);
    };
    void load().catch(() => {
      setLoadError("The traveller directory could not be loaded.");
      setLoading(false);
    });
  }, [reloadKey]);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) || null,
    [contacts, selectedContactId],
  );
  const selectedActivities = useMemo(
    () =>
      activities.filter(
        (activity) => activity.contact_id === selectedContactId,
      ),
    [activities, selectedContactId],
  );
  const companyNames = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies],
  );
  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) =>
      [
        fullName(contact),
        contact.email || "",
        contact.phone || "",
        contact.company_id ? companyNames.get(contact.company_id) || "" : "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [companyNames, contactQuery, contacts]);
  const duplicateCandidates = useMemo(
    () => findContactDuplicateCandidates(contacts),
    [contacts],
  );

  function submitCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("companyName") || "").trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const company = await createCompany({
          organizationId,
          name,
          website: null,
          email: null,
          phone: null,
          ownerId: null,
        });
        setCompanies((current) =>
          [...current, { id: company.id, name: company.name }].sort(
            (left, right) => left.name.localeCompare(right.name),
          ),
        );
        formElement.reset();
        setNotice(`${company.name} is ready to link to contacts.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that company.",
        );
      }
    });
  }

  function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("contactName") || "").trim();
    const [firstName, ...lastName] = name.split(/\s+/);
    if (!firstName) return;
    startTransition(async () => {
      try {
        const contact = await createContact({
          organizationId,
          firstName,
          lastName: lastName.join(" ") || null,
          email: String(form.get("email") || "").trim() || null,
          phone: String(form.get("phone") || "").trim() || null,
          companyId: String(form.get("companyId") || "") || null,
          ownerId: null,
        });
        const nextContact: Contact = {
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          phone: contact.phone,
          company_id: contact.company_id,
          owner_id: contact.owner_id,
          communication_consent: contact.communication_consent,
          consent_recorded_at: contact.consent_recorded_at,
          consent_source: contact.consent_source,
          preferred_channel: contact.preferred_channel,
          preferred_locale: contact.preferred_locale,
          time_zone: contact.time_zone,
          created_at: contact.created_at,
        };
        setContacts((current) => [nextContact, ...current]);
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            contact_id: contact.id,
            activity_type: "contact_created",
            body: "Contact created in AIOS.",
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setSelectedContactId(contact.id);
        formElement.reset();
        setNotice(`${fullName(nextContact)} is now in your CRM.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that contact.",
        );
      }
    });
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selectedContact || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("note") || "").trim();
    if (!body) return;
    startTransition(async () => {
      try {
        const note = await addActivityNote({
          organizationId,
          contactId: selectedContact.id,
          companyId: selectedContact.company_id,
          dealId: null,
          body,
        });
        setActivities((current) => [
          {
            id: note.id,
            contact_id: note.contact_id,
            activity_type: note.activity_type,
            body: note.body,
            created_at: note.created_at,
          },
          ...current,
        ]);
        formElement.reset();
        setNotice("Timeline note recorded.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not add that note.",
        );
      }
    });
  }

  function submitPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selectedContact || pending) return;
    const form = new FormData(event.currentTarget);
    const consentStatus = String(form.get("consentStatus") || "unknown") as
      | "unknown"
      | "granted"
      | "withdrawn";
    const preferredChannel = String(
      form.get("preferredChannel") || "email",
    ) as "email" | "phone" | "whatsapp" | "none";
    startTransition(async () => {
      try {
        const contact = await updateContactPreferences({
          organizationId,
          contactId: selectedContact.id,
          consentStatus,
          consentSource:
            String(form.get("consentSource") || "").trim() || null,
          preferredChannel,
          preferredLocale:
            String(form.get("preferredLocale") || "").trim() || null,
          timeZone: String(form.get("timeZone") || "").trim() || null,
        });
        setContacts((current) =>
          current.map((candidate) =>
            candidate.id === contact.id
              ? {
                  ...candidate,
                  communication_consent: contact.communication_consent,
                  consent_recorded_at: contact.consent_recorded_at,
                  consent_source: contact.consent_source,
                  preferred_channel: contact.preferred_channel,
                  preferred_locale: contact.preferred_locale,
                  time_zone: contact.time_zone,
                }
              : candidate,
          ),
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            contact_id: contact.id,
            activity_type: "contact_preferences_updated",
            body: "Communication preferences were updated.",
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice("Communication preferences recorded with an audit trail.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update those preferences.",
        );
      }
    });
  }

  function changeContactOwner(ownerId: string | null) {
    if (
      !organizationId ||
      !selectedContact ||
      pending ||
      ownerId === selectedContact.owner_id
    )
      return;
    startTransition(async () => {
      try {
        const contact = await updateContactOwner({
          organizationId,
          contactId: selectedContact.id,
          ownerId,
        });
        setContacts((current) =>
          current.map((candidate) =>
            candidate.id === contact.id
              ? { ...candidate, owner_id: contact.owner_id }
              : candidate,
          ),
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            contact_id: contact.id,
            activity_type: "contact_owner_changed",
            body: contact.owner_id
              ? "Contact ownership was assigned to a workspace member."
              : "Contact ownership was returned to the shared queue.",
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
        setNotice(
          contact.owner_id
            ? "Contact ownership updated."
            : "Contact returned to the shared CRM queue.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not change contact ownership.",
        );
      }
    });
  }

  function submitContactImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const csv = String(
      new FormData(formElement).get("csv") || "",
    ).trim();
    const rows = csv
      .split(/\r?\n/)
      .map((line) => line.split(",").map((value) => value.trim()))
      .filter((row) => row.some(Boolean));
    if (!rows.length || rows.length > 100)
      return setNotice("Paste between 1 and 100 rows: name, email, phone.");
    const importedEmails = rows
      .map((row) => row[1]?.toLowerCase())
      .filter((email): email is string => Boolean(email));
    if (new Set(importedEmails).size !== importedEmails.length)
      return setNotice(
        "The import includes the same email more than once. Resolve duplicates before importing.",
      );
    const existingEmails = new Set(
      contacts
        .map((contact) => contact.email?.toLowerCase())
        .filter((email): email is string => Boolean(email)),
    );
    if (importedEmails.some((email) => existingEmails.has(email)))
      return setNotice(
        "At least one imported email already exists in this workspace. Resolve duplicates before importing.",
      );
    startTransition(async () => {
      try {
        const payload = [];
        for (const [index, row] of rows.entries()) {
          const [name, email = "", phone = ""] = row;
          const [firstName, ...lastName] = (name || "").split(/\s+/);
          if (!firstName)
            throw new Error(`Row ${index + 1} needs a contact name.`);
          payload.push({
            firstName,
            lastName: lastName.join(" ") || null,
            email: email || null,
            phone: phone || null,
          });
        }
        const imported = await importContacts({
          organizationId,
          rows: payload,
        });
        setContacts((current) => [...imported.reverse(), ...current]);
        formElement.reset();
        setNotice(`${imported.length} contacts imported into this workspace.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not import those contacts.",
        );
      }
    });
  }

  function confirmContactMerge() {
    if (!organizationId || !mergeReview || pending) return;
    startTransition(async () => {
      try {
        const result = await mergeDuplicateContacts({
          organizationId,
          primaryContactId: mergeReview.primaryId,
          duplicateContactId: mergeReview.duplicateId,
        });
        const mergedContact: Contact = {
          id: result.contact.id,
          first_name: result.contact.first_name,
          last_name: result.contact.last_name,
          email: result.contact.email,
          phone: result.contact.phone,
          company_id: result.contact.company_id,
          owner_id: result.contact.owner_id,
          communication_consent: result.contact.communication_consent,
          consent_recorded_at: result.contact.consent_recorded_at,
          consent_source: result.contact.consent_source,
          preferred_channel: result.contact.preferred_channel,
          preferred_locale: result.contact.preferred_locale,
          time_zone: result.contact.time_zone,
          created_at: result.contact.created_at,
        };
        setContacts((current) =>
          current
            .filter(
              (contact) => contact.id !== result.archivedContactId,
            )
            .map((contact) =>
              contact.id === mergedContact.id ? mergedContact : contact,
            ),
        );
        setActivities((current) => [
          {
            id: crypto.randomUUID(),
            contact_id: mergedContact.id,
            activity_type: "contact_merged",
            body: "A reviewed duplicate contact was merged into this record.",
            created_at: new Date().toISOString(),
          },
          ...current.map((activity) =>
            activity.contact_id === result.archivedContactId
              ? { ...activity, contact_id: mergedContact.id }
              : activity,
          ),
        ]);
        setSelectedContactId(mergedContact.id);
        setMergeReview(null);
        setNotice(
          `${fullName(mergedContact)} is now the surviving contact record.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not merge those contacts.",
        );
      }
    });
  }

  function submitSavedView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("savedViewName") || "").trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const savedView = await createSavedView({
          organizationId,
          feature: "contacts",
          name,
          filters: { query: contactQuery },
        });
        setSavedViews((current) => [savedView, ...current]);
        setSelectedSavedViewId(savedView.id);
        formElement.reset();
        setNotice(`Saved “${savedView.name}” as a private Contacts view.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save that view.",
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
          feature: "contacts",
        });
        setSavedViews((current) =>
          current.filter((view) => view.id !== selectedSavedViewId),
        );
        setSelectedSavedViewId("");
        setNotice("The private saved view was removed.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not remove that view.",
        );
      }
    });
  }

  return (
    <main className="contacts-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[{ href: "/", label: "Back to command center" }]}
      />
      <OperationalPageHeader
        section="Sales"
        title="Contacts"
        meta={`${contacts.length} contacts · ${companies.length} companies`}
      />
      {notice && (
        <p className="contacts-notice" role="status">
          {notice}
        </p>
      )}
      {loadError ? (
        <ErrorState
          title="Contacts are unavailable"
          description={loadError}
          onRetry={() => setReloadKey((current) => current + 1)}
        />
      ) : null}
      {!loadError && canWrite ? (
        <details className="crm-action-drawer">
          <summary>Add or import contacts</summary>
          <div className="crm-action-drawer-body">
      <section className="contacts-tools">
        <form onSubmit={submitContact}>
          <label>
            New contact
            <input
              name="contactName"
              placeholder="Traveller or client name"
              required
            />
          </label>
          <label>
            Email
            <input name="email" type="email" placeholder="optional@email.com" />
          </label>
          <label>
            Phone
            <input name="phone" placeholder="Optional" />
          </label>
          <label>
            Company
            <select name="companyId" defaultValue="">
              <option value="">Independent traveller</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || !organizationId}>
            Add contact
          </button>
        </form>
        <form className="company-form" onSubmit={submitCompany}>
          <label>
            New company
            <input
              name="companyName"
              placeholder="Company or agency name"
              required
            />
          </label>
          <button type="submit" disabled={pending || !organizationId}>
            Add company
          </button>
        </form>
      </section>
      <section className="contacts-tools">
        <form className="company-form" onSubmit={submitContactImport}>
          <label>
            Paste CSV contacts (name, email, phone — one per line)
            <textarea
              name="csv"
              rows={4}
              placeholder={
                "Aarav Shah, aarav@example.com, +91 98765 43210\nMira Patel, mira@example.com, +91 98765 43211"
              }
              required
            />
          </label>
          <button type="submit" disabled={pending || !organizationId}>
            Import up to 100
          </button>
        </form>
      </section>
          </div>
        </details>
      ) : !loadError && role ? (
        <PermissionNotice description="You can search and inspect traveller records. Contact creation, merges, ownership, preferences, and notes are limited to CRM operators." />
      ) : null}
      {!loadError && canWrite && duplicateCandidates.length > 0 && (
        <section
          className="contact-duplicates"
          aria-labelledby="duplicate-review-title"
        >
          <header>
            <div>
              <p>DUPLICATE REVIEW</p>
              <h2 id="duplicate-review-title">
                {duplicateCandidates.length} possible match
                {duplicateCandidates.length === 1 ? "" : "es"}
              </h2>
            </div>
            <small>AIOS never merges contacts automatically.</small>
          </header>
          {duplicateCandidates.map((candidate) => {
            const pairKey = `${candidate.primary.id}:${candidate.duplicate.id}`;
            const selected =
              mergeReview &&
              [candidate.primary.id, candidate.duplicate.id].includes(
                mergeReview.primaryId,
              ) &&
              [candidate.primary.id, candidate.duplicate.id].includes(
                mergeReview.duplicateId,
              );
            return (
              <article key={pairKey}>
                <div>
                  <b>
                    {fullName(candidate.primary)} /{" "}
                    {fullName(candidate.duplicate)}
                  </b>
                  <span>
                    Matched by{" "}
                    {candidate.reason === "name_and_company"
                      ? "name + company"
                      : candidate.reason}
                  </span>
                  <small>
                    Older:{" "}
                    {candidate.primary.email ||
                      candidate.primary.phone ||
                      "no contact channel"}{" "}
                    · Newer:{" "}
                    {candidate.duplicate.email ||
                      candidate.duplicate.phone ||
                      "no contact channel"}
                  </small>
                </div>
                {!selected ? (
                  <div className="duplicate-actions">
                    <button
                      type="button"
                      onClick={() =>
                        setMergeReview({
                          primaryId: candidate.primary.id,
                          duplicateId: candidate.duplicate.id,
                        })
                      }
                    >
                      Keep older record
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMergeReview({
                          primaryId: candidate.duplicate.id,
                          duplicateId: candidate.primary.id,
                        })
                      }
                    >
                      Keep newer record
                    </button>
                  </div>
                ) : (
                  <div className="merge-confirmation" role="alert">
                    <span>
                      Archive the other record and re-link its history?
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={confirmContactMerge}
                    >
                      Confirm merge
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setMergeReview(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
      {!loadError ? (
      <section className="contacts-workspace">
        <aside className="contact-list">
          <header>
            <div>
              <p>CONTACTS</p>
              <h2>Traveller directory</h2>
            </div>
            <span>{contacts.length}</span>
          </header>
          <div className="contact-search">
            <input
              value={contactQuery}
              onChange={(event) => setContactQuery(event.target.value)}
              placeholder="Search name, email, phone…"
              aria-label="Search contacts"
            />
          </div>
          <div className="contact-saved-views">
            <label>
              Private saved view
              <select
                value={selectedSavedViewId}
                onChange={(event) => {
                  const viewId = event.target.value;
                  setSelectedSavedViewId(viewId);
                  setContactQuery(
                    queryFromSavedView(
                      savedViews.find((view) => view.id === viewId),
                    ),
                  );
                }}
              >
                <option value="">Current search</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={submitSavedView}>
              <input
                name="savedViewName"
                placeholder="Name this search"
                maxLength={80}
                required
              />
              <button type="submit" disabled={pending || !organizationId}>
                Save
              </button>
            </form>
            {selectedSavedViewId && (
              <button
                type="button"
                className="delete-view"
                disabled={pending}
                onClick={removeSavedView}
              >
                Remove selected view
              </button>
            )}
          </div>
          <div className="contact-directory-columns" aria-hidden="true">
            <span>Name</span>
            <span>Contact</span>
            <span>Owner</span>
          </div>
          {loading ? (
            <LoadingState label="Loading contacts" rows={4} />
          ) : contacts.length === 0 ? (
            <EmptyState
              compact
              title="No contacts yet"
              description="Add your first contact to begin the customer record."
            />
          ) : filteredContacts.length === 0 ? (
            <EmptyState
              compact
              title="No matching contacts"
              description="Try a different name, email address, or phone number."
            />
          ) : (
            filteredContacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                className={contact.id === selectedContactId ? "selected" : ""}
                onClick={() => setSelectedContactId(contact.id)}
              >
                <i>
                  {fullName(contact)
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </i>
                <span>
                  <b>{fullName(contact)}</b>
                  <small>
                    {contact.company_id
                      ? companyNames.get(contact.company_id) || "Company"
                      : "Independent traveller"}
                  </small>
                </span>
                <span className="contact-channel">
                  <b>{contact.email || "No email"}</b>
                  <small>{contact.phone || "No phone"}</small>
                </span>
                <span className="contact-row-owner">
                  {members.find((member) => member.id === contact.owner_id)
                    ?.name || "Shared queue"}
                </span>
              </button>
            ))
          )}
        </aside>
        <section className="contact-detail">
          {selectedContact ? (
            <>
              <header>
                <div>
                  <p>CONTACT RECORD</p>
                  <h2>{fullName(selectedContact)}</h2>
                  <span>
                    {selectedContact.company_id
                      ? companyNames.get(selectedContact.company_id) ||
                        "Company"
                      : "Independent traveller"}
                  </span>
                </div>
                <i>
                  {fullName(selectedContact)
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </i>
              </header>
              <div className="contact-facts">
                <div>
                  <small>EMAIL</small>
                  <b>{selectedContact.email || "Not collected"}</b>
                </div>
                <div>
                  <small>PHONE</small>
                  <b>{selectedContact.phone || "Not collected"}</b>
                </div>
                <div>
                  <small>ADDED</small>
                  <b>
                    {new Date(selectedContact.created_at).toLocaleDateString()}
                  </b>
                </div>
                <div>
                  <small>OWNER</small>
                  <b>
                    {members.find(
                      (member) => member.id === selectedContact.owner_id,
                    )?.name || "Shared CRM queue"}
                  </b>
                </div>
              </div>
              <section className="contact-routing">
                <div>
                  <p>RELATIONSHIP OWNERSHIP</p>
                  <h3>Give every traveller a responsible teammate</h3>
                  <small>
                    Only active members of this workspace can be assigned.
                  </small>
                </div>
                <label>
                  Contact owner
                  <select
                    value={selectedContact.owner_id || ""}
                    disabled={pending || !canWrite}
                    onChange={(event) =>
                      changeContactOwner(event.target.value || null)
                    }
                  >
                    <option value="">Shared CRM queue</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.role.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <section className="contact-preferences">
                <header>
                  <div>
                    <p>COMMUNICATION PREFERENCES</p>
                    <h3>Respect the traveller&apos;s stated choices</h3>
                  </div>
                  <span data-status={selectedContact.communication_consent}>
                    {selectedContact.communication_consent}
                  </span>
                </header>
                <form key={selectedContact.id} onSubmit={submitPreferences}>
                  <label>
                    Consent status
                    <select
                      name="consentStatus"
                      defaultValue={selectedContact.communication_consent}
                      disabled={pending || !canWrite}
                    >
                      <option value="unknown">Unknown</option>
                      <option value="granted">Granted</option>
                      <option value="withdrawn">Withdrawn</option>
                    </select>
                  </label>
                  <label>
                    Recorded source
                    <input
                      name="consentSource"
                      defaultValue={selectedContact.consent_source || ""}
                      placeholder="Required for granted/withdrawn"
                      disabled={pending || !canWrite}
                    />
                  </label>
                  <label>
                    Preferred channel
                    <select
                      name="preferredChannel"
                      defaultValue={selectedContact.preferred_channel}
                      disabled={pending || !canWrite}
                    >
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="none">Do not contact</option>
                    </select>
                  </label>
                  <label>
                    Locale
                    <input
                      name="preferredLocale"
                      defaultValue={selectedContact.preferred_locale || ""}
                      placeholder="en-IN"
                      disabled={pending || !canWrite}
                    />
                  </label>
                  <label>
                    Time zone
                    <input
                      name="timeZone"
                      defaultValue={selectedContact.time_zone || ""}
                      placeholder="Asia/Kolkata"
                      disabled={pending || !canWrite}
                    />
                  </label>
                  <button type="submit" disabled={pending || !canWrite}>
                    Save preferences
                  </button>
                </form>
                <small>
                  This records what the contact stated and when. Your privacy
                  policy still determines the legal basis for processing.
                  {selectedContact.consent_recorded_at
                    ? ` Last recorded ${new Date(
                        selectedContact.consent_recorded_at,
                      ).toLocaleString()}.`
                    : ""}
                </small>
              </section>
              <div className="timeline">
                <header>
                  <div>
                    <p>ACTIVITY TIMELINE</p>
                    <h3>Every relationship handoff, in context</h3>
                  </div>
                </header>
                <form onSubmit={submitNote}>
                  <input
                    name="note"
                    placeholder="Add a private CRM note…"
                    disabled={pending || !canWrite}
                  />
                  <button type="submit" disabled={pending || !canWrite}>
                    Record note
                  </button>
                </form>
                {selectedActivities.length === 0 ? (
                  <p className="empty">No timeline events yet.</p>
                ) : (
                  selectedActivities.map((activity) => (
                    <article key={activity.id}>
                      <i>{activity.activity_type === "note" ? "•" : "✦"}</i>
                      <div>
                        <b>{activityLabel(activity.activity_type)}</b>
                        <p>{activity.body}</p>
                        <small>
                          {new Date(activity.created_at).toLocaleString()}
                        </small>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="empty detail-empty">
              Choose a contact to inspect their CRM record.
            </p>
          )}
        </section>
      </section>
      ) : null}
    </main>
  );
}
