// The name printed beside a comment, run against the real migrations in an in-process Postgres.
//
//   cd wildlife-backend/test && npm install && npm test
//
// Until 006, create_direct_comment printed whatever the commenter had put in their Supabase
// Auth user_metadata. A user writes that field themselves, at sign-up or any time after
// through /auth/v1/user, so anyone could post as "Wildlife Moderator" or "Fencepost". These
// tests run 001 to 006 in order, with the few Supabase objects the migrations lean on
// (auth.users, auth.uid(), the storage tables, the anon and authenticated roles) stood in
// below, and then act as signed-in users.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = readdirSync(join(here, ".."))
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort();

const SUPABASE = `
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}', created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema public to anon, authenticated;
`;

const STORY = "5bc92395-6efc-4491-a608-746ce4b3b78c"; // from 002_seed.sql
const ids = {
  impostor: "00000000-0000-4000-8000-000000000001",
  taylor: "00000000-0000-4000-8000-000000000002",
  other: "00000000-0000-4000-8000-000000000003",
  oldTaylor: "00000000-0000-4000-8000-000000000004",
  oldMod: "00000000-0000-4000-8000-000000000005",
  twin: "00000000-0000-4000-8000-000000000006",
  jamie: "00000000-0000-4000-8000-000000000007",
  sam: "00000000-0000-4000-8000-000000000008",
};

// Characters built from code points, so no editor or formatter can quietly change them.
const cp = (...points) => String.fromCodePoint(...points);
const fullwidth = (s) => [...s].map((c) => (/[!-~]/.test(c) ? cp(c.codePointAt(0) + 0xfee0) : c)).join("");
const mathBold = (s) =>
  [...s]
    .map((c) => (/[A-Z]/.test(c) ? cp(0x1d400 + c.charCodeAt(0) - 65) : /[a-z]/.test(c) ? cp(0x1d41a + c.charCodeAt(0) - 97) : c))
    .join("");

let db;

async function as(user, fn) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

const comment = (user, body = "Saw one on the fence tonight.") =>
  as(user, async () => {
    const { rows } = await db.query("select public.create_direct_comment($1, $2) as r", [STORY, body]);
    const cid = rows[0].r.id;
    await db.exec("reset role");
    return (await db.query("select author_display_name from comments where id = $1", [cid])).rows[0]
      .author_display_name;
  });

// A fresh account, for tests that only need a name accepted.
let users = 100;
async function newUser() {
  const id = `00000000-0000-4000-8000-${String(++users).padStart(12, "0")}`;
  await db.query("insert into auth.users(id) values ($1)", [id]);
  return id;
}

const setName = (user, name) =>
  as(user, async () => (await db.query("select public.set_display_name($1) as n", [name])).rows[0].n);

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  // Users who exist before 006 runs, with names they gave themselves, and a comment already
  // posted under an official-looking one.
  await db.exec(`insert into auth.users(id, raw_user_meta_data) values
    ('${ids.impostor}', '{"display_name":"Wildlife Moderator"}'),
    ('${ids.taylor}', '{}'), ('${ids.other}', '{}'),
    ('${ids.oldMod}', '{"display_name":"Fencepost Admin"}'),
    ('${ids.jamie}', '{}'), ('${ids.sam}', '{}')`);
  // Two accounts that both called themselves Robin; the earlier one keeps the name.
  await db.exec(`insert into auth.users(id, raw_user_meta_data, created_at) values
    ('${ids.oldTaylor}', '{"display_name":"Robin"}', '2026-01-01'),
    ('${ids.twin}', '{"display_name":"robin"}', '2026-02-01')`);
  for (const file of migrations) {
    if (file.startsWith("006")) {
      await db.exec(`insert into comments(story_id, author_id, author_display_name, body, status) values
        ('${STORY}', '${ids.oldMod}', 'Fencepost Admin', 'Posted before the fix.', 'visible'),
        ('${STORY}', '${ids.oldTaylor}', 'Robin', 'Robin first.', 'visible'),
        ('${STORY}', '${ids.twin}', 'robin', 'Twin post.', 'visible')`);
    }
    await db.exec(readFileSync(join(here, "..", file), "utf8"));
  }
});

