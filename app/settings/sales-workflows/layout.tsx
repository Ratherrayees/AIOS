import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administration — Sales workflows — AIOS",
};

export default function SalesWorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
