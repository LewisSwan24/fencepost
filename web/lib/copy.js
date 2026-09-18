// User-facing English copy, defined in one place.
//
// Anything marked "verbatim" comes from the must-be-used-word-for-word sections of
// docs/ux-copy.md and docs/prompts.md — do not edit it here; edit the document, then edit
// this. The rest arrived with the prototype and has been mirrored back into ux-copy.md.

export const COPY = {
  levelLabel: { view: "Can view", contribute: "Can add sightings", reshare: "Can reshare" },
  // verbatim
  maskBlocked: "There's still a face or plate showing. Mask it to continue.",
  maskLede: "Anything that identifies a person or a house needs covering.",
  consentTitle: "Send this frame for identification?",
  consentBody:
    "One frame from your video will be sent to an AI service to help work out which possum it is.",
  // Four bullets rather than three, because the third was doing two jobs and only getting one
  // of them right. "The frame isn't kept afterwards" was written when nothing was kept; since
  // entries.still it is false on the screen where it matters most, because both buttons on
  // this sheet store a masked copy of the frame on the sighting. The sentence was never
  // updated when that landed, so a consent sheet — of every screen in this product — was the
  // one telling somebody the opposite of what the code does. Caught by an adversarial review.
  //
  // Both halves are said out loud now: the copy sent away is not kept, and the copy that stays
  // is the picture on their own sighting, where they can see it and where deleting the entry
  // takes it with them. Nobody should have to read lib/stills.js to find that out.
  consentPoints: [
    "Location data is removed before it's sent",
    "Faces and number plates need masking first",
    "The copy sent for identification isn't kept",
    "The masked frame stays as the picture on your sighting",
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
  // Shown when fetch rejects before there is a response: the network is down, DNS failed,
  // or the browser refused the origin. Without it the screen carries whatever string that
  // browser happens to use, which reads like a broken site rather than one that cannot be
  // reached, and differs depending on what they opened it in.
  unreachable: "Can't reach Fencepost right now. Try again in a moment.",
  // Shown when the browser will not keep anything for this site. Fencepost has no logins
  // for a visitor, so the one thing standing between two people's entries is a name this
  // browser remembers. Without it there is no way to be the same person twice, and saying
  // so is more use than quietly making them somebody new on every reload.
  needsStorage: "This browser isn't letting Fencepost remember who you are, so your sightings could not stay yours. Allow site data for this page, or open it in a normal window.",
  // This line lives in the drawer, not in the footer. The home page footer does say "Possum
  // Help is running from fixtures", but somebody who opens a storyboard directly never sees
  // it — and the thought "I am talking to an AI" forms inside this drawer. Every stand-in in
  // this product explains itself where it stands: the QR placeholder does, the frame stills
  // do, /credits does. The assistant is the last one that should be vague about it.
  assistantCanned: "Pre-written answers for this demo. Nothing is generated live.",

  // Asked once, on the first visit, before anything exists to write. It cannot be a setting
  // on the profile screen: changing a handle makes you a different user on the server and
  // your sightings do not come with you, which is the same thing the sign-in screen already
  // says out loud. Skipping is a first-class answer, not a failure — it gives the random
  // name, which is what everybody got until now.
  nameTitle: "What should we call you?",
  nameLede: "This is what sits beside your sightings and in the list of who a storyboard is shared with. It isn't an account and there's no password.",
  nameLabel: "Your name",
  namePlaceholder: "Sam from #14",
  nameGo: "That's me",
  nameSkip: "Skip — give me a random name",
  // Shown under the field as they type, because a handle is not quite what they typed and
  // finding that out afterwards is worse than being told now. The suffix is not decoration:
  // it is what stops two people called Sam becoming the same person.
  namePreview: "You'll appear as",
  nameWhySuffix: "The few characters on the end keep you separate from anyone else with the same name.",

  // Accounts, added 2026-09-15. Until now identity was a handle this browser made up, and
  // there was nowhere to see it or change it.
  signInTitle: "Sign in",
  registerTitle: "Make an account",
  signInLede: "Your storyboards and sightings follow the account, on whatever you sign in on.",
  registerLede: "Pick a name people will see beside what you write.",
  // Said on the form rather than discovered later. There is no email service behind this
  // prototype, so there is no way to send a reset link, and a person who assumes otherwise
  // finds out at the worst possible moment.
  noReset: "There's no password reset: this prototype can't email you. Keep it somewhere safe.",
  handleLabel: "Name",
  passwordLabel: "Password",
  toRegister: "No account yet? Make one.",
  toSignIn: "Already have one? Sign in.",
  youTitle: "You",
  guestTitle: "Looking around as a guest",
  // Accurate rather than reassuring. An account is a different identity, so entries written
  // as a guest do not move across. They are not lost either, and saying which it is matters:
  // signing out returns you to the same guest, and they are still there.
  guestBody:
    "This browser made you a name so you could try things out. An account is a separate identity: what you posted as a guest stays with the guest, and signing out brings you back to it.",
  signOut: "Sign out",
  // ux-copy.md 5.8. Shown when an account's sign-in stops working - it expired, or Sign out
  // was pressed somewhere else. Not the server's "unauthorized" line, which is about the
  // assistant; and deliberately not a silent switch to the guest identity, which is what
  // happened before and posted under a different name.
  sessionEnded: "Your sign-in has ended. Sign in again, or reload the page to carry on as a guest.",
  accessTitle: "What you can reach",
  accessEmpty: "Nothing yet. A storyboard you make, or a code somebody shares with you, turns up here.",

  // Added with the prototype, mirrored into ux-copy.md
  captureLede: "Start with a clip you already have.",
  noCameras: "Fencepost doesn't run any cameras. Everything here comes off your own phone.",
  captureReading: "Reading your clip…",
  // Both buttons open a file picker, and a picker that gets cancelled fires no event at
  // all — so without this line somebody on a laptop with no clip to hand is simply stuck
  // on this screen. It is also the line that keeps the placeholder path reachable on
  // purpose rather than only by failure.
  captureSkip: "No clip on this device? Carry on with placeholder stills.",

  // The viewfinder.
  //
  // Record opens a camera inside the page rather than handing off to the phone's camera app.
  // That started as a bug fix — the handoff asked Android for a video-capture intent and the
  // stock camera app opened and bounced straight back out — but the page is the better place
  // for it anyway: one screen does both a photograph and a recording, which the handoff
  // cannot, because an input element gets to name exactly one capture intent.
  //
  // "Record" stays the word on the button. Filming and photographing what is in front of you
  // are the same act from where the person holding the phone is standing.
  cameraModePhoto: "Photo",
  cameraModeVideo: "Video",
  cameraPhotoHint: "Point at the possum and press the button.",
  // Says where the frames come from, because this is the one screen where somebody could
  // reasonably expect a video file at the end of it, and there is never going to be one.
  cameraVideoHint: "Press to start, press again to stop. Fencepost keeps still frames from what you film, not the footage.",
  cameraStarting: "Opening the camera…",
  cameraClose: "Close the camera",
  // One label for both directions. "Switch to front camera" would have to know which way it
  // is pointing, and a label that lies for a moment during the swap is worse than a plain one.
  cameraFlip: "Switch camera",
  cameraTakePhoto: "Take a photograph",
  cameraStartVideo: "Start recording",
  cameraStopVideo: "Stop recording",
  // Four different reasons the camera does not open, and they are four different stories with
  // four different things to do about them. Collapsing them into one "camera unavailable" is
  // how somebody ends up reading "this device hasn't got a camera" while holding a phone with
  // two, because another app happens to have the lens — which is the commonest failure on
  // Android and the only one that is fixed in ten seconds.
  //
  // Being refused is an ordinary answer rather than an error, so each sentence says what to do
  // next instead of what went wrong. A permission the browser has already been told to refuse
  // cannot be asked for again from script, which is why that one points at the address bar
  // rather than offering a button that would quietly do nothing.
  cameraDeniedTitle: "Fencepost can't reach the camera",
  cameraDeniedBody: "Your browser is holding the camera back. You can allow it from the address bar, or use the phone's own camera app instead.",
  cameraMissingTitle: "No camera on this device",
  cameraMissingBody: "There's no camera here for Fencepost to open. You can still use a photo or a clip you already have.",
  cameraBusyTitle: "Something else has the camera",
  cameraBusyBody: "Another app is using the camera right now. Close it and try again, or use the phone's own camera app instead.",
  cameraBlockedTitle: "Fencepost can't reach the camera",
  cameraBlockedBody: "The camera didn't open, and the browser didn't say why. You can use the phone's own camera app instead.",
  cameraFallback: "Use the phone camera app",
  cameraUseLibrary: "Choose something you already have",
  // This used to read "This is the still people see in the storyboard.", which was false.
  // The chosen frame has never been carried anywhere: frameIndex is read only on the frame
  // screen, it is not sent on submit, and the server has nowhere to put a frame (`videos`
  // records only a storage_key, and whether frames are persisted is still open in
  // CLAUDE.md). The interface should not make a promise the product cannot keep.
  frameLede: "Scrub to the moment that shows it best.",
  frameNote: "Placeholder stills. In the real thing these are frames from your own video.",
  // Shown instead of the line above once the stills are real. It says where they are,
  // because that is the part somebody would otherwise assume wrongly: nothing about the
  // clip leaves the phone on this screen, and the frame reaches the assistant only on the
  // next one, once the covering-up gate has been passed.
  frameNoteLive: "Frames from your own clip, read on this phone. The video itself is not uploaded.",
  // A photograph has no timeline, so there is nothing to scrub and no timestamp to stamp on
  // it. Reached only by coming back from the next screen — taking a photograph skips this
  // one, because picking a frame from one frame is not a choice.
  framePhoto: "Your photograph. There is nothing to scrub through, so this is the one.",
  maskHint: "Drag across anything that shouldn't be shared",
  // This screen used to draw a FACE box and a NUMBER PLATE box from the fixture, over an
  // abstract canvas with no picture under it. Two invented rectangles, in fixed positions,
  // bearing no relation to what anybody had filmed — and the gate was "cover those two".
  // Somebody could follow it exactly and leave a real face showing, because the markers
  // were never looking at their footage. The screen was a demonstration of a mechanism
  // wearing the clothes of a safety check.
  //
  // Now the frame underneath is the one they chose, and nothing pretends to know what is in
  // it. Automatic detection is the right answer and this prototype does not have it, so the
  // honest fallback is the one docs/prompts.md §2.5.1 already specifies: 强制手动框选打码 —
  // you say what needs covering, and saying "nothing does" is a deliberate act rather than
  // the default.
  maskNote: "This is the frame you picked. Nothing is detected automatically — cover what you know is there.",
  maskNoFrame: "No frame from a clip this time, so there is nothing here to cover.",
  // A photograph was not picked out of anything, so it is not "the frame you picked".
  maskPhoto: "Your photograph. Nothing is detected automatically — cover what you know is there.",
  maskNothing: "Nothing in this frame identifies a person or a house",
  maskBlockedNow: "Cover what needs covering, or tick the line below to say there's nothing.",
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
  // ux-copy.md 5.7. Drawn only when the server says there is another page: it hands back
  // `next`, and a button that could be pressed for nothing is the thing web/README.md
  // says not to draw.
  moreSightings: "Show more sightings",
  askAssistant: "Ask Possum Help",
  discussion: "Discussion",
  newThread: "Start a thread",
  reply: "Reply",
  shareTitle: "Share this storyboard",
  shareLede: "The code carries the access you set here. It isn't a public link.",
  // Two captions, because the square underneath means two different things. Before anything
  // is issued there is nothing to encode, so what is drawn is a pattern and says so. After,
  // it is the code itself, and the sentence has to say what scanning it actually does —
  // somebody is about to point another person's phone at it.
  qrNote: "Placeholder graphic. A real code is generated when you share.",
  qrLive: "Point a camera at this. It opens the storyboard at the access above, until it expires or you turn it off.",
  whatTheyCanDo: "What they can do",
  linkExpires: "Link expires",
  whoHasAccess: "Who has access",
  revoke: "Revoke",
  // Editing and deleting your own entry (ux-copy.md §5.5)
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

  // Taking down your own forum post. Worded as withdrawing rather than deleting: the
  // replies under it stay where they are, and promising more than that would be a lie the
  // first time somebody used it on a thread other people had answered.
  deletePost: "Take it down",
  deletePostTitle: "Take down this post?",
  deletePostBody:
    "It comes off the thread straight away. Anything other people wrote stays.",
  deletePostConfirm: "Take it down",

  // The owner clearing somebody else's writing off their own storyboard. Worded so that
  // what it is cannot be mistaken: not "delete", which is what you do to your own, and not
  // silent either — the database records who did it, and the person doing it should know
  // that before they do it rather than afterwards.
  removeIt: "Remove",
  removeTitle: "Remove this from your storyboard?",
  removeBody:
    "It comes off straight away and Possum Help stops seeing it. You started this storyboard, so this is yours to do — and it is recorded as yours.",
  removeConfirm: "Remove it",
  removed: "Removed",

  // Your own record, on your own page, and nobody else can see it. CLAUDE.md rules out
  // points, streaks, badges and leaderboards because they characterise contributors, and
  // that reason holds for a plain count too the moment somebody else can read it. This one
  // nobody else can, it ranks nothing, and it rewards nothing — a possum turning up is not
  // something anybody can schedule, so a mechanism that pushed for frequency would be
  // pushing for invented sightings.
  //
  // What it is actually for is the last line: "your last one was three days ago" is what
  // reminds somebody there is still footage on their phone.
  recordTitle: "What you've kept",
  recordNone: "Nothing yet. What you write turns up here, and only here — nobody else sees this.",
  recordLatest: "Most recent",
  recordNever: "none yet",

  // The owner closing it deliberately (ux-copy.md §5)
  closeStoryboard: "Close this storyboard",
  closeTitle: "Close this storyboard",
  // verbatim, ux-copy.md §5
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

  // The second-look queue and the owner's disposal (ux-copy.md §2.5)
  secondLookNav: "Second look",
  secondLookTitle: "Worth a second look",
  secondLookLede:
    "A few details here were picked out as worth reading again. They're all still up on the storyboard, and the people who wrote them haven't been told.",
  secondLookEmpty: "Nothing needs a second look right now.",
  secondLookWindow: "Anything still sitting here after a week clears on its own.",
  // Tell the reviewer which part to read again, not what the model decided. Putting the
  // reason code in front of them makes a censor of a neighbour, and the Screener does not
  // even judge writing quality or worth.
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

  // Codes already issued, and revoking (ux-copy.md §6.5)
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

// The three access levels, smallest first, each containing the one before it. The ids match
// the CHECK in the schema.
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

// Which of those the share screen starts on. Must match SHARE_LINK_DAYS in proxy/app.py,
// where the reason for seven is written down; tests/test_resources.py reads this line and
// fails if the two part. It must also be one of the ids above, or the screen opens with no
// chip selected and sends a number the owner never saw — lib/fixtures.test.mjs checks that.
export const DEFAULT_EXPIRY_DAYS = 7;

// The Screener returns only reason_codes. What an author sees is these sentences; they
// never see the verdict or the note.
//
// Copied word for word from ux-copy.md §1, keyed on the codes the model actually emits per
// prompts.md §4.2. This table once held `safety` and `scope` — codes the Screener never
// sends — while nonsense / abuse / spam / harm_advocacy / dangerous_reassurance, the ones
// it really does send, had no entry at all. The consequence was not a few missing lines:
// somebody judged nonsense should have read "add a line about what you saw and it will go
// straight through" and instead read the generic fallback. These sentences were written
// for a person, and keyed wrongly they may as well not exist.
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

// verbatim. The fallback sentence from ux-copy.md §1 — this used to be a different line,
// written here rather than taken from the document.
export const REASON_FALLBACK =
  "Something in this post can't go up as written. Edit it and try again — nothing has been lost.";

// §1 says to take the first matching sentence for the codes, not to join every match.
// Joined, ["harm_advocacy","fact_conflict"] would hand somebody two sentences stacked
// together; and codes like fact_conflict have no author-facing sentence at all — their
// falling through to the fallback is deliberate.
export function reasonSentence(codes) {
  for (const code of codes || []) {
    if (REASON_COPY[code]) return REASON_COPY[code];
  }
  return REASON_FALLBACK;
}
