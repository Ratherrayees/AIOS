import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Load-balancer-safe health endpoint. Never exposes configuration or secrets. */
export function GET() {
  return NextResponse.json(
    { status: "ok", service: "aios-travel-crm", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
