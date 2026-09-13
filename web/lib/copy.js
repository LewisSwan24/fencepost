// 用户可见的英文文案，一处定义。
//
// 标了「逐字」的那些出自 docs/ux-copy.md 与 docs/prompts.md 的 §必须逐字使用的文案，
// 不要就地改——改文档，再改这里。剩下的是原型带来的新文案，已经同步进 ux-copy.md。

export const COPY = {
  // 逐字
  maskBlocked: "There's still a face or plate showing. Mask it to continue.",
  maskLede: "Anything that identifies a person or a house needs covering.",
  consentTitle: "Send this frame for identification?",
  consentBody:
    "One frame from your video will be sent to an AI service to help work out which possum it is.",
  consentPoints: [
    "Location data is removed before it's sent",
    "Faces and number plates need masking first",
    "The frame isn't kept afterwards",
  ],
  consentSend: "Mask and send",
  consentSkip: "Skip — I'll pick the species myself",
  archived:
    "This storyboard has gone quiet, so it's now read-only. The QR code still works, and everyone who had access still has it.",
  checkedLabel: "Being checked by neighbours",
  checkedBody:
    "Someone flagged a detail here as worth double-checking. The post stays up while that happens, and the author can reply.",
  checkedYes: "Looks right",
  checkedNo: "Worth checking",
  assistantOffline: "The assistant is offline right now. Writing and posting work as normal.",

  // 原型新增，已同步进 ux-copy.md
  captureLede: "Start with a clip you already have.",
  noCameras: "Fencepost doesn't run any cameras. Everything here comes off your own phone.",
  frameLede: "This is the still people see in the storyboard.",
  maskHint: "Drag across anything that shouldn't be shared",
  helperDisclosure: "AI suggestions. Nothing goes into your post unless you put it there.",
  helperEmpty: "No fun facts for this one. Possum Help only knows brushtail and ringtail possums.",
  helperOpen: "Possum Help — writing suggestions",
  addFact: "Add to fun fact",
  useTidied: "Replace my story with the tidied one",
  post: "Post to storyboard",
  posted: "Added to the storyboard",
  blockedTitle: "Not posted",
  blockedKept: "Your writing is still there, exactly as you left it.",
  backToEditing: "Back to editing",
  addSighting: "Add your sighting",
  askAssistant: "Ask Possum Help",
};

// Screener 只回 reason_codes。作者看到的是这些句子，看不到 verdict，也看不到 note。
export const REASON_COPY = {
  pii: "This mentions someone's address or name. Take that part out and you're good to post.",
  safety: "There's a safety claim in here that needs another look. Reword it and try again.",
  scope: "This one is outside what Fencepost covers.",
};

export function reasonSentence(codes) {
  const known = (codes || []).map((c) => REASON_COPY[c]).filter(Boolean);
  return known.length ? known.join(" ") : "Something in this post needs changing before it goes up.";
}
