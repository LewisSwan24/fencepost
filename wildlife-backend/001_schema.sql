-- Apply in Supabase SQL editor. No service-role key belongs in any browser.
begin;
create table public.moderators (user_id uuid primary key references auth.users(id), organisation text not null check(length(organisation)>2));
create function public.is_moderator() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from moderators where user_id=auth.uid()) $$;
create table public.observations (
 id uuid primary key default gen_random_uuid(), nickname text check(length(nickname)<=60), possible_species text not null,
 approximate_time text not null check(approximate_time in ('Early morning','During the day','Late afternoon','Around dusk','During the evening','Late at night')),
 public_area text not null check(public_area in ('General park area','Community centre area','Park pond area','School oval area','Reserve area','Community garden area')),
 private_rescue_location text check(length(private_rescue_location)<=500), behaviour text not null check(length(behaviour) between 1 and 160), description text not null check(length(description) between 1 and 600),
 media_url text, injury_concern boolean not null default false, condition text, moving text, near_traffic boolean default false,
 status text not null default 'pending' check(status in ('pending','urgent','clarification','approved','rejected','removed')),
 submitted_at timestamptz not null default now(), removal_token uuid not null default gen_random_uuid()
);
create table public.public_stories (
 id uuid primary key default gen_random_uuid(),source_observation_id uuid unique references observations(id),content_type text not null default 'neighbour-observation' check(content_type='neighbour-observation'),
 species text not null,public_area text not null check(public_area in ('General park area','Community centre area','Park pond area','School oval area','Reserve area','Community garden area')),
 approximate_time text not null,behaviour text not null,story_text text not null check(length(story_text)<=600 and cardinality(regexp_split_to_array(trim(story_text),'\s+'))<=60),media_url text,
 verified_fact text not null,fact_source text not null,reviewed_by text not null,published_at timestamptz not null default now(),sample boolean not null default false
);
create table public.moderation_records (id uuid primary key default gen_random_uuid(),observation_id uuid references observations(id),moderator_id uuid not null references auth.users(id),action text not null,public_text text,approved_species text,approved_public_area text,media_approved boolean not null default false,privacy_checks jsonb not null default '{}',reason text not null,created_at timestamptz not null default now());
create table public.opportunities(id text primary key,data jsonb not null);
create table public.outcomes(id uuid primary key default gen_random_uuid(),opportunity_id text references opportunities(id),title text not null,public_area text not null,completed_at date not null,actions_completed text not null,approved_image text,community_message text not null,activity text,why_it_matters text,demonstration_date text,next_opportunity_id text references opportunities(id),published boolean not null default false,sample boolean not null default false,no_wildlife_handling boolean not null default true);
create table public.information_sources(id text primary key,data jsonb not null);
create table public.comments(id uuid primary key default gen_random_uuid(),story_id uuid not null references public_stories(id) on delete cascade,body text not null check(length(body) between 1 and 500),status text not null default 'pending' check(status in ('pending','approved','removed')),created_at timestamptz not null default now());
create table public.comment_reports(id uuid primary key default gen_random_uuid(),comment_id uuid not null references comments(id) on delete cascade,reason text not null check(length(reason) between 1 and 500),created_at timestamptz not null default now());
create table public.removal_requests(id uuid primary key default gen_random_uuid(),observation_id uuid references observations(id),reason text not null,created_at timestamptz not null default now());
-- Registration is intentionally browser-local demo data until organiser/privacy arrangements exist.

