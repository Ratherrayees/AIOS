import assert from "node:assert/strict";
import test from "node:test";

import { assessItineraryReadiness } from "../lib/crm/itinerary-readiness";
import { assessItineraryConflicts } from "../lib/crm/itinerary-conflicts";
import {
  parseItineraryDraft,
  validateItineraryDraftForTrip,
} from "../lib/ai/contracts";

test("itinerary readiness identifies missing dates, content, and accommodation", () => {
  const result = assessItineraryReadiness({ startDate: null, endDate: null, items: [] });
  assert.equal(result.status, "not_ready");
  assert.equal(result.signals.length, 3);
});

test("itinerary readiness accepts a fully covered short internal plan", () => {
  const result = assessItineraryReadiness({ startDate: "2026-10-10", endDate: "2026-10-11", items: [{ dayNumber: 1, itemType: "stay" }, { dayNumber: 2, itemType: "activity" }] });
  assert.equal(result.status, "ready");
});

test("itinerary model drafts require cited, non-duplicated suggestions", () => {
  const result = parseItineraryDraft({
    summary: "Two-day Kyoto planning draft.",
    suggestedItems: [{ dayNumber: 1, itemType: "stay", title: "Check in", rationale: "Provides a base for the journey." }],
    openQuestions: ["Confirm hotel preference"], confidence: 0.7,
    citations: [{ sourceType: "trip", sourceId: "22222222-2222-4222-8222-222222222222", label: "Internal trip draft" }],
  });
  assert.equal(result.suggestedItems.length, 1);
});

test("itinerary model drafts cannot repeat the trip or exceed known dates", () => {
  const draft = parseItineraryDraft({
    summary: "One day internal draft.",
    suggestedItems: [
      {
        dayNumber: 2,
        itemType: "stay",
        title: "Check in",
        rationale: "Provides a base for the journey.",
      },
    ],
    openQuestions: [],
    confidence: 0.7,
    citations: [
      {
        sourceType: "trip",
        sourceId: "22222222-2222-4222-8222-222222222222",
        label: "Internal trip draft",
      },
    ],
  });
  assert.throws(() =>
    validateItineraryDraftForTrip(draft, {
      startDate: "2026-10-10",
      endDate: "2026-10-10",
      items: [],
    }),
  );
});

test("itinerary conflicts identify duplicate items outside known trip dates", () => {
  const result = assessItineraryConflicts({
    startDate: "2026-10-10",
    endDate: "2026-10-10",
    items: [
      { id: "one", dayNumber: 2, itemType: "activity", title: "Temple walk" },
      { id: "two", dayNumber: 2, itemType: "activity", title: "Temple walk" },
    ],
  });
  assert.equal(result.some((conflict) => conflict.code === "duplicate_item"), true);
  assert.equal(result.some((conflict) => conflict.code === "outside_trip_dates"), true);
});

test("itinerary conflicts identify overlapping timed entries", () => {
  const result = assessItineraryConflicts({
    startDate: null,
    endDate: null,
    items: [
      {
        id: "one",
        dayNumber: 1,
        itemType: "activity",
        title: "Museum",
        startsAt: "2026-10-10T10:00:00Z",
        endsAt: "2026-10-10T12:00:00Z",
      },
      {
        id: "two",
        dayNumber: 1,
        itemType: "meal",
        title: "Lunch",
        startsAt: "2026-10-10T11:30:00Z",
        endsAt: "2026-10-10T13:00:00Z",
      },
    ],
  });
  assert.equal(result[0]?.code, "overlapping_times");
});
