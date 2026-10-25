import { tidy, writingVariant } from "./writer-port.js";
import { privacyIssues,checkComment } from "./comment-safety.js";
const prompts = [
  "Check whether you included an approximate time and a broad area.",
  "Describe what the animal did without claiming a certain identification.",
  "Keep only what you personally observed. A short description is enough.",
];
export function validateWritingInput(text) {
  if (!String(text || "").trim())
    throw Error(
      "Add a few details about what you observed before requesting writing help.",
    );
  if(checkComment(text).errors.some(error=>error.startsWith("Remove instructions")||error.startsWith("Remove abusive")))throw Error("Writing help is for observations, not instructions to feed or handle wildlife. You can continue editing your own description.");
  if (privacyIssues(text).length)
    throw Error(
      "Remove exact locations and personal information from the description before requesting writing help. Media and private rescue fields are never sent.",
    );
}
export async function demoWritingHelp({ text, variant = 0, signal }) {
  validateWritingInput(text);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 180);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
  return {
    tidied_story: writingVariant(text, tidy(text), variant),
    question: prompts[variant % prompts.length],
    mode: "prewritten-demo",
  };
}
export function validatedSuggestion(result, original) {
  const text = String(result?.tidied_story || "").trim();
  if(text)validateWritingInput(text);
  if (
    !text ||
    text.length > 600 ||
    privacyIssues(text).length ||
    /\b(?:definitely identified|certainly (?:a|an)|you should (?:feed|catch|handle)|medical advice|rescue instructions)\b/i.test(
      text,
    )
  )
    throw Error(
      "Writing help is unavailable right now. You can continue editing and submit your own description.",
    );
  if (
    /\bpossible|\bnot sure|\bmight|\bperhaps|\bmaybe|\bpossibly|\bcould be/i.test(original) &&
    !/\bpossible|\bnot sure|\bmight|\bperhaps|\bmaybe|\bpossibly|\bcould be/i.test(text)
  )
    throw Error(
      "Writing help is unavailable right now. You can continue editing and submit your own description.",
    );
  const words = (value) =>
    String(value)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  const allowed = new Set([
    ...words(original),
    ...words(
      "I we a an the it and but or so then in on at by from to of was were is are am had has have with without that this there here my our saw noticed observed possible possibly may might not sure about animal species description observation",
    ),
  ]);
  if (words(text).some((word) => !allowed.has(word)))
    throw Error(
      "Writing help is unavailable right now. You can continue editing and submit your own description.",
    );
  return {
    suggestion: text,
    question: result.question || "",
    mode: result.mode || "ai-suggestion",
  };
}
