#!/usr/bin/env python3
"""对着真实部署跑一遍完整链路 —— issue #6 要的就是这个。

    python scripts/verify_deployment.py https://fencepost-xxxx.vercel.app
    python scripts/verify_deployment.py <url> --bypass <protection-bypass-token>

走一遍：404、坏令牌 401、换令牌、建故事版、提交 entry、读时间线、Screener 是不是真跑了、
复核队列、分享链（签发、第二个人兑换、关掉、关掉之后兑不动、关码不动已有权限）、
论坛（发主题、回帖、回帖被拒带 reason）、Neighbour 非流式与流式、Writer、submission 限流。
七次真模型调用（四次 Screener、三次助手），限流那一圈零调用。

**URL 要用生产别名**（`fencepost-omega.vercel.app` 这种），不是 `vercel deploy` 打印的那个
`fencepost-<hash>-<team>.vercel.app`。后者被 Deployment Protection 挡着，生产别名默认不挡。
`vercel inspect <deployment>` 能看到别名。

纯标准库，不 import 仓库里的任何东西，也不读 .env —— 令牌是从部署自己的 /api/session
换来的，不在本机签。这不是洁癖：storyboards.owner_id 有外键指向 users.id，本机签出来的
令牌对应的用户在那边的库里根本不存在，插入会撞外键。

所以部署上要开 FENCEPOST_OPEN_SIGNUP。它默认关着是对的（谁都能拿别人的 handle 换令牌），
但**交付维持 hybrid，所以线上这个 flag 留着不删**（2026-09-13 定，理由见 CLAUDE.md 决策表
与 web/README.md）：删了它 /api/session 就关上，前端换不到令牌，整个站打开是空白。
代价写在明处——线上那个库里只放 demo 数据。

新专案默认开着 Deployment Protection，请求拿到的是 Vercel 的登录页而不是我们的 JSON。
要么在专案设置里关掉，要么传 --bypass。
"""

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request


