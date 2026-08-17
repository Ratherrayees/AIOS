import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  getInboundEmailWorkerEnv,
  hasInboundEmailWorkerEnv,
} from "../../../../../lib/env";
import { runInboundEmailSync } from "../../../../../lib/email/imap-ingestion";

export const runtime = "nodejs";

function validBearer(request: NextRequest, expected: string) {
  const authorization = request.headers.get("authorization") || "";
  const actual = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function POST(request: NextRequest) {
  if (!hasInboundEmailWorkerEnv()) {
    return NextResponse.json({ error: "worker_not_configured" }, { status: 503 });
  }
  const env = getInboundEmailWorkerEnv();
  if (!validBearer(request, env.EMAIL_INBOUND_WORKER_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runInboundEmailSync(10);
  return NextResponse.json(result);
}
