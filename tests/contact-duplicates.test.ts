import assert from "node:assert/strict";
import test from "node:test";

import { findContactDuplicateCandidates } from "../lib/crm/contact-duplicates";

const base = {
  email: null,
  phone: null,
  company_id: null,
  last_name: null,
};

test("duplicate review flags normalized phone identities and keeps the older primary", () => {
  const result = findContactDuplicateCandidates([
    {
      ...base,
      id: "new",
      first_name: "Rayees",
      phone: "+91 98765 43210",
      created_at: "2026-07-26T10:00:00.000Z",
    },
    {
      ...base,
      id: "old",
      first_name: "Rayees Amin",
      phone: "919876543210",
      created_at: "2026-07-25T10:00:00.000Z",
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.primary.id, "old");
  assert.equal(result[0]?.duplicate.id, "new");
  assert.equal(result[0]?.reason, "phone");
});

test("same names alone are not treated as duplicate evidence", () => {
  const result = findContactDuplicateCandidates([
    {
      ...base,
      id: "one",
      first_name: "Aarav",
      last_name: "Shah",
      created_at: "2026-07-25T10:00:00.000Z",
    },
    {
      ...base,
      id: "two",
      first_name: "Aarav",
      last_name: "Shah",
      created_at: "2026-07-26T10:00:00.000Z",
    },
  ]);
  assert.equal(result.length, 0);
});

test("same normalized name and company creates a human review candidate", () => {
  const result = findContactDuplicateCandidates([
    {
      ...base,
      id: "one",
      first_name: "Míra",
      last_name: "Patel",
      company_id: "company",
      created_at: "2026-07-25T10:00:00.000Z",
    },
    {
      ...base,
      id: "two",
      first_name: "Mira",
      last_name: "Patel",
      company_id: "company",
      created_at: "2026-07-26T10:00:00.000Z",
    },
  ]);
  assert.equal(result[0]?.reason, "name_and_company");
});