class Client:
    def __init__(self, base, bypass=None):
        self.base = base.rstrip("/")
        self.bypass = bypass
        self.frame_times = []      # 每一帧到达的时刻，用来判平台有没有缓冲
        # 带 _vercel_share 的链接是靠 cookie 放行的，所以整个会话得共用一个 jar
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def prime(self, share_url):
        """先访问一次分享链接，把放行 cookie 收进来。"""
        self.opener.open(share_url, timeout=60).read()

    def send(self, path, body=None, token=None, stream=False):
        headers = {}
        if body is not None:
            headers["content-type"] = "application/json"
        if token:
            headers["authorization"] = "Bearer " + token
        if self.bypass:
            headers["x-vercel-protection-bypass"] = self.bypass
        request = urllib.request.Request(
            self.base + path, headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
            method="POST" if body is not None else "GET")
        try:
            response = self.opener.open(request, timeout=60)
        except urllib.error.HTTPError as err:
            response = err
        if stream:
            frames = []
            started = time.monotonic()
            self.frame_times = []
            for line in response:
                line = line.decode().strip()
                if line.startswith("data: "):
                    frames.append(json.loads(line[6:]))
                    self.frame_times.append(time.monotonic() - started)
            return response.status, frames
        raw = response.read()
        try:
            return response.status, json.loads(raw)
        except json.JSONDecodeError:
            # 保护层拦下来的时候回的是 HTML，不是我们的东西
            return response.status, {"_not_json": raw[:160].decode(errors="replace")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--bypass", help="Vercel protection bypass token")
    parser.add_argument("--share", help="带 _vercel_share 的临时链接，用它换放行 cookie")
    # 默认 handle 每次不同：submission 是每小时 20 次，同一个用户一小时内跑第二遍必撞额度，
    # 而那看起来像是服务坏了。2026-09-13 就这样误判过一次。
    parser.add_argument("--handle", default=f"verify-{int(time.time()) % 1000000}")
    args = parser.parse_args()

    client = Client(args.url, args.bypass)
    if args.share:
        client.prime(args.share)
    checks = []
    failures = 0

    def record(label, ok, detail):
        nonlocal failures
        failures += not ok
        checks.append(ok)
        print(f"  {'通过 ' if ok else '不通过'}  {label:26} {detail}")

    def stop(why):
        print("\n" + why)
        sys.exit(1)

    print(f"对着 {client.base} 跑：\n")

    status, payload = client.send("/api/nothing-here", body={})
    # 回的不是我们的 JSON，有两种完全不同的原因，别混成一句话说。
    # 2026-09-14 我自己把这份脚本指到了前端那个专案，它照着念「Deployment Protection
    # 挡着（未知）」，于是人会跑去翻保护设置 —— 而那边根本没开过。拿 HTML 当保护层的
    # 信号，漏掉了「地址指错了」这个更常见的原因，两者回的都不是 JSON。
    if "protection" in payload or "_not_json" in payload:
        on = payload.get("protection") or {}
        which = "、".join(name for name, flag in
                          (("Vercel Authentication", on.get("vercel_auth_enabled")),
                           ("Password", on.get("password_enabled"))) if flag)
        if not which and status == 404:
            stop(f"{client.base} 回的是一页 HTML 404，不是我们的 API。\n"
                 "这个仓库部署成两个专案：API 那个（/api/* 挂在它上面）和前端那个。\n"
                 "要跑的是 API 那个的生产别名 —— 前端页面上任意一次请求的 origin 就是它，\n"
                 "也可以看 web 专案的 NEXT_PUBLIC_FENCEPOST_API。")
        stop(f"Deployment Protection 挡着（{which or '未知'}），拿到的不是我们的响应。\n"
             f"  HTTP {status}，开头是 {str(payload.get('_not_json', ''))[:60]!r}\n"
             "三条路：Settings → Deployment Protection 关掉；带 --bypass <token>；\n"
             "或者 --share <带 _vercel_share 的临时链接>（23 小时有效，不动任何设置）。")
    record("未知路径回 404", status == 404, f"HTTP {status}")

    status, payload = client.send("/api/storyboards", body={"title": "x"}, token="bogus.token")
    record("坏令牌回 401", status == 401, f"HTTP {status}")

    status, session = client.send("/api/session", body={"handle": args.handle})
    if status == 403:
        stop("/api/session 关着。这一步换不到令牌，后面全走不了。\n"
             "  vercel env add FENCEPOST_OPEN_SIGNUP production   # 值填 1\n"
             "重新部署再跑。这个 flag 是留着的（hybrid 靠它换令牌），"
             "代价是谁都能冒充任何 handle —— 所以线上那个库里只放 demo 数据。")
    if status == 503:
        stop("503：部署缺环境变量。要有 DASHSCOPE_API_KEY 和 FENCEPOST_TOKEN_SECRET 两个。\n"
             f"  服务端说： {session.get('error', session)}")
    if status != 200:
        stop(f"换令牌失败 HTTP {status}：{session}")
    record("换到令牌", True, session["handle"])
    token = session["token"]

    status, board = client.send("/api/storyboards", body={"title": "deployment check"}, token=token)
    if status != 200:
        record("建故事版", False, f"HTTP {status} {board}")
        stop("后面的检查都挂在这个故事版上，停在这里。")
    record("建故事版", True, board["storyboard_id"][:12] + "…")
    storyboard = board["storyboard_id"]

    status, entry = client.send("/api/entries", token=token, body={
        "storyboard_id": storyboard, "species": "ringtail",
        "story": "One on the fence at eleven, stared at me for a while."})
    record("提交 entry（过筛查）", status == 200 and entry.get("published"),
           f"HTTP {status} prompt {entry.get('prompt_version')}")

    status, view = client.send(f"/api/timeline?storyboard_id={storyboard}", token=token)
    shown = view.get("entries", [])
    record("读时间线", status == 200 and len(shown) == 1, f"{len(shown)} 条")

    # 上一条「提交 entry」本身证明不了 Screener 跑通了：上游挂掉时 fail-open 照样放行，
    # 响应长得一模一样（这是 operations §2.3 要的，作者无感）。差别只在这条 entry 会被标
    # review，从 being_checked 看得出来。2026-09-13 真部署上就是靠这个抓到 key 是错的。
    flagged = [e for e in shown if e.get("being_checked")]
    record("Screener 真跑了", bool(shown) and not flagged,
           "被标 review —— 是 fail-open 放行的，上游没通" if flagged else
           "干净放行" if shown else "没有 entry 可看，这一项判不了")

    # 复核队列。它看着像一项凑数的检查，其实是这份脚本里最贵的一课：
    # `settle_review()` 走 `execute(...).rowcount`，而托管库那层包装原先没有这个属性，
    # 于是这条路在 Turso 上一直回 500——从来没人知道，因为复核那两屏还没做，
    # 没有界面调过它，而这份脚本当时也没走到这里。空队列一样算通过：
    # 要验的是「这条路通不通」，不是「有没有东西待复核」。
    status, queue = client.send(f"/api/review?storyboard_id={storyboard}", token=token)
    record("复核队列（惰性结算那条路）", status == 200 and "items" in queue,
           f"HTTP {status}，{len(queue.get('items', []))} 条" if status == 200
           else str(queue)[:60])

    # 分享这条链：签发 -> 兑换 -> 关掉 -> 再兑换。它横跨 share_links 与 access_grants
    # 两张表，而这份脚本原先一步都没走过。扫码进不去的时候，看不出是哪一步断的。
    status, link = client.send("/api/share-links", token=token, body={
        "storyboard_id": storyboard, "level": "view", "expires_in_days": 7})
    plain, link_id = link.get("token"), link.get("share_link_id")
    record("签发分享链接", status == 200 and bool(plain),
           f"HTTP {status} {link.get('level') or str(link)[:40]}")

    status, listed = client.send(f"/api/share-links?storyboard_id={storyboard}", token=token)
    rows = listed.get("links") or []
    # 明文不在回包里是刻意的：库里只有 SHA-256。这一项哪天「修」成回明文，
    # 等于把一份可兑换的权限长期挂在界面上（app.list_share_links 的注释说的就是这个）。
    leaked = [r for r in rows if "token" in r]
    record("码列表不回明文", status == 200 and len(rows) == 1 and not leaked,
           f"{len(rows)} 行" + ("，回了明文 —— 这一项防的就是这个" if leaked else ""))

    status, guest_session = client.send("/api/session", body={"handle": args.handle + "-guest"})
    guest = guest_session.get("token")
    status, got = client.send("/api/share-links/redeem", token=guest, body={"token": plain})
    record("第二个人兑换", status == 200 and got.get("storyboard_id") == storyboard,
           f"HTTP {status} 拿到 {got.get('level') or str(got)[:40]}")

    status, seen = client.send(f"/api/timeline?storyboard_id={storyboard}", token=guest)
    record("兑换之后读得到", status == 200, f"HTTP {status}，{len(seen.get('entries', []))} 条")

    status, off = client.send("/api/share-links/revoke", token=token,
                              body={"share_link_id": link_id})
    record("关掉这张码", status == 200 and off.get("revoked") is True, f"HTTP {status}")

    status, again = client.send("/api/share-links/redeem", token=guest, body={"token": plain})
    record("关掉之后兑不动", status == 403,
           f"HTTP {status} {(again.get('error') or {}).get('code', '')}")

    # ux-copy §6.5 那句话的实证：关码只挡还没用它的人。已经换到权限的人一个字都不动——
    # revoke_share_link() 只写 share_links.revoked_at，access_grants 碰都不碰。
    # 这两件事混在一起而不说清楚，就是让人以为自己关上了门。
    status, still = client.send(f"/api/timeline?storyboard_id={storyboard}", token=guest)
    record("关码不动已有权限", status == 200, f"HTTP {status}")

    # 论坛。发主题那一步的标题是跟正文合成一段送去筛查的，不是只查正文——
    # 否则「有人见过 Smiths 家 42 号那只吗」配一段干净的正文就能挂在所有人眼前。
    status, thread = client.send("/api/forum/threads", token=token, body={
        "storyboard_id": storyboard, "title": "Pruning on the corner block",
        "body": "Council dropped a letter saying the jacaranda gets a heavy prune next month."})
    thread_id = thread.get("thread_id")
    record("发主题", status == 200 and thread.get("published") is True,
           f"HTTP {status} prompt {thread.get('prompt_version', '')}")

    status, post = client.send("/api/forum/posts", token=token, body={
        "thread_id": thread_id,
        "body": "They left the big limbs last time and the ringtails came back after a few weeks."})
    record("回帖", status == 200 and post.get("published") is True, f"HTTP {status}")

    # 被拒的回帖必须带 reason_codes 回来：界面靠它挑那一句话。前端原先把这张表配错了，
    # 本该读到「说一句你看到了什么就能过」的人读到的是兜底那句泛泛之词。
    # 这一项同时是条红线检查——放行这段文字就是 harm_advocacy 没拦住。
    status, blocked = client.send("/api/forum/posts", token=token, body={
        "thread_id": thread_id,
        "body": "Easiest fix is rat baits in the roof cavity, they stop coming back."})
    codes = blocked.get("reason_codes") or []
    record("回帖被拒带 reason",
           status == 200 and blocked.get("published") is False and bool(codes),
           ("、".join(codes) if codes else "放行了 —— 这段是 harm_advocacy")
           if status == 200 else f"HTTP {status}")

    status, answer = client.send("/api/assistant", token=token, body={
        "role": "neighbour", "storyboard_id": storyboard,
        "message": "Is the ringtail the one with the curly tail?"})
    reply = answer.get("reply") or ""
    record("助手（非流式）", status == 200 and bool(reply), reply[:52] or str(answer)[:52])

    # 问得长一点，好让生成本身占掉几秒——不然「跨度小」既可能是被缓冲，也可能只是答得快。
    status, frames = client.send("/api/assistant", token=token, stream=True, body={
        "role": "neighbour", "storyboard_id": storyboard, "stream": True,
        "message": "What do ringtails eat, and what should I do if one gets into the roof?"})
    deltas = [f for f in frames if "delta" in f]
    record("助手（流式）", status == 200 and len(deltas) > 1 and frames[-1].get("done"),
           f"{len(frames)} 帧 / {len(deltas)} 个增量")

    # 平台如果把整条响应攒完再一次性吐出来，所有帧会挤在同一瞬间到达。帧数看不出这件事，
    # 到达时刻能。这是 issue #6 第三条验收标准，本来以为只能靠人眼在浏览器里看。
    times = client.frame_times
    spread = times[-1] - times[0] if len(times) > 1 else 0.0
    record("流式没被平台缓冲", spread >= 1.0,
           f"首帧 {times[0]:.2f}s，末帧 {times[-1]:.2f}s，跨度 {spread:.2f}s" if times else "没有帧")

    status, draft = client.send("/api/assistant", token=token, body={
        "role": "writer", "species_selected": "ringtail",
        "story_draft": "saw one on the fence last night it just sat there"})
    facts = draft.get("fun_facts") or []
    # skipped 不算通过。roles.writer 两次调用都失败就静默返回 skipped（§3.4，Writer 不是
    # 必经步骤），响应是 200，看起来跟正常一样。当成通过就等于替上游打掩护。
    record("助手（Writer）", status == 200 and not draft.get("skipped") and bool(facts),
           f"{len(facts)} 条 fun fact" +
           ("，skipped —— 两次都没成，八成是上游挂了" if draft.get("skipped") else ""))

    # 限流放最后：它会把 submission 这一档的额度用光，跑在提交 entry 前面就把上面弄挂了。
    # 不带 field 的 screener 请求在扣完额度之后才被判 400，所以这一圈一次模型都不调。
    hit, spent = None, 0
    for _ in range(30):
        spent += 1
        status, payload = client.send("/api/assistant", token=token, body={"role": "screener"})
        if status == 429:
            hit = payload.get("error", {})
            break
        if status != 400:
            break
    record("限流（submission）", hit is not None and hit.get("scope") == "submission",
           f"第 {spent} 次 → HTTP {status}" + (f" {hit.get('message', '')[:40]}" if hit else ""))

    print(f"\n{len(checks) - failures}/{len(checks)} 通过")
    if deltas and spread < 1.0:
        print("注意：帧跨度不到 1 秒。可能是平台把响应缓冲了，也可能只是这次答得短。"
              "两者的区别在浏览器里看得最清楚——字是一个个出来，还是憋一下整段蹦出来。")
    print("注意：限流准不准取决于部署连的是哪种库。连托管库（TURSO_DATABASE_URL 或 "
          "FENCEPOST_DB 指向 libsql://）时计数是全局的；退回 /tmp 的 SQLite 时每实例一份，"
          "冷启动清零，这一圈落在同一个实例上才数得准。")
    print("这次跑通只说明链路对。要证明数据不再蒸发，隔几分钟再跑一次，"
          "看上一次建的东西还在不在——第二次才是验收。")
    if failures == 0:
        print("链路通了。FENCEPOST_OPEN_SIGNUP 留着——2026-09-13 定的：答辩要演真后端，"
              "而 hybrid 靠 /api/session 换令牌，删了它整个站就空了。")
        print("代价写在明处：谁都能拿任意 handle 换令牌，所以线上那个库里只放 demo 数据。"
              "收尾用 scripts/teardown_demo.py，它清完会提醒你这个 flag 还开着。")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
