import "server-only";

import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../supabase/admin";
import type { ModelJobPayload } from "./job-contracts";
import { aiJobRetryDelaySeconds } from "./job-policy";

type ModelJobType = ModelJobPayload["workflow"];

export class AiosJobNotAvailableError extends Error {
  constructor() {
    super("The durable AI job is already running or waiting for its retry window.");
    this.name = "AiosJobNotAvailableError";
  }
}

export async function enqueueModelJob(input: {
  organizationId: string;
  aiRunId: string;
  jobType: ModelJobType;
  payload: ModelJobPayload;
  idempotencyKey: string;
  maxAttempts?: number;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ai_jobs")
    .insert({
      organization_id: input.organizationId,
      ai_run_id: input.aiRunId,
      job_type: input.jobType,
      payload: input.payload,
      idempotency_key: input.idempotencyKey,
      max_attempts: input.maxAttempts ?? 3,
    })
    .select()
    .single();

  if (!error) return data;
  if (error.code !== "23505") throw error;

  const { data: existing, error: existingError } = await admin
    .from("ai_jobs")
    .select()
    .eq("organization_id", input.organizationId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existingError || !existing) {
    throw existingError ?? new Error("The idempotent AI job is unavailable.");
  }
  if (
    existing.ai_run_id !== input.aiRunId ||
    existing.job_type !== input.jobType
  ) {
    throw new Error("The AI job idempotency key is already bound.");
  }
  return existing;
}

export async function claimModelJobById(input: {
  organizationId: string;
  aiRunId: string;
  jobId: string;
  jobType: ModelJobType;
}) {
  const admin = createSupabaseAdminClient();
  const workerId = `aios:${randomUUID()}`;
  const { data, error } = await admin.rpc("claim_ai_job", {
    target_job_id: input.jobId,
    target_worker_id: workerId,
  });
  if (error) throw error;
  const claimed = data?.[0] ?? null;
  if (!claimed) return null;
  if (
    claimed.job_organization_id !== input.organizationId ||
    claimed.job_ai_run_id !== input.aiRunId ||
    claimed.claimed_job_type !== input.jobType
  ) {
    throw new Error("The claimed AI job does not match its execution context.");
  }
  return { ...claimed, workerId };
}

export async function prepareModelJob(input: {
  organizationId: string;
  aiRunId: string;
  jobType: ModelJobType;
  payload: ModelJobPayload;
  maxAttempts?: number;
}) {
  const job = await enqueueModelJob({
    ...input,
    idempotencyKey: `run:${input.aiRunId}:model`,
  });
  const claimed = await claimModelJobById({
    organizationId: input.organizationId,
    aiRunId: input.aiRunId,
    jobId: job.id,
    jobType: input.jobType,
  });
  if (!claimed) throw new AiosJobNotAvailableError();
  return claimed;
}

export async function settleModelJob(input: {
  jobId: string;
  workerId: string;
  attempt: number;
  succeeded: boolean;
  errorCode?: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("settle_ai_job", {
    target_job_id: input.jobId,
    target_worker_id: input.workerId,
    target_succeeded: input.succeeded,
    target_error_code: input.succeeded
      ? null
      : input.errorCode ?? "AI_JOB_FAILED",
    target_retry_delay_seconds: aiJobRetryDelaySeconds(input.attempt),
  });
  if (error) throw error;
  const settled = data?.[0] ?? null;
  if (!settled) throw new Error("The AI job lock was lost before settlement.");
  return settled;
}

export async function deadLetterModelJob(input: {
  jobId: string;
  workerId: string;
  errorCode: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("dead_letter_ai_job", {
    target_job_id: input.jobId,
    target_worker_id: input.workerId,
    target_error_code: input.errorCode,
  });
  if (error) throw error;
  const settled = data?.[0] ?? null;
  if (!settled) throw new Error("The AI job lock was lost before dead-lettering.");
  return settled;
}

export async function requeueModelJob(jobId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("requeue_ai_job", {
    target_job_id: jobId,
  });
  if (error) throw error;
  const requeued = data?.[0] ?? null;
  if (!requeued) throw new Error("Only a dead-letter AI job can be requeued.");
  return requeued;
}

/** Reads bounded candidates; exact claiming remains atomic in the database. */
export async function listRunnableModelJobs(
  limit = 5,
  organizationId?: string,
) {
  const boundedLimit = Math.min(25, Math.max(1, Math.floor(limit)));
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const admin = createSupabaseAdminClient();
  let dueQuery = admin
    .from("ai_jobs")
    .select()
    .in("status", ["queued", "failed"])
    .lte("available_at", now.toISOString());
  let staleQuery = admin
    .from("ai_jobs")
    .select()
    .eq("status", "running")
    .lte("locked_at", staleBefore.toISOString());
  if (organizationId) {
    dueQuery = dueQuery.eq("organization_id", organizationId);
    staleQuery = staleQuery.eq("organization_id", organizationId);
  }
  const [dueResult, staleResult] = await Promise.all([
    dueQuery.order("available_at", { ascending: true }).limit(boundedLimit),
    staleQuery.order("locked_at", { ascending: true }).limit(boundedLimit),
  ]);
  if (dueResult.error || staleResult.error)
    throw dueResult.error || staleResult.error;
  const jobs = [...(staleResult.data || []), ...(dueResult.data || [])];
  return [...new Map(jobs.map((job) => [job.id, job])).values()].slice(
    0,
    boundedLimit,
  );
}
