"use client";

// 13 · 扫码落地。码里带的就是这个地址。
//
// 兑换成功就进故事版，界面按拿到的那一档权限收缩（view 档没有投稿按钮）。
// 失败一律去 /no-access，不区分过期还是被撤销——两者看起来必须一样。

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
