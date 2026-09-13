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

答辩用 `hybrid`。红线管的是**助手**——真模型有概率说出一句违反红线的话，现场没有第二次
机会（CLAUDE.md）。CRUD 那半边没有这个风险，藏起来不演反而可惜。

`hybrid` 和 `live` 都要先从 `/api/session` 换令牌，而那个端点默认关着，需要部署上有
`FENCEPOST_OPEN_SIGNUP`。这是这两种模式的前提，不是可选项——开着意味着谁都能拿任意
handle 换令牌，这在原型阶段就是它的登录模型，交付前要连同模式一起决定。

## 测试

```
node --test lib/fixtures.test.mjs
```

钉的是助手的路由表：四条演示脚本各一条，加上几条曾经走错的（「Will it hurt my cat?」
该走 injured 不该走「我只懂负鼠」，「Do they eat fruit?」该答食性不该答别喂）。

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
  b/[id]/forum/              11 · 讨论区（列表 + 帖子详情）
  b/[id]/share/              12 · 分享：QR 占位、三档权限、有效期、谁有权限
  s/[token]/                 13 · 扫码落地，兑换后进故事版
  no-access/                 14 · 链接不管用
components/ui.js             共用外壳与控件
components/Chat.js           10 · Possum Help 对话
components/QrPlaceholder.js  占位图形，不是真码
lib/api.js                   三种模式的客户端
lib/fixtures.js              助手应答与离线数据
lib/copy.js                  用户可见文案，一处定义
```

## 几处界面按服务端的规矩收缩，不是装样子

- 自己的 entry 上没有投票按钮（服务端对作者回 `not_your_call`）
- `view` 档的人也没有（服务端回 `read_only_access`，理由是「复核是贡献者之间的事」）
- 撤销只对 owner 出现（`revoke_grant` 回 `not_the_owner`）
- 归档的故事版没有投稿入口

每一条都是「服务端会拒绝，所以界面不给这个按钮」，不是「界面藏起来就当没有」——
两者的区别在于前者被绕过也没用。

## 无权限态

`/no-access` 不取任何数据，也不区分链接是过期还是被撤销。区分了，一条死链就成了探测
工具：换个 token 试，从措辞差别里能读出「这个故事版存在」。
