"use client";

// 13 · Scanning a code lands here. This address is what the code carries.
//
// A successful redemption goes into the storyboard, with the interface narrowed to the
// level that was granted (a view grant gets no posting button). A failure always goes to
// /no-access, with no distinction between expired and revoked — the two must look alike.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { redeemShareLink } from "../../../lib/api";
import { ui } from "../../../components/ui";

export default function Redeem({ params }) {
  const { token } = use(params);
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => alive && setSlow(true), 900);
    redeemShareLink(decodeURIComponent(token)).then(
      (granted) => alive && router.replace("/b/" + granted.storyboard_id + "?via=link"),
      () => alive && router.replace("/no-access")
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, router]);

  return (
    <div className={ui.screen} style={{ justifyContent: "center", padding: "0 28px" }}>
      <p style={{ color: "var(--text-dim)", textAlign: "center" }}>
        {slow ? "Checking the code…" : ""}
      </p>
    </div>
  );
}
