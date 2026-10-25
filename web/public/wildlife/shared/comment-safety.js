export const reportReasons = [
  "Exact wildlife location",
  "Personal information",
  "Unsafe wildlife advice",
  "Harassment or abusive language",
  "Spam",
  "Other concern",
];
const patterns = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  phone:
    /(?:\+?61[ -]?(?:\(0\)[ -]?)?|\b0)[23478](?:[ ()-]*\d){8}\b|\b\d{3}[ -]\d{3}[ -]\d{4}\b|\b(?:call|phone|mobile|tel)\s*:?\s*(?:\+?\d[ ()-]*){8,13}/i,
  address:
    /\b\d{1,5}[A-Z]?\s+(?:[A-Z][A-Z'-]*\s+){1,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|crescent|cres|place|pl|terrace|tce|way|parade|pde)\b/i,
  coordinates: /\b-?\d{1,3}\.\d{4,}\s*[,/]\s*-?\d{1,3}\.\d{4,}\b/,
  plate:
    /\b(?:plate|rego|registration number)\s*(?:is|:|#)?\s*[A-Z0-9 -]{3,10}\b|\b[A-Z]{3}[- ]?\d{3}\b|\b\d{3}[- ]?[A-Z]{3}\b|\b\d{3}[- ]?[A-Z]{2}\d\b/i,
  dangerous:
    /(?<!\b(?:not |never ))\b(?:you should|you can|we should|we can|let'?s|try to|please|go and|everyone should)\s+(?:feed|catch|grab|handle|pick up|trap|chase)\b|^\s*(?:feed|catch|grab|handle|pick up|trap|chase)\s+(?:the |a |that |this )?(?:animal|possum|bat|flying fox|kangaroo|bird|lizard|wildlife|it|them)\b|\b(?:give|offer)\s+(?:the |a )?(?:possum|animal|wildlife|bird|kangaroo)\s+(?:some )?(?:food|bread|milk)\b/i,
  abuse:
    /\b(?:i will kill you|i'll kill you|kill yourself|i will hurt you|i'll hurt you|you (?:are |are a |are an )?(?:idiot|moron|scum)|fuck (?:you|off))\b/i,
};
export function privacyIssues(text) {
  const t = String(text || "");
  return Object.entries(patterns)
    .filter(
      ([key, re]) =>
        ["email", "phone", "address", "coordinates", "plate"].includes(key) &&
        re.test(t),
    )
    .map(([key]) => key);
}
export function checkComment(text) {
  const body = String(text || "").trim(),
    errors = [],
    warnings = [];
  if (!body || body.length > 500)
    errors.push("Write a comment of 1–500 characters.");
  if (privacyIssues(body).length)
    errors.push(
      "Remove exact addresses, coordinates, phone numbers, email addresses and number plates before posting.",
    );
  if (patterns.dangerous.test(body))
    errors.push(
      "Remove instructions encouraging people to feed, catch or handle wildlife.",
    );
  if (patterns.abuse.test(body))
    errors.push("Remove abusive or threatening language before posting.");
  if (/\b(?:stupid|ridiculous|hate|shut up)\b/i.test(body))
    warnings.push("This wording may feel disrespectful. Consider revising it.");
  if (/https?:\/\/|\b(?:buy now|free money|special offer)\b/i.test(body))
    warnings.push(
      "Links or promotional wording can look like spam. Check that this is relevant.",
    );
  if (
    /\b(?:my house|my home|behind my fence|front door|at number)\b/i.test(body)
  )
    warnings.push(
      "Check that this does not identify a home or an exact wildlife location.",
    );
  return { body, errors, warnings };
}
export function requireSafeComment(text, acknowledged = false) {
  const result = checkComment(text);
  if (result.errors.length) throw Error(result.errors.join(" "));
  if (result.warnings.length && !acknowledged)
    throw Error(
      result.warnings.join(" ") +
        " Revise it, or confirm that you checked the wording.",
    );
  return result.body;
}