test("a name typed into sign-up metadata is never printed on a comment", async () => {
  assert.equal(await comment(ids.impostor), "Community member");
});

test("names that claim a role or the organisation are refused, however they are spelled", async () => {
  for (const name of [
    "Moderator", "wildlife moderator", "Admin", "Fencepost", "fencepost team", "Official",
    "M0derator", "Mod3rator", "F e n c e p o s t", "Mоderator" /* Cyrillic о */, "Staff",
    "Community member", "Ranger Dave", "Council", "Adm1n", "0ff1c1al", "Módérator",
  ]) {
    await assert.rejects(setName(ids.taylor, name), /reserved|alphabet/i, `"${name}" was accepted`);
  }
});

test("ordinary names in any script are accepted and printed", async () => {
  for (const name of ["Nguyễn Vy", "李小明", "O'Brien", "Mod Squad fan"]) {
    assert.equal(await setName(await newUser(), name), name);
  }
  assert.equal(await setName(ids.taylor, "  Taylor   B  "), "Taylor B");
  assert.equal(await comment(ids.taylor), "Taylor B");
});

test("a name has a length and a character set", async () => {
  await assert.rejects(setName(ids.other, "A"), /2 to 40/);
  await assert.rejects(setName(ids.other, "x".repeat(41)), /2 to 40/);
  await assert.rejects(setName(ids.other, "Taylor <script>"), /letters/);
  await assert.rejects(setName(ids.other, "Taylor" + String.fromCharCode(0x202e) + "B"), /letters/);
});

test("two people cannot hold the same name, whatever the case", async () => {
  await setName(ids.taylor, "Taylor B");
  await assert.rejects(setName(ids.other, "taylor b"), /taken/i);
});

test("profiles can be read by their owner but not written directly", async () => {
  await as(ids.taylor, async () => {
    await assert.rejects(db.query("update profiles set display_name = 'Moderator' where id = $1", [ids.taylor]));
    await assert.rejects(db.query("insert into profiles(id, display_name) values ($1, 'Admin')", [ids.other]));
    const { rows } = await db.query("select id from profiles");
    assert.deepEqual(rows.map((r) => r.id), [ids.taylor]);
  });
});

test("signed-out callers cannot set a name", async () => {
  await assert.rejects(db.query("select public.set_display_name('Robin')"), /sign in/i);
});

test("the upgrade keeps fair names from metadata and drops official-looking ones", async () => {
  const names = (await db.query("select id, display_name from profiles")).rows;
  const of = (id) => names.find((r) => r.id === id)?.display_name;
  assert.equal(of(ids.oldTaylor), "Robin");
  assert.equal(of(ids.oldMod), undefined);
  assert.equal(of(ids.impostor), undefined);
  const old = await db.query("select author_display_name from comments where body = 'Posted before the fix.'");
  assert.equal(old.rows[0].author_display_name, "Community member");
});

test("compatibility forms and letters outside the allowed scripts are refused", async () => {
  // Fullwidth and mathematical letters render as the word itself; IPA alpha, Cherokee and
  // Latin Extended-B letters pass for Latin ones.
  for (const name of [
    fullwidth("Moderator"), mathBold("Admin"), fullwidth("Fencepost") + " fan",
    cp(0x251) + "dmin", cp(0x13b7) + "oderator", "Off" + cp(0x269) + "cial", "Tay" + cp(0x301, 0x301, 0x301) + "lor",
    // An allowed Latin letter that does not reduce to a to z (n preceded by apostrophe).
    "Do" + cp(0x149) + "a",
  ]) {
    await assert.rejects(setName(ids.taylor, name), /letters/i, `"${name}" was accepted`);
  }
});

test("Latin letters with no plain form are read as the plain letter", async () => {
  for (const name of ["Moderat" + cp(0xf8) + "r", "Fence" + cp(0xfe) + "ost", "Adrnin", "Off" + cp(0x131) + "cial", "A" + cp(0x111) + "min"]) {
    await assert.rejects(setName(ids.taylor, name), /reserved|letters/i, `"${name}" was accepted`);
  }
  for (const name of ["S" + cp(0xf8) + "ren", cp(0x141) + "ukasz", "Stra" + cp(0xdf) + "e", "Ma" + cp(0xeb) + "lle"]) {
    assert.equal(await setName(await newUser(), name), name.normalize("NFC"));
  }
});

