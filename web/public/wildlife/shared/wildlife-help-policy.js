// Approved project safety copy: the model selects from these records, never
// supplies medical prose, contacts, handling instructions or factual sources.
import { privacyIssues } from "./comment-safety.js";
export const helpSource = {
  title: "Queensland Government — Care of sick, injured or orphaned wildlife",
  url: "https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife",
};
export const helpCategories = [
  "Observe safely",
  "Professional advice recommended",
  "Urgent assistance recommended",
  "Unable to determine",
];
export const starterPrompts = [
  "The animal is not moving",
  "I can see bleeding",
  "The animal may be trapped",
  "It is close to moving traffic",
  "It is moving but seems unusual",
  "I cannot tell if it is hurt",
];
export const helpTransparency =
  "AI guidance is based only on your description. It may be incorrect and cannot examine or diagnose the animal.";
export const offlineNotice =
  "AI is currently unavailable. Safe offline guidance is being shown instead.";
export const fallbackExplanation =
  "The system could not assess this situation reliably. Keep your distance and contact a recognised wildlife organisation if you are concerned.";
export const approvedReasons = {
  traffic: "Moving traffic creates immediate risk for people and wildlife.",
  breathing: "Difficulty breathing needs prompt professional assessment.",
  bleeding: "Visible bleeding may need prompt professional assessment.",
  injury: "Signs of possible injury need professional assessment.",
  trapped: "A trapped or tangled animal may need a trained responder.",
  still: "Stillness alone cannot show whether an animal is injured.",
  unusual: "Unusual movement can have several causes.",
  moving: "Movement alone does not confirm the animal’s condition.",
  uncertain: "A description cannot reliably establish an animal’s condition.",
};
const signs = [
  [
    "traffic",
    /\b(?:moving traffic|traffic|road|highway|motorway|cars|vehicles|busy road|middle of (?:a |the )?road|on (?:a |the )?road|roadway|hit by (?:a )?(?:car|vehicle))\b/i,
  ],
  [
    "breathing",
    /\b(?:difficulty breathing|struggl\w* to breathe|gasp\w*|cannot breathe|can'?t breathe|breathing (?:hard|badly)|labou?red breath\w*|heavy breathing|breathing difficult\w*|not breathing)\b/i,
  ],
  ["bleeding", /\b(?:bleed\w*|blood\w*|open wound\w*)\b/i],
  [
    "injury",
    /\b(?:broken|fractur\w*|damaged|injured|droop\w*|dragging)\s+(?:\w+\s+){0,2}(?:limb|leg|wing)|\b(?:limb|leg|wing)\s+(?:\w+\s+){0,2}(?:broken|fractur\w*|injured)\b|\b(?:hurt|injured|injury|wound\w*|pain)\b/i,
  ],
  ["trapped", /\b(?:trapp\w*|tangl\w*|entangl\w*|caught|stuck|snar\w*)\b/i],
  [
    "still",
    /\b(?:not moving|isn'?t moving|immobile|paralys\w*|unable to (?:move|walk|stand|fly)|can'?t (?:walk|stand|fly)|cannot (?:walk|stand|fly)|cannot move|can'?t move|motionless|unresponsive|collapsed|lying still|lying (?:beside|on)|won'?t move|not responding)\b/i,
  ],
  [
    "unusual",
    /\b(?:unusual|stagger\w*|limp\w*|wobbl\w*|disorient\w*|circling|dazed|strange)\b/i,
  ],
  [
    "moving",
    /\b(?:moving (?:freely|normally)|walking normally|hopping normally|flying normally|grazing quietly|climbing normally)\b/i,
  ],
];
export function descriptionIssue(input) {
  if (typeof input !== "string" || !input.trim())
    return "Describe what you noticed or select one of the prompts below.";
  if (input.length > 600) return "Keep the description to 600 characters.";
  if (
    privacyIssues(input).length ||
    /\b(?:[Mm]y name is|[Nn]ame\s*:|[Ii] am called|[Ii]'?m called|[Ii] am [A-Z][a-z]+ [A-Z][a-z]+|[Ii]'?m [A-Z][a-z]+|[Mm]y (?:home|house|address)|exact location|gps|at number|unit \d|apartment \d)/.test(
      input,
    ) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)
  )
    return "Remove names, contact details, exact locations and number plates. Describe only the animal and what it is doing.";
  return null;
}
export function safetySignals(description) {
  return signs.filter(([, re]) => re.test(description)).map(([key]) => key);
}
const highRisk = [
  "traffic",
  "breathing",
  "bleeding",
  "injury",
  "trapped",
  "still",
];
export function makeGuidance(description, selection, mode = "live") {
  const detected = safetySignals(description),
    risk = detected.find((key) => highRisk.includes(key));
  let { category, reason } = selection;
  // High-risk descriptions take precedence over every model-selected category.
  if (risk) {
    reason = risk;
    category = ["traffic", "breathing", "bleeding", "injury"].includes(risk)
      ? "Urgent assistance recommended"
      : "Professional advice recommended";
  }
  if (category === "Observe safely" && detected.includes("unusual"))
    category = "Professional advice recommended";
  if (category === "Observe safely" && !detected.includes("moving"))
    category = "Unable to determine";
  return {
    category,
    reason,
    mode,
    explanation:
      mode === "fallback"
        ? fallbackExplanation
        : mode === "offline"
          ? `${approvedReasons[reason]} ${fallbackExplanation}`
          : approvedReasons[reason],
    now:
      reason === "traffic"
        ? "Keep clear of traffic. Seek recognised wildlife assistance."
        : category === "Observe safely"
          ? "Watch quietly from a distance. Seek professional advice if concerned."
          : "Keep people and pets away. Seek recognised wildlife assistance.",
    avoid:
      "Do not touch, feed, free or move wildlife without qualified responder instructions.",
    professional:
      category === "Observe safely"
        ? "Recommended if you remain concerned."
        : "Recommended; contact the organisation directly.",
    uncertainty: "Condition and species are unconfirmed.",
    source: helpSource,
  };
}
export function offlineGuidance(description) {
  const reason = safetySignals(description)[0] || "uncertain";
  return makeGuidance(
    description,
    { category: "Professional advice recommended", reason },
    "offline",
  );
}
export function safeFallback(description) {
  return makeGuidance(
    description,
    { category: "Professional advice recommended", reason: "uncertain" },
    "fallback",
  );
}
export function validateSelection(value, description) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "category,reason" ||
    !helpCategories.includes(value.category) ||
    !Object.hasOwn(approvedReasons, value.reason)
  )
    return null;
  const detected = safetySignals(description);
  if (value.reason !== "uncertain" && !detected.includes(value.reason))
    return null;
  return value;
}
export function validateGuidance(value, description) {
  if (!value || !["live", "offline", "fallback"].includes(value.mode))
    return null;
  const selection = validateSelection(
    { category: value.category, reason: value.reason },
    description,
  );
  if (!selection) return null;
  const expected = makeGuidance(description, selection, value.mode);
  return JSON.stringify(value) === JSON.stringify(expected) ? expected : null;
}
// The network boundary carries only these general sign codes, never free text,
// species assertions, identity, an address, media or a precise location.
const signDescriptions = {
  traffic: "moving traffic",
  breathing: "difficulty breathing",
  bleeding: "bleeding",
  injury: "injured",
  trapped: "trapped",
  still: "not moving",
  unusual: "unusual movement",
  moving: "moving normally",
};
export function validateSigns(value) {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    new Set(value).size === value.length &&
    value.every(
      (code) =>
        typeof code === "string" && Object.hasOwn(signDescriptions, code),
    )
  );
}
export function signsDescription(codes) {
  return (
    codes.map((code) => signDescriptions[code]).join(". ") ||
    "Condition unclear"
  );
}
