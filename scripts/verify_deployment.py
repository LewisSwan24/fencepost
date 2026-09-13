#!/usr/bin/env python3
"""对着真实部署跑一遍完整链路 —— issue #6 要的就是这个。

    python scripts/verify_deployment.py https://fencepost-xxxx.vercel.app
    python scripts/verify_deployment.py <url> --bypass <protection-bypass-token>

走一遍：404、坏令牌 401、换令牌、建故事版、提交 entry、读时间线、Screener 是不是真跑了、
Neighbour 非流式与流式、Writer、submission 限流。三次真模型调用，限流那一圈零调用。

**URL 要用生产别名**（`fencepost-omega.vercel.app` 这种），不是 `vercel deploy` 打印的那个
`fencepost-<hash>-<team>.vercel.app`。后者被 Deployment Protection 挡着，生产别名默认不挡。
`vercel inspect <deployment>` 能看到别名。

纯标准库，不 import 仓库里的任何东西，也不读 .env —— 令牌是从部署自己的 /api/session
换来的，不在本机签。这不是洁癖：storyboards.owner_id 有外键指向 users.id，本机签出来的
令牌对应的用户在那边的库里根本不存在，插入会撞外键。

所以部署上要开 FENCEPOST_OPEN_SIGNUP。它默认关着是对的（谁都能拿别人的 handle 换令牌），
验完把它删掉。

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
    if "protection" in payload or "_not_json" in payload:
        # 两种形状都见过：JSON 里带 protection 对象（2026-09-13 实际收到的），
        # 或者干脆回一页 HTML 登录页。
        on = payload.get("protection") or {}
        which = "、".join(name for name, flag in
                          (("Vercel Authentication", on.get("vercel_auth_enabled")),
                           ("Password", on.get("password_enabled"))) if flag) or "未知"
        stop(f"Deployment Protection 挡着（{which}），拿到的不是我们的响应。\n"
             "三条路：Settings → Deployment Protection 关掉；带 --bypass <token>；\n"
             "或者 --share <带 _vercel_share 的临时链接>（23 小时有效，不动任何设置）。")
    record("未知路径回 404", status == 404, f"HTTP {status}")

    status, payload = client.send("/api/storyboards", body={"title": "x"}, token="bogus.token")
    record("坏令牌回 401", status == 401, f"HTTP {status}")

    status, session = client.send("/api/session", body={"handle": args.handle})
    if status == 403:
        stop("/api/session 关着。这一步换不到令牌，后面全走不了。\n"
             "  vercel env add FENCEPOST_OPEN_SIGNUP production   # 值填 1\n"
             "重新部署再跑。验完记得把它删掉 —— 开着等于谁都能冒充任何 handle。")
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
        print("链路通了。把 FENCEPOST_OPEN_SIGNUP 删掉再交。")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
