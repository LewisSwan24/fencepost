-- Retire obsolete writing-only metadata while preserving observations and ownership.
begin;
create or replace function public.submit_observation(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare oid uuid; tok uuid; concern boolean:=coalesce((payload->>'injuryConcern')::boolean,false); media text:=nullif(payload->>'mediaUrl','');
begin
 if payload->>'possibleSpecies' not in ('brushtail','flying-fox','water-dragon','magpie','kangaroo','blue-tongue','not-sure') then raise exception 'Invalid species';end if;
 if media is not null and media !~ '^[a-f0-9-]{36}\.jpg$' then raise exception 'Invalid media';end if;
 insert into observations(nickname,possible_species,approximate_time,public_area,private_rescue_location,behaviour,description,media_url,injury_concern,condition,moving,near_traffic,status,author_id)
 values(left(payload->>'nickname',60),payload->>'possibleSpecies',payload->>'approximateTime',payload->>'publicArea',case when concern then payload->>'privateRescueLocation' else null end,payload->>'behaviour',payload->>'description',media,concern,left(payload->>'condition',300),left(payload->>'moving',60),coalesce((payload->>'nearTraffic')::boolean,false),case when concern then 'urgent' else 'pending' end,auth.uid())
 returning id,removal_token into oid,tok;
 return jsonb_build_object('id',oid,'removalToken',tok,'status',case when concern then 'urgent' else 'pending' end);
end $$;
create or replace function public.my_observations() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'possible_species',o.possible_species,'public_area',o.public_area,'approximate_time',o.approximate_time,'behaviour',o.behaviour,'description',o.description,'status',o.status,'submitted_at',o.submitted_at)) from observations o where o.author_id=auth.uid()),'[]'::jsonb);
end $$;
alter table public.observations drop column if exists ai_assisted;
commit;
