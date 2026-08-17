import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "System health — Platform — AIOS",
  description: "Review deployment readiness and aggregate service queues.",
};

export default function PlatformSystemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
