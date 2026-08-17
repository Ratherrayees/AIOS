import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDailyWorkAttention } from "../lib/crm/work-attention";

const userId = "00000000-0000-4000-8000-000000000001";
const teammateId = "00000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-08-10T12:00:00.000Z");

test("daily attention separates assigned work from workspace risk", () => {
  assert.deepEqual(
    summarizeDailyWorkAttention({
      userId,
      now,
      tasks: [
        {
          assignee_id: userId,
          status: "open",
          due_at: "2026-08-10T11:00:00.000Z",
        },
        {
          assignee_id: teammateId,
          status: "in_progress",
          due_at: "2026-08-10T10:00:00.000Z",
        },
        {
          assignee_id: userId,
          status: "completed",
          due_at: "2026-08-09T10:00:00.000Z",
        },
      ],
      conversations: [
        {
          assignee_id: userId,
          status: "open",
          response_due_at: "2026-08-10T09:00:00.000Z",
        },
        {
          assignee_id: null,
          status: "open",
          response_due_at: "2026-08-10T08:00:00.000Z",
        },
      ],
      trips: [
        { owner_id: userId, status: "in_travel" },
        { owner_id: teammateId, status: "confirmed" },
        { owner_id: userId, status: "completed" },
      ],
    }),
    {
      tasks: { mineOverdue: 1, workspaceOverdue: 2, workspaceActive: 2 },
      inbox: { mineOverdue: 1, workspaceOverdue: 2 },
      trips: { mineActive: 1, workspaceActive: 2 },
    },
  );
});

test("invalid deadlines never become overdue work", () => {
  const result = summarizeDailyWorkAttention({
    userId,
    now,
    tasks: [{ assignee_id: userId, status: "open", due_at: "not-a-date" }],
    conversations: [
      {
        assignee_id: userId,
        status: "open",
        response_due_at: null,
      },
    ],
    trips: [],
  });

  assert.equal(result.tasks.mineOverdue, 0);
  assert.equal(result.inbox.workspaceOverdue, 0);
});
