import { esc, image, fencepostUrl } from "./ui.js";
import { isVerifiedOpportunity } from "./data.js";
export function opportunityCard(o, href) {
  return `<article class="opportunity-card">${image(o.image || "illustration:volunteers", o.title)}<div class="card-body"><p class="status-label opportunity-label">${isVerifiedOpportunity(o) ? "Verified Opportunity" : "SAMPLE COMMUNITY ACTIVITY — PROTOTYPE ONLY"}</p><h3>${esc(o.title)}</h3><p>${esc(o.description)}</p><p class="card-meta">${esc(o.publicArea)} · ${o.dateConfirmed ? esc(o.date) : "To be confirmed"}</p><dl class="compact-meta"><dt>Duration</dt><dd>${esc(o.duration)}</dd><dt>Organiser</dt><dd>${isVerifiedOpportunity(o) ? esc(o.organiser) : "Example organisation · unverified"}</dd><dt>Accessibility</dt><dd>${esc(o.accessibility)}</dd></dl><a class="link-button" href="${esc(href)}">View activity →</a></div></article>`;
}
export function outcomeCard(o, href) {
  const related = o.opportunityId
    ? href.startsWith("#")
      ? "#opportunity/" + o.opportunityId
      : fencepostUrl("opportunity/" + o.opportunityId)
    : null;
  return `<article class="update-card">${image(o.approvedImage || "illustration:park", o.title)}<div class="card-body"><p class="status-label update-label">${o.sample ? "SAMPLE COMMUNITY UPDATE — PROTOTYPE CONTENT" : "Community Update"}</p><h3>${esc(o.title)}</h3><p class="card-meta">${esc(o.publicArea)} · ${o.sample ? "Demonstration date: To be confirmed" : esc(o.completedAt)}</p><p class="card-meta">Activity: ${esc(o.activity || "Habitat care")}</p><p>${esc(o.actionsCompleted)}</p><p class="small"><strong>Why it matters:</strong> ${esc(o.whyItMatters || "Thoughtful habitat care may support wildlife.")}</p><p class="small">${esc(o.communityMessage)}</p><p class="small">Wildlife handling: No wildlife was handled.</p><a class="link-button" href="${esc(href)}">Read update →</a>${related ? `<a class="related-link" href="${esc(related)}" ${href.startsWith("#") ? "" : 'target="_blank" rel="noreferrer"'}>Related sample activity</a>` : ""}</div></article>`;
}
export function outcomeDetail(o, relatedHref) {
  return `<article class="update-detail">${image(o.approvedImage || "illustration:park", o.title, "detail-image")}<p class="status-label update-label">${o.sample ? "SAMPLE COMMUNITY UPDATE — PROTOTYPE CONTENT" : "Community Update"}</p><h1>${esc(o.title)}</h1><p class="card-meta">${esc(o.publicArea)} · ${o.sample ? "Demonstration date: To be confirmed" : esc(o.completedAt)}</p>${o.sample ? '<p class="sample-note">This is fictional exhibition content. It does not describe an activity that really occurred.</p>' : ""}<h2>What volunteers did</h2><p>${esc(o.actionsCompleted)}</p><h2>Why it matters</h2><p>${esc(o.whyItMatters || "Thoughtful habitat care may support local wildlife. No measured impact is claimed.")}</p><h2>Community message</h2><p>${esc(o.communityMessage)}</p><p class="notice">Wildlife handling: No wildlife was handled.</p>${relatedHref ? `<a class="link-button" href="${esc(relatedHref)}">View related sample activity →</a>` : ""}</article>`;
}
