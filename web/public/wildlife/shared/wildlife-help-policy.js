// Predefined project guidance selected locally by recognised observation words.
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
  "This general guidance cannot confirm whether an animal is injured. Contact a wildlife professional if you are concerned.";
export const unknownExplanation =
  "There is not enough information to assess the situation. Observe from a safe distance, keep people and pets away, and contact a recognised wildlife organisation if you remain concerned.";
export const fallbackExplanation =
  "Guidance is temporarily unavailable. Keep your distance and contact a recognised wildlife organisation if you are concerned.";
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
    /\b(?:broken|fractur\w*|damaged|injured|droop\w*|dragging)\s+(?:\w+\s+){0,2}(?:limb|leg|wing)|\b(?:limb|leg|wing)\s+(?:\w+\s+){0,2}(?:broken|fractur\w*|injured)\b|\b(?:looks hurt|appears injured|visibly injured|obvious injury|wound\w*|in pain)\b/i,
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
export function predefinedGuidance(description) {
  const reason = safetySignals(description)[0] || "uncertain";
  const category = ["traffic", "breathing", "bleeding", "injury"].includes(
    reason,
  )
    ? "Urgent assistance recommended"
    : ["trapped", "still", "unusual"].includes(reason)
      ? "Professional advice recommended"
      : reason === "moving"
        ? "Observe safely"
        : "Unable to determine";
  return response(
    category,
    reason,
    reason === "uncertain" ? unknownExplanation : approvedReasons[reason],
  );
}
function response(category, reason, explanation) {
  return {
    category,
    reason,
    explanation,
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
export function safeFallback() {
  return response(
    "Professional advice recommended",
    "uncertain",
    fallbackExplanation,
  );
}
