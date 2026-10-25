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
const CHECK_LABELS = {
  face: "Faces and children checked",
  house: "House numbers checked",
  plate: "Number plates checked",
  location: "Exact location removed from public wording",
  welfare: "Animal welfare risk checked",
};
export async function mount(root) {
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
    const receipts = JSON.parse(localStorage.getItem("wn-receipts") || "[]");
    receipts.push(r);
    localStorage.setItem("wn-receipts", JSON.stringify(receipts));
  }
  function regs() {
    return JSON.parse(localStorage.getItem("wn-registrations") || "[]");
  }
  function putRegs(r) {
    localStorage.setItem("wn-registrations", JSON.stringify(r));
  }
  function storyCard(s) {
    return `<article class="mobile-card">${image(api.publicImage(s.mediaUrl), `Illustrative image: ${name(s.species)}`)}<div><p class="label">Neighbour Observation ${s.sample ? "· Sample" : ""}</p><h2>Possible ${esc(name(s.species))}</h2><p>${esc(s.storyText)}</p><p>${esc(s.publicArea)} · ${esc(s.approximateTime)}</p><p class="small">Approved for public display · Reviewed by ${esc(s.reviewedBy)}</p><a class="link-button" href="#story/${esc(s.id)}">Read story and wildlife information →</a></div></article>`;
  }
  async function render() {
    const current = ++version;
    root.innerHTML = `<div class="fencepost-app"><header class="mobile-header"><a href="#stories" class="brand">Fencepost<span> ●</span></a><span>Wildlife Neighbours</span></header>${modeNote(api.live)}<nav class="mobile-nav" aria-label="Fencepost navigation">${["Stories", "Learn", "Share", "Help", "Community"].map((n) => `<a href="#${n.toLowerCase()}">${n}</a>`).join("")}</nav><main class="mobile-main"><div id="feedback" tabindex="-1" role="status"></div><div id="content"><p>Loading…</p></div></main><footer><a href="#moderator">Moderator</a><a href="#receipts">My submission receipts</a><a href="#credits">Image credits</a><a href="${asset("index.html")}">Public display</a></footer></div>`;
    try {
      const route = hash(),
        [section, param] = route.split("/");
      let html = "";
      if (section === "stories") {
        const all = await api.stories();
        html = `<p class="eyebrow">Local park / Read without an account</p><h1>Small encounters.<br>Shared stories.</h1>${all.length ? all.map(storyCard).join("") : "<p>No approved stories are available yet.</p>"}`;
      } else if (section === "story") {
        const s = (await api.stories()).find((x) => x.id === param);
        if (!s)
          html =
            "<h1>Story unavailable</h1><p>This observation is still being reviewed or has been removed.</p>";
        else {
          const sp = species.find((x) => x.id === s.species);
          const comments = await api.comments(s.id);
          html = `<a href="#stories">← Stories</a><h1>Possible ${esc(name(s.species))}</h1>${image(api.publicImage(s.mediaUrl), name(s.species), "detail-image")}<p class="label">Neighbour Observation ${s.sample ? "· Sample" : ""}</p><h2>Resident observation</h2><p>${esc(s.storyText)}</p><p>${esc(s.publicArea)} · ${esc(s.approximateTime)}</p><h2>Wildlife information</h2><p>${esc(s.verifiedFact)}</p>${sourceLink(s.factSource)}<p class="small">Reference information; source review status: ${esc(sp?.sourceStatus || "Review needed")}.</p><h2>Safe response</h2><p>Observe from a distance. Do not approach, feed or handle wildlife.</p><h2>Public privacy information</h2><p>Contributor identity removed · Broad area only · Images reviewed before publication · Private details removed.</p><p>Reviewed by ${esc(s.reviewedBy)}</p><h2>Discussion</h2><p>Share experiences, not exact locations. Verified advice is labelled separately.</p><p class="small">No personal attacks, identifying details, feeding/handling instructions or unverified rescue advice. Every comment is reviewed before publication.</p>${comments.map((c) => `<article class="notice"><p>${esc(c.body)}</p>${button("Report comment", "report", `data-id="${esc(c.id)}"`)}</article>`).join("") || "<p>No approved comments yet.</p>"}<form id="comment-form" data-story="${esc(s.id)}">${text("Your experience", "body", "", 500)}<button>Send comment for review</button></form>`;
        }
      } else if (section === "learn") {
        html = `<h1>Meet the animal</h1>${species.map((s) => `<article class="mobile-card">${image(s.image, s.name)}<div><h2>${esc(s.name)}</h2><p>${esc(s.fact)}</p><a href="#species/${s.id}">Learn together →</a></div></article>`).join("")}`;
      } else if (section === "species") {
        const s = species.find((x) => x.id === param) || species[0];
        html = `<a href="#learn">← All animals</a><h1>${esc(s.name)}</h1>${image(s.image, s.name, "detail-image")}<p><i>${esc(s.scientific)}</i></p><dl><dt>Active time</dt><dd>${esc(s.active)}</dd><dt>Habitat</dt><dd>${esc(s.habitat)}</dd><dt>Behaviour</dt><dd>${esc(s.behaviour)}</dd></dl><p class="notice">${esc(s.advice)}</p><h2>Wildlife fact</h2><p>${esc(s.fact)}</p>${sourceLink(s.source)}<p class="small">${esc(s.sourceStatus)}</p><details><summary>Try one family discovery</summary><p>A wild animal is nearby. What would you do?</p>${button("Watch quietly from a distance", "safe")}${button("Offer food", "unsafe")}<p id="learning-result" role="status"></p></details>`;
      } else if (section === "share") {
        html = `<h1>Share an observation</h1><p>Text is enough. A photograph and nickname are optional. No account needed.</p><p class="notice">Observe from a safe distance. Do not approach, follow, feed or disturb wildlife to create a post. If driving, submit only after parking safely.</p><p>Is the animal injured or trapped? <a href="#rescue">Animal Needs Help →</a></p>${submissionForm(false)}`;
      } else if (section === "rescue") {
        html = `<h1>Animal Needs Help</h1><p class="notice">This form does not dispatch rescue assistance and is not monitored for emergencies. <a href="#help">Read safety guidance and contact a wildlife organisation directly.</a></p><p>Exact location is shared privately only to support an appropriate response. In local demo mode, use fictional details only.</p>${submissionForm(true)}`;
      } else if (section === "preview") {
        html = `<h1>This is what may become public after review</h1><article class="notice"><p>Public nickname preference: ${esc(draft.nickname || "Anonymous")} (removed from public-display stories)</p><h2>Possible ${esc(name(draft.possibleSpecies))}</h2><p>${esc(draft.publicArea)} · ${esc(draft.approximateTime)}</p><p>${esc(draft.description)}</p>${photo ? image(photo, "Your optional image awaiting human review") : ""}</article><p>Hidden: exact rescue location, condition details, submission receipt and internal moderation notes. Images remain private until reviewed.</p>${draft.injuryConcern ? '<p class="notice">This welfare report remains private. It will not become a public story without a separate human privacy review.</p>' : ""}${button("Edit", "edit-draft")}${button("Cancel", "cancel-draft")}${button("Send for review", "submit-observation")}`;
      } else if (section === "sent") {
        html = `<h1>Sent for review — not yet public</h1><p>A human moderator will review the content. Private details will not be published. The submission may be edited, rejected or approved. Submission does not guarantee publication.</p><p class="notice">This is not a rescue dispatch service.</p><a href="#receipts">View receipts or request removal</a>`;
      } else if (section === "receipts") {
        const receipts = JSON.parse(
          localStorage.getItem("wn-receipts") || "[]",
        );
        html = `<h1>My submission receipts</h1><p>Receipts are kept only in this browser. Save them if you need to request removal.</p>${receipts.map((r) => `<article class="notice"><p>${esc(r.id)}</p><p>This observation is still being reviewed unless a moderator has published it. A receipt does not grant access to private queue data.</p>${button("Request removal", "removal", `data-id="${esc(r.id)}"`)}</article>`).join("") || "<p>No receipts in this browser.</p>"}`;
      } else if (section === "credits") {
        html = `<h1>Image credits</h1><p>Photographs are illustrative and are not the sightings beside them. The brushtail photograph is by Andrew Mercer, licensed CC BY-SA 4.0. The existing processed image is resized and cropped by the display layout; no night colour grading is added in this version.</p>${sourceLink("https://commons.wikimedia.org/wiki/File:Brushtail_Possum_IMG_5017.jpg", "Original photograph")}${sourceLink("https://creativecommons.org/licenses/by-sa/4.0/", "CC BY-SA 4.0 licence")}<p>The other five species use labelled placeholders until suitable licensed photographs are supplied. No third-party animal audio is introduced. Narration is optional browser speech with visible text.</p>`;
      } else if (section === "help") {
        html = await helpHtml();
      } else if (section === "community") {
        const opportunities = (await api.opportunities()).filter(
            (o) => o.status !== "completed",
          ),
          outcomes = await api.outcomes();
        html = `<h1>Optional community action</h1><p>Participation is voluntary. Volunteers do not handle wildlife.</p>${opportunities.map((o) => `<article class="notice"><p class="label">${isVerifiedOpportunity(o) ? "Verified opportunity" : "SAMPLE COMMUNITY ACTIVITY — PROTOTYPE ONLY"}</p><h2>${esc(o.title)}</h2><p>${esc(o.description)}</p><a href="#opportunity/${esc(o.id)}">Full details and prototype registration →</a></article>`).join("") || "<p>No current activities.</p>"}<a href="#registrations">My prototype registrations</a><h2>Community Updates</h2>${outcomes.map((o) => `<article class="notice"><p class="label">Community outcome ${o.sample ? "· Sample" : ""}</p><h3>${esc(o.title)}</h3><p>${esc(o.publicArea)}</p>${o.approvedImage ? image(api.publicImage(o.approvedImage), "Human-reviewed community activity image") : ""}<p>${esc(o.actionsCompleted)}</p><p>${esc(o.communityMessage)}</p><p>No wildlife handling. No unverified habitat impact or individual animal use is claimed.</p></article>`).join("") || "<p>No published outcomes yet.</p>"}`;
      } else if (section === "opportunity") {
        const o = (await api.opportunities()).find((o) => o.id === param);
        html = o ? opportunityHtml(o) : "<h1>Activity unavailable</h1>";
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
                `<article class="notice"><h2>${esc(r.reference)}</h2><p>${esc(r.nickname)} · ${esc(r.email)}</p><p>${r.adults} adults · ${r.children} supervised children · ${esc(r.preferredRole)}</p><p>Status: ${esc(r.status)}</p>${button("Edit", "edit-registration", `data-id="${r.id}"`)}${button(r.status === "cancelled" ? "Restore" : "Cancel", "toggle-registration", `data-id="${r.id}"`)}</article>`,
            )
            .join("") || "<p>No registrations in this browser.</p>"
        }<a href="#register/habitat-demo">Submit a new registration</a>`;
      } else if (section === "moderator") {
        html = await moderatorHtml();
      } else
        html =
          '<h1>Page unavailable</h1><a href="#stories">Return to stories</a>';
      if (disposed || current !== version) return;
      $("#content").innerHTML = html;
      setupImages(root);
      bindForms();
    } catch {
      if (!disposed && current === version)
        $("#content").innerHTML =
          '<p role="alert">We could not load the latest stories. Please try again. Private data has not been shown.</p>' +
          button("Try again", "reload");
    }
  }
  function submissionForm(rescue) {
    const d = draft;
    return `<form id="observation-form" data-rescue="${rescue}">${field("Nickname (optional)", "nickname", "text", d.nickname, 'maxlength="60"')}${select("Possible animal", "possibleSpecies", [...species, { id: "not-sure", name: "Not sure" }], d.possibleSpecies)}${select("Approximate time", "approximateTime", times, d.approximateTime)}${select("General area (no exact address)", "publicArea", areas, d.publicArea)}${field("Observed behaviour", "behaviour", "text", d.behaviour, 'required maxlength="160"')}${text("Short description", "description", d.description)}${!rescue ? '<label class="tick"><input name="injuryRoute" type="checkbox">Animal may be injured or trapped — switch to private help route</label>' : ""}${rescue ? `${field("Exact location (optional, private)", "privateRescueLocation", "text", d.privateRescueLocation, 'maxlength="500"')}${field("Animal condition", "condition", "text", d.condition, 'required maxlength="300"')}${select("Is it moving?", "moving", ["Not sure", "Yes", "No"], d.moving)}<label class="tick"><input name="nearTraffic" type="checkbox" ${d.nearTraffic ? "checked" : ""}>Near traffic</label>` : ""}<label>Optional photograph or short video (max 5 MB)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"></label><p class="small">Do not upload children, faces, house numbers or number plates. A video is converted to one still image; the original is not stored. Metadata is stripped before storage.</p><div id="photo-preview">${photo ? image(photo, "Optional photograph preview") + button("Remove photograph", "remove-photo") : ""}</div>${tick("I observed safely and any photograph contains no identifying details or children.", "safeConsent")}<button>Preview submission</button></form>`;
  }
  async function helpHtml() {
    const contacts = [...config.contacts, ...(await api.sources())].filter(
      (c) => c.verified === true && c.sourceUrl && c.reviewedAt,
    );
    return `<h1>Is it hurt? What should I do?</h1><p>Observe from a safe distance. Do not touch, feed or chase wildlife. Keep children and pets away.</p><div class="help-options">${["Animal appears healthy", "Animal may be injured", "Animal may be trapped", "Animal is on or near a road", "I am not sure"].map((x, i) => button(x, "guidance", `data-index="${i}"`)).join("")}</div><div id="guidance" role="status"></div><h2>Professional contacts</h2>${contacts.length ? contacts.map((c) => `<article class="notice"><strong>${esc(c.name)}</strong><p>${esc(c.phone)}</p>${sourceLink(c.sourceUrl, "Official source")}<p>Reviewed: ${esc(c.reviewedAt)}</p></article>`).join("") : "<p>Verified contact information is temporarily unavailable.</p>"}<p>Check your state wildlife service’s official website. This prototype cannot dispatch assistance.</p>${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Queensland Government wildlife guidance")}<p class="small">Source review pending; no official contact numbers are invented.</p>`;
  }
  function opportunityHtml(o) {
    return `<h1>${esc(o.title)}</h1><p class="label">${isVerifiedOpportunity(o) ? "Verified opportunity" : "SAMPLE COMMUNITY ACTIVITY — PROTOTYPE ONLY"}</p><p>${esc(o.description)}</p><dl>${[
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
    return `<h1>Register interest — prototype</h1><p>Use fictional contact details. Stored in this browser only, not sent to an organiser; no place is reserved.</p><form id="registration-form" data-opportunity="${esc(o.id)}" novalidate>${field("First name or nickname", "nickname", "text", d.nickname, 'required maxlength="60"')}${field("Email (fictional for demo)", "email", "email", d.email, 'required maxlength="254"')}${field("Number of adults", "adults", "number", d.adults ?? 1, 'required min="1" max="20"')}${field("Number of supervised children", "children", "number", d.children ?? 0, 'required min="0" max="20"')}${field("Accessibility requirements (optional)", "accessibilityNeeds", "text", d.accessibilityNeeds, 'maxlength="300"')}${select("Preferred role", "preferredRole", opportunity.tasks, d.preferredRole)}${tick("I understand this is a demonstration, not a real booking.", "prototypeConsent")}${tick("I understand volunteers will not handle wildlife.", "wildlifeConsent")}${tick("I agree to follow organiser safety instructions and supervise children.", "safetyConsent")}<button>Record prototype registration</button></form>`;
  }
  async function moderatorHtml() {
    if (!api.moderatorSession())
      return `<h1>Moderator access</h1>${api.live ? `<form id="login-form">${field("Moderator email", "email", "email", "", "required")}${field("Password", "password", "password", "", "required")}<button>Sign in</button></form>` : `<p class="notice">Local demo role only. This is not authentication or secure storage. Anyone using this browser can inspect demo data. Never enter real information.</p>${button("Enter local demo moderator", "demo-login")}`}`;
    queueData = await api.queue();
    return `<h1>Human moderation</h1>${button("Sign out", "logout")}<p>Observation → Review → Approved Story → Optional Opportunity → Community Outcome</p><p>Card 1: private observation · Card 2: approved story · Card 4: opportunity · Card 3: community update.</p>${[
      "pending",
      "urgent",
      "clarification",
      "approved",
      "rejected",
      "removed",
    ]
      .map(
        (status) =>
          `<h2>${esc(status)} observations</h2>${
            queueData.observations
              .filter((o) => o.status === status)
              .map((o) => moderationForm(o))
              .join("") || "<p>None.</p>"
          }`,
      )
      .join(
        "",
      )}<h2>Comment review</h2>${queueData.comments.map((c) => `<article class="notice"><p>${esc(c.body)}</p><p>${esc(c.status)}</p>${button("Approve comment", "comment-approve", `data-id="${esc(c.id)}"`)}${button("Remove comment", "comment-remove", `data-id="${esc(c.id)}"`)}</article>`).join("") || "<p>No comments.</p>"}<h2>Reported comments / removal requests</h2><pre>${esc(JSON.stringify({ reports: queueData.reports, removals: queueData.removals }, null, 2))}</pre><h2>Moderation audit</h2><pre>${esc(
      JSON.stringify(
        queueData.records.map((r) => ({
          action: r.action,
          moderatorId: r.moderatorId,
          reason: r.reason,
          createdAt: r.createdAt,
        })),
        null,
        2,
      ),
    )}</pre><h2>Community opportunities</h2><form id="opportunity-form"><p>Edit sample details; verification requires all fields and an official registration URL.</p>${field("Title", "title", "text", opportunity.title, "required")}${field("Organiser", "organiser", "text", opportunity.organiser, "required")}${field("Confirmed date", "date", "date")}${field("Start time", "startTime", "time")}${field("Official registration URL", "registrationUrl", "url")}${field("Official contact", "contact")}${field("Accessibility", "accessibility", "text", opportunity.accessibility, "required")}${field("Safety instructions", "safety", "text", opportunity.safety, "required")}${field("Verification date", "verifiedAt", "date")}<label class="tick"><input type="checkbox" name="organiserVerified">I verified the real organiser and all event details</label><button>Save opportunity</button></form><h2>Create Community Update</h2><form id="outcome-form">${field("Title", "title", "text", "", 'required maxlength="120"')}${select("General area", "publicArea", areas)}${field("Completion date", "completedAt", "date", "", "required")}${text("What volunteers did (no unverified impact claims)", "actionsCompleted")}${text("Community message", "communityMessage")}<label>Optional approved outcome photograph<input type="file" name="outcomePhoto" accept="image/jpeg,image/png,image/webp"></label><label>Next opportunity ID (optional; verified events only)<input name="nextOpportunityId" maxlength="80"></label>${tick("No wildlife handling; content and any image checked for faces, children, plates, addresses and welfare risks.", "checked")}<button>Publish Community Update</button></form><h2>Verified information sources</h2><form id="source-form">${field("Organisation", "name", "text", "", "required")}${field("Official contact number", "phone", "text", "", "required")}${field("Official source URL", "sourceUrl", "url", "", "required")}${field("Review date", "reviewedAt", "date", "", "required")}${tick("I checked these details against the official source.", "verified")}<button>Save reviewed contact</button></form>${!api.live ? button("Reset fictional demo data", "reset-demo") : ""}`;
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
    $("#comment-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.addComment(
          e.currentTarget.dataset.story,
          e.currentTarget.body.value,
        );
        e.target.reset();
        feedback("Sent for review — not yet public");
      } catch {
        feedback("Comment could not be sent. Please try again.", true);
      }
    });
    $("#login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.login(
          e.currentTarget.email.value,
          e.currentTarget.password.value,
        );
        await render();
      } catch {
        feedback("Sign-in failed or moderator access is unavailable.", true);
      }
    });
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
          ...opportunity,
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
          lastReceipt = await api.submit({ ...draft, mediaUrl });
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
      if (a === "demo-login") {
        api.demoLogin();
        await render();
      }
      if (a === "logout") {
        api.logout();
        await render();
      }
      if (a === "view-media") {
        const o = queueData.observations.find((o) => o.id === el.dataset.id);
        const url = await api.pendingMedia(o.mediaUrl);
        root.querySelector(`[id="media-${o.id}"]`).innerHTML = image(
          url,
          "Private submitted image — review identifying details",
        );
      }
      if (a === "comment-approve" || a === "comment-remove") {
        await api.moderateComment(
          el.dataset.id,
          a === "comment-approve" ? "approved" : "removed",
        );
        await render();
      }
      if (a === "report") {
        await api.reportComment(el.dataset.id, "Reader requested human review");
        feedback("Comment report sent to a moderator.");
      }
      if (a === "removal") {
        const receipts = JSON.parse(
          localStorage.getItem("wn-receipts") || "[]",
        );
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
          await render();
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
  root.addEventListener("click", action);
  window.addEventListener("hashchange", onHash);
  await render();
  return () => {
    disposed = true;
    version++;
    root.removeEventListener("click", action);
    window.removeEventListener("hashchange", onHash);
    if (photo) URL.revokeObjectURL(photo);
  };
}
