-- Phase 17: durable provider-backed composition for the governed Answer Desk.
--
-- Job payloads contain only run references and policy metadata. The sanitized
-- question and approved passage identifiers live on the tenant-scoped AI run.

alter type public.ai_job_type add value 'knowledge_answer';
