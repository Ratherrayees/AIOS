import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Users & security — AIOS Platform",
  description: "Review privacy-minimized account and security status across AIOS.",
};

export default function PlatformIdentitiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
