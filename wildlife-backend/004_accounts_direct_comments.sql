-- Real backend authorisation remains Supabase Auth + RLS. Hardcoded browser accounts never grant these roles.
begin;
alter table public.observations add column if not exists author_id uuid references auth.users(id);
alter table public.observations add column if not exists ai_assisted boolean not null default false;
alter table public.comments add column if not exists parent_comment_id uuid references public.comments(id) on delete set null;
alter table public.comments add column if not exists author_id uuid references auth.users(id);
alter table public.comments add column if not exists author_display_name text not null default 'Community member';
alter table public.comments add column if not exists report_count integer not null default 0;
alter table public.comments add column if not exists updated_at timestamptz;
alter table public.comments add column if not exists removal_reason text;
alter table public.comments add column if not exists author_deleted boolean not null default false;
alter table public.comments drop constraint if exists comments_status_check;
update public.comments set status=case when status='approved' then 'visible' when status='pending' then 'removed' else status end,
 removal_reason=case when status='pending' then 'Legacy pre-approval comment retained privately during direct-comment upgrade.' else removal_reason end;
alter table public.comments alter column status set default 'visible';
alter table public.comments add constraint comments_status_check check(status in ('visible','removed'));
alter table public.comment_reports add column if not exists reported_by uuid references auth.users(id);
alter table public.comment_reports add column if not exists details text not null default '';
alter table public.comment_reports add column if not exists status text not null default 'open' check(status in ('open','dismissed','actioned'));
alter table public.comment_reports add column if not exists reviewed_by uuid references auth.users(id);
alter table public.comment_reports add column if not exists reviewed_at timestamptz;
create unique index if not exists comment_reports_one_open_per_person on public.comment_reports(comment_id,reported_by) where status='open';
create table if not exists public.comment_actions(id uuid primary key default gen_random_uuid(),comment_id uuid,moderator_id uuid not null references auth.users(id),action text not null,reason text not null,created_at timestamptz not null default now());
alter table public.comment_actions enable row level security;
create policy comment_actions_moderator on public.comment_actions for select to authenticated using(is_moderator());
grant select on public.comment_actions to authenticated;
drop policy if exists comments_public on public.comments;
drop policy if exists comments_moderator on public.comments;
create policy comments_public on public.comments for select to anon,authenticated using(status='visible' and not author_deleted);
create policy comments_moderator on public.comments for select to authenticated using(is_moderator());
revoke insert,update,delete on public.comments from anon,authenticated;
-- Disable superseded entry points so old clients cannot create pre-approval comments.
revoke execute on function public.submit_comment(uuid,text),public.report_comment(uuid,text) from public,anon,authenticated;

create or replace function public.submit_observation(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare oid uuid; tok uuid; concern boolean:=coalesce((payload->>'injuryConcern')::boolean,false); media text:=nullif(payload->>'mediaUrl','');
begin
 if payload->>'possibleSpecies' not in ('brushtail','flying-fox','water-dragon','magpie','kangaroo','blue-tongue','not-sure') then raise exception 'Invalid species';end if;
 if media is not null and media !~ '^[a-f0-9-]{36}\.jpg$' then raise exception 'Invalid media';end if;
 insert into observations(nickname,possible_species,approximate_time,public_area,private_rescue_location,behaviour,description,media_url,injury_concern,condition,moving,near_traffic,status,author_id,ai_assisted)
 values(left(payload->>'nickname',60),payload->>'possibleSpecies',payload->>'approximateTime',payload->>'publicArea',case when concern then payload->>'privateRescueLocation' else null end,payload->>'behaviour',payload->>'description',media,concern,left(payload->>'condition',300),left(payload->>'moving',60),coalesce((payload->>'nearTraffic')::boolean,false),case when concern then 'urgent' else 'pending' end,auth.uid(),coalesce((payload->>'aiAssisted')::boolean,false))
 returning id,removal_token into oid,tok;
 return jsonb_build_object('id',oid,'removalToken',tok,'status',case when concern then 'urgent' else 'pending' end);
end $$;
create or replace function public.my_observations() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'possible_species',o.possible_species,'public_area',o.public_area,'approximate_time',o.approximate_time,'behaviour',o.behaviour,'description',o.description,'status',o.status,'submitted_at',o.submitted_at,'ai_assisted',o.ai_assisted)) from observations o where o.author_id=auth.uid()),'[]'::jsonb);
end $$;
create or replace function public.validate_comment_body(value text) returns void language plpgsql set search_path=public as $$
begin
 if length(trim(value)) not between 1 and 500 then raise exception 'A short comment is required';end if;
 if value ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' or value ~* '\m[0-9]{1,5}[A-Z]? +([A-Z][A-Z''-]* +){1,5}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|crescent|cres|place|pl|terrace|tce|way|parade|pde)\M' or value ~* '\m0[23478]([ ()-]*[0-9]){8}\M' or value ~* '\m[A-Z]{3}[- ]?[0-9]{3}\M' or value ~* '\m(you should|try to|please|go and) +(feed|catch|grab|handle|pick up|trap|chase)\M' or value ~* '\m(i will kill you|kill yourself|i will hurt you)\M' then raise exception 'Remove identifying or dangerous content';end if;
