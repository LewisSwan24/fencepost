import * as api from "./api.js";
import { config } from "./config.js";
import {
  species,
  areas,
  times,
  opportunity,
  isVerifiedOpportunity,
} from "./data.js";
import {
  esc,
  asset,
  name,
  opts,
  image,
  button,
  sourceLink,
  setupImages,
  modeNote,
} from "./ui.js";
import { demoAccounts, demoAccountNotice } from "./demo-accounts.js";
import { checkComment, reportReasons } from "./comment-safety.js";
import {
  demoWritingHelp,
  validateWritingInput,
  validatedSuggestion,
} from "./writing.js";
import { mountActivity } from "./activities.js";
import { opportunityCard, outcomeCard, outcomeDetail } from "./presentation.js";
const CHECK_LABELS = {
  face: "Faces and children checked",
  house: "House numbers checked",
  plate: "Number plates checked",
  location: "Exact location removed from public wording",
  welfare: "Animal welfare risk checked",
};
export async function mount(
  root,
  { writingHelp = demoWritingHelp, writingMode = "prewritten-demo" } = {},
) {
  let writerController,
    writerOriginal = null,
    writerVariant = 0,
    writerGeneration = 0,
    aiApplied = false,
    requestOriginal = "";
  let replyTo = null,
    editingComment = null,
    reportingComment = null,
    commentDraft = "";
  let activityCleanup;
  let disposed = false,
    version = 0,
    draft = {},
    photo = null,
    photoBlob = null,
    reviewing = false,
    lastReceipt = null,
    editRegistration = null,
    queueData = null;
  const $ = (s) => root.querySelector(s);
  const hash = () => location.hash.slice(1) || "stories";
  const go = (h) => {
    location.hash = h;
  };
  const feedback = (text, error = false) => {
    const target = $("#feedback");
    if (target) {
      target.textContent = text;
      target.setAttribute("role", error ? "alert" : "status");
      target.focus();
    }
  };
  const field = (label, key, type = "text", value = "", extra = "") =>
    `<label>${label}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}><span class="field-error" data-error="${key}" aria-live="polite"></span></label>`;
  const select = (label, key, values, value) =>
    `<label>${label}<select name="${key}">${opts(values, value)}</select><span class="field-error" data-error="${key}" aria-live="polite"></span></label>`;
  const text = (label, key, value = "", max = 600) =>
    `<label>${label}<textarea name="${key}" maxlength="${max}" required>${esc(value)}</textarea><span class="field-error" data-error="${key}" aria-live="polite"></span></label>`;
  const tick = (label, key) =>
    `<label class="tick"><input type="checkbox" name="${key}" required aria-describedby="error-${key}">${label}<span id="error-${key}" class="field-error" data-error="${key}" aria-live="polite"></span></label>`;
  function storeReceipt(r) {
    api.keepReceipt(r);
  }
  function regs() {
    return api.registrationList();
  }
  function putRegs(records) {
    api.saveRegistrations(records);
  }
  function authHeader() {
    const user = api.account();
    return user
      ? `<div class="account-header"><span>◉ ${esc(user.displayName)} <small>${user.role === "moderator" ? "Moderator" : "Resident"}</small></span><a href="#${user.role === "moderator" ? "moderator" : "profile"}">${user.role === "moderator" ? "Moderator dashboard" : "My activity"}</a>${button("Logout", "logout")}</div>`
      : '<div class="account-header"><a href="#stories">◇ Browse</a><a href="#login">↪ Sign in</a></div>';
  }
  function loginHtml() {
    return `<section class="login-panel"><p class="eyebrow">Fencepost / Exhibition accounts</p><h1>Sign in to Fencepost</h1><p>${demoAccountNotice}</p><form id="account-login" novalidate>${field("Email", "email", "email", "", 'required autocomplete="username"')}${field("Password", "password", "password", "", 'required autocomplete="off"')}${button("Show password", "toggle-password", 'aria-pressed="false"')}<p id="login-error" role="alert"></p><button type="submit">Sign in</button></form>${button("Continue browsing as guest", "guest")}<details class="demo-accounts" open><summary>Demonstration accounts</summary>${demoAccounts.map((a) => `<article><strong>${esc(a.role === "moderator" ? "Moderator" : "Community user")} · ${esc(a.displayName)}</strong><p>${esc(a.email)}<br>Password: <code>${esc(a.password)}</code></p>${button(a.role === "moderator" ? "Use moderator account" : "Use resident account", "fill-account", `data-id="${a.id}"`)}</article>`).join("")}<p class="small">Hardcoded accounts protect only the prototype interface. They are not production-level security. Do not enter real personal information.</p>${api.live ? '<p class="notice">This connected instance uses Supabase accounts. Hardcoded accounts apply only to local demo data and never grant backend access.</p>' : ""}</details></section>`;
  }
  async function profileHtml(section) {
    const user = api.account(),
      observations = await api.myObservations();
    if (section === "my-observations")
      return `<h1>My observations</h1><p>Your own public wording and status only. Private rescue details and moderator notes are not shown.</p>${observations.map((o) => `<article class="notice"><span class="status-label">${{ pending: "Awaiting review", approved: "Approved", rejected: "Rejected", urgent: "Urgent", clarification: "Clarification requested", removed: "Removed" }[o.status] || esc(o.status)}</span><h2>Possible ${esc(name(o.possibleSpecies))}</h2><p>${esc(o.description)}</p><p>${esc(o.publicArea)} · ${esc(o.approximateTime)}</p></article>`).join("") || "<p>You have not submitted any observations yet.</p>"}<a class="link-button" href="#share">Share an observation</a>`;
    const saved = await api.savedStories(),
      writingDraft = api.writingDraft();
    return `<p class="eyebrow">Resident activity / Private demonstration view</p><h1>Hello, ${esc(user.displayName)}</h1><p>${esc(user.email)} · ${user.role === "moderator" ? "Moderator" : "Community user"}</p><nav class="activity-menu"><a href="#my-observations">My observations (${observations.length}) →</a><a href="#registrations">My prototype volunteer registrations →</a><a href="#share">Share an observation →</a></nav><h2>Saved wildlife stories</h2>${saved.map((story) => storyCard(story)).join("") || "<p>No saved stories yet. Open an approved story to save it.</p>"}${writingDraft ? `<section class="notice"><p class="status-label">AI-assisted draft · Not submitted</p><h2>A writing draft to continue</h2><p>${esc(writingDraft.description)}</p>${button("Continue draft", "continue-draft")}</section>` : ""}${button("Logout", "logout")}`;
  }
  function discussionHtml(storyId, comments) {
    const user = api.account();
    return `<section class="discussion"><h2>Discussion</h2><p>Share experiences respectfully. Do not include exact wildlife locations or personal information.</p><p class="small">Comments appear immediately after validation. Automated checks are imperfect; reporting and human moderation remain available.</p><div class="comment-list">${comments.map((c) => `<article class="comment-card" id="comment-${esc(c.id)}"><header><strong>${esc(c.authorDisplayName || "Community member")}</strong><span>${c.updatedAt ? "Updated" : "Comment"}</span></header>${c.parentCommentId ? `<p class="small">↳ Reply to ${esc(comments.find((parent) => parent.id === c.parentCommentId)?.authorDisplayName || "a comment that is no longer visible")}</p>` : ""}<p>${esc(c.body)}</p><div class="comment-actions">${user ? button("Reply", "reply-comment", `data-id="${esc(c.id)}"`) : ""}${user?.id === c.authorId ? button("Edit", "edit-comment", `data-id="${esc(c.id)}"`) + button("Delete", "delete-comment", `data-id="${esc(c.id)}"`) : button("Report", "report", `data-id="${esc(c.id)}"`) + ""}</div></article>`).join("") || "<p>No comments yet.</p>"}</div>${user ? `<form id="comment-form" data-story="${esc(storyId)}"><p id="reply-state">${replyTo ? "Replying to a comment." : ""}${editingComment ? "Editing your comment." : ""}</p>${text("Your comment", "body", commentDraft, 500)}<div id="comment-validation" role="alert"></div><label class="tick"><input type="checkbox" name="warningAcknowledged">I checked any caution shown and want to post this wording.</label><button>${editingComment ? "Save comment" : "Post comment"}</button>${button("Cancel reply or edit", "cancel-comment")}</form>` : '<p><a class="link-button" href="#login">Sign in to comment</a> Guests can read the discussion.</p>'}${reportingComment ? `<form id="report-form"><h3>Report a comment</h3>${select("Reason", "reason", reportReasons)}${field("Details (optional)", "details", "text", "", 'maxlength="500"')}<button>Send report</button>${button("Cancel", "cancel-report")}</form>` : ""}</section>`;
  }
  function storyCard(s, featured = false) {
    return `<article class="mobile-card ${featured ? "featured-story" : ""}">${image(api.publicImage(s.mediaUrl) || species.find((x) => x.id === s.species)?.image || "illustration:park", `Possible ${name(s.species)}`)}<div class="card-body"><p class="status-label observation-label">Neighbour Observation ${s.sample ? "· Sample" : ""}</p><h${featured ? "2" : "3"}>Possible ${esc(name(s.species))}</h${featured ? "2" : "3"}><p class="card-meta">${esc(s.publicArea)} · ${esc(s.approximateTime)}</p><p>${esc(s.storyText)}</p><p class="review-label">Approved for Public Display · Reviewed by ${esc(s.reviewedBy)}</p><a class="link-button" href="#story/${esc(s.id)}">Read story →</a></div></article>`;
  }
  function homeHtml(all, opportunities, updates) {
    return `<section class="phone-intro"><p class="eyebrow">Your local park / Everyone is welcome</p><h1>Wildlife stories from your neighbourhood</h1><p>Read moderated community observations, learn how to respond responsibly and discover optional ways to care for local habitat.</p><a class="secondary-button" href="#share">Share an observation →</a></section><section aria-labelledby="featured-title"><div class="section-heading"><h2 id="featured-title">A moment nearby</h2><span>Featured local story</span></div>${all.length ? storyCard(all[0], true) : "<p>No approved stories are available yet.</p>"}</section><section class="guidance-card"><p class="status-label guidance-label">Safe Response · professional sources</p><h2>What should I do?</h2><p>Keep your distance. Do not touch, feed or chase wildlife. Read practical guidance before you need it.</p><div class="guidance-shortcuts"><a href="#help/injured">Injured animal →</a><a href="#help/trapped">Trapped animal →</a><a href="#help/road">Near a road →</a><a href="#help/unsure">I’m not sure →</a></div><p class="small">Official references are separate from residents’ observations. Current contact verification remains required.</p></section><section class="feed-section"><div class="section-heading"><h2>Recent wildlife stories</h2><span>Read. Notice. Leave space.</span></div><div class="story-grid">${
      all
        .slice(1)
        .map((story) => storyCard(story))
        .join("") || "<p>No other approved stories yet.</p>"
    }</div></section><section class="feed-section community-preview"><p class="eyebrow">Optional ways to care</p><h2>Volunteer in your neighbourhood</h2><p>Habitat care, at your own pace. Volunteers never handle wildlife.</p><div class="opportunity-grid">${
      opportunities
        .filter((o) => o.status !== "completed")
        .map((o) => opportunityCard(o, "#opportunity/" + o.id))
        .join("") || "<p>No current activities.</p>"
    }</div></section><section class="feed-section"><div class="section-heading"><h2>Community Updates</h2><a href="#updates">All updates →</a></div><p>Fictional exhibition samples show how community care could be shared.</p><div class="update-grid">${updates
      .filter((o) => o.id !== "outcome-demo")
      .map((o) => outcomeCard(o, "#update/" + o.id))
      .join("")}</div></section>`;
  }
  function clearEditor() {
    writerController?.abort();
    writerGeneration++;
    draft = {};
    queueData = null;
    writerOriginal = null;
    aiApplied = false;
    editRegistration = null;
    replyTo = null;
    editingComment = null;
    reportingComment = null;
    commentDraft = "";
    if (photo) URL.revokeObjectURL(photo);
    photo = null;
    photoBlob = null;
  }
  const writingNotice =
    "AI can help organise your writing, but it may make mistakes. Check the wording before submitting.";
  function writingPanel() {
    const input = $("#observation-form [name=description]");
    if (!api.account()) {
      go("login/share");
      return;
    }
    const original = input.value;
    validateWritingInput(original);
    requestOriginal = original;
    if (writerOriginal === null) writerOriginal = original;
    $("#writing-panel").innerHTML =
      `<section class="writing-helper" aria-labelledby="writing-title"><h2 id="writing-title">Ask AI for writing help</h2><p>${writingNotice}</p><p class="status-label">${writingMode === "prewritten-demo" ? "Local prewritten demonstration — no live AI request" : writingMode === "legacy-fixture" ? "Existing Fencepost fixture writer — local demonstration" : "Existing Fencepost writing service"}</p><label>Original text<textarea id="writer-original" readonly>${esc(original)}</textarea></label><p class="small">Only this description is used. Uploaded media and private rescue fields are never sent. Do not include exact locations or personal information.</p><label class="tick"><input id="writer-consent" type="checkbox">I agree to request optional writing help with this description only.</label>${button("Prepare writing suggestion", "request-writing")}${button("Cancel", "cancel-writing")}<div id="writer-result" role="status"></div></section>`;
    $("#writing-title").setAttribute("tabindex", "-1");
    $("#writing-title").focus();
  }
  async function requestWriting() {
    if (!$("#writer-consent")?.checked) {
      $("#writer-result").textContent =
        "Confirm that you want writing help for this description only.";
      return;
    }
    validateWritingInput(requestOriginal);
    writerController?.abort();
    writerController = new AbortController();
    const generation = ++writerGeneration;
    $("#writer-result").innerHTML =
      '<p role="status">Preparing a writing suggestion…</p>';
    try {
      const raw = await writingHelp({
        text: requestOriginal,
        variant: writerVariant++,
        signal: writerController.signal,
      });
      if (generation !== writerGeneration || !$("#writer-result")) return;
      const result = validatedSuggestion(raw, requestOriginal);
      $("#writer-result").innerHTML =
        `<p>Review this suggestion before adding it to your post.</p><label>Suggested version — editable<textarea id="writer-suggestion" maxlength="600">${esc(result.suggestion)}</textarea></label>${result.question ? `<p class="small">${esc(result.question)}</p>` : ""}<p class="small">Possible animal — not confirmed. This wording is not verified wildlife information.</p><label class="tick"><input id="writer-confirm" type="checkbox">I checked the final wording and want to use it as my draft.</label>${button("Use suggestion", "use-writing")}${button("Edit suggestion", "edit-writing")}${button("Try another suggestion", "request-writing")}${button("Keep original", "keep-original")}`;
    } catch (err) {
      if (generation !== writerGeneration || writerController.signal.aborted)
        return;
      $("#writer-result").innerHTML =
        '<p role="alert">Writing help is unavailable right now. You can continue editing and submit your own description.</p>';
    }
  }
  async function render() {
    activityCleanup?.();
    activityCleanup = null;
    writerController?.abort();
    writerGeneration++;
    const current = ++version;
    const requested = hash(),
      sectionRequested = requested.split("/")[0],
      user = api.account();
    if (sectionRequested === "moderator" && !user) {
      root.innerHTML = "<p>Redirecting to sign in…</p>";
      go("login/" + encodeURIComponent(requested));
      return;
    }
    if (sectionRequested === "moderator" && user.role !== "moderator") {
      root.innerHTML = "<p>Moderator access is required.</p>";
      go("denied");
      return;
    }
    if (["profile", "my-observations"].includes(sectionRequested) && !user) {
      root.innerHTML = "<p>Redirecting to sign in…</p>";
      go("login/" + sectionRequested);
      return;
    }

    root.innerHTML = `<div class="fencepost-app"><header class="mobile-header"><a href="#stories" class="brand">Fencepost<span> ●</span></a><span>Wildlife Neighbours</span></header>${authHeader()}${modeNote(api.live)}<nav class="mobile-nav" aria-label="Fencepost navigation">${["Stories", "Learn", "Share", "Help", "Community"].map((n) => `<a href="#${n.toLowerCase()}">${n}</a>`).join("")}</nav><main class="mobile-main"><div id="feedback" tabindex="-1" role="status"></div><div id="content"><p>Loading…</p></div></main><footer><a href="#login">Sign in</a><a href="#receipts">My submission receipts</a><a href="#credits">Image credits</a><a href="${asset("index.html")}">Public display</a></footer></div>`;
    try {
      const route = hash(),
        [section, param] = route.split("/");
      let html = "";
      if (section === "login") {
        html = loginHtml();
      } else if (section === "denied") {
        html =
          '<h1>Moderator access is required.</h1><p>This page is available only to the moderator account.</p><a class="link-button" href="#profile">Return to my activity</a>';
      } else if (["profile", "my-observations"].includes(section)) {
        html = await profileHtml(section);
      } else if (section === "stories") {
        const [all, opportunities, updates] = await Promise.all([
          api.stories(),
          api.opportunities(),
          api.outcomes(),
        ]);
        html = homeHtml(all, opportunities, updates);
      } else if (section === "story") {
        const s = (await api.stories()).find((x) => x.id === param);
        if (!s)
          html =
            "<h1>Story unavailable</h1><p>This observation is still being reviewed or has been removed.</p>";
        else {
          const sp = species.find((x) => x.id === s.species);
          const comments = await api.comments(s.id);
          html = `<a href="#stories">← Stories</a><h1>Possible ${esc(name(s.species))}</h1>${image(api.publicImage(s.mediaUrl) || sp?.image, name(s.species), "detail-image")}<p class="status-label observation-label">Neighbour Observation ${s.sample ? "· Sample" : ""}</p><h2>Resident observation</h2><p>${esc(s.storyText)}</p><p>${esc(s.publicArea)} · ${esc(s.approximateTime)}</p><h2>Wildlife information</h2><p>${esc(s.verifiedFact)}</p>${sourceLink(s.factSource)}<p class="small">Reference information; source review status: ${esc(sp?.sourceStatus || "Review needed")}.</p><h2>Safe Response</h2><p>Observe from a distance. Do not approach, feed or handle wildlife.</p><h2>Public privacy information</h2><p>Contributor identity removed · Broad area only · Images reviewed before publication · Private details removed.</p><p>Reviewed by ${esc(s.reviewedBy)}</p>${api.account() ? button("Save / unsave story", "save-story", `data-id="${esc(s.id)}"`) : ""}${discussionHtml(s.id, comments)}`;
        }
      } else if (section === "learn") {
        html = `<h1>Meet the animal</h1>${species.map((s) => `<article class="mobile-card">${image(s.image, s.name)}<div><h2>${esc(s.name)}</h2><p>${esc(s.fact)}</p><a href="#species/${s.id}">Learn together →</a></div></article>`).join("")}`;
      } else if (section === "species") {
        const s = species.find((x) => x.id === param) || species[0];
        html = `<a class="return-link" href="#learn">← Return to previous screen</a><h1>${esc(s.name)}</h1>${image(s.image, s.name, "detail-image")}<p><i>${esc(s.scientific)}</i></p><dl><dt>Active time</dt><dd>${esc(s.active)}</dd><dt>Habitat</dt><dd>${esc(s.habitat)}</dd><dt>Behaviour</dt><dd>${esc(s.behaviour)}</dd></dl><p class="notice"><strong>Safe Response</strong><br>${esc(s.advice)}</p><h2>Wildlife fact · source linked</h2><p>${esc(s.fact)}</p>${sourceLink(s.source)}<p class="small">${esc(s.sourceStatus)}</p><a class="link-button" href="#activity/${s.id}">Start a mini quiz together →</a>`;
      } else if (section === "activity") {
        const s = species.find((x) => x.id === param) || species[0];
        html = '<h1 class="quiz-page-heading">Meet the Animal quiz</h1><div id="activity-root"></div>';
      } else if (section === "share") {
        html = `<h1>Share an observation</h1><p>Text is enough. A photograph and nickname are optional. No account needed.</p><p class="notice">Observe from a safe distance. Do not approach, follow, feed or disturb wildlife to create a post. If driving, submit only after parking safely.</p><p>Is the animal injured or trapped? <a href="#rescue">Animal Needs Help →</a></p>${submissionForm(false)}`;
      } else if (section === "rescue") {
        html = `<h1>Animal Needs Help</h1><p class="notice">This form does not dispatch rescue assistance and is not monitored for emergencies. <a href="#help">Read safety guidance and contact a wildlife organisation directly.</a></p><p>Exact location is shared privately only to support an appropriate response. In local demo mode, use fictional details only.</p>${submissionForm(true)}`;
      } else if (section === "preview") {
        html = `<h1>This is what may become public after review</h1><article class="notice"><p>Public nickname preference: ${esc(draft.nickname || "Anonymous")} (removed from public-display stories)</p><h2>Possible ${esc(name(draft.possibleSpecies))}</h2><p>${esc(draft.publicArea)} · ${esc(draft.approximateTime)}</p><p>${esc(draft.description)}</p>${photo ? image(photo, "Your optional image awaiting human review") : ""}</article><p>Hidden: exact rescue location, condition details, submission receipt and internal moderation notes. Images remain private until reviewed.</p>${draft.injuryConcern ? '<p class="notice">This welfare report remains private. It will not become a public story without a separate human privacy review.</p>' : ""}${button("Edit", "edit-draft")}${button("Cancel", "cancel-draft")}${button("Send for review", "submit-observation")}`;
      } else if (section === "sent") {
        html = `<p class="status-label opportunity-label">Sent for Review</p><h1>Sent for review — not yet public</h1><p>Your observation will remain private until a moderator checks its content, location and optional media.</p><p>A human moderator will review the content. Private details will not be published. The submission may be edited, rejected or approved. Submission does not guarantee publication.</p><p class="notice">This is not a rescue dispatch service.</p><a href="#receipts">View receipts or request removal</a>`;
      } else if (section === "receipts") {
        const receipts = api.receipts();
        html = `<h1>My submission receipts</h1><p>Receipts are kept only in this browser. Save them if you need to request removal.</p>${receipts.map((r) => `<article class="notice"><p>${esc(r.id)}</p><p>This observation is still being reviewed unless a moderator has published it. A receipt does not grant access to private queue data.</p>${button("Request removal", "removal", `data-id="${esc(r.id)}"`)}</article>`).join("") || "<p>No receipts in this browser.</p>"}`;
      } else if (section === "credits") {
        html = `<h1>Image credits</h1><p>The original illustrated atlas was generated with OpenAI image generation for this prototype. It depicts six Australian animals and habitat-care scenes; it is not evidence of real sightings or events. Local WebP encoding changes format and file size only.</p><p>Brushtail photograph: Andrew Mercer · CC BY-SA 4.0. Illustrative use, resized/cropped by the layout; not a contributor’s sighting.</p>${sourceLink("https://commons.wikimedia.org/wiki/File:Brushtail_Possum_IMG_5017.jpg", "Original photograph")}${sourceLink("https://creativecommons.org/licenses/by-sa/4.0/", "CC BY-SA 4.0 licence")}<p>The neutral park fallback is original SVG artwork authored for the prototype. No third-party animal audio was added. See IMAGE-ATTRIBUTIONS.md in the source repository for the complete provenance record.</p>`;
      } else if (section === "help") {
        html = await helpHtml();
      } else if (section === "community") {
        const [opportunities, updates] = await Promise.all([
          api.opportunities(),
          api.outcomes(),
        ]);
        html = `<p class="eyebrow">Optional ways to care</p><h1>Volunteer in your neighbourhood</h1><p>Choose a task that suits you. Every unverified event is a sample; no wildlife handling is included.</p><a class="secondary-button" href="#registrations">My prototype registrations →</a><div class="opportunity-grid">${
          opportunities
            .filter((o) => o.status !== "completed")
            .map((o) => opportunityCard(o, "#opportunity/" + o.id))
            .join("") || "<p>No current activities.</p>"
        }</div><h2>Community Updates</h2><p>These are fictional exhibition records, not reports of real completed events.</p><div class="update-grid">${updates
          .filter((o) => o.id !== "outcome-demo")
          .map((o) => outcomeCard(o, "#update/" + o.id))
          .join("")}</div>`;
      } else if (section === "updates") {
        const updates = await api.outcomes();
        html = `<a class="return-link" href="#community">← Return to previous screen</a><h1>Community Updates</h1><p>Fictional exhibition samples. No real event or measured impact is claimed.</p><div class="update-grid">${updates
          .filter((o) => o.id !== "outcome-demo")
          .map((o) => outcomeCard(o, "#update/" + o.id))
          .join("")}</div>`;
      } else if (section === "update") {
        const update = (await api.outcomes()).find((o) => o.id === param);
        html =
          '<a class="return-link" href="#community">← Return to previous screen</a>' +
          (update
            ? outcomeDetail(
                update,
                update.opportunityId
                  ? "#opportunity/" + update.opportunityId
                  : null,
              )
            : "<h1>Update unavailable</h1>");
      } else if (section === "opportunity") {
        const o = (await api.opportunities()).find((o) => o.id === param);
        const related = (await api.outcomes()).filter(
          (u) => u.opportunityId === o?.id,
        );
        html = o
          ? opportunityHtml(o) +
            `<section class="feed-section"><h2>Related Community Updates</h2>${related.map((u) => outcomeCard(u, "#update/" + u.id)).join("") || "<p>No related updates yet.</p>"}</section>`
          : "<h1>Activity unavailable</h1>";
      } else if (section === "register") {
        const o = (await api.opportunities()).find((o) => o.id === param);
        html =
          o?.registrationOpen && o.registrationMode === "demo"
            ? registrationForm(o)
            : "<p>This activity is not currently accepting registrations.</p>";
      } else if (section === "registrations") {
        html = `<h1>My prototype registrations</h1><p>Stored only on this browser, including when the shared story backend is connected. Nothing is sent to a real organiser. Use a fictional email.</p>${
          regs()
            .map(
              (r) =>
                `<article class="notice"><h2>${esc(r.reference)}</h2><p>${esc(r.nickname)} · ${esc(r.email)}</p><p>${r.adults} adults · ${r.children} supervised children · ${esc(r.preferredRole)}</p><p>Status: ${r.status === "cancelled" ? "Registration cancelled" : "Registration active"}</p>${button("Edit", "edit-registration", `data-id="${r.id}"`)}${button(r.status === "cancelled" ? "Restore" : "Cancel", "toggle-registration", `data-id="${r.id}"`)}</article>`,
            )
            .join("") || "<p>No registrations in this browser.</p>"
        }<a href="#register/habitat-demo">Submit a new registration</a>`;
      } else if (section === "moderator") {
        html = await moderatorHtml(param);
      } else
        html =
          '<h1>Page unavailable</h1><a href="#stories">Return to stories</a>';
      if (disposed || current !== version) return;
      $("#content").innerHTML = html;
      setupImages(root);
      bindForms();
      const primary = ["story", "stories"].includes(section)
        ? "stories"
        : ["learn", "species", "activity"].includes(section)
          ? "learn"
          : [
                "community",
                "opportunity",
                "register",
                "registrations",
                "updates",
                "update",
              ].includes(section)
            ? "community"
            : section;
      root
        .querySelector(`.mobile-nav a[href="#${primary}"]`)
        ?.setAttribute("aria-current", "page");
      if (section === "activity") {
        const s = species.find((x) => x.id === param) || species[0];
        activityCleanup = mountActivity($("#activity-root"), s.id, {
          animalUrl: "#species/" + s.id,
          animalsUrl: "#learn",
        });
      }
      if (section === "help" && param) {
        const i = { injured: 1, trapped: 2, road: 3, unsure: 4 }[param];
        if (i !== undefined)
          root
            .querySelector(`[data-action="guidance"][data-index="${i}"]`)
            ?.click();
      }
    } catch {
      if (!disposed && current === version)
        $("#content").innerHTML =
          '<p role="alert">We could not load the latest stories. Please try again. Private data has not been shown.</p>' +
          button("Try again", "reload");
    }
  }
  function submissionForm(rescue) {
    const d = draft;
    return `<form id="observation-form" data-rescue="${rescue}">${field("Nickname (optional)", "nickname", "text", d.nickname, 'maxlength="60"')}${select("Possible animal", "possibleSpecies", [...species, { id: "not-sure", name: "Not sure" }], d.possibleSpecies)}${select("Approximate time", "approximateTime", times, d.approximateTime)}${select("General area (no exact address)", "publicArea", areas, d.publicArea)}${field("Observed behaviour", "behaviour", "text", d.behaviour, 'required maxlength="160"')}${text("Short description", "description", d.description)}${api.account() ? button("Ask AI for writing help", "writing-help") + button("Undo AI suggestion / restore original", "undo-writing", writerOriginal === null ? "hidden" : "") : '<p class="small"><a href="#login">Sign in for optional AI writing help</a>. You can still submit your own text as a guest.</p>'}<div id="writing-panel"></div>${!rescue ? '<label class="tick"><input name="injuryRoute" type="checkbox">Animal may be injured or trapped — switch to private help route</label>' : ""}${rescue ? `${field("Exact location (optional, private)", "privateRescueLocation", "text", d.privateRescueLocation, 'maxlength="500"')}${field("Animal condition", "condition", "text", d.condition, 'required maxlength="300"')}${select("Is it moving?", "moving", ["Not sure", "Yes", "No"], d.moving)}<label class="tick"><input name="nearTraffic" type="checkbox" ${d.nearTraffic ? "checked" : ""}>Near traffic</label>` : ""}<label>Optional photograph or short video (max 5 MB)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"></label><p class="small">Do not upload children, faces, house numbers or number plates. A video is converted to one still image; the original is not stored. Metadata is stripped before storage.</p><div id="photo-preview">${photo ? image(photo, "Optional photograph preview") + button("Remove photograph", "remove-photo") : ""}</div>${tick("I observed safely and any photograph contains no identifying details or children.", "safeConsent")}<button>Preview submission</button></form>`;
  }
  async function helpHtml() {
    const contacts = [...config.contacts, ...(await api.sources())].filter(
      (c) => c.verified === true && c.sourceUrl && c.reviewedAt,
    );
    return `<h1>Is it hurt? What should I do?</h1><p>Observe from a safe distance. Do not touch, feed or chase wildlife. Keep children and pets away.</p><div class="help-options">${["Animal appears healthy", "Animal may be injured", "Animal may be trapped", "Animal is on or near a road", "I am not sure"].map((x, i) => button(x, "guidance", `data-index="${i}"`)).join("")}</div><div id="guidance" role="status"></div><h2>Professional contacts</h2>${contacts.length ? contacts.map((c) => `<article class="notice"><strong>${esc(c.name)}</strong><p>${esc(c.phone)}</p>${sourceLink(c.sourceUrl, "Official source")}<p>Reviewed: ${esc(c.reviewedAt)}</p></article>`).join("") : "<p>Verified contact information is temporarily unavailable.</p>"}<p>Check your state wildlife service’s official website. This prototype cannot dispatch assistance.</p>${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Queensland Government wildlife guidance")}<p class="small">Source review pending; no official contact numbers are invented.</p>`;
  }
  function opportunityHtml(o) {
    return `<a class="return-link" href="#community">← Return to previous screen</a>${image(o.image || "illustration:volunteers", o.title, "detail-image")}<h1>${esc(o.title)}</h1><p class="label">${isVerifiedOpportunity(o) ? "Verified opportunity" : "SAMPLE COMMUNITY ACTIVITY — PROTOTYPE ONLY"}</p><p>${esc(o.description)}</p><dl>${[
      ["Location", o.publicArea],
      ["Date", o.dateConfirmed ? o.date : "To be confirmed"],
      ["Time", o.startTime || "To be confirmed"],
      ["Duration", o.duration],
      ["Organiser", o.organiser],
      ["Tasks", o.tasks?.join(", ")],
      ["Suitable for", o.suitableFor],
      ["Equipment", o.equipment],
      ["Accessibility", o.accessibility],
      ["What to bring", o.bring],
      ["Weather and cancellations", o.weather],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || "To be confirmed")}</dd>`)
      .join(
        "",
      )}</dl><aside class="notice"><h2>Important</h2><ul><li>Participation is voluntary.</li><li>Volunteers will not handle wildlife.</li><li>Follow the organiser’s safety instructions.</li><li>Exact wildlife locations will not be provided.</li><li>Children must remain with their supervising adult.</li><li>Do not approach, feed or disturb animals.</li></ul></aside>${o.registrationOpen && o.registrationMode === "demo" ? `<a class="link-button" href="#register/${esc(o.id)}">Register interest — prototype</a>` : isVerifiedOpportunity(o) && o.registrationOpen ? sourceLink(o.registrationUrl, "Official registration") : "<p>This activity is not currently accepting registrations.</p>"}<p>No real event place can be reserved through this prototype.</p>`;
  }
  function registrationForm(o) {
    const d = editRegistration || {};
    return `${image("illustration:volunteers", "Illustrative seated volunteer seedling preparation", "registration-image")}<h1>Register interest — prototype</h1><p>Use fictional contact details. Stored in this browser only, not sent to an organiser; no place is reserved.</p><form id="registration-form" data-opportunity="${esc(o.id)}" novalidate>${field("First name or nickname", "nickname", "text", d.nickname, 'required maxlength="60"')}${field("Email (fictional for demo)", "email", "email", d.email, 'required maxlength="254"')}${field("Number of adults", "adults", "number", d.adults ?? 1, 'required min="1" max="20"')}${field("Number of supervised children", "children", "number", d.children ?? 0, 'required min="0" max="20"')}${field("Accessibility requirements (optional)", "accessibilityNeeds", "text", d.accessibilityNeeds, 'maxlength="300"')}${select("Preferred role", "preferredRole", o.tasks || opportunity.tasks, d.preferredRole)}${tick("I understand this is a demonstration, not a real booking.", "prototypeConsent")}${tick("I understand volunteers will not handle wildlife.", "wildlifeConsent")}${tick("I agree to follow organiser safety instructions and supervise children.", "safetyConsent")}<button>Record prototype registration</button></form>`;
  }
  async function moderatorHtml(tab = "") {
    queueData = await api.queue();
    const q = queueData;
    const tabs = [
      ["", "Overview"],
      ["pending", "Posts awaiting approval"],
      ["urgent", "Injured-animal reports"],
      ["approved", "Approved stories"],
      ["rejected", "Rejected posts"],
      ["comments", "Comments"],
      ["reports", "Reported Comments"],
      ["opportunities", "Community opportunities"],
      ["updates", "Community Updates"],
      ["sources", "Information sources"],
      ["history", "Moderation history"],
      ["settings", "Settings"],
    ];
    let content = "";
    if (!tab)
      content = `<h2>Dashboard overview</h2><div class="admin-summary">${[
        [
          "Pending posts",
          q.observations.filter((o) => o.status === "pending").length,
        ],
        [
          "Urgent wildlife reports",
          q.observations.filter((o) => o.status === "urgent").length,
        ],
        [
          "Reported comments",
          q.reports.filter((r) => r.status === "open").length,
        ],
        [
          "Approved stories",
          q.observations.filter((o) => o.status === "approved").length,
        ],
        [
          "Rejected posts",
          q.observations.filter((o) => o.status === "rejected").length,
        ],
      ]
        .map(
          ([label, count]) =>
            `<article><strong>${count}</strong><span>${label}</span></article>`,
        )
        .join(
          "",
        )}</div><p>Posts require human approval. Comments are published immediately after validation and may be reported for a separate human review.</p>`;
    if (["pending", "urgent", "approved", "rejected"].includes(tab)) {
      const list = q.observations.filter((o) =>
        tab === "pending"
          ? ["pending", "clarification"].includes(o.status)
          : o.status === tab,
      );
      content = `<h2>${{ pending: "Posts awaiting approval", urgent: "Injured-animal reports", approved: "Approved stories", rejected: "Rejected posts" }[tab]}</h2>${list.map(moderationForm).join("") || "<p>No posts in this section.</p>"}`;
    }
    if (tab === "comments" || tab === "reports") {
      content = `<h2>${tab === "reports" ? "Reported Comments" : "Comments — visible or removed"}</h2><p>Comments do not await approval. Record a reason when removing a comment; restoration is available for moderator removals.</p>${
        tab === "reports"
          ? q.reports
              .map((r) => {
                const c = q.comments.find((c) => c.id === r.commentId);
                return `<article class="notice"><span class="status-label">Report ${esc(r.status)}</span><p>${esc(r.reason)} · ${esc(r.details)}</p>${c ? `<blockquote>${esc(c.body)}</blockquote><p>By ${esc(c.authorDisplayName)} · Comment ${esc(c.status)}</p><a href="#story/${esc(c.storyId)}">Open related story in context →</a>${commentModeration(c)}` : "<p>Comment is unavailable.</p>"}${r.status === "open" ? button("Dismiss report", "dismiss-report", `data-id="${esc(r.id)}"`) : `<p class="small">Reviewed by ${esc(r.reviewedBy)} · ${esc(r.reviewedAt)}</p>`}</article>`;
              })
              .join("") || "<p>No reported comments.</p>"
          : q.comments
              .map(
                (c) =>
                  `<article class="notice"><strong>${esc(c.authorDisplayName)}</strong><p>${esc(c.body)}</p><p>Status: ${esc(c.status)} ${c.authorDeleted ? "· Deleted by author" : ""}</p><a href="#story/${esc(c.storyId)}">Open story in context →</a>${commentModeration(c)}</article>`,
              )
              .join("") || "<p>No comments.</p>"
      }`;
    }
    if (tab === "opportunities") {
      const allOpportunities = await api.opportunities();
      const current =
        allOpportunities.find((o) => o.id === hash().split("/")[2]) ||
        allOpportunities.find((o) => o.id === "habitat-demo") ||
        opportunity;
      content = `<h2>Community opportunities</h2><nav class="activity-menu">${allOpportunities.map((o) => `<a href="#moderator/opportunities/${esc(o.id)}">Edit ${esc(o.title)}</a>`).join("")}</nav><form id="opportunity-form">${field("Activity ID (use a new ID to create another sample)", "id", "text", current.id, 'required pattern="[a-z0-9-]{3,80}"')}<p>Edit the sample activity. A verified badge requires a real organiser and complete confirmed details.</p>${field("Title", "title", "text", current.title, "required")}${field("Organiser", "organiser", "text", current.organiser, "required")}${field("Confirmed date", "date", "date", current.date || "")}${field("Start time", "startTime", "time", current.startTime || "")}${field("Official registration URL", "registrationUrl", "url", current.registrationUrl || "")}${field("Official contact", "contact", "text", current.contact || "")}${field("Accessibility", "accessibility", "text", current.accessibility, "required")}${field("Safety instructions", "safety", "text", current.safety, "required")}${field("Verification date", "verifiedAt", "date", current.verifiedAt || "")}<label class="tick"><input type="checkbox" name="organiserVerified" ${current.organiserVerified ? "checked" : ""}>I verified the real organiser and all event details</label><button>Save opportunity</button></form>`;
    }
    if (tab === "updates")
      content = `<h2>Publish Community Update</h2><form id="outcome-form">${field("Title", "title", "text", "", 'required maxlength="120"')}${select("General area", "publicArea", areas)}${field("Completion date", "completedAt", "date", "", "required")}${text("What volunteers did (no unverified impact claims)", "actionsCompleted")}${text("Why it matters (no unverified impact claims)", "whyItMatters")}${text("Community message", "communityMessage")}<label>Optional approved outcome photograph<input type="file" name="outcomePhoto" accept="image/jpeg,image/png,image/webp"></label>${field("Next opportunity ID (optional; verified events only)", "nextOpportunityId")}${tick("No wildlife handling; content and any image checked for privacy and welfare risks.", "checked")}<button>Publish Community Update</button></form>`;
    if (tab === "sources")
      content = `<h2>Information sources</h2><form id="source-form">${field("Organisation", "name", "text", "", "required")}${field("Official contact number", "phone", "text", "", "required")}${field("Official source URL", "sourceUrl", "url", "", "required")}${field("Review date", "reviewedAt", "date", "", "required")}${tick("I checked these details against the official source.", "verified")}<button>Save reviewed contact</button></form>`;
    if (tab === "history")
      content = `<h2>Moderation history</h2><h3>Post actions</h3><pre>${esc(
        JSON.stringify(
          q.records.map((r) => ({
            action: r.action,
            moderatorId: r.moderatorId,
            reason: r.reason,
            createdAt: r.createdAt,
          })),
          null,
          2,
        ),
      )}</pre><h3>Comment actions</h3><pre>${esc(JSON.stringify(q.commentHistory || [], null, 2))}</pre><h3>Contributor removal requests</h3><pre>${esc(JSON.stringify(q.removals, null, 2))}</pre>`;
    if (tab === "settings")
      content = `<h2>Moderator settings</h2><p>Exhibition data only. Reset restores the fictional observations, activities, updates, registrations, saved stories and draft while preserving the configured accounts and moderator session.</p>${!api.live ? button("Reset demonstration data", "reset-demo") : "<p>Reset is unavailable for connected data.</p>"}`;
    return `<p class="eyebrow">${api.live ? "Authenticated backend moderator" : "Exhibition moderator · local demonstration"}</p><h1>Moderator dashboard</h1><div class="admin-layout"><nav class="admin-nav" aria-label="Moderator sections">${tabs.map(([id, label]) => `<a href="#moderator${id ? "/" + id : ""}" ${tab === id ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav><section class="admin-content">${content || "<h2>Section unavailable</h2>"}</section></div>`;
  }
  function commentModeration(c) {
    if (c.authorDeleted)
      return '<p class="small">Deleted by author; restoration is not available.</p>';
    return `<form class="comment-moderation" data-id="${esc(c.id)}">${field(c.status === "visible" ? "Removal reason (required)" : "Restoration note (optional)", "reason", "text", c.removalReason || "", c.status === "visible" ? 'required minlength="3" maxlength="500"' : 'maxlength="500"')}<button name="action" value="${c.status === "visible" ? "remove" : "restore"}">${c.status === "visible" ? "Remove comment" : "Restore comment"}</button></form>`;
  }
  function moderationForm(o) {
    return `<details class="notice"><summary>${esc(name(o.possibleSpecies))} · ${esc(o.publicArea)} · ${esc(o.status)}</summary><h3>Submitted content (private)</h3><p>${esc(o.description)}</p><p>Nickname: ${esc(o.nickname || "Anonymous")} · ${esc(o.approximateTime)}</p><p>Private rescue location: ${esc(o.privateRescueLocation || "None")}</p><p>Condition: ${esc(o.condition || "Not reported")} · Moving: ${esc(o.moving || "Not reported")} · Near traffic: ${o.nearTraffic ? "Yes" : "No"}</p>${o.mediaUrl ? button("View private media (moderator only)", "view-media", `data-id="${esc(o.id)}"`) : "<p>No media.</p>"}<div id="media-${esc(o.id)}"></div><form class="moderation-form" data-id="${esc(o.id)}">${text("Edited public wording", "publicText", o.description)}${select("Possible species / identification confidence", "approvedSpecies", [...species, { id: "not-sure", name: "Not sure — no species assertion" }], o.possibleSpecies)}${select("Broad public area", "approvedPublicArea", areas, o.publicArea)}<fieldset><legend>Human privacy checklist (required for approval)</legend>${api.checks.map((k) => `<label class="tick"><input type="checkbox" name="${k}">${CHECK_LABELS[k]}</label>`).join("")}</fieldset>${o.mediaUrl ? '<label class="tick"><input type="checkbox" name="mediaApproved">Approve reviewed media (leave unchecked to remove it)</label>' : ""}${text("Moderator notes / reason (required for every action)", "reason", "", 500)}<div class="answers">${["approve", "reject", "clarification", "urgent", "remove"].map((a) => `<button name="action" value="${a}">${{ approve: "Approve and publish", reject: "Reject", clarification: "Request clarification", urgent: "Mark urgent", remove: "Remove story and media" }[a]}</button>`).join("")}</div><p class="small">Clarification is recorded only: no messaging service or contributor contact is collected. Urgent reports are not dispatched automatically.</p></form></details>`;
  }
  function bindForms() {
    $("input[name=injuryRoute]")?.addEventListener("change", (e) => {
      if (e.target.checked) {
        const f = $("#observation-form");
        draft = { ...Object.fromEntries(new FormData(f)) };
        delete draft.photo;
        go("rescue");
      }
    });
    $("#observation-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      draft = {
        ...Object.fromEntries(new FormData(f)),
        injuryConcern: f.dataset.rescue === "true",
        nearTraffic: f.nearTraffic?.checked || false,
      };
      delete draft.photo;
      try {
        api.validateObservation(draft);
        go("preview");
      } catch (err) {
        feedback(err.message, true);
      }
    });
    $('input[name="photo"]')?.addEventListener("change", async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        photoBlob = await api.prepareImage(file);
        if (photo) URL.revokeObjectURL(photo);
        photo = URL.createObjectURL(photoBlob);
        $("#photo-preview").innerHTML =
          image(photo, "Optional photograph preview") +
          button("Remove photograph", "remove-photo");
      } catch (err) {
        e.target.value = "";
        feedback(err.message, true);
      }
    });
    $("#account-login")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const email = form.email.value.trim(),
        password = form.password.value;
      root
        .querySelectorAll("[data-error]")
        .forEach((node) => (node.textContent = ""));
      if (!email || !password) {
        const target = root.querySelector(
          `[data-error="${!email ? "email" : "password"}"]`,
        );
        target.textContent = "This field is required.";
        form.elements[!email ? "email" : "password"].focus();
        return;
      }
      try {
        const previousUser = api.account()?.id;
        const user = await api.login(email, password);
        if (previousUser !== user.id) clearEditor();
        form.password.value = "";
        const next = hash().split("/")[1];
        const wanted = next ? decodeURIComponent(next) : null;
        go(
          wanted &&
            (!wanted.startsWith("moderator") || user.role === "moderator")
            ? wanted
            : user.role === "moderator"
              ? "moderator"
              : "profile",
        );
      } catch (err) {
        $("#login-error").textContent = err.message;
        form.password.setAttribute("aria-invalid", "true");
      }
    });
    $("#comment-form")?.addEventListener("input", (e) => {
      if (e.target.name === "body") commentDraft = e.target.value;
    });
    $("#comment-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        checked = checkComment(form.body.value);
      if (
        checked.errors.length ||
        (checked.warnings.length && !form.warningAcknowledged.checked)
      ) {
        $("#comment-validation").textContent = [
          ...checked.errors,
          ...checked.warnings,
        ].join(" ");
        return;
      }
      try {
        if (editingComment)
          await api.editComment(
            editingComment,
            form.body.value,
            form.warningAcknowledged.checked,
          );
        else
          await api.addComment(
            form.dataset.story,
            form.body.value,
            replyTo,
            form.warningAcknowledged.checked,
          );
        editingComment = null;
        replyTo = null;
        commentDraft = "";
        await render();
        feedback("Your comment is visible now.");
      } catch (err) {
        feedback(err.message, true);
      }
    });
    $("#report-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.reportComment(
          reportingComment,
          e.currentTarget.reason.value,
          e.currentTarget.details.value,
        );
        reportingComment = null;
        await render();
        feedback(
          "Thanks for letting us know. The comment remains visible unless a moderator removes it.",
        );
      } catch (err) {
        feedback(err.message, true);
      }
    });
    root.querySelectorAll(".comment-moderation").forEach((form) =>
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api.moderateComment(
            form.dataset.id,
            e.submitter.value,
            form.reason.value,
          );
          await render();
          feedback("Comment action recorded.");
        } catch (err) {
          feedback(err.message, true);
        }
      }),
    );
    root.querySelectorAll(".moderation-form").forEach((form) =>
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const action = e.submitter?.value;
        try {
          const obs = queueData.observations.find(
            (o) => o.id === form.dataset.id,
          );
          const sp = species.find((s) => s.id === values.approvedSpecies);
          const payload = {
            ...values,
            id: obs.id,
            action,
            privacyChecks: Object.fromEntries(
              api.checks.map((k) => [k, form.elements[k].checked]),
            ),
            mediaApproved: form.elements.mediaApproved?.checked || false,
            originalMedia: obs.mediaUrl,
            fact: sp?.fact || "Identification uncertain. Observe safely.",
            factSource: sp?.source || "",
          };
          if (action === "approve" && payload.mediaApproved) {
            if (!api.checks.every((k) => payload.privacyChecks[k]))
              throw Error("Complete every privacy check first.");
            payload.publicMedia = await api.approveMedia(obs.mediaUrl);
          }
          await api.moderate(payload);
          await render();
          feedback("Moderation action recorded.");
        } catch (err) {
          feedback(err.message, true);
        }
      }),
    );
    $("#registration-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        d = Object.fromEntries(new FormData(form));
      root
        .querySelectorAll("[data-error]")
        .forEach((x) => (x.textContent = ""));
      const errors = {};
      if (!d.nickname?.trim()) errors.nickname = "Enter a name or nickname.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || ""))
        errors.email = "Enter a valid email.";
      if (
        !Number.isInteger(Number(d.adults)) ||
        Number(d.adults) < 1 ||
        Number(d.adults) > 20
      )
        errors.adults = "At least one adult is required (maximum 20).";
      if (
        !Number.isInteger(Number(d.children)) ||
        Number(d.children) < 0 ||
        Number(d.children) > 20
      )
        errors.children = "Enter 0–20 supervised children.";
      for (const k of ["prototypeConsent", "wildlifeConsent", "safetyConsent"])
        if (!form.elements[k].checked) errors[k] = "Required confirmation.";
      if (Object.keys(errors).length) {
        for (const [k, v] of Object.entries(errors)) {
          const node = root.querySelector(`[data-error="${k}"]`);
          if (node) node.textContent = v;
          form.elements[k].setAttribute("aria-invalid", "true");
        }
        feedback(
          "Check the marked fields and all three confirmations. Your entries have been kept.",
          true,
        );
        form.elements[Object.keys(errors)[0]].focus();
        return;
      }
      try {
        let all = regs();
        const record = {
          ...d,
          id: editRegistration?.id || crypto.randomUUID(),
          reference:
            editRegistration?.reference ||
            "WN-DEMO-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
          opportunityId: form.dataset.opportunity,
          adults: Number(d.adults),
          children: Number(d.children),
          status: editRegistration?.status || "active",
          createdAt: editRegistration?.createdAt || new Date().toISOString(),
        };
        all = all.filter((r) => r.id !== record.id);
        all.push(record);
        putRegs(all);
        editRegistration = null;
        go("registrations");
        setTimeout(
          () =>
            feedback(
              "Prototype registration recorded. It has not been sent to a real organiser and does not reserve a place at an event.",
            ),
          50,
        );
      } catch {
        feedback(
          "Browser storage is unavailable. Registration was not saved.",
          true,
        );
      }
    });
    $("#opportunity-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget,
        d = Object.fromEntries(new FormData(f));
      try {
        await api.saveOpportunity({
          ...((await api.opportunities()).find((o) => o.id === d.id) || {
            ...opportunity,
            image: "illustration:volunteers",
          }),
          ...d,
          dateConfirmed: !!d.date,
          organiserVerified: f.organiserVerified.checked,
          status: f.organiserVerified.checked ? "verified" : "sample",
          registrationMode: f.organiserVerified.checked ? "external" : "demo",
        });
        feedback(
          "Opportunity saved. Verified status is shown only when all required details are present.",
        );
      } catch {
        feedback("Opportunity could not be saved.", true);
      }
    });
    $("#outcome-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fields = Object.fromEntries(new FormData(form));
      delete fields.outcomePhoto;
      try {
        let approvedImage = null;
        const file = form.elements.outcomePhoto.files[0];
        if (file) {
          const pending = await api.uploadImage(await api.prepareImage(file));
          approvedImage = await api.approveMedia(pending);
        }
        if (fields.nextOpportunityId) {
          const next = (await api.opportunities()).find(
            (o) => o.id === fields.nextOpportunityId,
          );
          if (!next || !isVerifiedOpportunity(next))
            throw Error("Next opportunity must be verified.");
        }
        await api.saveOutcome({
          ...fields,
          approvedImage,
          opportunityId: "habitat-demo",
          published: true,
          sample: !api.live,
        });
        await render();
        feedback("Community Update published.");
      } catch {
        feedback("Update could not be saved.", true);
      }
    });
    $("#source-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.currentTarget));
      try {
        await api.saveSource({ ...d, id: "rescue-contact", verified: true });
        feedback("Reviewed contact saved.");
      } catch {
        feedback("Contact could not be saved.", true);
      }
    });
  }
  async function action(e) {
    const el = e.target.closest("[data-action]");
    if (!el || !root.contains(el)) return;
    const a = el.dataset.action;
    try {
      if (a === "writing-help") writingPanel();
      if (a === "request-writing") await requestWriting();
      if (a === "cancel-writing" || a === "keep-original") {
        writerController?.abort();
        writerGeneration++;
        if (a === "keep-original") {
          $("#observation-form [name=description]").value = requestOriginal;
          aiApplied = false;
        }
        $("#writing-panel").innerHTML = "";
      }
      if (a === "edit-writing") $("#writer-suggestion")?.focus();
      if (a === "use-writing") {
        if (!$("#writer-confirm")?.checked) {
          feedback(
            "Confirm the final wording before using the suggestion.",
            true,
          );
          return;
        }
        const suggestion = $("#writer-suggestion").value;
        validateWritingInput(suggestion);
        if (suggestion.length > 600)
          throw Error("Keep the draft under 600 characters.");
        $("#observation-form [name=description]").value = suggestion;
        draft.description = suggestion;
        aiApplied = true;
        const form = $("#observation-form");
        api.saveWritingDraft({
          original: writerOriginal,
          description: suggestion,
          possibleSpecies: form.possibleSpecies.value,
          approximateTime: form.approximateTime.value,
          publicArea: form.publicArea.value,
          behaviour: form.behaviour.value,
          aiAssisted: true,
        });
        $("[data-action=undo-writing]").hidden = false;
        $("#writing-panel").innerHTML = "";
        feedback(
          "Suggestion added as a draft only. Review and submit separately.",
        );
      }
      if (a === "undo-writing") {
        $("#observation-form [name=description]").value = writerOriginal || "";
        draft.description = writerOriginal || "";
        aiApplied = false;
        feedback("Your original description has been restored.");
      }
      if (a === "reload") await render();
      if (a === "safe" || a === "unsafe")
        $("#learning-result").textContent =
          a === "safe"
            ? "Yes. Watch quietly, keep pets away and let it move on."
            : "Do not feed wildlife. Give it space instead.";
      if (a === "edit-draft") go(draft.injuryConcern ? "rescue" : "share");
      if (a === "cancel-draft") {
        draft = {};
        photoBlob = null;
        if (photo) URL.revokeObjectURL(photo);
        photo = null;
        go("stories");
      }
      if (a === "remove-photo") {
        if (photo) URL.revokeObjectURL(photo);
        photo = null;
        photoBlob = null;
        $("#photo-preview").innerHTML = "";
        const f = $('input[name="photo"]');
        if (f) f.value = "";
      }
      if (a === "submit-observation") {
        if (reviewing) return;
        reviewing = true;
        el.disabled = true;
        try {
          const mediaUrl = photoBlob ? await api.uploadImage(photoBlob) : null;
          lastReceipt = await api.submit({
            ...draft,
            mediaUrl,
            aiAssisted: aiApplied,
          });
          writerOriginal = null;
          aiApplied = false;
          storeReceipt(lastReceipt);
          draft = {};
          photoBlob = null;
          if (photo) URL.revokeObjectURL(photo);
          photo = null;
          go("sent");
        } finally {
          reviewing = false;
          el.disabled = false;
        }
      }

      if (a === "logout") {
        api.logout();
        clearEditor();
        go("stories");
      }
      if (a === "view-media") {
        const o = queueData.observations.find((o) => o.id === el.dataset.id);
        const url = await api.pendingMedia(o.mediaUrl);
        root.querySelector(`[id="media-${o.id}"]`).innerHTML = image(
          url,
          "Private submitted image — review identifying details",
        );
      }
      if (a === "fill-account") {
        const account = demoAccounts.find((u) => u.id === el.dataset.id),
          form = $("#account-login");
        form.email.value = account.email;
        form.password.value = account.password;
      }
      if (a === "toggle-password") {
        const input = $("#account-login").password;
        input.type = input.type === "password" ? "text" : "password";
        el.textContent =
          input.type === "password" ? "Show password" : "Hide password";
        el.setAttribute("aria-pressed", String(input.type === "text"));
      }
      if (a === "guest") {
        api.logout();
        clearEditor();
        go("stories");
      }
      if (a === "save-story") {
        api.toggleSaved(el.dataset.id);
        feedback("Saved stories updated in My activity.");
      }
      if (a === "continue-draft") {
        const saved = api.writingDraft();
        draft = { ...saved };
        writerOriginal = saved.original || saved.description;
        aiApplied = !!saved.aiAssisted;
        go("share");
      }
      if (a === "reply-comment") {
        replyTo = el.dataset.id;
        editingComment = null;
        commentDraft = "";
        await render();
        $("#comment-form textarea")?.focus();
      }
      if (a === "edit-comment") {
        const c = (await api.comments(hash().split("/")[1])).find(
          (c) => c.id === el.dataset.id,
        );
        if (c?.authorId !== api.account()?.id)
          throw Error("You can only edit your own comment.");
        editingComment = c.id;
        replyTo = c.parentCommentId;
        commentDraft = c.body;
        await render();
        $("#comment-form textarea")?.focus();
      }
      if (a === "delete-comment") {
        await api.deleteComment(el.dataset.id);
        await render();
        feedback("Your comment was deleted.");
      }
      if (a === "cancel-comment") {
        editingComment = null;
        replyTo = null;
        commentDraft = "";
        await render();
      }
      if (a === "report") {
        if (!api.account()) {
          go("login/" + encodeURIComponent(hash()));
          return;
        }
        reportingComment = el.dataset.id;
        await render();
        $("#report-form select")?.focus();
      }
      if (a === "cancel-report") {
        reportingComment = null;
        await render();
      }
      if (a === "dismiss-report") {
        await api.dismissReport(el.dataset.id);
        await render();
        feedback("Report dismissed after review.");
      }
      if (a === "removal") {
        const receipts = api.receipts();
        await api.removal(
          receipts.find((r) => r.id === el.dataset.id),
          "Contributor requested removal",
        );
        feedback("Removal request sent for human review.");
      }
      if (a === "edit-registration") {
        editRegistration = regs().find((r) => r.id === el.dataset.id);
        go("register/" + editRegistration.opportunityId);
      }
      if (a === "toggle-registration") {
        const all = regs(),
          r = all.find((r) => r.id === el.dataset.id);
        r.status = r.status === "cancelled" ? "active" : "cancelled";
        putRegs(all);
        await render();
      }
      if (a === "reset-demo") {
        if (
          confirm(
            "Reset fictional demo data in this browser? This cannot be undone.",
          )
        ) {
          api.resetDemo();
          go("moderator");
        }
      }
      if (a === "guidance") {
        const messages = [
          "If it is moving freely and shows no obvious distress, give it space and let it move on. If unsure, seek professional advice.",
          "Keep your distance and keep children and pets away. Contact an appropriate wildlife organisation directly. Do not handle the animal.",
          "Keep your distance. Do not attempt to free or handle wildlife yourself. Seek advice from an appropriate wildlife organisation.",
          "If driving, stop only when safe. Do not photograph or complete forms while driving. Keep clear of traffic and contact an appropriate wildlife organisation.",
          "You do not need to decide alone. Stay back and ask an appropriate wildlife organisation for advice.",
        ];
        $("#guidance").innerHTML =
          `<p class="notice">${messages[Number(el.dataset.index)]}</p>${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Official reference: Queensland Government")}<p class="small">Reference verification pending. No exact wildlife location is available publicly.</p>`;
      }
    } catch (err) {
      feedback(
        err.message || "The action could not be completed. Please try again.",
        true,
      );
    }
  }
  const onHash = () => render();
  const onStorage = (e) => {
    if (e.key === "wn-demo-session") {
      clearEditor();
      render();
    }
  };
  window.addEventListener("storage", onStorage);
  root.addEventListener("click", action);
  window.addEventListener("hashchange", onHash);
  await render();
  return () => {
    activityCleanup?.();
    disposed = true;
    version++;
    root.removeEventListener("click", action);
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("storage", onStorage);
    writerController?.abort();
    if (photo) URL.revokeObjectURL(photo);
  };
}
