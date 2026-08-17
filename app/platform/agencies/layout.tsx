import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agency registry — Platform — AIOS",
  description: "Review tenant registry metadata and platform service readiness.",
};

export default function PlatformAgenciesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
