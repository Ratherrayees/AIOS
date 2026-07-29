"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import { upsertTravelerEntryCheck } from "../../app/actions/crm";
import type { Database } from "../../types/database";
import { EmptyState } from "./empty-state";

type EntryCheck =
  Database["public"]["Tables"]["traveler_entry_checks"]["Row"];

type TravelerOption = {
  id: string;
  first_name: string;
  last_name: string | null;
};

type VisaRequirement = "unknown" | "not_required" | "required" | "conditional";
type VisaStatus =
  | "unknown"
  | "not_applicable"
  | "researching"
  | "application_pending"
  | "granted"
  | "refused";

function travelerName(traveler: TravelerOption | undefined) {
  if (!traveler) return "Unknown traveller";
  return `${traveler.first_name}${traveler.last_name ? ` ${traveler.last_name}` : ""}`;
}

function requiredPassportDate(
  tripEndDate: string | null,
  validityMonths: number,
) {
  if (!tripEndDate) return null;
  const requiredUntil = new Date(`${tripEndDate}T00:00:00.000Z`);
  requiredUntil.setUTCMonth(requiredUntil.getUTCMonth() + validityMonths);
  return requiredUntil.toISOString().slice(0, 10);
}

function readinessState(check: EntryCheck, tripEndDate: string | null) {
  const passportRequiredUntil = requiredPassportDate(
    tripEndDate,
    check.passport_validity_months_required,
  );
  const passportReady = Boolean(
    check.passport_expires_on &&
      (!passportRequiredUntil ||
        check.passport_expires_on >= passportRequiredUntil),
  );
  const visaReady =
    (check.visa_requirement === "not_required" &&
      check.visa_status === "not_applicable") ||
    (check.visa_status === "granted" &&
      (!tripEndDate ||
        !check.visa_valid_until ||
        check.visa_valid_until >= tripEndDate));
  return {
    passportReady,
    visaReady,
    ready: passportReady && visaReady,
  };
}

