"use client";

// A short code lands here (#54): typed into "Got a code from a neighbour?", or scanned off
// the square beside it, which carries /c/<code>. The same three answers as /s/[token]: into
// the storyboard at the level granted, /no-access for a refusal (expired, turned off, used
// up and wrong all look alike), or stay put when the trouble says nothing about the code.
//
// One more of those here than there: too many codes tried this hour. That is about the
// guessing limit, not about this code, so it is said rather than turned into "this link
// does not work", which would tell somebody holding a good code to go and get another.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { redeemShortCode } from "../../../lib/api";
import { ui } from "../../../components/ui";

const STAYS = new Set(["unreachable", "session_ended", "rate_limited"]);

export default function RedeemCode({ params }) {
  const { code } = use(params);
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const [stopped, setStopped] = useState(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => alive && setSlow(true), 900);
    redeemShortCode(decodeURIComponent(code)).then(
      (granted) => alive && router.replace("/b/" + granted.storyboard_id + "?via=link"),
      (err) => {
        if (!alive) return;
        if (STAYS.has(err?.code)) return setStopped(err.message);
        router.replace("/no-access");
      }
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code, router]);

  return (
    <div className={ui.screen} style={{ justifyContent: "center", padding: "0 28px" }}>
      <p style={{ color: "var(--text-dim)", textAlign: "center" }} role="status">
        {stopped || (slow ? "Checking the code…" : "")}
      </p>
    </div>
  );
}
