// 用户可见的英文文案，一处定义。
//
// 标了「逐字」的那些出自 docs/ux-copy.md 与 docs/prompts.md 的 §必须逐字使用的文案，
// 不要就地改——改文档，再改这里。剩下的是原型带来的新文案，已经同步进 ux-copy.md。

export const COPY = {
  levelLabel: { view: "Can view", contribute: "Can add sightings", reshare: "Can reshare" },
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
  // 这一句在抽屉里，不在页脚。首页页脚确实写了「Possum Help is running from fixtures」，
  // 但直接点进某个故事版的人看不到那行字——而「我在跟一个 AI 说话」这个念头，
  // 正是在这个抽屉里形成的。产品里每一处替身都在原地说明自己：二维码占位说了、
  // 挑帧那几张说了、/credits 也说了。助手是最不该含糊的那一个。
  assistantCanned: "Pre-written answers for this demo. Nothing is generated live.",

  // 原型新增，已同步进 ux-copy.md
  captureLede: "Start with a clip you already have.",
  noCameras: "Fencepost doesn't run any cameras. Everything here comes off your own phone.",
  // 原先这句是「This is the still people see in the storyboard.」——那是假的。
  // 挑出来的帧从来没有被带走过：frameIndex 只在挑帧那一屏里被读，提交时不发，
  // 服务端也没有存帧的地方（`videos` 只记 storage_key，而「视觉帧是否落盘」
  // 在 CLAUDE.md 里还是未决项）。界面不该替产品许一个它做不到的承诺。
  frameLede: "Scrub to the moment that shows it best.",
  frameNote: "Placeholder stills. In the real thing these are frames from your own video.",
  maskHint: "Drag across anything that shouldn't be shared",
  // 这一屏刻意**不**铺真实照片。挑帧那边铺了，这边不铺，是因为那四张是负鼠的照片：
  // 在一张树上的负鼠上画一个「FACE」和一个「NUMBER PLATE」的框，等于当着人的面
  // 指着不存在的东西——它会把这道安全闸门演成一个笑话。这一屏演的是机制，不是画面。
  // 所以画布保持抽象，但要说出来它是替身，否则看着只像没做完。
  maskNote:
    "A stand-in frame. The markers show what has to be covered before anything is sent.",
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
  discussion: "Discussion",
  newThread: "Start a thread",
  reply: "Reply",
  shareTitle: "Share this storyboard",
  shareLede: "The code carries the access you set here. It isn't a public link.",
  qrNote: "Placeholder graphic. A real code is generated when you share.",
  whatTheyCanDo: "What they can do",
  linkExpires: "Link expires",
  whoHasAccess: "Who has access",
  revoke: "Revoke",
  // 改与删自己的条目（ux-copy.md §5.5）
  editEntry: "Edit",
  editTitle: "Edit your sighting",
  editHint: "The species stays as you set it. Change the words, not what you saw.",
  saveChanges: "Save changes",
  saving: "Saving…",
  cancel: "Cancel",
  noChanges: "Nothing changed, so nothing was sent.",
  editNotSaved: "Not saved",
  editOriginalKept: "What's on the storyboard is unchanged. Your edit is still here.",
  deleteEntry: "Delete",
  deleteTitle: "Delete this sighting?",
  deleteBody:
    "It comes off the storyboard straight away, and Possum Help stops seeing it. The others stay.",
  deleteConfirm: "Delete it",
  deleted: "Deleted",

  // owner 主动完结（ux-copy.md §5）
  closeStoryboard: "Close this storyboard",
  closeTitle: "Close this storyboard",
  // 逐字，ux-copy.md §5
  closeLede: "Wrapping this one up? You can leave a closing note for everyone who contributed.",
  closePoints: [
    "No one can add new sightings after this",
    "The QR code still works, and everyone who had access keeps it",
    "The Possum Help conversation on this storyboard is cleared",
    "It can't be reopened afterwards",
  ],
  closeNoteLabel: "Your closing line",
  closeNoteHint: "Everyone who can open this storyboard will see it. You can leave it blank.",
  closeNotePlaceholder: "Thanks for filming with me, everyone.",
  closing: "Closing…",
  closeNotRequired:
    "There's no need to do this. A storyboard that goes quiet turns read-only on its own after a month.",
  closed:
    "This storyboard has been wrapped up. The QR code still works, and everyone who had access still has it.",
  closedNoteFrom: "From the person who started this storyboard",

  // 待核实队列与 owner 处置（ux-copy.md §2.5）
  secondLookNav: "Second look",
  secondLookTitle: "Worth a second look",
  secondLookLede:
    "A few details here were picked out as worth reading again. They're all still up on the storyboard, and the people who wrote them haven't been told.",
  secondLookEmpty: "Nothing needs a second look right now.",
  secondLookWindow: "Anything still sitting here after a week clears on its own.",
  // 告诉复核的人「该重读哪一段」，不告诉他们模型判了什么。
  // 把 reason code 摆出来等于请邻居当审查员，而 Screener 本来就不判文采与价值。
  secondLookFact: "The fun fact is the part to read again.",
  secondLookStory: "What happened is the part to read again.",
  secondLookBoth: "Both parts are worth reading again.",
  votedYes: "You said it looks right.",
  votedNo: "Noted — thanks.",
  ownerCall: "You started this storyboard, so the last word is yours.",
  disposeKeep: "Leave it as it is",
  disposeLabel: "Mark it as being checked",
  disposeLabelNote: "Adds the public note. The post stays up.",
  disposeLabelConfirm: "Add the note? It can't be taken off later.",
  disposeRemove: "Take it off the storyboard",
  disposeRemoveConfirm: "Take it off? This can't be undone.",
  disposeDone: "Thanks — that's it for this one.",

  // 已发出去的码与撤销（ux-copy.md §6.5）
  codesForThisBoard: "Codes for this storyboard",
  codesNote:
    "Turning a code off stops anyone new from using it. Whoever already used it keeps the access they have — take that away under Who has access.",
  noCodesYet: "No codes yet. The next one you make shows up here.",
  turnOff: "Turn off",
  codeMadeByYou: "Made by you",
  codeMadeBy: "Made by",
  codeExpires: "Expires",
  codeNoExpiry: "No expiry",
  codeUses: "Used",
  codeState: { revoked: "Turned off", expired: "Expired", used_up: "Used up" },

  noAccessTitle: "This link doesn't work",
  noAccessBody: "Ask whoever shared it with you for a new one.",
};

