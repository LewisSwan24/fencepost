# fencepost-web

Fencepost 的界面。独立的 Vercel 专案，和 API 那个分开部署——前端不直接调 DashScope，
一切经代理，理由见仓库根的 CLAUDE.md。

设计出自 Claude Design 的原型（issue #22 核验通过），这里是复刻实现，不是移植：
设计系统那套 token 带过来了，散落的十六进制没有。

## 跑起来

```
npm install
npm run dev
```

配置放 `.env.local`：

```
NEXT_PUBLIC_FENCEPOST_API=http://127.0.0.1:8802
NEXT_PUBLIC_FENCEPOST_MODE=hybrid
```

配套的后端：

```
FENCEPOST_OPEN_SIGNUP=1 FENCEPOST_ALLOWED_ORIGIN=http://localhost:3000 \
  python ../scripts/serve_local.py --port 8802
```

## 三种模式

| `NEXT_PUBLIC_FENCEPOST_MODE` | CRUD | 助手 |
|---|---|---|
| `hybrid`（默认） | 真后端 | fixture |
| `fixtures` | fixture | fixture |
| `live` | 真后端 | 真模型 |

答辩用 `hybrid`，**线上跑的就是它**（https://fencepost-web-ten.vercel.app）。
红线管的是**助手**——真模型有概率说出一句违反红线的话，现场没有第二次机会（CLAUDE.md）。
CRUD 那半边没有这个风险，藏起来不演反而可惜。

`hybrid` 和 `live` 都要先从 `/api/session` 换令牌，而那个端点默认关着，需要部署上有
`FENCEPOST_OPEN_SIGNUP`。**这是这两种模式的前提，不是可选项**——开着意味着谁都能拿任意
handle 换令牌。原型阶段这就是它的登录模型。

**2026-09-13 定了：交付也维持 `hybrid`，flag 不删。** 理由是这两件事本来就是一件事——
删了 flag，`/api/session` 关上，`hybrid` 换不到令牌，站点打开就是一片空白；要删就得同时
把模式切回 `fixtures`，那等于把已经验到 12/12 的真后端那半边藏起来不演。

代价不藏着说：任何人访问这个站，都能拿任意 handle 换到令牌，也就能建故事版、发 entry、
发帖。所以线上那个库里**只放 demo 数据**，别往里写任何真实的人和地址。

**访客是一人一个身分（2026-09-14 改的）。** 不配 `NEXT_PUBLIC_FENCEPOST_HANDLE` 时，
`lib/api.js` 给每个浏览器生成一个 `guest_xxxxxx` 存进 localStorage，所以回访的人还是自己。
配了就听它的——本机开发和测试用。

这一条改过两次，两次都是同一类毛病，值得记着：

1. 默认值原先是 `mel_k`，而那是 demo 故事版的 **owner**。谁忘了配这个变量，
   每位访客就都拿到了归档、撤权限、删别人条目的能力。默认值现在是空的——
   退路是「一人一个陌生身分」，不是「所有人都是 owner」。
2. 后来固定成 `visitor`，owner 那一层挡住了，但**所有访客共用一个身分**，
   于是 `author_id` 在他们之间相等：访客 A 能改能删访客 B 写的东西。

新身分在任何故事版上都没有权限，所以要有一张**入场码**：
`NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN` 放一张 contribute 档的分享链接，换到令牌之后自动兑一次，
兑过的浏览器记一笔不再重兑。明文放前端不新增暴露——开放注册本来就让任何人拿任意 handle
换令牌，而这张码只给 demo 故事版的 contribute。

**它有有效期。** 服务端强制 1..90 天，签不出永久的。当前这张到 **2026-12-13** 为止，
过期之后新访客兑不上，打开就是空 dashboard（老访客不受影响，他们的 grant 已经在库里了）。
到期要重签一张并更新这个变量。
令牌本身并不多给什么：可见范围照旧按 `access_grants` 走，没分享给他的故事版他打不开——
时间线回 403 `no_access`，助手也拿不到那份上下文。这两条分别由
`test_the_timeline_needs_a_grant` 和 `test_someone_elses_storyboard_stays_out_of_reach`
钉着。所以开放注册放大的是「能写多少」，不是「能看到谁的」。

收尾跑 `scripts/teardown_demo.py`，它清完库会提醒这个 flag 还开着，
以及删掉它的那一刻前端也跟着空。顺序别反了：先关入口再清库，
不然清完站还开着，访客一来又长出数据。

后端连的是托管的 Turso（`TURSO_DATABASE_URL`），所以数据跨请求、跨实例、跨冷启动都在。
这一条不是一直如此：库曾经在 Vercel 的 `/tmp` 里，每实例一份，同一个 handle 会变成两个
不同的用户，首页列得出的故事版点进去回 403。经过见 `qwen-integration.md` §6。

## 图片

`public/frames/` 里四张 Wikimedia Commons 的 CC BY-SA 4.0 照片，三张拍于布里斯班，
一张是真夜拍。**它们不是用户拍的**——真产品里那个位置放的是拍摄者自己的视频截帧。
`/credits` 开头第一段就说这件事，因为声明该在照片旁边，不是躺在 README 里。

