import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseActiveWorkspace,
  type WorkspaceChoice,
} from "../lib/workspace/active-workspace";

const workspaces: WorkspaceChoice[] = [
  {
    organization_id: "workspace-primary",
    name: "Altitude Travel",
    role: "owner",
  },
  {
    organization_id: "workspace-secondary",
    name: "State AI Journeys",
    role: "admin",
  },
];

test("active workspace uses a valid saved tenant preference", () => {
  assert.equal(
    chooseActiveWorkspace(workspaces, "workspace-secondary")?.organization_id,
    "workspace-secondary",
  );
});

test("active workspace falls back to the first RLS-visible membership", () => {
  assert.equal(
    chooseActiveWorkspace(workspaces, "workspace-not-visible")
      ?.organization_id,
    "workspace-primary",
  );
});

test("active workspace is absent when the user has no active memberships", () => {
  assert.equal(chooseActiveWorkspace([], "workspace-primary"), null);
});
