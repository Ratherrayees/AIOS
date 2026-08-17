import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administration — Integrations — AIOS",
};

export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

