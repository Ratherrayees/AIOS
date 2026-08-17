import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { decryptIntegrationSecrets } from "../integrations/vault";
import { resolvePublicHostname } from "../integrations/network-safety";
import type { IntegrationPublicConfig } from "../integrations/catalog";
import { createSupabaseAdminClient } from "../supabase/admin";
import { ingestInboundEmail, plainTextFromEmail } from "./inbound";

const MAX_TENANTS_PER_RUN = 25;
const MAX_MESSAGES_PER_MAILBOX = 25;
const MAX_MESSAGE_BYTES = 10_000_000;

type MailboxSyncResult = {
  organizationId: string;
  initialized: boolean;
  imported: number;
  failed: boolean;
};

async function saveCheckpoint(
  organizationId: string,
  mailbox: string,
  values: {
    uidValidity: string;
    lastUid: number;
    success: boolean;
    error?: string;
  },
) {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("email_ingestion_checkpoints").upsert(
    {
      organization_id: organizationId,
      provider: "custom_imap",
      mailbox,
      uid_validity: values.uidValidity,
      last_uid: values.lastUid,
      last_polled_at: now,
      last_success_at: values.success ? now : undefined,
      last_error: values.error?.slice(0, 500) ?? null,
    },
    { onConflict: "organization_id,provider,mailbox" },
  );
  if (error) throw error;
}

async function syncMailbox(row: {
  organization_id: string;
  public_config: unknown;
  encrypted_secrets: string;
}): Promise<MailboxSyncResult> {
  const config = row.public_config as IntegrationPublicConfig;
  const secrets = decryptIntegrationSecrets(row.encrypted_secrets);
  const organizationId = row.organization_id;
  const mailbox = String(config.imapMailbox || "INBOX");
  const inboundAddress = String(config.inboundAddress).trim().toLowerCase();
  const originalHost = String(config.imapHost);
  const resolvedHost = await resolvePublicHostname(originalHost);
  const client = new ImapFlow({
    host: resolvedHost,
    servername: originalHost,
    port: Number(config.imapPort),
    secure: config.imapSecurity === "tls",
    doSTARTTLS: config.imapSecurity === "starttls",
    auth: {
      user: String(config.imapUsername),
      pass: secrets.imapPassword,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    maxLineLength: 1_000_000,
    maxLiteralSize: MAX_MESSAGE_BYTES,
    maxResponseSize: MAX_MESSAGE_BYTES + 1_000_000,
    tls: { servername: originalHost, rejectUnauthorized: true },
  });

  let lastUid = 0;
  let uidValidity = "";
  let imported = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (!client.mailbox) throw new Error("The configured IMAP mailbox was not opened.");
      uidValidity = client.mailbox.uidValidity.toString();
      const currentLastUid = Math.max(0, client.mailbox.uidNext - 1);
      const admin = createSupabaseAdminClient();
      const { data: checkpoint, error: checkpointError } = await admin
        .from("email_ingestion_checkpoints")
        .select("uid_validity, last_uid")
        .eq("organization_id", organizationId)
        .eq("provider", "custom_imap")
        .eq("mailbox", mailbox)
        .maybeSingle();
      if (checkpointError) throw checkpointError;

      if (!checkpoint || checkpoint.uid_validity !== uidValidity) {
        await saveCheckpoint(organizationId, mailbox, {
          uidValidity,
          lastUid: currentLastUid,
          success: true,
        });
        return { organizationId, initialized: true, imported: 0, failed: false };
      }

      lastUid = Number(checkpoint.last_uid);
      if (lastUid >= currentLastUid) {
        await saveCheckpoint(organizationId, mailbox, {
          uidValidity,
          lastUid,
          success: true,
        });
        return { organizationId, initialized: false, imported: 0, failed: false };
      }

      const matchingUids = await client.search(
        { uid: `${lastUid + 1}:*` },
        { uid: true },
      );
      const uids = (matchingUids || [])
        .filter((uid) => uid > lastUid)
        .sort((left, right) => left - right)
        .slice(0, MAX_MESSAGES_PER_MAILBOX);

      for (const uid of uids) {
        const message = await client.fetchOne(
          String(uid),
          { source: true, internalDate: true },
          { uid: true },
        );
        if (message === false || !message.source) {
          throw new Error(`IMAP message ${uid} had no source.`);
        }
        const parsed = await simpleParser(message.source, {
          maxHtmlLengthToParse: 2_000_000,
          skipImageLinks: true,
        });
        const sender = parsed.from?.value[0];
        if (!sender?.address) throw new Error(`IMAP message ${uid} had no sender.`);
        const externalMessageId =
          parsed.messageId?.trim() || `imap:${uidValidity}:${uid}`;
        await ingestInboundEmail({
          organizationId,
          provider: "custom_imap",
          providerEventId: `imap:${mailbox}:${uidValidity}:${uid}`,
          externalMessageId,
          senderEmail: sender.address.trim().toLowerCase(),
          senderName: sender.name || "",
          recipientEmail: inboundAddress,
          subject: parsed.subject || "",
          body: plainTextFromEmail(
            parsed.text || null,
            typeof parsed.html === "string" ? parsed.html : null,
          ),
          receivedAt: new Date(
            parsed.date || message.internalDate || new Date(),
          ).toISOString(),
          payload: {
            mailbox,
            uid,
            uid_validity: uidValidity,
          },
          metadata: {
            in_reply_to: parsed.inReplyTo || null,
            references: parsed.references || [],
            attachment_count: parsed.attachments.length,
            attachments: parsed.attachments.slice(0, 100).map((attachment) => ({
              filename: attachment.filename || null,
              content_type: attachment.contentType,
              size: attachment.size,
              checksum: attachment.checksum,
            })),
          },
        });
        lastUid = uid;
        imported += 1;
        await saveCheckpoint(organizationId, mailbox, {
          uidValidity,
          lastUid,
          success: true,
        });
      }
    } finally {
      lock.release();
    }
    return { organizationId, initialized: false, imported, failed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMAP synchronization failed.";
    if (uidValidity) {
      await saveCheckpoint(organizationId, mailbox, {
        uidValidity,
        lastUid,
        success: false,
        error: message,
      }).catch(() => undefined);
    }
    return { organizationId, initialized: false, imported, failed: true };
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
}

export async function runInboundEmailSync(
  limit = 10,
  organizationId?: string,
) {
  const boundedLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_TENANTS_PER_RUN);
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("organization_integrations")
    .select("organization_id, public_config, encrypted_secrets")
    .eq("provider", "custom_smtp")
    .eq("is_enabled", true)
    .contains("public_config", { inboundEnabled: true })
    .limit(boundedLimit);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw error;

  const results: MailboxSyncResult[] = [];
  for (const row of data || []) results.push(await syncMailbox(row));
  return {
    mailboxes: results.length,
    initialized: results.filter((result) => result.initialized).length,
    imported: results.reduce((total, result) => total + result.imported, 0),
    failed: results.filter((result) => result.failed).length,
  };
}
