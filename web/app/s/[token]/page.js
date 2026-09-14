"use client";

// 13 · Scanning a code lands here. This address is what the code carries.
//
// A successful redemption goes into the storyboard, with the interface narrowed to the
// level that was granted (a view grant gets no posting button). A refusal from the server
// goes to /no-access, with no distinction between expired and revoked — the two must look
// alike, or a dead link becomes a way of probing which storyboards exist.
//
// A server that cannot be reached is a different thing and gets said differently. It used to
// land on /no-access as well, which told somebody their code was no good and to go and ask
// for another one, when nothing at all was wrong with the code they had.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { redeemShareLink } from "../../../lib/api";
import { COPY } from "../../../lib/copy";
import { ui } from "../../../components/ui";

export default function Redeem({ params }) {
  const { token } = use(params);
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => alive && setSlow(true), 900);
    redeemShareLink(decodeURIComponent(token)).then(
      (granted) => alive && router.replace("/b/" + granted.storyboard_id + "?via=link"),
      (err) => {
        if (!alive) return;
        // Only a refusal from the server says anything about the code. Staying here on a
        // transport failure also keeps the code in the address bar, so a retry is a refresh.
        if (err?.code === "unreachable") return setUnreachable(true);
        router.replace("/no-access");
      }
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, router]);

  return (
    <div className={ui.screen} style={{ justifyContent: "center", padding: "0 28px" }}>
      <p style={{ color: "var(--text-dim)", textAlign: "center" }}>
        {unreachable ? COPY.unreachable : slow ? "Checking the code…" : ""}
      </p>
    </div>
  );
}
