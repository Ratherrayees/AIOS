import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  PlatformAuthorizationError,
  requirePlatformRole,
} from "../../../lib/platform/authorization";

export const metadata: Metadata = {
  title: "Platform access — Superadmin — AIOS",
  description: "Manage the separate AIOS platform operator role directory.",
};

export default async function PlatformAccessLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformRole(["superadmin"]);
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      redirect("/access-denied/platform?reason=superadmin");
    }
    throw error;
  }
  return children;
}