alter table moderators enable row level security;
alter table observations enable row level security;
alter table public_stories enable row level security;
alter table moderation_records enable row level security;
alter table opportunities enable row level security;
alter table outcomes enable row level security;
alter table information_sources enable row level security;
alter table comments enable row level security;
alter table comment_reports enable row level security;
alter table removal_requests enable row level security;
create policy moderator_self on moderators for select to authenticated using(user_id=auth.uid());
create policy observations_moderator on observations for all to authenticated using(is_moderator()) with check(is_moderator());
create policy stories_public on public_stories for select to anon,authenticated using(true);
create policy stories_moderator on public_stories for all to authenticated using(is_moderator()) with check(is_moderator());
create policy audit_moderator on moderation_records for select to authenticated using(is_moderator());
create policy opportunities_public on opportunities for select to anon,authenticated using(true);
create policy opportunities_moderator on opportunities for all to authenticated using(is_moderator()) with check(is_moderator());
create policy outcomes_public on outcomes for select to anon,authenticated using(published);
create policy outcomes_moderator on outcomes for all to authenticated using(is_moderator()) with check(is_moderator());
create policy sources_public on information_sources for select to anon,authenticated using(true);
create policy sources_moderator on information_sources for all to authenticated using(is_moderator()) with check(is_moderator());
create policy comments_public on comments for select to anon,authenticated using(status='approved');
create policy comments_moderator on comments for all to authenticated using(is_moderator()) with check(is_moderator());
create policy reports_moderator on comment_reports for select to authenticated using(is_moderator());
create policy removals_moderator on removal_requests for select to authenticated using(is_moderator());

