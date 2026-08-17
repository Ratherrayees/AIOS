import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Today — Tasks — AIOS",
};

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
