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
  addKnowledgeSection,
  saveKnowledgeSource,
  searchApprovedKnowledge,
  transitionKnowledgeSource,
} from "../actions/knowledge";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import type { KnowledgeSearchResult } from "../../lib/knowledge/schemas";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { Database } from "../../types/database";
import "./knowledge.css";

type KnowledgeSource =
  Database["public"]["Tables"]["knowledge_sources"]["Row"];
type KnowledgeSection =
  Database["public"]["Tables"]["knowledge_sections"]["Row"];

const curatorRoles = new Set([
  "owner",
  "admin",
  "trip_designer",
  "operations",
]);

const statusLabel: Record<KnowledgeSource["status"], string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  retired: "Retired",
};

const kindLabel: Record<KnowledgeSource["source_kind"], string> = {
  destination_guide: "Destination guide",
  visa_advisory: "Visa advisory",
  supplier_terms: "Supplier terms",
  sop: "Operating procedure",
  policy: "Policy",
  product_sheet: "Product sheet",
  other: "Other",
};

function optionalText(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim() || null;
}

function defaultReviewDate() {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function displayDate(value: string | null) {
  if (!value) return "No review date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function KnowledgePage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Travel workspace");
  const [role, setRole] = useState<string | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchRan, setSearchRan] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const canCurate = role ? curatorRoles.has(role) : false;
  const selectedSource =
    sources.find((source) => source.id === selectedSourceId) ?? null;
  const selectedSections = useMemo(
    () =>
      sections
        .filter((section) => section.source_id === selectedSourceId)
        .sort((a, b) => a.position - b.position),
    [sections, selectedSourceId],
  );
  const approvedCount = sources.filter(
    (source) => source.status === "approved",
  ).length;
  const reviewCount = sources.filter(
    (source) => source.status === "in_review",
  ).length;
  const staleCount = sources.filter(
    (source) =>
      source.status === "approved" &&
      (!source.review_due_on ||
        source.review_due_on < new Date().toISOString().slice(0, 10)),
  ).length;

  async function loadKnowledge(targetOrganizationId: string) {
    const supabase = createSupabaseBrowserClient();
    const [sourceResult, sectionResult] = await Promise.all([
      supabase
        .from("knowledge_sources")
        .select("*")
        .eq("organization_id", targetOrganizationId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("knowledge_sections")
        .select("*")
        .eq("organization_id", targetOrganizationId)
        .order("position"),
    ]);
    if (sourceResult.error || sectionResult.error)
      throw sourceResult.error ?? sectionResult.error;
    const nextSources = sourceResult.data ?? [];
    setSources(nextSources);
    setSections(sectionResult.data ?? []);
    setSelectedSourceId((current) =>
      nextSources.some((source) => source.id === current)
        ? current
        : (nextSources[0]?.id ?? ""),
    );
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const supabase = createSupabaseBrowserClient();
        const context = await loadWorkspaceContext(supabase);
        if (!active || !context.active) return;
        setOrganizationId(context.active.organization_id);
        setWorkspaceName(context.active.name);
        setRole(context.active.role);
        await loadKnowledge(context.active.organization_id);
      } catch (error) {
        if (active)
          setNotice(
            error instanceof Error
              ? error.message
              : "Knowledge could not be loaded.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);

  function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        const source = await saveKnowledgeSource({
          organizationId,
          title: String(formData.get("title") || ""),
          sourceKind: String(formData.get("sourceKind")) as
            | "destination_guide"
            | "visa_advisory"
            | "supplier_terms"
            | "sop"
            | "policy"
            | "product_sheet"
            | "other",
          authority: String(formData.get("authority")) as
            | "official"
            | "supplier"
            | "internal"
            | "third_party",
          sensitivity: String(formData.get("sensitivity")) as
            | "normal"
            | "restricted",
          versionLabel: String(formData.get("versionLabel") || ""),
          sourceUrl: optionalText(formData, "sourceUrl"),
          summary: optionalText(formData, "summary"),
          validFrom: optionalText(formData, "validFrom"),
          reviewDueOn: optionalText(formData, "reviewDueOn"),
        });
        await loadKnowledge(organizationId);
        setSelectedSourceId(source.id);
        form.reset();
        setNotice(
          "Draft source saved. Add cited sections before requesting review.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The source could not be saved.",
        );
      }
    });
  }

  function submitSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selectedSource) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await addKnowledgeSection({
          organizationId,
          sourceId: selectedSource.id,
          heading: String(formData.get("heading") || ""),
          content: String(formData.get("content") || ""),
          citationLabel: String(formData.get("citationLabel") || ""),
          position:
            selectedSections.length === 0
              ? 0
              : Math.max(
                  ...selectedSections.map((section) => section.position),
                ) + 1,
        });
        await loadKnowledge(organizationId);
        form.reset();
        setNotice("Cited section added to the reviewable draft.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The cited section could not be added.",
        );
      }
    });
  }

  function transition(
    sourceId: string,
    status: "draft" | "in_review" | "approved" | "retired",
  ) {
    if (!organizationId) return;
    setNotice("");
    startTransition(async () => {
      try {
        await transitionKnowledgeSource({
          organizationId,
          sourceId,
          status,
        });
        await loadKnowledge(organizationId);
        setNotice(`Knowledge moved to ${statusLabel[status].toLowerCase()}.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The review state could not be changed.",
        );
      }
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("query") || "").trim();
    setSearchTerm(query);
    setNotice("");
    startTransition(async () => {
      try {
        const nextResults = await searchApprovedKnowledge({
          organizationId,
          query,
          limit: 8,
        });
        setResults(nextResults);
        setSearchRan(true);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Approved knowledge could not be searched.",
        );
      }
    });
  }

  return (
    <main className="knowledge-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/aios", label: "AIOS Control" },
          { href: "/analytics", label: "Analytics" },
          { href: "/trips", label: "Trip Operations" },
          { href: "/", label: "Command center" },
        ]}
        ariaLabel="Knowledge workspace navigation"
      />

      <section className="knowledge-hero">
        <div>
          <p>INTELLIGENCE / GOVERNED EVIDENCE</p>
          <h1>Give AIOS trusted material, with a source for every answer.</h1>
          <span>
            {workspaceName} can curate operating guidance, supplier terms,
            destination notes, and advisories without mixing drafts into
            approved retrieval.
          </span>
        </div>
        <aside aria-label="Knowledge lifecycle">
          <span>CURATE</span>
          <i aria-hidden="true" />
          <span>REVIEW</span>
          <i aria-hidden="true" />
          <b>CITE</b>
        </aside>
      </section>

      <section className="knowledge-boundary">
        <b>Evidence, not authority</b>
        <span>
          AIOS may retrieve approved sections and show their citations. It
          cannot crawl the web here, approve its own source, or turn a stale
          visa advisory into an immigration decision.
        </span>
        <Link href="/aios">Review AIOS authority →</Link>
      </section>

      {notice ? (
        <p className="knowledge-notice" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading governed knowledge" rows={4} />
      ) : (
        <>
          <section className="knowledge-pulse" aria-label="Knowledge summary">
            <article>
              <span>APPROVED</span>
              <b>{approvedCount}</b>
              <small>retrievable sources</small>
            </article>
            <article>
              <span>IN REVIEW</span>
              <b>{reviewCount}</b>
              <small>awaiting a human</small>
            </article>
            <article>
              <span>STALE</span>
              <b>{staleCount}</b>
              <small>freshness attention</small>
            </article>
            <article>
              <span>SECTIONS</span>
              <b>{sections.length}</b>
              <small>citation-ready passages</small>
            </article>
          </section>

          <section
            className="governed-knowledge-search"
            aria-labelledby="retrieval-title"
          >
            <div>
              <p>AIOS RETRIEVAL PREVIEW</p>
              <h2 id="retrieval-title">Search only approved knowledge.</h2>
              <span>
                This is the same permission-aware evidence boundary future
                agents will use before producing a cited recommendation.
              </span>
            </div>
            <form onSubmit={submitSearch}>
              <label htmlFor="knowledge-query">Question or evidence needed</label>
              <div>
                <input
                  id="knowledge-query"
                  name="query"
                  minLength={2}
                  maxLength={240}
                  placeholder="Example: Kyoto rail pass cancellation"
                  required
                />
                <button type="submit" disabled={pending}>
                  {pending ? "Searching…" : "Search approved sources"}
                </button>
              </div>
            </form>
            <div className="knowledge-results" aria-live="polite">
              {results.map((result) => (
                <article key={result.section_id}>
                  <header>
                    <span>{kindLabel[result.source_kind]}</span>
                    <i className={result.is_stale ? "stale" : "current"}>
                      {result.is_stale ? "Freshness expired" : "Current review"}
                    </i>
                  </header>
                  <h3>{result.heading}</h3>
                  <p>{result.excerpt}</p>
                  <footer>
                    <div>
                      <b>{result.citation_label}</b>
                      <span>
                        {result.source_title} · v{result.version_label} ·{" "}
                        {result.authority.replace("_", " ")}
                      </span>
                    </div>
                    {result.source_url ? (
                      <a
                        href={result.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source ↗
                      </a>
                    ) : null}
                  </footer>
                </article>
              ))}
              {searchRan && results.length === 0 ? (
                <EmptyState
                  compact
                  title="No approved evidence matched"
                  description={`No permission-available source matched “${searchTerm}”. Draft and retired material is intentionally excluded.`}
                />
              ) : null}
            </div>
          </section>

          <section className="knowledge-workspace">
            <div className="knowledge-library">
              <header>
                <div>
                  <p>SOURCE INVENTORY</p>
                  <h2>Reviewable knowledge library</h2>
                </div>
                <span>{sources.length} sources</span>
              </header>
              {sources.length === 0 ? (
                <EmptyState
                  title="No governed sources yet"
                  description={
                    canCurate
                      ? "Create a draft below, add its cited passages, then send it through human review."
                      : "A workspace curator must approve a source before it becomes visible here."
                  }
                />
              ) : (
                <div className="source-list">
                  {sources.map((source) => (
                    <button
                      type="button"
                      className={
                        source.id === selectedSourceId ? "selected" : ""
                      }
                      onClick={() => setSelectedSourceId(source.id)}
                      key={source.id}
                    >
                      <span className={`source-status ${source.status}`}>
                        {statusLabel[source.status]}
                      </span>
                      <b>{source.title}</b>
                      <small>
                        {kindLabel[source.source_kind]} · v{source.version_label}
                      </small>
                      <i>{displayDate(source.review_due_on)}</i>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <aside className="knowledge-inspector">
              {selectedSource ? (
                <>
                  <header>
                    <span>{statusLabel[selectedSource.status]}</span>
                    <h2>{selectedSource.title}</h2>
                    <p>
                      {selectedSource.summary ||
                        "No curator summary was recorded."}
                    </p>
                    <dl>
                      <div>
                        <dt>Authority</dt>
                        <dd>{selectedSource.authority.replace("_", " ")}</dd>
                      </div>
                      <div>
                        <dt>Sensitivity</dt>
                        <dd>{selectedSource.sensitivity}</dd>
                      </div>
                      <div>
                        <dt>Review due</dt>
                        <dd>{displayDate(selectedSource.review_due_on)}</dd>
                      </div>
                    </dl>
                  </header>

                  <div className="section-stack">
                    {selectedSections.map((section, index) => (
                      <article key={section.id}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <h3>{section.heading}</h3>
                          <p>{section.content}</p>
                          <small>CITE · {section.citation_label}</small>
                        </div>
                      </article>
                    ))}
                    {selectedSections.length === 0 ? (
                      <EmptyState
                        compact
                        title="No cited sections"
                        description="A source cannot be approved until at least one evidence passage is recorded."
                      />
                    ) : null}
                  </div>

                  {canCurate && selectedSource.status === "draft" ? (
                    <form
                      className="knowledge-section-form"
                      onSubmit={submitSection}
                    >
                      <h3>Add a cited passage</h3>
                      <label>
                        Section heading
                        <input name="heading" minLength={2} maxLength={180} required />
                      </label>
                      <label>
                        Evidence content
                        <textarea
                          name="content"
                          minLength={2}
                          maxLength={8000}
                          required
                        />
                      </label>
                      <label>
                        Citation label
                        <input
                          name="citationLabel"
                          minLength={2}
                          maxLength={300}
                          placeholder="Policy §4 · Cancellation windows"
                          required
                        />
                      </label>
                      <button type="submit" disabled={pending}>
                        {pending ? "Saving…" : "Add cited passage"}
                      </button>
                    </form>
                  ) : null}

                  {canCurate ? (
                    <div className="knowledge-transitions">
                      {selectedSource.status === "draft" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            transition(selectedSource.id, "in_review")
                          }
                        >
                          Send to human review
                        </button>
                      ) : null}
                      {selectedSource.status === "in_review" ? (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            disabled={pending}
                            onClick={() =>
                              transition(selectedSource.id, "draft")
                            }
                          >
                            Return to draft
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              transition(selectedSource.id, "approved")
                            }
                          >
                            Approve for AIOS retrieval
                          </button>
                        </>
                      ) : null}
                      {selectedSource.status === "approved" ? (
                        <button
                          type="button"
                          className="danger"
                          disabled={pending}
                          onClick={() =>
                            transition(selectedSource.id, "retired")
                          }
                        >
                          Retire from retrieval
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  title="Choose a source"
                  description="Select a knowledge source to inspect its evidence and review state."
                />
              )}
            </aside>
          </section>

          {canCurate ? (
            <section className="knowledge-create">
              <header>
                <p>CURATOR WORKBENCH</p>
                <h2>Create a versioned draft</h2>
                <span>
                  Saving does not approve or expose a draft to ordinary
                  retrieval. A separate review decision is required.
                </span>
              </header>
              <form onSubmit={submitSource}>
                <label>
                  Source title
                  <input name="title" minLength={2} maxLength={180} required />
                </label>
                <label>
                  Source type
                  <select name="sourceKind" defaultValue="destination_guide">
                    <option value="destination_guide">Destination guide</option>
                    <option value="visa_advisory">Visa advisory</option>
                    <option value="supplier_terms">Supplier terms</option>
                    <option value="sop">Operating procedure</option>
                    <option value="policy">Policy</option>
                    <option value="product_sheet">Product sheet</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Authority
                  <select name="authority" defaultValue="official">
                    <option value="official">Official</option>
                    <option value="supplier">Supplier</option>
                    <option value="internal">Internal</option>
                    <option value="third_party">Third party</option>
                  </select>
                </label>
                <label>
                  Sensitivity
                  <select name="sensitivity" defaultValue="normal">
                    <option value="normal">Normal workspace access</option>
                    <option value="restricted">Curators only</option>
                  </select>
                </label>
                <label>
                  Version
                  <input name="versionLabel" defaultValue="1" maxLength={80} required />
                </label>
                <label>
                  Valid from
                  <input name="validFrom" type="date" />
                </label>
                <label>
                  Review due
                  <input
                    name="reviewDueOn"
                    type="date"
                    defaultValue={defaultReviewDate()}
                    required
                  />
                </label>
                <label className="wide">
                  HTTPS source link
                  <input
                    name="sourceUrl"
                    type="url"
                    placeholder="https://authority.example/source"
                    maxLength={1000}
                  />
                </label>
                <label className="wide">
                  Curator summary
                  <textarea name="summary" maxLength={2000} />
                </label>
                <button type="submit" disabled={pending}>
                  {pending ? "Saving draft…" : "Create governed draft"}
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
