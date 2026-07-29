import { NextRequest, NextResponse } from "next/server";

import { matchesBearerSecret } from "../../../../../lib/auth/bearer-secret";
import {
  getAiosWorkerEnv,
  hasAiosWorkerEnv,
} from "../../../../../lib/env";
import { runDueOperationsRadarSchedules } from "../../../../../lib/operations/radar-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Server-to-server wake-up for due deterministic Operations Radar scans. */
export async function POST(request: NextRequest) {
  if (!hasAiosWorkerEnv())
    return response({ error: "worker_not_configured" }, 503);
  const { AIOS_WORKER_SECRET } = getAiosWorkerEnv();
  if (
    !matchesBearerSecret(
      request.headers.get("authorization"),
      AIOS_WORKER_SECRET,
    )
  ) {
    return response({ error: "unauthorized" }, 401);
  }

  try {
    return response(await runDueOperationsRadarSchedules(10));
  } catch {
    return response({ error: "worker_failed" }, 500);
  }
}
