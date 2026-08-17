import { createHash } from "node:crypto";
import { z } from "zod";

export function parseMailboxAddress(value: string) {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^(.*?)\s*<([^<>]+)>$/);
  const email = (bracketed?.[2] ?? trimmed).trim().toLowerCase();
  const parsed = z.email().max(320).safeParse(email);
  if (!parsed.success) throw new Error("The inbound sender address is invalid.");
  const name = (bracketed?.[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
  return { email: parsed.data, name: name.slice(0, 320) };
}

function normalizeSubject(value: string) {
  let subject = value.trim().toLowerCase();
  while (/^(re|fw|fwd)\s*:/i.test(subject)) {
    subject = subject.replace(/^(re|fw|fwd)\s*:\s*/i, "");
  }
  return subject.replace(/\s+/g, " ").slice(0, 500) || "no subject";
}

export function inboundThreadKey(senderEmail: string, subject: string) {
  return `email:${createHash("sha256")
    .update(`${senderEmail.trim().toLowerCase()}\n${normalizeSubject(subject)}`)
    .digest("hex")}`;
}

export function plainTextFromEmail(text: string | null, html: string | null) {
  if (text?.trim()) return text.trim().slice(0, 500_000);
  if (!html?.trim()) return "(Email had no readable text body.)";
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 500_000);
}