end $$;
create or replace function public.create_direct_comment(story_id uuid,body text,parent_comment_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid; display text;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform validate_comment_body(body);
 if not exists(select 1 from public_stories s where s.id=create_direct_comment.story_id) then raise exception 'Story unavailable';end if;
 if parent_comment_id is not null and not exists(select 1 from comments c where c.id=create_direct_comment.parent_comment_id and c.story_id=create_direct_comment.story_id and c.status='visible' and not c.author_deleted) then raise exception 'Reply unavailable';end if;
 select left(coalesce(nullif(raw_user_meta_data->>'display_name',''),'Community member'),60) into display from auth.users where id=auth.uid();
 insert into comments(story_id,parent_comment_id,author_id,author_display_name,body,status) values(story_id,parent_comment_id,auth.uid(),coalesce(display,'Community member'),trim(body),'visible') returning id into cid;
 return jsonb_build_object('id',cid,'status','visible');
end $$;
create or replace function public.edit_own_comment(comment_id uuid,body text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;perform validate_comment_body(body);
 update comments c set body=trim(edit_own_comment.body),updated_at=now() where c.id=edit_own_comment.comment_id and c.author_id=auth.uid() and c.status='visible' and not c.author_deleted;
 if not found then raise exception 'Own visible comment required';end if;
end $$;
create or replace function public.delete_own_comment(comment_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 update comments c set status='removed',author_deleted=true,updated_at=now() where c.id=delete_own_comment.comment_id and c.author_id=auth.uid();if not found then raise exception 'Own comment required';end if;
end $$;
create or replace function public.report_direct_comment(comment_id uuid,reason text,details text default '') returns void language plpgsql security definer set search_path=public as $$
declare rid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if reason not in ('Exact wildlife location','Personal information','Unsafe wildlife advice','Harassment or abusive language','Spam','Other concern') or length(details)>500 then raise exception 'Reporting reason required';end if;
 if not exists(select 1 from comments c where c.id=report_direct_comment.comment_id and c.status='visible' and not c.author_deleted and c.author_id is distinct from auth.uid()) then raise exception 'Another visible comment required';end if;
 insert into comment_reports(comment_id,reported_by,reason,details) values(comment_id,auth.uid(),reason,details) on conflict do nothing returning id into rid;
 if rid is null then raise exception 'Already reported';end if;
 update comments c set report_count=report_count+1 where c.id=report_direct_comment.comment_id;
end $$;
create or replace function public.moderate_direct_comment(comment_id uuid,action text,reason text default '') returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_moderator() then raise exception 'Moderator required';end if;
 if action not in ('remove','restore') or (action='remove' and length(trim(reason))<3) or length(reason)>500 then raise exception 'Action and reason required';end if;
 if exists(select 1 from comments c where c.id=moderate_direct_comment.comment_id and c.author_deleted) then raise exception 'Author deletion cannot be restored';end if;
 update comments c set status=case when action='remove' then 'removed' else 'visible' end,removal_reason=case when action='remove' then reason else null end,updated_at=now() where c.id=moderate_direct_comment.comment_id;
 if not found then raise exception 'Comment unavailable';end if;
 update comment_reports r set status='actioned',reviewed_by=auth.uid(),reviewed_at=now() where r.comment_id=moderate_direct_comment.comment_id and r.status='open';
 insert into comment_actions(comment_id,moderator_id,action,reason) values(comment_id,auth.uid(),action,coalesce(nullif(reason,''),'Restored after review'));
end $$;
create or replace function public.dismiss_comment_report(report_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
 if not is_moderator() then raise exception 'Moderator required';end if;
 update comment_reports r set status='dismissed',reviewed_by=auth.uid(),reviewed_at=now() where r.id=report_id and r.status='open' returning comment_id into cid;
 if not found then raise exception 'Open report unavailable';end if;
 insert into comment_actions(comment_id,moderator_id,action,reason) values(cid,auth.uid(),'dismiss-report','Report reviewed; no removal required.');
end $$;
revoke execute on function public.my_observations(),public.validate_comment_body(text),public.create_direct_comment(uuid,text,uuid),public.edit_own_comment(uuid,text),public.delete_own_comment(uuid),public.report_direct_comment(uuid,text,text),public.moderate_direct_comment(uuid,text,text),public.dismiss_comment_report(uuid) from public,anon;
grant execute on function public.my_observations(),public.create_direct_comment(uuid,text,uuid),public.edit_own_comment(uuid,text),public.delete_own_comment(uuid),public.report_direct_comment(uuid,text,text),public.moderate_direct_comment(uuid,text,text),public.dismiss_comment_report(uuid) to authenticated;
commit;
