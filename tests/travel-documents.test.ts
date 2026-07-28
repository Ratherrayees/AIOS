import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesTravelDocumentSignature,
  travelDocumentDisplayName,
  travelDocumentStorageName,
} from "../lib/crm/travel-documents";

test("travel document names are safe for display and private object paths", () => {
  assert.equal(
    travelDocumentDisplayName("  Passport\u0000 Rayees.pdf  "),
    "Passport Rayees.pdf",
  );
  assert.equal(
    travelDocumentStorageName("Passport Rayees.pdf"),
    "Passport-Rayees.pdf",
  );
});

test("travel document signatures accept the declared file format", () => {
  assert.equal(
    matchesTravelDocumentSignature(
      "application/pdf",
      new Uint8Array(Buffer.from("%PDF-1.4\n")),
    ),
    true,
  );
  assert.equal(
    matchesTravelDocumentSignature(
      "image/png",
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
    ),
    true,
  );
});

test("travel document signatures reject renamed arbitrary content", () => {
  assert.equal(
    matchesTravelDocumentSignature(
      "application/pdf",
      new Uint8Array(Buffer.from("MZ executable")),
    ),
    false,
  );
});
