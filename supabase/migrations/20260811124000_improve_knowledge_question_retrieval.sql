-- Prefer exact web-search matches, then broaden natural-language questions to
-- meaningful OR terms. This preserves tenant/sensitivity checks while making
-- ordinary questions useful against a small approved knowledge library.

create or replace function public.search_approved_knowledge(
  target_organization_id uuid,
  target_query text,
  target_limit integer default 8
)
returns table (
  section_id uuid,
  source_id uuid,
  source_title text,
  source_kind public.knowledge_source_kind,
  authority public.knowledge_authority,
  sensitivity public.document_sensitivity,
  version_label text,
  source_url text,
  heading text,
  excerpt text,
  citation_label text,
  review_due_on date,
  is_stale boolean,
  relevance real
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_query text := trim(target_query);
  bounded_limit integer := least(greatest(target_limit, 1), 12);
  may_read_restricted boolean;
begin
  if actor_id is null
    or not public.meets_mfa_requirement()
    or not public.is_active_member(target_organization_id)
  then
    raise exception 'You do not have permission to search this knowledge.'
      using errcode = '42501';
  end if;

  if char_length(normalized_query) not between 2 and 240 then
    raise exception 'Knowledge searches must contain 2 to 240 characters.'
      using errcode = '22023';
  end if;

  may_read_restricted := public.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'trip_designer', 'operations']::public.app_role[]
  );

  return query
  with meaningful_terms as (
    select distinct term
    from regexp_split_to_table(
      lower(regexp_replace(normalized_query, '[^[:alnum:]]+', ' ', 'g')),
      '\s+'
    ) as term
    where char_length(term) >= 3
      and term not in (
        'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these',
        'those', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
        'does', 'did', 'can', 'could', 'should', 'would', 'must', 'are',
        'was', 'were', 'been', 'being', 'have', 'has', 'had', 'into'
      )
  ),
  broad_text as (
    select string_agg(term, ' OR ' order by term) as value
    from meaningful_terms
  ),
  requested_queries as (
    select 0 as priority, websearch_to_tsquery('simple', normalized_query) as value
    union all
    select 1, websearch_to_tsquery('simple', broad_text.value)
    from broad_text
    where broad_text.value is not null
  ),
  candidates as (
    select
      section.id as section_id,
      source.id as source_id,
      source.title as source_title,
      source.source_kind,
      source.authority,
      source.sensitivity,
      source.version_label,
      source.source_url,
      section.heading,
      case
        when char_length(section.content) > 500
          then left(section.content, 497) || '...'
        else section.content
      end as excerpt,
      section.citation_label,
      source.review_due_on,
      source.review_due_on is null
        or source.review_due_on < current_date as is_stale,
      ts_rank_cd(section.search_document, requested_queries.value) as relevance,
      requested_queries.priority,
      section.position,
      row_number() over (
        partition by section.id
        order by requested_queries.priority,
          ts_rank_cd(section.search_document, requested_queries.value) desc
      ) as match_order
    from public.knowledge_sections as section
    join public.knowledge_sources as source
      on source.organization_id = section.organization_id
      and source.id = section.source_id
    cross join requested_queries
    where section.organization_id = target_organization_id
      and source.status = 'approved'
      and (source.sensitivity = 'normal' or may_read_restricted)
      and section.search_document @@ requested_queries.value
  )
  select
    candidate.section_id,
    candidate.source_id,
    candidate.source_title,
    candidate.source_kind,
    candidate.authority,
    candidate.sensitivity,
    candidate.version_label,
    candidate.source_url,
    candidate.heading,
    candidate.excerpt,
    candidate.citation_label,
    candidate.review_due_on,
    candidate.is_stale,
    candidate.relevance
  from candidates as candidate
  where candidate.match_order = 1
  order by
    candidate.priority,
    candidate.relevance desc,
    candidate.review_due_on desc nulls last,
    candidate.position,
    candidate.section_id
  limit bounded_limit;
end;
$$;