`lib/frames.js` 按物种配图，用 entry id 算稳定下标，所以刷新不会换图。
物种是 `other` 或 `unknown` 就不配——随便配一只上去等于替用户断言他拍到了什么，
而「视觉识别不得自动设定物种」是这个项目的红线。列表卡片的封面走
`/api/dashboard` 的 `latest_species`，排序和 `timeline()` 一字不差地对齐。

进仓库之前每张都缩到 1200px 并剥掉 EXIF/GPS/机型：

```
magick raw.jpg -resize "1200x1200>" -strip -interlace Plane -quality 82 out.jpg
exiftool out.jpg          # 只该剩文件系统与 JPEG 结构字段
```

这条是 CLAUDE.md 的安全底线，不因为素材来自公开站点而免除——照片带着拍摄地点，
而这个产品讲的正是别暴露住址。换图或加图，这一步照做，并在 `lib/frames.js`
和 `/credits` 里补上署名与「改没改过」。

## 测试

```
node --test lib/api.test.mjs lib/copy.test.mjs lib/format.test.mjs lib/fixtures.test.mjs
```

（`node --test lib/` 会把目录里非测试的 `.js` 也当测试跑，所以列文件名。）

`fixtures.test.mjs` 钉的是助手的路由表：四条演示脚本各一条，加上几条曾经走错的
（「Will it hurt my cat?」该走 injured 不该走「我只懂负鼠」，「Do they eat fruit?」
该答食性不该答别喂）。

`format.test.mjs` 钉的是**往前看和往回看是两回事**。`relative()` 只往回算，对任何未来
时间都回 "today"，而分享页要显示码的有效期——一张 10 月 30 日才过期的码写着
「Expires today」，足以让人把好好的码作废重发。2026-09-14 在本机跑 fixtures 看出来的。

`copy.test.mjs` 钉的是**作者被拦下时读到的那句话**。它抄自 `ux-copy.md` §1，而那份文档
不在仓库里，所以没有任何自动手段能发现抄错——这个文件就是人工对照留下的痕迹。
2026-09-14 对照时发现三处不一致：配了两个 Screener 根本不发的码，漏了五个真会发的，
兜底那句也是另写的。

## 目录

```
app/
  page.js                    1 · My storyboards
  b/[id]/page.js             9 · 故事版详情（时间线、复核标签、讨论入口、助手抽屉）
  b/[id]/add/                投稿流，一步一个路由
    DraftContext.js          草稿跨路由活在这里
    page.js                  2 · Capture
    frame/                   3 · Pick a frame
    mask/                    4 · Mask + 5 · 同意弹窗
    species/                 6 · Which one is it?
    write/                   7 · Write it up
    blocked/                 8b · 被拦下
  b/[id]/close/              owner 主动完结：四条后果 + 一句结语（user-flow §9）
  b/[id]/review/             待核实队列 + owner 处置（operations §2）
  b/[id]/forum/              11 · 讨论区（列表 + 帖子详情）
  b/[id]/share/              12 · 分享：QR 占位、三档权限、有效期、已发的码、谁有权限
  s/[token]/                 13 · 扫码落地，兑换后进故事版
  no-access/                 14 · 链接不管用
app/credits/                 图片鸣谢（CC BY-SA 的许可条件，所以在应用里）
components/ui.js             共用外壳与控件
components/Shot.js           一帧画面：配图、夜色调、暗罩
components/Chat.js           10 · Possum Help 对话
components/QrPlaceholder.js  占位图形，不是真码
lib/api.js                   三种模式的客户端
lib/fixtures.js              助手应答与离线数据
lib/copy.js                  用户可见文案，一处定义
lib/format.js                时间与 handle 的显示
lib/frames.js                四张素材、署名、按物种配图的规则
```

## 几处界面按服务端的规矩收缩，不是装样子

- 自己的 entry 上没有投票按钮（服务端对作者回 `not_your_call`）
- `view` 档的人也没有（服务端回 `read_only_access`，理由是「复核是贡献者之间的事」）
- 撤销只对 owner 出现（`revoke_grant` 回 `not_the_owner`）
- 归档的故事版没有投稿入口
- 完结入口只对 owner 出现（`close_storyboard` 回 `not_the_owner`），归档后也不再出现
- 「发主题」与回复框对 `view` 档和已归档的故事版都不画（`read_only_access` / `storyboard_closed`）
- 改与删只出现在自己的条目上（`not_your_entry`），归档后一并收起（`storyboard_closed`）
- 待核实入口对 `view` 档不出现（`read_only_access`）；但**归档的故事版上照样给**——
  那三个端点都不查状态，藏起来就是往另一个方向撒谎
- 「关掉这张码」只出现在自己发的码上，或者你是 owner（`created_by` 或 owner，**不是 reshare**）

每一条都是「服务端会拒绝，所以界面不给这个按钮」，不是「界面藏起来就当没有」——
两者的区别在于前者被绕过也没用。

## 无权限态

`/no-access` 不取任何数据，也不区分链接是过期还是被撤销。区分了，一条死链就成了探测
工具：换个 token 试，从措辞差别里能读出「这个故事版存在」。
