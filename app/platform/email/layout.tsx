import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Platform email — AIOS",
  description: "Configure the AIOS platform-owned email sender.",
};

export default function PlatformEmailLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

