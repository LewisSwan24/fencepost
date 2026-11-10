-- Apply after 005 in the Supabase SQL editor.
--
-- The name printed beside a comment used to come from auth.users.raw_user_meta_data, which a
-- user writes for themselves at sign-up and can rewrite at any time through /auth/v1/user.
-- Anyone could post as "Wildlife Moderator" or "Fencepost". The name now lives in a profile
-- the server owns: users read their own row and change it only through set_display_name(),
-- which refuses names that claim a role or the organisation, names that look like one
-- someone else holds or has held, and characters that hide or disguise letters.
-- user_metadata is never read for anything shown publicly.
--
-- Tests: wildlife-backend/test (runs 001 to 006 in an in-process Postgres).
begin;

-- Composed form, trimmed, runs of whitespace collapsed to one space.
create or replace function public.clean_display_name(value text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(normalize(coalesce(value,''),NFC),'^\s+|\s+$','','g'),'\s+',' ','g')
$$;

-- How a name reads, for comparison only. NFKD turns fullwidth and mathematical letters into
-- plain ones and splits accents off, which are then dropped; lookalike Cyrillic and Greek
-- letters and digits fold onto Latin. Letters of other scripts are kept as they are.
create or replace function public.display_name_fold(value text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(translate(lower(normalize(coalesce(value,''),NFKD)),
  '034578аеорсухіјѕкмнтвԁԛԝӏАВЕКМНОРСТХІЈЅαεορτυνικβηχΑΒΕΗΙΚΜΝΟΡΤΥΧ@$!',
  'oeastbaeopcyxijskmhtbdqwlabekmhopctxijsaeoptuvikbnxabehikmnoptyxasi'),
  '[\x0300-\x036F]','','g')
$$;

-- Latin letters only, for the reserved-word check. 1 and | stand for i or l, so the caller
-- folds both ways.
create or replace function public.display_name_skeleton(value text,one text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(display_name_fold(value),'[1|]',one,'g'),'[^a-z]','','g')
$$;

-- The key two names collide on: folded, separators dropped. "Taylor B", "TAYLOR-b",
-- "Táylor B", "Tay1or B" and a fullwidth "Taylor B" share one key.
create or replace function public.display_name_key(value text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(display_name_fold(clean_display_name(value)),'[1|]','l','g'),'[\s.''-]','','g')
$$;

-- Null when the name may be used, otherwise the message to show. Letters in any script are
-- allowed; ASCII punctuation beyond . ' -, symbols, emoji, and characters that are invisible,
-- change direction or fill space are not, and Latin may not be mixed with Cyrillic or Greek.
create or replace function public.display_name_problem(value text) returns text language plpgsql immutable set search_path=public as $$
declare v text:=clean_display_name(value); one text; w text;
begin
 if char_length(v) not between 2 and 40 then return 'Use 2 to 40 characters.';end if;
 if v ~ '^[ .''-]' or v ~ '[\x01-\x1F\x21-\x26\x28-\x2C\x2F\x3A-\x40\x5B-\x60\x7B-\xBF\xD7\xF7\x034F\x061C\x115F-\x1160\x17B4-\x17B5\x180B-\x180F\x2000-\x2BFF\x3000-\x303F\x3164\xE000-\xF8FF\xFE00-\xFE0F\xFEFF\xFF01-\xFF0F\xFF1A-\xFF20\xFF3B-\xFF40\xFF5B-\xFF65\xFFA0\xFFF0-\xFFFF\x1BCA0-\x1BCA3\x1D173-\x1D17A\x1F000-\x1FFFF\xE0000-\xE0FFF]' then
  return 'Use letters, numbers, spaces, full stops, hyphens or apostrophes.';
 end if;
 if v ~ '[A-Za-z\xC0-\x024F\x1E00-\x1EFF]' and v ~ '[\x0370-\x03FF\x0400-\x052F\x1F00-\x1FFF\x2DE0-\x2DFF\xA640-\xA69F]' then
  return 'Use one alphabet: Latin letters cannot be mixed with Cyrillic or Greek.';
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

create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null,
 name_key text,
 updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists name_key text;
update public.profiles set name_key=display_name_key(display_name) where name_key is null;
alter table public.profiles alter column name_key set not null;
drop index if exists public.profiles_display_name_key;
create unique index if not exists profiles_name_key on public.profiles(name_key);
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for select to authenticated using(id=auth.uid());
grant select on public.profiles to authenticated;

-- Every name an account has held, by key. A name never passes to another account, even after
-- its holder renames or the account is deleted, because comments keep the name they were
-- posted under. No foreign key, so a deleted account's names stay held.
create table if not exists public.display_name_claims(
 name_key text primary key,
 user_id uuid not null,
 claimed_at timestamptz not null default now()
);
alter table public.display_name_claims enable row level security;
revoke all on public.display_name_claims from public,anon,authenticated;

create or replace function public.set_display_name(name text) returns text language plpgsql security definer set search_path=public as $$
declare v text:=clean_display_name(name); k text:=display_name_key(name); problem text:=display_name_problem(name); holder uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if problem is not null then raise exception '%',problem;end if;
 insert into display_name_claims(name_key,user_id) values(k,auth.uid()) on conflict(name_key) do nothing;
 select c.user_id into holder from display_name_claims c where c.name_key=k;
 if holder is distinct from auth.uid() then raise exception 'That name is taken. Choose another.';end if;
 insert into profiles(id,display_name,name_key,updated_at) values(auth.uid(),v,k,now())
 on conflict(id) do update set display_name=excluded.display_name,name_key=excluded.name_key,updated_at=now();
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

-- Existing users keep a name they gave themselves if it would pass today; where two share a
-- key, the earlier account keeps it. Every comment is then shown under its name only if its
-- author holds that name, so a comment never reads as someone else's.
insert into profiles(id,display_name,name_key)
 select distinct on (display_name_key(u.raw_user_meta_data->>'display_name'))
  u.id,clean_display_name(u.raw_user_meta_data->>'display_name'),display_name_key(u.raw_user_meta_data->>'display_name')
 from auth.users u
 where display_name_problem(u.raw_user_meta_data->>'display_name') is null
 order by display_name_key(u.raw_user_meta_data->>'display_name'),u.created_at,u.id
on conflict do nothing;
insert into display_name_claims(name_key,user_id) select name_key,id from profiles on conflict do nothing;
update comments c set author_display_name='Community member'
 where c.author_display_name<>'Community member'
  and not exists(select 1 from display_name_claims k where k.name_key=display_name_key(c.author_display_name) and k.user_id=c.author_id);

revoke execute on function public.clean_display_name(text),public.display_name_fold(text),public.display_name_skeleton(text,text),public.display_name_key(text),public.display_name_problem(text),public.set_display_name(text) from public,anon,authenticated;
grant execute on function public.set_display_name(text) to authenticated;
commit;
