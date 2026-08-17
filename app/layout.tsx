import type { Metadata } from "next";
import { ApplicationShell } from "../components/ui/application-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIOS — Travel intelligence, in motion",
  description: "A secure agentic travel CRM command center.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <ApplicationShell>{children}</ApplicationShell>
      </body>
    </html>
  );
}
