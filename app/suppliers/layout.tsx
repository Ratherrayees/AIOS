import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Operations — Suppliers — AIOS",
};

export default function SuppliersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