export function TravelerEntryReadiness({
  organizationId,
  tripId,
  tripEndDate,
  travelers,
  initialChecks,
  canManage,
  onChecksChange,
}: {
  organizationId: string;
  tripId: string;
  tripEndDate: string | null;
  travelers: TravelerOption[];
  initialChecks: EntryCheck[];
  canManage: boolean;
  onChecksChange?: (checks: EntryCheck[]) => void;
}) {
  const [checks, setChecks] = useState(initialChecks);
  const [editing, setEditing] = useState<EntryCheck | null>(null);
  const [visaRequirement, setVisaRequirement] =
    useState<VisaRequirement>("unknown");
  const [visaStatus, setVisaStatus] = useState<VisaStatus>("unknown");
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();

  const travelerMap = useMemo(
    () => new Map(travelers.map((traveler) => [traveler.id, traveler])),
    [travelers],
  );
  const reviewedTravelerCount = new Set(
    checks.map((check) => check.traveler_id),
  ).size;
  const readyCheckCount = checks.filter(
    (check) => readinessState(check, tripEndDate).ready,
  ).length;

  function saveCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const form = new FormData(event.currentTarget);
    setNotice("");
    startTransition(async () => {
      try {
        const saved = await upsertTravelerEntryCheck({
          organizationId,
          tripId,
          travelerId: String(form.get("travelerId")),
          destinationCountryCode: String(
            form.get("destinationCountryCode"),
          ),
          citizenshipCountryCode: String(
            form.get("citizenshipCountryCode"),
          ),
          passportIssuingCountryCode:
            String(form.get("passportIssuingCountryCode") || "") || null,
          passportExpiresOn:
            String(form.get("passportExpiresOn") || "") || null,
          passportValidityMonthsRequired: Number(
            form.get("passportValidityMonthsRequired"),
          ),
          visaRequirement: String(form.get("visaRequirement")) as
            | "unknown"
            | "not_required"
            | "required"
            | "conditional",
          visaStatus: String(form.get("visaStatus")) as
            | "unknown"
            | "not_applicable"
            | "researching"
            | "application_pending"
            | "granted"
            | "refused",
          visaValidUntil:
            String(form.get("visaValidUntil") || "") || null,
          actionDueOn: String(form.get("actionDueOn") || "") || null,
          evidenceSourceLabel:
            String(form.get("evidenceSourceLabel") || "") || null,
          evidenceSourceUrl:
            String(form.get("evidenceSourceUrl") || "") || null,
        });
        const nextChecks = checks.some((check) => check.id === saved.id)
          ? checks.map((check) =>
              check.id === saved.id ? (saved as EntryCheck) : check,
            )
          : [...checks, saved as EntryCheck];
        setChecks(nextChecks);
        onChecksChange?.(nextChecks);
        setEditing(null);
        setVisaRequirement("unknown");
        setVisaStatus("unknown");
        setNotice(
          "Human review saved. Run Operations Radar to reconcile current risks.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "The entry-readiness review could not be saved.",
        );
      }
    });
  }

  function beginEdit(check: EntryCheck) {
    setEditing(check);
    setVisaRequirement(check.visa_requirement as VisaRequirement);
    setVisaStatus(check.visa_status as VisaStatus);
  }

  function cancelEdit() {
    setEditing(null);
    setVisaRequirement("unknown");
    setVisaStatus("unknown");
  }

  function changeVisaRequirement(nextRequirement: VisaRequirement) {
    setVisaRequirement(nextRequirement);
    if (nextRequirement === "not_required") {
      setVisaStatus("not_applicable");
    } else if (nextRequirement === "unknown") {
      setVisaStatus("unknown");
    } else if (visaStatus === "unknown" || visaStatus === "not_applicable") {
      setVisaStatus("researching");
    }
  }

  return (
    <section className="ops-panel entry-readiness-panel">
      <div className="ops-panel-heading">
        <div>
          <p>ENTRY READINESS / HUMAN VERIFIED</p>
          <h2>Passport &amp; visa checkpoints</h2>
        </div>
        <span>
          {reviewedTravelerCount}/{travelers.length} travellers reviewed
        </span>
      </div>

      <div className="entry-readiness-summary">
        <div>
          <b>{checks.length}</b>
          <span>destination checks</span>
        </div>
        <div>
          <b>{readyCheckCount}</b>
          <span>currently clear</span>
        </div>
        <p>
          AIOS compares human-reviewed dates and workflow state with trip dates.
          It does not decide whether a visa is legally required.
        </p>
      </div>

      <p className="safety-callout entry-readiness-boundary">
        Store no passport number here. Verify rules with an official or
        professionally reviewed source; country-specific entry decisions always
        remain human-owned.
      </p>

      {notice && (
        <p className="entry-readiness-notice" role="status">
          {notice}
        </p>
      )}

      <div className="entry-check-list">
        {checks.map((check) => {
          const state = readinessState(check, tripEndDate);
          return (
            <article key={check.id}>
              <div className="entry-check-route">
                <span>{check.citizenship_country_code}</span>
                <i aria-hidden="true">→</i>
                <b>{check.destination_country_code}</b>
              </div>
              <div className="entry-check-body">
                <h3>{travelerName(travelerMap.get(check.traveler_id))}</h3>
                <p>
                  Passport{" "}
                  {check.passport_expires_on
                    ? `expires ${check.passport_expires_on}`
                    : "expiry open"}{" "}
                  · {check.passport_validity_months_required} month validity
                  rule
                </p>
                <p>
                  Visa {check.visa_requirement.replace("_", " ")} ·{" "}
                  {check.visa_status.replace("_", " ")}
                  {check.action_due_on ? ` · action ${check.action_due_on}` : ""}
                </p>
                <small>
                  Reviewed{" "}
                  {new Date(check.reviewed_at).toLocaleDateString()}
                  {check.evidence_source_label
                    ? ` · ${check.evidence_source_label}`
                    : " · requirement still unknown"}
                </small>
              </div>
              <span
                className={`entry-check-state ${state.ready ? "clear" : "attention"}`}
              >
                {state.ready ? "clear" : "attention"}
              </span>
              {check.evidence_source_url && (
                <a
                  href={check.evidence_source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open evidence
                </a>
              )}
              {canManage && (
                <button type="button" onClick={() => beginEdit(check)}>
                  Edit review
                </button>
              )}
            </article>
          );
        })}
        {checks.length === 0 && (
          <EmptyState
            title="No entry-readiness review"
            description="Add one destination checkpoint per traveller before a confirmed journey reaches its internal review deadline."
          />
        )}
      </div>

      {canManage && travelers.length > 0 && (
        <form
          className="ops-form entry-check-form"
          key={editing?.id ?? "new-entry-check"}
          onSubmit={saveCheck}
        >
          <div className="entry-check-form-heading">
            <div>
              <b>{editing ? "Update checkpoint" : "Add checkpoint"}</b>
              <span>
                Reusing the same traveller and destination updates the reviewed
                record.
              </span>
            </div>
            {editing && (
              <button type="button" onClick={cancelEdit}>
                Cancel edit
              </button>
            )}
          </div>
          <label>
            Traveller
            <select
              name="travelerId"
              defaultValue={editing?.traveler_id ?? travelers[0]?.id}
              required
            >
              {travelers.map((traveler) => (
                <option key={traveler.id} value={traveler.id}>
                  {travelerName(traveler)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Destination country
            <input
              name="destinationCountryCode"
              defaultValue={editing?.destination_country_code ?? ""}
              required
              pattern="[A-Za-z]{2}"
              maxLength={2}
              placeholder="JP"
              autoCapitalize="characters"
            />
          </label>
          <label>
            Citizenship
            <input
              name="citizenshipCountryCode"
              defaultValue={editing?.citizenship_country_code ?? ""}
              required
              pattern="[A-Za-z]{2}"
              maxLength={2}
              placeholder="IN"
              autoCapitalize="characters"
            />
          </label>
          <label>
            Passport issuer
            <input
              name="passportIssuingCountryCode"
              defaultValue={editing?.passport_issuing_country_code ?? ""}
              pattern="[A-Za-z]{2}"
              maxLength={2}
              placeholder="IN"
              autoCapitalize="characters"
            />
          </label>
          <label>
            Passport expires
            <input
              name="passportExpiresOn"
              type="date"
              defaultValue={editing?.passport_expires_on ?? ""}
            />
          </label>
          <label>
            Required validity after trip
            <select
              name="passportValidityMonthsRequired"
              defaultValue={editing?.passport_validity_months_required ?? 6}
            >
              {[0, 3, 6, 9, 12].map((months) => (
                <option value={months} key={months}>
                  {months} months
                </option>
              ))}
            </select>
          </label>
          <label>
            Visa requirement
            <select
              name="visaRequirement"
              value={visaRequirement}
              onChange={(event) =>
                changeVisaRequirement(event.target.value as VisaRequirement)
              }
            >
              <option value="unknown">Unknown</option>
              <option value="not_required">Not required</option>
              <option value="required">Required</option>
              <option value="conditional">Conditional</option>
            </select>
          </label>
          <label>
            Visa workflow state
            <select
              name="visaStatus"
              value={visaStatus}
              onChange={(event) =>
                setVisaStatus(event.target.value as VisaStatus)
              }
            >
              <option value="unknown">Unknown</option>
              <option value="not_applicable">Not applicable</option>
              <option value="researching">Researching</option>
              <option value="application_pending">Application pending</option>
              <option value="granted">Granted</option>
              <option value="refused">Refused</option>
            </select>
          </label>
          <label>
            Visa valid until
            <input
              name="visaValidUntil"
              type="date"
              defaultValue={editing?.visa_valid_until ?? ""}
            />
          </label>
          <label>
            Internal action due
            <input
              name="actionDueOn"
              type="date"
              defaultValue={editing?.action_due_on ?? ""}
            />
          </label>
          <label>
            Evidence source
            <input
              name="evidenceSourceLabel"
              defaultValue={editing?.evidence_source_label ?? ""}
              maxLength={180}
              placeholder="Embassy advisory reviewed by operator"
            />
          </label>
          <label>
            Evidence link (HTTPS)
            <input
              name="evidenceSourceUrl"
              type="url"
              defaultValue={editing?.evidence_source_url ?? ""}
              maxLength={1000}
              pattern="https://.*"
              placeholder="https://official.example/entry"
            />
          </label>
          <button disabled={isPending}>
            {isPending ? "Saving review…" : "Save human review"}
          </button>
        </form>
      )}
    </section>
  );
}
