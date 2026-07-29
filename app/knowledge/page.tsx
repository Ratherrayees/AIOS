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
  deleteKnowledgeSection,
  renewKnowledgeSource,
  reviewKnowledgeConflict,
  saveKnowledgeSource,
  scanKnowledgeConflicts,
  searchApprovedKnowledge,
  transitionKnowledgeSource,
  updateKnowledgeSection,
} from "../actions/knowledge";
import {
  composeKnowledgeAnswer,
  type KnowledgeAnswerResponse,
} from "../actions/knowledge-answer";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import {
  knowledgeConflictSignalSchema,
  type KnowledgeSearchResult,
} from "../../lib/knowledge/schemas";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { Database } from "../../types/database";
import "./knowledge.css";

type KnowledgeSource =
  Database["public"]["Tables"]["knowledge_sources"]["Row"];
type KnowledgeSection =
  Database["public"]["Tables"]["knowledge_sections"]["Row"];
type KnowledgeConflict =
  Database["public"]["Tables"]["knowledge_conflicts"]["Row"];

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

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextVersionLabel(current: string) {
  const match = current.match(/^(.*?)(\d+)$/);
  if (!match) return `${current} renewal`;
  return `${match[1]}${Number(match[2]) + 1}`;
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
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [answerResponse, setAnswerResponse] =
    useState<KnowledgeAnswerResponse | null>(null);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchRan, setSearchRan] = useState(false);
  const [notice, setNotice] = useState("");
  const [removalConfirmationId, setRemovalConfirmationId] = useState<
    string | null
  >(null);
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
  const staleSources = sources.filter(
    (source) =>
      source.status === "approved" &&
      (!source.review_due_on ||
        source.review_due_on < todayDate()),
  );
  const staleCount = staleSources.length;
  const activeConflicts = conflicts.filter(
    (conflict) =>
      conflict.status === "open" || conflict.status === "confirmed",
  );
  const selectedPredecessor = selectedSource?.supersedes_source_id
    ? sources.find(
        (source) => source.id === selectedSource.supersedes_source_id,
      ) ?? null
    : null;
  const selectedSuccessor = selectedSource
    ? sources.find(
        (source) =>
          source.supersedes_source_id === selectedSource.id &&
          source.status !== "retired",
      ) ?? null
    : null;

  async function loadKnowledge(targetOrganizationId: string) {
    const supabase = createSupabaseBrowserClient();
    const [sourceResult, sectionResult, conflictResult] = await Promise.all([
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
      supabase
        .from("knowledge_conflicts")
        .select("*")
        .eq("organization_id", targetOrganizationId)
        .order("detected_at", { ascending: false }),
    ]);
    if (sourceResult.error || sectionResult.error || conflictResult.error)
      throw sourceResult.error ?? sectionResult.error ?? conflictResult.error;
    const nextSources = sourceResult.data ?? [];
    setSources(nextSources);
    setSections(sectionResult.data ?? []);
    setConflicts(conflictResult.data ?? []);
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

  function submitSectionRevision(
    event: FormEvent<HTMLFormElement>,
    section: KnowledgeSection,
  ) {
    event.preventDefault();
    if (!organizationId || !selectedSource) return;
    const formData = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        await updateKnowledgeSection({
          organizationId,
          sourceId: selectedSource.id,
          sectionId: section.id,
          heading: String(formData.get("heading") || ""),
          content: String(formData.get("content") || ""),
          citationLabel: String(formData.get("citationLabel") || ""),
          position: section.position,
        });
        await loadKnowledge(organizationId);
        setNotice("Draft passage revised with new audit evidence.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The passage could not be revised.",
        );
      }
    });
  }

  function removeSection(section: KnowledgeSection) {
    if (!organizationId || !selectedSource) return;
    setNotice("");
    startTransition(async () => {
      try {
        await deleteKnowledgeSection({
          organizationId,
          sourceId: selectedSource.id,
          sectionId: section.id,
        });
        await loadKnowledge(organizationId);
        setRemovalConfirmationId(null);
        setNotice("Obsolete draft passage removed.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The passage could not be removed.",
        );
      }
    });
  }

  function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selectedSource) return;
    const formData = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        const source = await renewKnowledgeSource({
          organizationId,
          sourceId: selectedSource.id,
          versionLabel: String(formData.get("versionLabel") || ""),
          validFrom: optionalText(formData, "validFrom"),
          reviewDueOn: String(formData.get("reviewDueOn") || ""),
        });
        await loadKnowledge(organizationId);
        setSelectedSourceId(source.id);
        setNotice(
          "Replacement draft prepared. Review every cloned passage before human approval.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The replacement draft could not be prepared.",
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
    const query = knowledgeQuery.trim();
    setSearchTerm(query);
    setAnswerResponse(null);
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

  function askAios() {
    if (!organizationId || knowledgeQuery.trim().length < 2) return;
    const question = knowledgeQuery.trim();
    setSearchTerm(question);
    setNotice("");
    startTransition(async () => {
      try {
        const response = await composeKnowledgeAnswer({
          organizationId,
          question,
        });
        setAnswerResponse(response);
        setSearchRan(false);
        setResults([]);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not open the Answer Desk.",
        );
      }
    });
  }

  function scanConflicts() {
    if (!organizationId) return;
    setNotice("");
    startTransition(async () => {
      try {
        const nextConflicts = await scanKnowledgeConflicts({
          organizationId,
        });
        setConflicts(nextConflicts);
        const activeCount = nextConflicts.filter(
          (conflict) =>
            conflict.status === "open" || conflict.status === "confirmed",
        ).length;
        setNotice(
          activeCount === 0
            ? "Conflict scan complete. No current factual mismatches were found."
            : `Conflict scan complete. ${activeCount} item${activeCount === 1 ? "" : "s"} need human attention.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Knowledge conflicts could not be scanned.",
        );
      }
    });
  }

  function submitConflictReview(
    event: FormEvent<HTMLFormElement>,
    conflictId: string,
  ) {
    event.preventDefault();
    if (!organizationId) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice("");
    startTransition(async () => {
      try {
        await reviewKnowledgeConflict({
          organizationId,
          conflictId,
          status: String(formData.get("status")) as
            | "confirmed"
            | "dismissed",
          resolutionNote: String(formData.get("resolutionNote") || ""),
        });
        form.reset();
        await loadKnowledge(organizationId);
        setNotice(
          "Conflict review recorded. Confirmed conflicts remain visible until the source evidence is renewed.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The conflict review could not be recorded.",
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
              <span>CONFLICTS</span>
              <b>{activeConflicts.length}</b>
              <small>competing evidence</small>
            </article>
            <article>
              <span>SECTIONS</span>
              <b>{sections.length}</b>
              <small>citation-ready passages</small>
            </article>
          </section>

          {staleSources.length > 0 ? (
            <section
              className="knowledge-renewal-queue"
              aria-labelledby="renewal-queue-title"
            >
              <header>
                <div>
                  <p>FRESHNESS QUEUE</p>
                  <h2 id="renewal-queue-title">
                    Evidence that needs a human renewal decision
                  </h2>
                </div>
                <span>{staleSources.length} due</span>
              </header>
              <div>
                {staleSources.map((source) => {
                  const successor = sources.find(
                    (candidate) =>
                      candidate.supersedes_source_id === source.id &&
                      candidate.status !== "retired",
                  );
                  return (
                    <article key={source.id}>
                      <span
                        className={
                          successor
                            ? "renewal-state active"
                            : "renewal-state attention"
                        }
                      >
                        {successor
                          ? `${statusLabel[successor.status]} replacement`
                          : "Renewal required"}
                      </span>
                      <h3>{source.title}</h3>
                      <p>
                        Version {source.version_label} · review due{" "}
                        {displayDate(source.review_due_on)}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSourceId(successor?.id ?? source.id)
                        }
                      >
                        {successor
                          ? "Open replacement draft"
                          : "Review source"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {canCurate ? (
            <section
              className="knowledge-conflict-queue"
              aria-labelledby="conflict-queue-title"
            >
              <header>
                <div>
                  <p>CONFLICT WATCH</p>
                  <h2 id="conflict-queue-title">
                    Compare competing facts before AIOS uses them
                  </h2>
                  <span>
                    The detector flags mismatched dates, numbers, or currency
                    amounts in current approved passages with the same heading.
                    A human still decides whether the sources truly conflict.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={scanConflicts}
                  disabled={pending || approvedCount < 2}
                >
                  {pending ? "Scanningâ€¦" : "Scan current evidence"}
                </button>
              </header>
              {activeConflicts.length > 0 ? (
                <div className="knowledge-conflict-list">
                  {activeConflicts.map((conflict) => {
                    const leftSection = sections.find(
                      (section) => section.id === conflict.left_section_id,
                    );
                    const rightSection = sections.find(
                      (section) => section.id === conflict.right_section_id,
                    );
                    const leftSource = leftSection
                      ? sources.find(
                          (source) => source.id === leftSection.source_id,
                        )
                      : null;
                    const rightSource = rightSection
                      ? sources.find(
                          (source) => source.id === rightSection.source_id,
                        )
                      : null;
                    const signal = knowledgeConflictSignalSchema.safeParse(
                      conflict.signal,
                    );
                    if (
                      !leftSection ||
                      !rightSection ||
                      !leftSource ||
                      !rightSource ||
                      !signal.success
                    )
                      return null;
                    return (
                      <article key={conflict.id}>
                        <header>
                          <div>
                            <span
                              className={`conflict-state ${conflict.status}`}
                            >
                              {conflict.status === "confirmed"
                                ? "Human confirmed"
                                : "Review required"}
                            </span>
                            <h3>{leftSection.heading}</h3>
                          </div>
                          <small>
                            Detected{" "}
                            {new Intl.DateTimeFormat("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(conflict.detected_at))}
                          </small>
                        </header>
                        <div className="conflict-comparison">
                          {[
                            {
                              side: "SOURCE A",
                              section: leftSection,
                              source: leftSource,
                              tokens: signal.data.left_tokens,
                            },
                            {
                              side: "SOURCE B",
                              section: rightSection,
                              source: rightSource,
                              tokens: signal.data.right_tokens,
                            },
                          ].map((item) => (
                            <section key={item.section.id}>
                              <span>{item.side}</span>
                              <b>
                                {item.source.title} Â· v
                                {item.source.version_label}
                              </b>
                              <p>{item.section.content}</p>
                              <div>
                                {item.tokens.map((token) => (
                                  <i key={token}>{token}</i>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedSourceId(item.source.id)
                                }
                              >
                                Inspect source
                              </button>
                            </section>
                          ))}
                        </div>
                        {conflict.status === "open" ? (
                          <form
                            onSubmit={(event) =>
                              submitConflictReview(event, conflict.id)
                            }
                          >
                            <label>
                              Human decision
                              <select name="status" defaultValue="confirmed">
                                <option value="confirmed">
                                  Confirm â€” source renewal required
                                </option>
                                <option value="dismissed">
                                  Dismiss â€” not a real conflict
                                </option>
                              </select>
                            </label>
                            <label>
                              Evidence note
                              <textarea
                                name="resolutionNote"
                                minLength={6}
                                maxLength={500}
                                placeholder="Explain why these facts conflict or why both are valid in context."
                                required
                              />
                            </label>
                            <button type="submit" disabled={pending}>
                              Record human review
                            </button>
                          </form>
                        ) : (
                          <p className="conflict-resolution">
                            <b>Human evidence:</b> {conflict.resolution_note}
                            <span>
                              Correct an approved source through its replacement
                              workflow, then scan again. AIOS will resolve this
                              item only when the competing evidence is no longer
                              current.
                            </span>
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="No active conflict review"
                  description={
                    approvedCount < 2
                      ? "Approve at least two current sources before running the comparison."
                      : "Run the deterministic scan whenever approved source facts change."
                  }
                />
              )}
            </section>
          ) : null}

          <section
            className="governed-knowledge-search"
            aria-labelledby="retrieval-title"
          >
            <div>
              <p>AIOS RETRIEVAL PREVIEW</p>
              <h2 id="retrieval-title">
                Ask AIOS, then inspect every source.
              </h2>
              <span>
                Preview approved passages directly, or let the Answer Desk
                compose bounded claims that keep their citations attached.
              </span>
            </div>
            <form onSubmit={submitSearch}>
              <label htmlFor="knowledge-query">Question or evidence needed</label>
              <div>
                <input
                  id="knowledge-query"
                  name="query"
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                  minLength={2}
                  maxLength={240}
                  placeholder="Example: Kyoto rail pass cancellation"
                  required
                />
                <button type="submit" disabled={pending}>
                  Preview evidence
                </button>
                <button
                  type="button"
                  className="answer-button"
                  disabled={pending || knowledgeQuery.trim().length < 2}
                  onClick={askAios}
                >
                  {pending ? "AIOS is checking…" : "Ask AIOS with citations"}
                </button>
              </div>
            </form>
            {answerResponse ? (
              <section
                className={`knowledge-answer ${answerResponse.state}`}
                aria-labelledby="answer-desk-result"
                aria-live="polite"
              >
                <header>
                  <div>
                    <span>AIOS ANSWER DESK</span>
                    <h3 id="answer-desk-result">
                      {answerResponse.state === "supported"
                        ? "Grounded answer"
                        : answerResponse.state === "needs_human_review"
                          ? "Cited advisory · human decision required"
                          : answerResponse.state === "unsupported"
                            ? "Unsupported · AIOS refused to guess"
                            : answerResponse.state === "stale"
                              ? "Out of date · renewal required"
                              : "Composition safely stopped"}
                    </h3>
                  </div>
                  <i>{answerResponse.state.replaceAll("_", " ")}</i>
                </header>
                <p>{answerResponse.message}</p>
                {answerResponse.answer ? (
                  <>
                    <div className="knowledge-answer-claims">
                      {answerResponse.answer.claims.map((claim, index) => (
                        <article key={`${claim.text}-${index}`}>
                          <span>
                            CLAIM {String(index + 1).padStart(2, "0")}
                          </span>
                          <p>{claim.text}</p>
                          <footer>
                            {claim.citations.map((citation) =>
                              citation.sourceUrl ? (
                                <a
                                  href={citation.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  key={citation.sectionId}
                                >
                                  {citation.label} · v
                                  {citation.versionLabel} ↗
                                </a>
                              ) : (
                                <b key={citation.sectionId}>
                                  {citation.label} · v
                                  {citation.versionLabel}
                                </b>
                              ),
                            )}
                          </footer>
                        </article>
                      ))}
                    </div>
                    {answerResponse.answer.caveats.length > 0 ? (
                      <div className="knowledge-answer-caveats">
                        <b>Caveats</b>
                        <ul>
                          {answerResponse.answer.caveats.map((caveat) => (
                            <li key={caveat}>{caveat}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <small>
                      Confidence{" "}
                      {Math.round(answerResponse.answer.confidence * 100)}%
                      {answerResponse.provider && answerResponse.model
                        ? ` · ${answerResponse.provider}/${answerResponse.model}`
                        : ""}
                    </small>
                  </>
                ) : answerResponse.evidence.length > 0 ? (
                  <div className="knowledge-answer-evidence">
                    {answerResponse.evidence.map((item) => (
                      <article key={item.sectionId}>
                        <span>
                          {item.isStale ? "STALE EVIDENCE" : "APPROVED EVIDENCE"}
                        </span>
                        <b>{item.citationLabel}</b>
                        <p>{item.excerpt}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
                <small>Run {answerResponse.runId}</small>
              </section>
            ) : null}
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
                      {source.supersedes_source_id ? (
                        <em>
                          Replaces v
                          {sources.find(
                            (candidate) =>
                              candidate.id === source.supersedes_source_id,
                          )?.version_label ?? "prior"}
                        </em>
                      ) : null}
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
                    {selectedPredecessor ? (
                      <div className="knowledge-lineage">
                        Replacement draft for v
                        {selectedPredecessor.version_label}. The prior approved
                        version remains live until this version is approved.
                      </div>
                    ) : null}
                    {selectedSuccessor ? (
                      <div className="knowledge-lineage">
                        Version {selectedSuccessor.version_label} is already{" "}
                        {statusLabel[selectedSuccessor.status].toLowerCase()} as
                        this source&apos;s controlled replacement.
                      </div>
                    ) : null}
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
                          {canCurate &&
                          selectedSource.status === "draft" ? (
                            <details className="knowledge-section-editor">
                              <summary>Revise passage</summary>
                              <form
                                onSubmit={(event) =>
                                  submitSectionRevision(event, section)
                                }
                              >
                                <label>
                                  Section heading
                                  <input
                                    name="heading"
                                    defaultValue={section.heading}
                                    minLength={2}
                                    maxLength={180}
                                    required
                                  />
                                </label>
                                <label>
                                  Evidence content
                                  <textarea
                                    name="content"
                                    defaultValue={section.content}
                                    minLength={2}
                                    maxLength={8000}
                                    required
                                  />
                                </label>
                                <label>
                                  Citation label
                                  <input
                                    name="citationLabel"
                                    defaultValue={section.citation_label}
                                    minLength={2}
                                    maxLength={300}
                                    required
                                  />
                                </label>
                                <div>
                                  <button type="submit" disabled={pending}>
                                    Save revision
                                  </button>
                                  {removalConfirmationId === section.id ? (
                                    <>
                                      <button
                                        type="button"
                                        className="danger"
                                        disabled={pending}
                                        onClick={() => removeSection(section)}
                                      >
                                        Confirm removal
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary"
                                        disabled={pending}
                                        onClick={() =>
                                          setRemovalConfirmationId(null)
                                        }
                                      >
                                        Keep passage
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="danger"
                                      disabled={pending}
                                      onClick={() =>
                                        setRemovalConfirmationId(section.id)
                                      }
                                    >
                                      Remove passage
                                    </button>
                                  )}
                                </div>
                              </form>
                            </details>
                          ) : null}
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
                        <>
                          {!selectedSuccessor ? (
                            <form
                              className="knowledge-renewal-form"
                              key={selectedSource.id}
                              onSubmit={submitRenewal}
                            >
                              <header>
                                <h3>Prepare a replacement</h3>
                                <p>
                                  AIOS keeps this version live while cloned
                                  passages are revised and reviewed.
                                </p>
                              </header>
                              <label>
                                Replacement version
                                <input
                                  name="versionLabel"
                                  defaultValue={nextVersionLabel(
                                    selectedSource.version_label,
                                  )}
                                  maxLength={80}
                                  required
                                />
                              </label>
                              <label>
                                Valid from
                                <input
                                  name="validFrom"
                                  type="date"
                                  defaultValue={todayDate()}
                                />
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
                              <button type="submit" disabled={pending}>
                                Prepare replacement draft
                              </button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedSourceId(selectedSuccessor.id)
                              }
                            >
                              Open replacement v
                              {selectedSuccessor.version_label}
                            </button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            disabled={pending}
                            onClick={() =>
                              transition(selectedSource.id, "retired")
                            }
                          >
                            Retire without replacement
                          </button>
                        </>
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
