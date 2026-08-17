import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administration — Security — AIOS",
};

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