test("lookalike Cyrillic spellings of reserved words are refused", async () => {
  // a, komi de, em, i, pe: reads "admin".
  await assert.rejects(setName(ids.other, cp(0x430, 0x501, 0x43c, 0x456, 0x43f)), /reserved/i);
});

test("invisible fillers, joiners and selectors are refused", async () => {
  // Hangul fillers, combining grapheme joiner, Arabic letter mark, Mongolian vowel separator,
  // a supplementary variation selector.
  for (const point of [0x3164, 0x115f, 0xffa0, 0x034f, 0x061c, 0x180e, 0xe0101]) {
    await assert.rejects(setName(ids.other, "Tay" + cp(point) + "lor Q"), /letters/, point.toString(16));
  }
});

test("Latin mixed with Cyrillic or Greek letters is refused", async () => {
  await assert.rejects(setName(ids.other, "Tayl" + cp(0x43e) + "r Q"), /alphabet/i);
  await assert.rejects(setName(ids.other, "Tayl" + cp(0x3bf) + "r Q"), /alphabet/i);
  assert.equal(await setName(await newUser(), "Иван Петров"), "Иван Петров");
});

test("a lookalike of a name someone holds counts as the same name", async () => {
  await setName(ids.taylor, "Taylor B");
  for (const name of ["Tay1or B", "TayIor B", "Taylor-B", "TAYLOR  b", "T" + cp(0xe1) + "ylor B"]) {
    await assert.rejects(setName(ids.other, name), /taken/i, `"${name}" was accepted`);
  }
  await setName(ids.taylor, "Iris Warne");
  for (const name of ["lris Warne", "Iris VVarne", "Iris Wame"]) {
    await assert.rejects(setName(ids.other, name), /taken/i, `"${name}" was accepted`);
  }
});

test("one account can hold at most five names", async () => {
  for (const n of ["One", "Two", "Three", "Four", "Five"]) await setName(ids.sam, "Sam " + n);
  await assert.rejects(setName(ids.sam, "Sam Six"), /five names/i);
  assert.equal(await setName(ids.sam, "Sam Two"), "Sam Two");
});

test("a name stays with whoever held it, even after they rename", async () => {
  await setName(ids.jamie, "Jamie Q");
  await setName(ids.jamie, "Jordan Q");
  await assert.rejects(setName(ids.sam, "Jamie Q"), /taken/i);
  assert.equal(await setName(ids.jamie, "Jamie Q"), "Jamie Q");
});

test("the upgrade resets comments whose author did not keep that name", async () => {
  const rows = (
    await db.query("select body, author_display_name from comments where body in ('Robin first.', 'Twin post.') order by body")
  ).rows;
  assert.deepEqual(rows.map((r) => r.author_display_name), ["Robin", "Community member"]);
  await assert.rejects(setName(ids.twin, "Robin"), /taken/i);
});

test("a name written wholly in lookalike letters is read as the word it imitates", async () => {
  // All Cyrillic, so the mixed-alphabet rule does not apply: "System", and a copy of "Coco".
  const system = cp(0x405, 0x443, 0x455, 0x442, 0x435, 0x43c);
  await assert.rejects(setName(ids.other, system), /reserved/i);
  await setName(ids.jamie, "Coco");
  await assert.rejects(setName(ids.other, cp(0x421, 0x43e, 0x441, 0x43e)), /taken/i);
});

test("I, l and 1 read as one letter in reserved words too", async () => {
  // A capital I and the digit 1 pass for l in most sans-serif type.
  for (const name of ["CounciI", "Po1ice", "AdmIn", "OffIcial", "WiIdlife Neighbours"]) {
    await assert.rejects(setName(ids.other, name), /reserved/i, `"${name}" was accepted`);
  }
});

test("capital lookalikes are folded whatever the database lowercases", async () => {
  // All Cyrillic capitals: A, Komi DE, EM, I, PE.
  await assert.rejects(setName(ids.other, cp(0x410, 0x500, 0x41c, 0x406, 0x41f)), /reserved/i);
});
