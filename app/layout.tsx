import type { Metadata } from "next";
import { ProductHelp } from "../components/ui/product-help";
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
        {children}
        <ProductHelp />
      </body>
    </html>
  );
}
