-- Additive upgrade for existing installations; no observations or registrations are deleted.
begin;
alter table public.outcomes add column if not exists activity text;
alter table public.outcomes add column if not exists why_it_matters text;
alter table public.outcomes add column if not exists demonstration_date text;
create or replace function public.publish_outcome(payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_moderator() then raise exception 'Moderator required'; end if;
 if not exists(select 1 from opportunities where id=payload->>'opportunityId') then raise exception 'Opportunity unavailable';end if;
 if payload->>'publicArea' not in ('General park area','Community centre area','Park pond area','School oval area','Reserve area','Community garden area') then raise exception 'Broad area required';end if;
 insert into outcomes(opportunity_id,title,public_area,completed_at,actions_completed,approved_image,community_message,activity,why_it_matters,demonstration_date,next_opportunity_id,published,sample,no_wildlife_handling)
 values(payload->>'opportunityId',payload->>'title',payload->>'publicArea',(payload->>'completedAt')::date,payload->>'actionsCompleted',nullif(payload->>'approvedImage',''),payload->>'communityMessage',payload->>'activity',payload->>'whyItMatters',payload->>'demonstrationDate',nullif(payload->>'nextOpportunityId',''),true,coalesce((payload->>'sample')::boolean,false),true);
 update opportunities set data=data||'{"status":"completed","registrationOpen":false}'::jsonb where id=payload->>'opportunityId';
end $$;

commit;
-- Then apply the updated 002_seed.sql; deterministic sample IDs make it safe to repeat.
