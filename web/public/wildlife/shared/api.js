import * as localAuth from "./auth.js";
import * as store from "./storage.js";
import {
  accountObservations,
  accountComments,
  accountReports,
  accountRegistration,
  accountDraft,
  residentId,
} from "./account-seeds.js";
import { requireSafeComment, reportReasons } from "./comment-safety.js";
import { config } from "./config.js";
import {
  areas,
  times,
  species,
  sampleStories,
  observationSamples,
  opportunity,
  historicOpportunity,
  sampleOutcome,
  sampleOutcomes,
  sampleOpportunities,
} from "./data.js";
export const live = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const KEY = "wn-demo-v2";
const id = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const publicFields = [
  "id",
  "sourceObservationId",
  "contentType",
  "species",
  "publicArea",
  "approximateTime",
  "behaviour",
  "storyText",
  "mediaUrl",
  "verifiedFact",
  "factSource",
  "reviewedBy",
  "publishedAt",
  "sample",
];
const pickStory = (s) =>
  Object.fromEntries(publicFields.filter((k) => k in s).map((k) => [k, s[k]]));
export function initialState() {
  return {
    observations: [
      ...structuredClone(observationSamples),
      ...structuredClone(accountObservations),
    ],
    stories: structuredClone(sampleStories).map((story) =>
      story.id === "story-brushtail"
        ? { ...story, sourceObservationId: "taylor-approved-demo" }
        : story,
    ),
    opportunities: [
      ...structuredClone(sampleOpportunities),
      structuredClone(historicOpportunity),
    ],
    outcomes: structuredClone(sampleOutcomes),
    catalogVersion: 3,
    records: [],
    comments: structuredClone(accountComments),
    reports: structuredClone(accountReports),
    registrations: [structuredClone(accountRegistration)],
    receipts: [],
    favorites: { [residentId]: ["story-brushtail"] },
    drafts: { [residentId]: structuredClone(accountDraft) },
    commentHistory: [],
    accountVersion: 1,
    removals: [],
    sources: [],
  };
}
function state() {
  return store.readDemo(initialState, (saved) => {
    let changed = false;
    if (saved.catalogVersion !== 3) {
      for (const seed of sampleOpportunities) {
        const found = saved.opportunities.find((o) => o.id === seed.id);
        if (found) found.image = seed.image;
        else saved.opportunities.push(structuredClone(seed));
      }
      for (const seed of sampleOutcomes)
        if (!saved.outcomes.some((o) => o.id === seed.id))
          saved.outcomes.push(structuredClone(seed));
      for (const seed of sampleStories) {
        const found = saved.stories.find((o) => o.id === seed.id && o.sample);
        if (found) found.mediaUrl = seed.mediaUrl;
      }
      saved.catalogVersion = 3;
      changed = true;
    }
    if (saved.accountVersion !== 1) {
      for (const observation of accountObservations)
        if (!saved.observations.some((o) => o.id === observation.id))
          saved.observations.push(structuredClone(observation));
      const first = saved.stories.find((x) => x.id === "story-brushtail");
      if (first && !first.sourceObservationId)
        first.sourceObservationId = "taylor-approved-demo";
      saved.comments ??= [];
      for (const comment of accountComments)
        if (!saved.comments.some((c) => c.id === comment.id))
          saved.comments.push(structuredClone(comment));
      // Existing pre-review comments remain unpublished for the moderator to remove or restore explicitly.
      for (const c of saved.comments) {
        if (c.status === "approved") c.status = "visible";
        if (c.status === "pending") {
          c.status = "removed";
          c.removalReason =
            "Legacy pre-approval comment retained privately during the direct-comment upgrade.";
        }
        c.authorId ??= "legacy-anonymous";
        c.authorDisplayName ??= "Previous contributor (sample)";
        c.parentCommentId ??= null;
        c.reportCount ??= 0;
      }
      saved.reports ??= [];
      for (const report of accountReports)
        if (!saved.reports.some((r) => r.id === report.id))
          saved.reports.push(structuredClone(report));
      for (const report of saved.reports) {
        report.status ??= "open";
        report.reportedBy ??= "legacy-contributor";
        report.reviewedBy ??= null;
        report.reviewedAt ??= null;
      }
      saved.registrations = store
        .readLocal(store.storageKeys.legacyRegistrations, [])
        .map((r) => ({ ...r, ownerId: null }));
      saved.registrations.push(structuredClone(accountRegistration));
      saved.receipts = store
        .readLocal(store.storageKeys.legacyReceipts, [])
        .map((r) => ({ ...r, ownerId: null }));
      saved.favorites ??= { [residentId]: ["story-brushtail"] };
      saved.drafts ??= { [residentId]: structuredClone(accountDraft) };
      saved.commentHistory ??= [];
      saved.accountVersion = 1;
      changed = true;
    }
    return changed;
  });
}
function save(s) {
  store.saveDemo(s);
}
export function account() {
  return live ? auth()?.profile || null : localAuth.currentUser();
}
function requireAccount() {
  const user = account();
  if (!user) throw Error("Sign in to continue.");
  return user;
}
export function resetDemo() {
  if (live) throw Error("Demo reset is unavailable in connected mode.");
  requireModerator();
  save(initialState());
  store.removeLocal(store.storageKeys.legacyRegistrations);
  store.removeLocal(store.storageKeys.legacyReceipts);
}
export function logout() {
  store.writeSession(null);
  localAuth.signOut();
}
function auth() {
  return store.readSession();
}
export function moderatorSession() {
  return (
    account()?.role === "moderator" && (!live || Boolean(auth()?.access_token))
  );
}
function requireModerator() {
  if (!moderatorSession()) throw Error("Moderator access is required.");
  return account();
}
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const convert = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
async function request(path, options = {}) {
  const response = await fetch(config.supabaseUrl + path, {
    ...options,
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${auth()?.access_token || config.supabaseAnonKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok)
    throw Error(
      "The service is unavailable or access was refused. Please try again or sign in again.",
    );
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name, payload) =>
  request("/rest/v1/rpc/" + name, {
    method: "POST",
    body: JSON.stringify(payload),
  });
export async function login(email, password) {
  if (!live) return localAuth.signIn(email, password);
  const session = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  store.writeSession(session);
  try {
    const moderator = await request("/rest/v1/rpc/is_moderator", {
      method: "POST",
      body: "{}",
    });
    session.profile = {
      id: session.user.id,
      email: session.user.email,
      displayName:
        session.user.user_metadata?.display_name || "Community member",
      role: moderator === true ? "moderator" : "user",
    };
    store.writeSession(session);
    store.notify("wn-auth-change");
    return session.profile;
  } catch {
    logout();
    throw Error("Sign-in could not be completed. Please try again.");
  }
}
export async function stories() {
  if (!live) return state().stories.map(pickStory);
  return (
    await request("/rest/v1/public_stories?select=*&order=published_at.desc")
  )
    .map(convert)
    .map(pickStory);
}
export async function opportunities() {
  return live
    ? (await request("/rest/v1/opportunities?select=data")).map((x) => x.data)
    : state().opportunities;
}
export async function outcomes() {
  return live
    ? (await request("/rest/v1/outcomes?select=*&published=eq.true")).map(
        convert,
      )
    : state().outcomes.filter((x) => x.published);
}
export async function sources() {
  return live
    ? (await request("/rest/v1/information_sources?select=data")).map(
        (x) => x.data,
      )
    : state().sources;
}
export function validateObservation(o) {
  if (![...species.map((x) => x.id), "not-sure"].includes(o.possibleSpecies))
    throw Error("Choose a possible animal.");
  if (!areas.includes(o.publicArea) || !times.includes(o.approximateTime))
    throw Error("Choose a broad area and approximate time.");
  if (
    !o.behaviour?.trim() ||
    o.behaviour.length > 160 ||
    !o.description?.trim() ||
    o.description.length > 600 ||
    o.nickname?.length > 60
  )
    throw Error(
      "Add a short behaviour and description within the field limits.",
    );
}
export async function submit(o) {
  validateObservation(o);
  if (live) return rpc("submit_observation", { payload: o });
  const s = state();
  const receipt = {
    id: id(),
    removalToken: id(),
    status: o.injuryConcern ? "urgent" : "pending",
  };
  s.observations.push({
    ...o,
    authorId: account()?.id || null,
    ...receipt,
    sample: true,
    submittedAt: stamp(),
  });
  save(s);
  return receipt;
}
export async function removal(receipt, reason) {
  if (live)
    return rpc("request_removal", {
      observation_id: receipt.id,
      token: receipt.removalToken,
      reason,
    });
  const s = state();
  if (
    !s.observations.some(
      (o) => o.id === receipt.id && o.removalToken === receipt.removalToken,
    )
  )
    throw Error("Receipt unavailable.");
  s.removals.push({ observationId: receipt.id, reason, createdAt: stamp() });
  save(s);
}
export async function queue() {
  requireModerator();
  if (live)
    return {
      observations: (
        await request("/rest/v1/observations?select=*&order=submitted_at.desc")
      ).map(convert),
      records: (await request("/rest/v1/moderation_records?select=*")).map(
        convert,
      ),
      comments: (await request("/rest/v1/comments?select=*")).map(convert),
      reports: (await request("/rest/v1/comment_reports?select=*")).map(
        convert,
      ),
      removals: (await request("/rest/v1/removal_requests?select=*")).map(
        convert,
      ),
      commentHistory: (await request("/rest/v1/comment_actions?select=*")).map(
        convert,
      ),
    };
  const s = state();
  return {
    observations: s.observations,
    records: s.records,
    comments: s.comments,
    reports: s.reports,
    removals: s.removals,
    commentHistory: s.commentHistory,
  };
}
export const checks = ["face", "house", "plate", "location", "welfare"];
export async function moderate(p) {
  requireModerator();
  if (
    !["approve", "reject", "clarification", "urgent", "remove"].includes(
      p.action,
    )
  )
    throw Error("Choose a moderation action.");
  if (!p.reason?.trim() || p.reason.trim().length < 3)
    throw Error("Give a reason for this action.");
  if (
    p.action === "approve" &&
    (!checks.every((k) => p.privacyChecks[k]) ||
      !areas.includes(p.approvedPublicArea) ||
      !p.publicText?.trim() ||
      p.publicText.length > 600 ||
      p.publicText.trim().split(/\s+/).length > 60)
  )
    throw Error("Complete every privacy check and public field.");
  if (live) {
    await rpc("moderate_observation", { payload: p });
    if (
      ["remove", "reject"].includes(p.action) ||
      (p.action === "approve" && !p.mediaApproved)
    )
      await deleteMedia(p.originalMedia).catch(() => {});
    return;
  }
  const s = state(),
    o = s.observations.find((x) => x.id === p.id);
  if (!o) throw Error("Observation unavailable.");
  const existingStory = s.stories.find((x) => x.sourceObservationId === o.id);
  const publicStoryId = existingStory?.id || o.publicStoryId || id();
  s.stories = s.stories.filter((x) => x.sourceObservationId !== o.id);
  if (p.action === "approve") {
    const sp = species.find((x) => x.id === p.approvedSpecies);
    s.stories.unshift(
      pickStory({
        id: publicStoryId,
        sourceObservationId: o.id,
        contentType: "neighbour-observation",
        species: p.approvedSpecies,
        publicArea: p.approvedPublicArea,
        approximateTime: o.approximateTime,
        behaviour: "Reviewed observation",
        storyText: p.publicText,
        mediaUrl: p.mediaApproved ? o.mediaUrl : null,
        verifiedFact:
          sp?.fact ||
          "Identification uncertain. Observe safely from a distance.",
        factSource: sp?.source || "",
        reviewedBy: account().displayName,
        publishedAt: stamp(),
        sample: true,
      }),
    );
  }
  if (p.action === "approve") o.publicStoryId = publicStoryId;
  o.status =
    { approve: "approved", reject: "rejected", remove: "removed" }[p.action] ||
    p.action;
  if (
    ["remove", "reject"].includes(p.action) ||
    (p.action === "approve" && !p.mediaApproved)
  )
    o.mediaUrl = null;
  s.records.push({
    ...p,
    id: id(),
    moderatorId: account().id,
    moderatorName: account().displayName,
    createdAt: stamp(),
  });
  save(s);
}
const commentProjection = (c) =>
  Object.fromEntries(
    [
      "id",
      "storyId",
      "parentCommentId",
      "authorId",
      "authorDisplayName",
      "body",
      "status",
      "reportCount",
      "createdAt",
      "updatedAt",
    ].map((k) => [k, c[k] ?? null]),
  );
export async function comments(storyId) {
  if (live)
    return (
      await request(
        "/rest/v1/comments?select=id,story_id,parent_comment_id,author_id,author_display_name,body,status,report_count,created_at,updated_at&story_id=eq." +
          encodeURIComponent(storyId) +
          "&status=eq.visible",
      )
    ).map(convert);
  const s = state();
  if (!s.stories.some((x) => x.id === storyId)) return [];
  return s.comments
    .filter(
      (c) =>
        c.storyId === storyId && c.status === "visible" && !c.authorDeleted,
    )
    .map(commentProjection);
}
export async function addComment(
  storyId,
  body,
  parentCommentId = null,
  acknowledged = false,
) {
  const user = requireAccount();
  body = requireSafeComment(body, acknowledged);
  if (live)
    return rpc("create_direct_comment", {
      story_id: storyId,
      body,
      parent_comment_id: parentCommentId,
    });
  const s = state();
  if (!s.stories.some((x) => x.id === storyId))
    throw Error("Story unavailable.");
  if (
    parentCommentId &&
    !s.comments.some(
      (c) =>
        c.id === parentCommentId &&
        c.storyId === storyId &&
        c.status === "visible",
    )
  )
    throw Error("The comment you are replying to is unavailable.");
  const c = {
    id: id(),
    storyId,
    parentCommentId,
    authorId: user.id,
    authorDisplayName: user.displayName,
    body,
    status: "visible",
    reportCount: 0,
    createdAt: stamp(),
    updatedAt: null,
  };
  s.comments.push(c);
  save(s);
  return commentProjection(c);
}
export async function editComment(commentId, body, acknowledged = false) {
  const user = requireAccount();
  body = requireSafeComment(body, acknowledged);
  if (live) return rpc("edit_own_comment", { comment_id: commentId, body });
  const s = state(),
    c = s.comments.find((c) => c.id === commentId);
  if (!c || c.authorId !== user.id || c.status !== "visible")
    throw Error("You can only edit your own visible comment.");
  c.body = body;
  c.updatedAt = stamp();
  save(s);
}
export async function deleteComment(commentId) {
  const user = requireAccount();
  if (live) return rpc("delete_own_comment", { comment_id: commentId });
  const s = state(),
    c = s.comments.find((c) => c.id === commentId);
  if (!c || c.authorId !== user.id)
    throw Error("You can only delete your own comment.");
  c.status = "removed";
  c.authorDeleted = true;
  c.updatedAt = stamp();
  save(s);
}
export async function reportComment(commentId, reason, details = "") {
  const user = requireAccount();
  if (!reportReasons.includes(reason) || details.length > 500)
    throw Error(
      "Choose a reporting reason and keep details under 500 characters.",
    );
  if (live)
    return rpc("report_direct_comment", {
      comment_id: commentId,
      reason,
      details,
    });
  const s = state(),
    c = s.comments.find((c) => c.id === commentId);
  if (!c || c.status !== "visible" || c.authorId === user.id)
    throw Error("You can only report another person’s visible comment.");
  if (
    s.reports.some(
      (r) =>
        r.commentId === commentId &&
        r.reportedBy === user.id &&
        r.status === "open",
    )
  )
    throw Error("You have already reported this comment.");
  s.reports.push({
    id: id(),
    commentId,
    reportedBy: user.id,
    reason,
    details,
    status: "open",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: stamp(),
  });
  c.reportCount = (c.reportCount || 0) + 1;
  save(s);
}
export async function moderateComment(commentId, action, reason = "") {
  const user = requireModerator();
  if (!["remove", "restore"].includes(action))
    throw Error("Choose remove or restore.");
  if (action === "remove" && reason.trim().length < 3)
    throw Error("Enter a reason for removing this comment.");
  if (live)
    return rpc("moderate_direct_comment", {
      comment_id: commentId,
      action,
      reason,
    });
  const s = state(),
    c = s.comments.find((c) => c.id === commentId);
  if (!c) throw Error("Comment unavailable.");
  if (c.authorDeleted && action === "restore")
    throw Error("A comment deleted by its author cannot be restored.");
  c.status = action === "remove" ? "removed" : "visible";
  c.removalReason = action === "remove" ? reason : null;
  c.updatedAt = stamp();
  for (const report of s.reports.filter(
    (r) => r.commentId === commentId && r.status === "open",
  )) {
    report.status = "actioned";
    report.reviewedBy = user.id;
    report.reviewedAt = stamp();
  }
  s.commentHistory.push({
    id: id(),
    commentId,
    moderatorId: user.id,
    action,
    reason: reason || "Restored after review",
    createdAt: stamp(),
  });
  save(s);
}
export async function dismissReport(reportId) {
  const user = requireModerator();
  if (live) return rpc("dismiss_comment_report", { report_id: reportId });
  const s = state(),
    r = s.reports.find((r) => r.id === reportId);
  if (!r) throw Error("Report unavailable.");
  r.status = "dismissed";
  r.reviewedBy = user.id;
  r.reviewedAt = stamp();
  s.commentHistory.push({
    id: id(),
    commentId: r.commentId,
    moderatorId: user.id,
    action: "dismiss-report",
    reason: "Report reviewed; no removal required.",
    createdAt: stamp(),
  });
  save(s);
}
export async function myObservations() {
  const user = requireAccount();
  if (live) return (await rpc("my_observations", {})).map(convert);
  return state()
    .observations.filter((o) => o.authorId === user.id)
    .map((o) =>
      Object.fromEntries(
        [
          "id",
          "possibleSpecies",
          "publicArea",
          "approximateTime",
          "behaviour",
          "description",
          "status",
          "submittedAt",
          "aiAssisted",
        ].map((k) => [k, o[k] ?? null]),
      ),
    );
}
export async function savedStories() {
  const user = requireAccount();
  const ids = state().favorites[user.id] || [];
  return (await stories()).filter((story) => ids.includes(story.id));
}
export function toggleSaved(storyId) {
  const user = requireAccount(),
    s = state();
  s.favorites[user.id] ??= [];
  const list = s.favorites[user.id];
  s.favorites[user.id] = list.includes(storyId)
    ? list.filter((id) => id !== storyId)
    : [...list, storyId];
  save(s);
}
export function registrationList() {
  const owner = account()?.id || null;
  return state().registrations.filter((r) => (r.ownerId || null) === owner);
}
export function saveRegistrations(records) {
  const owner = account()?.id || null,
    s = state();
  const other = s.registrations.filter((r) => (r.ownerId || null) !== owner);
  for (const r of records) {
    const existing = s.registrations.find((x) => x.id === r.id);
    if (existing && (existing.ownerId || null) !== owner)
      throw Error("You cannot change another person’s registration.");
  }
  s.registrations = [
    ...other,
    ...records.map((r) => ({ ...r, ownerId: owner })),
  ];
  save(s);
}
export function receipts() {
  const owner = account()?.id || null;
  return state().receipts.filter((r) => (r.ownerId || null) === owner);
}
export function keepReceipt(receipt) {
  const s = state();
  s.receipts.push({ ...receipt, ownerId: account()?.id || null });
  save(s);
}
export function writingDraft() {
  const user = requireAccount();
  return state().drafts[user.id] || null;
}
export function saveWritingDraft(draft) {
  const user = requireAccount(),
    s = state();
  s.drafts[user.id] = { ...draft, status: "draft" };
  save(s);
}
export async function saveOpportunity(o) {
  requireModerator();
  if (live)
    return request("/rest/v1/opportunities", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: o.id, data: o }),
    });
  const s = state();
  s.opportunities = s.opportunities.filter((x) => x.id !== o.id);
  s.opportunities.push(o);
  save(s);
}
export async function saveSource(source) {
  requireModerator();
  if (live)
    return request("/rest/v1/information_sources", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: source.id, data: source }),
    });
  const s = state();
  s.sources = s.sources.filter((x) => x.id !== source.id);
  s.sources.push(source);
  save(s);
}
export async function saveOutcome(o) {
  requireModerator();
  if (live) return rpc("publish_outcome", { payload: o });
  const s = state();
  s.outcomes.unshift({ ...o, id: id(), noWildlifeHandling: true });
  const activity = s.opportunities.find((x) => x.id === o.opportunityId);
  if (activity) {
    activity.status = "completed";
    activity.registrationOpen = false;
  }
  save(s);
}
// Re-encode images to strip metadata and disallow active SVG/HTML uploads.
export async function prepareImage(file) {
  if (file.size > 5 * 1024 * 1024)
    throw Error("Choose a photograph or short video under 5 MB.");
  let source,
    release = () => {};
  if (["video/mp4", "video/webm"].includes(file.type)) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    source = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(Error("Video could not be decoded. Try a photograph."));
      }, 10000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve(video);
      };
      video.onerror = () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        reject(Error("Video could not be decoded. Try a photograph."));
      };
      video.src = url;
    });
    release = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
  } else {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw Error("Choose a JPEG, PNG, WebP, MP4 or WebM file.");
    source = await createImageBitmap(file);
    release = () => source.close();
  }
  const width = source.videoWidth || source.width,
    height = source.videoHeight || source.height;
  const scale = Math.min(1, 1200 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  release();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error("Media could not be prepared."))),
      "image/jpeg",
      0.82,
    ),
  );
}
export async function uploadImage(blob) {
  if (!live)
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(Error("Image could not be stored."));
      r.readAsDataURL(blob);
    });
  const path = id() + ".jpg";
  await request("/storage/v1/object/pending-media/" + path, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  return path;
}
export async function pendingMedia(path) {
  requireModerator();
  if (!path) return null;
  if (!live) return path;
  const result = await request(
    "/storage/v1/object/sign/pending-media/" + path,
    { method: "POST", body: JSON.stringify({ expiresIn: 120 }) },
  );
  return config.supabaseUrl + "/storage/v1" + result.signedURL;
}
export async function approveMedia(path) {
  requireModerator();
  if (!live) return path;
  const signed = await pendingMedia(path);
  const response = await fetch(signed);
  if (!response.ok) throw Error("Media unavailable.");
  const blob = await prepareImage(
    new File([await response.blob()], "reviewed.jpg", { type: "image/jpeg" }),
  );
  await request("/storage/v1/object/approved-media/" + path, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: blob,
  });
  return path;
}
async function deleteMedia(path) {
  if (!live || !path) return;
  await request("/storage/v1/object/pending-media", {
    method: "DELETE",
    body: JSON.stringify({ prefixes: [path] }),
  });
  await request("/storage/v1/object/approved-media", {
    method: "DELETE",
    body: JSON.stringify({ prefixes: [path] }),
  });
}
export function publicImage(path) {
  if (!path) return null;
  return live && /^[a-f0-9-]{36}\.jpg$/.test(path)
    ? config.supabaseUrl + "/storage/v1/object/public/approved-media/" + path
    : path;
}
