import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit log — Platform — AIOS",
  description: "Review privacy-minimized platform access and configuration evidence.",
};

export default function PlatformAuditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
