// /study — the facilitator's switch for study mode (#52). Not linked from anywhere a
// participant would go: the facilitator opens it by address, starts a session, hands the
// phone over, and comes back here to export and delete what was noted.

import Study from "./Study";

export const metadata = {
  title: "Fencepost — study mode",
  robots: { index: false, follow: false },
};

export default function StudyPage() {
  return <Study />;
}
