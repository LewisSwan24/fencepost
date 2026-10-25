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
    observations: structuredClone(observationSamples),
    stories: structuredClone(sampleStories),
    opportunities: [
      ...structuredClone(sampleOpportunities),
      structuredClone(historicOpportunity),
    ],
    outcomes: structuredClone(sampleOutcomes),
    catalogVersion: 3,
    records: [],
    comments: [],
    reports: [],
    removals: [],
    sources: [],
  };
}
function state() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return initialState();
    if (saved.catalogVersion !== 3) {
      // Add exhibition records without deleting submissions, moderation or registrations.
      for (const seed of sampleOpportunities) {
        const found = saved.opportunities.find((o) => o.id === seed.id);
        if (found) {
          found.image = seed.image;
        } else saved.opportunities.push(structuredClone(seed));
      }
      for (const seed of sampleOutcomes)
        if (!saved.outcomes.some((o) => o.id === seed.id))
          saved.outcomes.push(structuredClone(seed));
      for (const seed of sampleStories) {
        const found = saved.stories.find((o) => o.id === seed.id && o.sample);
        if (found) found.mediaUrl = seed.mediaUrl;
      }
      saved.catalogVersion = 3;
      localStorage.setItem(KEY, JSON.stringify(saved));
    }
    return saved;
  } catch {
    throw Error(
      "Demo storage is unavailable. Enable browser storage and try again.",
    );
  }
}
function save(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("wn-data"));
}
export function resetDemo() {
  if (live) throw Error("Demo reset is unavailable in connected mode.");
  localStorage.removeItem(KEY);
  sessionStorage.removeItem("wn-demo-moderator");
  window.dispatchEvent(new Event("wn-data"));
}
export function demoLogin() {
  if (live) throw Error("Use moderator sign-in.");
  sessionStorage.setItem("wn-demo-moderator", "true");
}
export function logout() {
  sessionStorage.removeItem("wn-auth");
  sessionStorage.removeItem("wn-demo-moderator");
}
function auth() {
  try {
    return JSON.parse(sessionStorage.getItem("wn-auth"));
  } catch {
    return null;
  }
}
export function moderatorSession() {
  return live
    ? Boolean(auth()?.access_token)
    : sessionStorage.getItem("wn-demo-moderator") === "true";
}
function requireModerator() {
  if (!moderatorSession()) throw Error("Moderator sign-in required.");
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
  const session = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  sessionStorage.setItem("wn-auth", JSON.stringify(session));
  try {
    const result = await request("/rest/v1/rpc/is_moderator", {
      method: "POST",
      body: "{}",
    });
    if (result !== true) throw Error("No moderator role");
  } catch {
    logout();
    throw Error("This account does not have moderator access.");
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
  s.observations.push({ ...o, ...receipt, sample: true, submittedAt: stamp() });
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
    };
  const s = state();
  return {
    observations: s.observations,
    records: s.records,
    comments: s.comments,
    reports: s.reports,
    removals: s.removals,
  };
}
export const checks = ["face", "house", "plate", "location", "welfare"];
export async function moderate(p) {
  requireModerator();
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
  s.stories = s.stories.filter((x) => x.sourceObservationId !== o.id);
  if (p.action === "approve") {
    const sp = species.find((x) => x.id === p.approvedSpecies);
    s.stories.unshift(
      pickStory({
        id: id(),
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
        reviewedBy: config.reviewerOrganisation,
        publishedAt: stamp(),
        sample: true,
      }),
    );
  }
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
    moderatorId: "demo-moderator",
    createdAt: stamp(),
  });
  save(s);
}
export async function comments(storyId) {
  return live
    ? (
        await request(
          "/rest/v1/comments?select=id,story_id,body,status,created_at&story_id=eq." +
            encodeURIComponent(storyId) +
            "&status=eq.approved",
        )
      ).map(convert)
    : state().comments.filter(
        (x) => x.storyId === storyId && x.status === "approved",
      );
}
export async function addComment(storyId, body) {
  if (!body.trim() || body.length > 500)
    throw Error("Write a comment of 1–500 characters.");
  if (live) return rpc("submit_comment", { story_id: storyId, body });
  const s = state();
  if (!s.stories.some((x) => x.id === storyId))
    throw Error("Story unavailable.");
  s.comments.push({
    id: id(),
    storyId,
    body,
    status: "pending",
    createdAt: stamp(),
  });
  save(s);
}
export async function reportComment(commentId, reason) {
  if (live) return rpc("report_comment", { comment_id: commentId, reason });
  const s = state();
  s.reports.push({ id: id(), commentId, reason, createdAt: stamp() });
  save(s);
}
export async function moderateComment(commentId, status) {
  requireModerator();
  if (live)
    return request("/rest/v1/comments?id=eq." + encodeURIComponent(commentId), {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  const s = state();
  const c = s.comments.find((c) => c.id === commentId);
  if (c) c.status = status;
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
