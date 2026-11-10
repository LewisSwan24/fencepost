-- Apply after 005 in the Supabase SQL editor.
--
-- The name printed beside a comment used to come from auth.users.raw_user_meta_data, which a
-- user writes for themselves at sign-up and can rewrite at any time through /auth/v1/user.
-- Anyone could post as "Wildlife Moderator" or "Fencepost". The name now lives in a profile
-- the server owns: users read their own row, change it only through set_display_name(), and
-- that refuses names claiming a role or the organisation, and names someone already holds.
-- user_metadata is never read for anything shown publicly.
--
-- Tests: wildlife-backend/test (runs 001 to 006 in an in-process Postgres).
begin;

create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null,
 updated_at timestamptz not null default now()
);
create unique index if not exists profiles_display_name_key on public.profiles(lower(display_name));
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for select to authenticated using(id=auth.uid());
grant select on public.profiles to authenticated;

-- Composed form, trimmed, runs of whitespace collapsed to one space.
create or replace function public.clean_display_name(value text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(normalize(coalesce(value,''),NFC),'^\s+|\s+$','','g'),'\s+',' ','g')
$$;

-- The letters a name would be read as, for comparison only. Accents come off, lookalike
-- Cyrillic and Greek letters and digits fold onto Latin, everything else is dropped, so
-- "M0d3rator", "Mоderator" with a Cyrillic о, "Módérator" and "F e n c e p o s t" all fold
-- to the word they imitate. 1 and | stand for i or l, so the caller folds both ways.
create or replace function public.display_name_skeleton(value text,one text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(translate(lower(normalize(value,NFD)),
  '034578аеорсухіјѕкмнтвԁԛԝӏАВЕКМНОРСТХІЈЅαεορτυνικβηχΑΒΕΗΙΚΜΝΟΡΤΥΧ@$!',
  'oeastbaeopcyxijskmhtbdqwlabekmhopctxijsaeoptuvikbnxabehikmnoptyxasi'),
  '[1|]',one,'g'),'[^a-z]','','g')
$$;

-- Null when the name may be used, otherwise the message to show. Letters in any script are
-- allowed; ASCII punctuation beyond . ' -, symbols, emoji, invisible and direction-changing
-- characters are not.
create or replace function public.display_name_problem(value text) returns text language plpgsql immutable set search_path=public as $$
declare v text:=clean_display_name(value); one text; w text;
begin
 if char_length(v) not between 2 and 40 then return 'Use 2 to 40 characters.';end if;
 if v ~ '^[ .''-]' or v ~ '[\x01-\x1F\x21-\x26\x28-\x2C\x2F\x3A-\x40\x5B-\x60\x7B-\xBF\xD7\xF7\x2000-\x2BFF\x3000-\x303F\xE000-\xF8FF\xFE00-\xFE0F\xFEFF\xFFF0-\xFFFF\x1F000-\x1FFFF\xE0000-\xE007F]' then
  return 'Use letters, numbers, spaces, full stops, hyphens or apostrophes.';
 end if;
 foreach one in array array['i','l'] loop
  if display_name_skeleton(v,one) ~ '(moderator|fencepost|communitymember|wildlifeneighbou?r|possumhelp)' then
   return 'That name is reserved. Choose another.';
  end if;
  for w in select regexp_split_to_table(v,'[ .''-]+') loop
   if display_name_skeleton(w,one) in ('admin','admins','administrator','staff','ranger','rangers','council','official','officials','support','system','rspca','wires','police') then
    return 'That name is reserved. Choose another.';
   end if;
  end loop;
 end loop;
 return null;
end $$;

create or replace function public.set_display_name(name text) returns text language plpgsql security definer set search_path=public as $$
declare v text:=clean_display_name(name); problem text:=display_name_problem(name);
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if problem is not null then raise exception '%',problem;end if;
 begin
  insert into profiles(id,display_name,updated_at) values(auth.uid(),v,now())
  on conflict(id) do update set display_name=excluded.display_name,updated_at=now();
 exception when unique_violation then
  raise exception 'That name is taken. Choose another.';
 end;
 return v;
end $$;

-- Same as 004 except where the name comes from.
create or replace function public.create_direct_comment(story_id uuid,body text,parent_comment_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid; display text;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform validate_comment_body(body);
 if not exists(select 1 from public_stories s where s.id=create_direct_comment.story_id) then raise exception 'Story unavailable';end if;
 if parent_comment_id is not null and not exists(select 1 from comments c where c.id=create_direct_comment.parent_comment_id and c.story_id=create_direct_comment.story_id and c.status='visible' and not c.author_deleted) then raise exception 'Reply unavailable';end if;
 select p.display_name into display from profiles p where p.id=auth.uid();
 insert into comments(story_id,parent_comment_id,author_id,author_display_name,body,status) values(story_id,parent_comment_id,auth.uid(),coalesce(display,'Community member'),trim(body),'visible') returning id into cid;
 return jsonb_build_object('id',cid,'status','visible');
end $$;

-- Existing users keep a name they gave themselves if it would pass today; where two share
-- one, the earlier account keeps it. Comments already posted under a name that would not
-- pass are shown as "Community member".
insert into profiles(id,display_name)
 select distinct on (lower(clean_display_name(u.raw_user_meta_data->>'display_name')))
  u.id,clean_display_name(u.raw_user_meta_data->>'display_name')
 from auth.users u
 where display_name_problem(u.raw_user_meta_data->>'display_name') is null
 order by lower(clean_display_name(u.raw_user_meta_data->>'display_name')),u.created_at
on conflict do nothing;
update comments set author_display_name='Community member'
 where author_display_name<>'Community member' and display_name_problem(author_display_name) is not null;

revoke execute on function public.clean_display_name(text),public.display_name_skeleton(text,text),public.display_name_problem(text),public.set_display_name(text) from public,anon,authenticated;
grant execute on function public.set_display_name(text) to authenticated;
commit;
