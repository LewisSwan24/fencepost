-- Apply after 005 in the Supabase SQL editor.
--
-- The name printed beside a comment used to come from auth.users.raw_user_meta_data, which a
-- user writes for themselves at sign-up and can rewrite at any time through /auth/v1/user.
-- Anyone could post as "Wildlife Moderator" or "Fencepost". The name now lives in a profile
-- the server owns: users read their own row and change it only through set_display_name().
--
-- What a name may contain is an allowlist, not a list of bad characters: letters of common
-- scripts, digits, spaces, full stops, apostrophes and hyphens, all in one script. Every
-- Latin letter must reduce to a to z, so the reserved-word check sees each one. Names that
-- claim a role or the organisation are refused, and so are names that read the same as one
-- another account holds or has ever held. user_metadata is never read for anything shown.
--
-- Tests: wildlife-backend/test (runs 001 to 006 in an in-process Postgres).
begin;

-- Composed form, trimmed, runs of whitespace collapsed to one space.
create or replace function public.clean_display_name(value text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(regexp_replace(normalize(coalesce(value,''),NFC),'^\s+|\s+$','','g'),'\s+',' ','g')
$$;

-- How a name reads, for comparison only. NFKD splits accents off, and they are dropped;
-- Latin letters with no decomposition (ø, ł, þ, ı ...), lookalike Cyrillic and Greek letters
-- and digits that stand for letters fold onto a to z. The table runs before lower(), so a
-- capital is folded the same whatever the database's locale would lower it to.
create or replace function public.display_name_fold(value text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(
  replace(replace(replace(replace(replace(lower(translate(normalize(coalesce(value,''),NFKD),
   '034578øØðÐþÞđĐħĦıĸłŁŀĿŋŊŧŦаеорсухіјѕкмнтвԁԛԝӏпгһьүѵАВЕКМНОРСТХІЈЅӀҺЬҮԀԚԜαεορτυνικβηχγωμϲϳΑΒΕΗΙΚΜΝΟΡΤΥΧΖϹͿ',
   'oeastbooddppddhhikllllnnttaeopcyxijskmhtbdqwlnrhbyvabekmhopctxijslhbydqwaeoptuvikbnxywucjabehikmnoptyxzcj')),
   'æ','ae'),'Æ','ae'),'œ','oe'),'Œ','oe'),'ß','ss'),
  '[\x0300-\x036F]','','g')
$$;

-- Latin letters only, for the reserved-word check. 1 stands for i or l, and rn and vv can
-- pass for m and w, so the caller tries each reading.
create or replace function public.display_name_skeleton(value text,one text,merge boolean) returns text language sql immutable set search_path=public as $$
 select case when merge then replace(replace(s,'rn','m'),'vv','w') else s end
 from (select regexp_replace(regexp_replace(display_name_fold(value),'1',one,'g'),'[^a-z]','','g') as s) x
$$;

-- The key two names collide on: folded, separators dropped, i, l and 1 one letter, rn as m
-- and vv as w. "Taylor B", "TAYLOR-b", "Táylor B", "TayIor B" and "Tay1or B" share a key.
create or replace function public.display_name_key(value text) returns text language sql immutable set search_path=public as $$
 select replace(replace(translate(regexp_replace(display_name_fold(clean_display_name(value)),'[\s.''-]','','g'),'i1','ll'),'rn','m'),'vv','w')
$$;

-- Null when the name may be used, otherwise the message to show.
create or replace function public.display_name_problem(value text) returns text language plpgsql immutable set search_path=public as $$
declare v text:=clean_display_name(value); one text; merge boolean; w text;
begin
 if char_length(v) not between 2 and 40 then return 'Use 2 to 40 characters.';end if;
 -- Latin (Basic, Latin-1 letters, Extended-A, Vietnamese), Greek, Cyrillic, Hebrew, Arabic,
 -- Devanagari, Thai, kana, CJK ideographs and Hangul syllables. No combining marks left over
 -- after composing, no symbols, no invisible or direction-changing characters.
 if v ~ '^[ .''-]' or v ~ '[^A-Za-z0-9 .''\xC0-\xD6\xD8-\xF6\xF8-\xFF\x0100-\x017F\x1E00-\x1E99\x1EA0-\x1EF9\x0386\x0388-\x03CE\x0400-\x0481\x048A-\x052F\x05D0-\x05EA\x0620-\x064A\x0900-\x097F\x0E01-\x0E3A\x0E40-\x0E4E\x3041-\x3096\x30A1-\x30FA\x30FC\x3400-\x4DBF\x4E00-\x9FFF\xAC00-\xD7A3-]' then
  return 'Use letters, numbers, spaces, full stops, hyphens or apostrophes.';
 end if;
 if (select count(*) from unnest(array[
   '[A-Za-z\xC0-\x017F\x1E00-\x1EFF]','[\x0370-\x03FF]','[\x0400-\x052F]','[\x0590-\x05FF]',
   '[\x0600-\x06FF]','[\x0900-\x097F]','[\x0E00-\x0E7F]','[\x3040-\x30FF\x3400-\x4DBF\x4E00-\x9FFF\xAC00-\xD7AF]']) as s(script)
   where v ~ s.script) > 1 then
  return 'Use one alphabet: letters from different scripts cannot be mixed.';
 end if;
 if v ~ '[A-Za-z\xC0-\x017F\x1E00-\x1EFF]' and display_name_fold(v) ~ '[^a-z0-9 .''-]' then
  return 'Use letters, numbers, spaces, full stops, hyphens or apostrophes.';
 end if;
 foreach one in array array['i','l'] loop
  foreach merge in array array[false,true] loop
   if display_name_skeleton(v,one,merge) ~ '(moderator|fencepost|communitymember|wildlifeneighbou?r|possumhelp)' then
    return 'That name is reserved. Choose another.';
   end if;
   for w in select regexp_split_to_table(v,'[ .''-]+') loop
    if display_name_skeleton(w,one,merge) in ('admin','admins','administrator','staff','ranger','rangers','council','official','officials','support','system','rspca','wires','police') then
     return 'That name is reserved. Choose another.';
    end if;
   end loop;
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
-- posted under. No foreign key, so a deleted account's names stay held. An account may hold
-- at most five, so no one can sit on a whole neighbourhood's names.
create table if not exists public.display_name_claims(
 name_key text primary key,
 user_id uuid not null,
 claimed_at timestamptz not null default now()
);
create index if not exists display_name_claims_user on public.display_name_claims(user_id);
alter table public.display_name_claims enable row level security;
revoke all on public.display_name_claims from public,anon,authenticated;

create or replace function public.set_display_name(name text) returns text language plpgsql security definer set search_path=public as $$
declare v text:=clean_display_name(name); k text:=display_name_key(name); problem text:=display_name_problem(name); holder uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if problem is not null then raise exception '%',problem;end if;
 -- One rename at a time per account, so the five-name count below cannot be raced.
 perform pg_advisory_xact_lock(hashtext('display_name:'||auth.uid()::text));
 select c.user_id into holder from display_name_claims c where c.name_key=k;
 if holder is not null and holder<>auth.uid() then raise exception 'That name is taken. Choose another.';end if;
 if holder is null and (select count(*) from display_name_claims c where c.user_id=auth.uid())>=5 then
  raise exception 'An account can use at most five names. Choose one you have used before.';
 end if;
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

revoke execute on function public.clean_display_name(text),public.display_name_fold(text),public.display_name_skeleton(text,text,boolean),public.display_name_key(text),public.display_name_problem(text),public.set_display_name(text) from public,anon,authenticated;
grant execute on function public.set_display_name(text) to authenticated;
commit;