create function public.submit_observation(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare oid uuid; tok uuid; concern boolean := coalesce((payload->>'injuryConcern')::boolean,false); media text:=nullif(payload->>'mediaUrl','');
begin
 if payload->>'possibleSpecies' not in ('brushtail','flying-fox','water-dragon','magpie','kangaroo','blue-tongue','not-sure') then raise exception 'Invalid species'; end if;
 if media is not null and media !~ '^[a-f0-9-]{36}\.jpg$' then raise exception 'Invalid media'; end if;
 insert into observations(nickname,possible_species,approximate_time,public_area,private_rescue_location,behaviour,description,media_url,injury_concern,condition,moving,near_traffic,status)
 values(left(payload->>'nickname',60),payload->>'possibleSpecies',payload->>'approximateTime',payload->>'publicArea',case when concern then payload->>'privateRescueLocation' else null end,payload->>'behaviour',payload->>'description',media,concern,left(payload->>'condition',300),left(payload->>'moving',60),coalesce((payload->>'nearTraffic')::boolean,false),case when concern then 'urgent' else 'pending' end)
 returning id,removal_token into oid,tok;
 return jsonb_build_object('id',oid,'removalToken',tok,'status',case when concern then 'urgent' else 'pending' end);
end $$;
create function public.request_removal(observation_id uuid,token uuid,reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if length(reason)<3 or not exists(select 1 from observations o where o.id=observation_id and o.removal_token=token) then raise exception 'Unable to request removal'; end if;
 insert into removal_requests(observation_id,reason) values(observation_id,left(reason,500));
end $$;
create function public.submit_comment(story_id uuid,body text) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into comments(story_id,body) values(story_id,body);
end $$;
create function public.report_comment(comment_id uuid,reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from comments c where c.id=comment_id and c.status='approved') then raise exception 'Comment unavailable'; end if;
 insert into comment_reports(comment_id,reason) values(comment_id,reason);
end $$;
create function public.moderate_observation(payload jsonb) returns void language plpgsql security definer set search_path=public as $$
declare obs observations; act text:=payload->>'action'; checks jsonb:=payload->'privacyChecks'; org text; newmedia text:=nullif(payload->>'publicMedia','');
begin
 if not is_moderator() then raise exception 'Moderator required'; end if;
 select * into obs from observations where id=(payload->>'id')::uuid for update;
 if not found then raise exception 'Observation unavailable'; end if;
 if act not in ('approve','reject','clarification','urgent','remove') or length(trim(coalesce(payload->>'reason','')))<3 then raise exception 'Action and reason required'; end if;
 if act='approve' then
  if checks is null or not (coalesce((checks->>'face')::boolean,false) and coalesce((checks->>'house')::boolean,false) and coalesce((checks->>'plate')::boolean,false) and coalesce((checks->>'location')::boolean,false) and coalesce((checks->>'welfare')::boolean,false)) then raise exception 'Privacy review required'; end if;
  if coalesce((payload->>'mediaApproved')::boolean,false) and (obs.media_url is null or newmedia is distinct from obs.media_url) then raise exception 'Reviewed media required'; end if;
  if not coalesce((payload->>'mediaApproved')::boolean,false) then newmedia:=null; end if;
  select organisation into org from moderators where user_id=auth.uid();
  insert into public_stories(source_observation_id,species,public_area,approximate_time,behaviour,story_text,media_url,verified_fact,fact_source,reviewed_by)
  values(obs.id,payload->>'approvedSpecies',payload->>'approvedPublicArea',obs.approximate_time,'Reviewed observation',payload->>'publicText',newmedia,coalesce(payload->>'fact','Identification uncertain. Observe safely from a distance.'),coalesce(payload->>'factSource',''),org)
  on conflict(source_observation_id) do update set species=excluded.species,public_area=excluded.public_area,story_text=excluded.story_text,media_url=excluded.media_url,verified_fact=excluded.verified_fact,fact_source=excluded.fact_source,reviewed_by=excluded.reviewed_by;
 end if;
 if act in ('remove','reject','clarification','urgent') then delete from public_stories where source_observation_id=obs.id; end if;
 update observations set status=case act when 'approve' then 'approved' when 'reject' then 'rejected' when 'remove' then 'removed' else act end where id=obs.id;
 insert into moderation_records(observation_id,moderator_id,action,public_text,approved_species,approved_public_area,media_approved,privacy_checks,reason)
 values(obs.id,auth.uid(),act,payload->>'publicText',payload->>'approvedSpecies',payload->>'approvedPublicArea',coalesce((payload->>'mediaApproved')::boolean,false),coalesce(checks,'{}'),payload->>'reason');
end $$;
create function public.publish_outcome(payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_moderator() then raise exception 'Moderator required'; end if;
 if not exists(select 1 from opportunities where id=payload->>'opportunityId') then raise exception 'Opportunity unavailable';end if;
 if payload->>'publicArea' not in ('General park area','Community centre area','Park pond area','School oval area','Reserve area','Community garden area') then raise exception 'Broad area required';end if;
 insert into outcomes(opportunity_id,title,public_area,completed_at,actions_completed,approved_image,community_message,activity,why_it_matters,demonstration_date,next_opportunity_id,published,sample,no_wildlife_handling)
 values(payload->>'opportunityId',payload->>'title',payload->>'publicArea',(payload->>'completedAt')::date,payload->>'actionsCompleted',nullif(payload->>'approvedImage',''),payload->>'communityMessage',payload->>'activity',payload->>'whyItMatters',payload->>'demonstrationDate',nullif(payload->>'nextOpportunityId',''),true,coalesce((payload->>'sample')::boolean,false),true);
 update opportunities set data=data||'{"status":"completed","registrationOpen":false}'::jsonb where id=payload->>'opportunityId';
end $$;
-- Default function privileges must not leave privileged entry points callable unintentionally.
revoke execute on function public.is_moderator(),public.submit_observation(jsonb),public.request_removal(uuid,uuid,text),public.submit_comment(uuid,text),public.report_comment(uuid,text),public.moderate_observation(jsonb),public.publish_outcome(jsonb) from public;
grant execute on function public.is_moderator() to anon,authenticated;
grant execute on function public.submit_observation(jsonb),public.request_removal(uuid,uuid,text),public.submit_comment(uuid,text),public.report_comment(uuid,text) to anon,authenticated;
grant execute on function public.moderate_observation(jsonb),public.publish_outcome(jsonb) to authenticated;
grant usage on schema public to anon,authenticated;
grant select on public_stories,opportunities,outcomes,information_sources,comments to anon,authenticated;
grant select,insert,update,delete on observations,public_stories,opportunities,outcomes,information_sources,comments to authenticated;
grant select on moderators,moderation_records,comment_reports,removal_requests to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('pending-media','pending-media',false,5242880,array['image/jpeg']),
 ('approved-media','approved-media',true,5242880,array['image/jpeg']) on conflict(id) do nothing;
create policy pending_upload on storage.objects for insert to anon,authenticated with check(bucket_id='pending-media' and name ~ '^[a-f0-9-]{36}\.jpg$');
create policy pending_moderator on storage.objects for select to authenticated using(bucket_id='pending-media' and public.is_moderator());
create policy pending_remove on storage.objects for delete to authenticated using(bucket_id='pending-media' and public.is_moderator());
create policy approved_read on storage.objects for select to anon,authenticated using(bucket_id='approved-media');
create policy approved_manage on storage.objects for all to authenticated using(bucket_id='approved-media' and public.is_moderator()) with check(bucket_id='approved-media' and public.is_moderator());
commit;