// 三档权限，从小到大，后面一档包含前面一档。id 与 schema 的 CHECK 一致。
export const LEVELS = [
  { id: "view", label: "Can view", sub: "Read the storyboard and the discussion" },
  { id: "contribute", label: "Can add sightings", sub: "Write their own entries on this storyboard" },
  { id: "reshare", label: "Can reshare", sub: "Pass the QR code on to someone else" },
];

export const EXPIRY = [
  { id: 1, label: "24 hours" },
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: 90, label: "90 days" },
];

// Screener 只回 reason_codes。作者看到的是这些句子，看不到 verdict，也看不到 note。
//
// 逐字抄自 ux-copy.md §1，键名取 prompts.md §4.2 里模型真会吐出来的那些。
// 这里曾经写着 `safety` 和 `scope`——Screener 从来不发这两个码；而真会发的
// nonsense / abuse / spam / harm_advocacy / dangerous_reassurance 一个都没配。
// 后果不是少几行字：被判 nonsense 的人本该读到「说一句你看到了什么就能过」，
// 实际读到的是兜底那句泛泛之词。这些句子是照着人写的，配错了等于没写。
export const REASON_COPY = {
  nonsense:
    "We couldn't find a sighting in this one. Add a line about what you saw and it'll go straight through.",
  pii: "This mentions someone's address or name. Take that part out and you're good to post.",
  abuse: "This one doesn't fit what this space is for. Have another go?",
  spam: "This reads as advertising, so it won't post here. A sighting of your own will.",
  harm_advocacy:
    "We can't post advice about harming wildlife — possums are protected here. You're welcome to describe what happened instead.",
  dangerous_reassurance:
    "Posts about snakes and bats can't include advice on handling them. That's a safety call, not a judgement on your post. Describe the sighting and it'll go through.",
};

// 逐字。ux-copy.md §1 的兜底那句，原先这里是自己另写的一句。
export const REASON_FALLBACK =
  "Something in this post can't go up as written. Edit it and try again — nothing has been lost.";

// §1 写的是「按 codes 取第一条匹配文案」，不是把所有匹配的拼起来。
// 拼起来的话，["harm_advocacy","fact_conflict"] 这种会甩给用户两句叠在一起的话；
// 而 fact_conflict 这类码本来就没有面向作者的文案——它们落到兜底是故意的。
export function reasonSentence(codes) {
  for (const code of codes || []) {
    if (REASON_COPY[code]) return REASON_COPY[code];
  }
  return REASON_FALLBACK;
}
