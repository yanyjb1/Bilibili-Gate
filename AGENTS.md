# AGENTS.md — 本 Fork 维护指南（yanyjb1/Bilibili-Gate）

> 面向 AI agent 的上下文交接文档。下次会话读这一份即可接续工作，不需要用户重新解释背景。
> 上游开发者指南在 `archive/AGENTS.md`（构建命令、代码风格等仍然适用，先读它再读本文）。

## 这个 fork 是什么

上游 [magicdawn/bilibili-app-recommend](https://github.com/magicdawn/bilibili-app-recommend)（对外名 Bilibili-Gate）的 fork，
在官方功能之上**增加了一个功能：推荐流去重**——把"曾经推荐过"的视频从首页过滤掉，解决 B 站推荐流反复推同一条视频的问题。

- 仓库: https://github.com/yanyjb1/Bilibili-Gate （公开）
- 本地: `~/Projects/Utility/Bilibili-Gate`
- 分支:
  - `main` = 上游基线 + dedup 功能 + updateURL 修复（**默认在这个分支干活**）
  - `dedup-skip-recommended` = 历史开发分支，内容与 main 同步，保留做对照
  - `release` / `release-nightly` = 纯产物分支（.user.js），由 GitHub Actions 自动维护，**不要手动改**
- CI: `.github/workflows/ci.yml` 在 push 到 main 时自动跑 typecheck + test + 构建，并把 `dist/*.user.js` 发布到 `release-nightly` 分支

## 用户的暴力猴安装

从 `release-nightly` 分支安装（暴力猴自动走 @updateURL 检查更新）:

```
https://raw.githubusercontent.com/yanyjb1/Bilibili-Gate/refs/heads/release-nightly/bilibili-gate.mini.user.js
```

功能开关在: 脚本设置面板 → 过滤 → 去重（默认关闭）。

## 去重功能改动清单（相对上游 main 的全部 diff）

改动原则: 纯加法 + 一处函数签名不变的重写，尽量少碰上游代码，降低合并冲突面。

### 1. `src/modules/filter/dedup.ts`（新增，核心模块）

「已推荐过」的 bvid 持久化集合:

- 存储: `GM.setValue('filter.dedup.seen-bvids', string[])`，跨会话持久
- 结构: `Set`（查重）+ `order: string[]`（插入顺序，用于 FIFO 裁剪）
- 上限: `settings.filter.dedup.maxEntries`（默认 5000），超出丢最旧的，防止 storage 无限膨胀
- 热路径 `has(bvid)` 是同步内存查询，GM 读取只在启动时发生一次（模块级 `void seenBvidStore.load()`）
- `addMany(bvids)` 批量写入，每批只 persist 一次
- 未加载完成时 `has()` 返回 false——宁可漏放不误杀

### 2. `src/modules/filter/index.ts`（过滤规则接入）

`filterRecItems()` 是所有 tab 过滤的唯一收口函数，本文件改动:

- 快速路径: dedup 未开时保持上游原行为
- 规则位置: 放在 `tab === 'keep-follow-only'` 判断之后、blacklist/byAuthor/byTitle 之前——去重是"必杀"，命中即弃，省掉后续所有判断
- 上游的 `return items.filter(...)` 改为 `forEach` + `passed.push()` 结构: 因为要在**通过全部过滤后**才把 bvid 记入集合（被标题过滤掉的没展示出来，不该算"推荐过"），且要把"记录"和"返回"解耦
- 记录范围: 只有 `isApiRecLike(item.api)` 的视频才记录

**范围边界（用户明确要求）**: `isApiRecLike()` = app-recommend / pc-recommend / rank / popular-general / popular-weekly 五类。
稍后再看(watchlater)、收藏(fav)、历史(history)、空间(space-upload)、动态(dynamic-feed)、直播(live) 既不过滤也不记录，一动不动。

### 3. `src/modules/rec-services/index.ts`（补货适配）

`fetchMinCount()` 里的 `hasFilter` 判断加上 `dedup.enabled`。否则去重开启后大量卡片被过滤，
首页会变稀甚至空。加上后 fetcher 会按 5 倍基数多拉补足。

### 4. `src/modules/settings/index.ts`（配置）

`filter.dedup`: `{ enabled: false, maxEntries: 5000 }`。
未写 `runSettingsMigration` 迁移项——加法字段带默认值，旧配置 merge 后自动补全，不需要迁移（已验证：typecheck + 29 个单测通过）。

### 5. `src/components/ModalSettings/tab-panes/pane-filter.tsx`（设置 UI）

"去重"区块插在 UP 区块和标题区块之间: 开关 (`filter.dedup.enabled`) + "清空记录 (N)" 按钮（调用 `seenBvidStore.clear()`）。

### 6. `vite.config.ts`（updateURL fork 化，这是 fork 能自更新的关键）

上游硬编码 updateURL 指向 magicdawn 的 release-nightly 分支，fork 直接用会被上游产物覆盖用户改动。
已改为:

```typescript
const repo = process.env.GITHUB_REPOSITORY || 'magicdawn/Bilibili-Gate'
```

Actions 构建时自动取 `yanyjb1/Bilibili-Gate`；本地构建回退上游地址（无副作用）。

## 日后维护操作

### 同步上游（用户只做 git 层面，构建交给 CI）

```bash
cd ~/Projects/Utility/Bilibili-Gate
git checkout main
git fetch upstream
git merge upstream/main        # 冲突喊 AI 解
git push origin main           # push 即触发 CI 构建+发布
```

注意: 本地 remote `upstream` 已配置指向 magicdawn 仓库。

### 修改功能后发版

push 到 main 即可，CI 全自动（typecheck → test → build → 发布 release-nightly）。暴力猴会在版本号变化后自动更新。

### 本地调试（如需要）

```bash
pnpm install --frozen-lockfile   # 每次拉上游后必须重跑
pnpm build:vite                  # 产物在 dist/，注意 NODE_ENV/RELEASE 对 updateURL 的影响见 vite.config.ts
pnpm typecheck && pnpm test      # 提交前必跑
```

已知坑: clone 后首次 `pnpm typecheck` 会因 `*.module.scss` 缺 d.ts 报 29 个错——先跑 `pnpm build:scss` 生成声明，不是代码问题。

## 高频冲突点预警（跟上游合并时）

1. `src/modules/filter/index.ts` — 上游也在频繁加过滤规则（最近 300 提交改了 35 次）。冲突时: 保留上游的新规则逻辑，把 dedup 判断插回 `keep-follow-only` 判断之后；forEach/passed 结构若被上游改回 filter 链，保持上游结构、把 dedup 过滤插到规则链最前、记录逻辑插到"通过"分支
2. `src/modules/settings/index.ts` — 上游常加新配置组，dedup 块是独立键无冲突风险，但 `filter` 对象内部的行号会漂
3. `vite.config.ts` — branchBaseUrl 一带若上游重构，保持"最终 updateURL 用 GITHUB_REPOSITORY"语义即可

## 未完成的后续想法（用户提过、还没做）

- **恰饭跳过**: 给 B 站网页版写 Tampermonkey 脚本，调 BilibiliSponsorBlock 公开 API
  (`https://bsbsb.top/api/skipSegments?videoID={bvid}&category=sponsor&...`，无需鉴权、无 CORS 问题)，
  拿到 `{segment: [start, end], category, actionType}` 数组后监听 `<video>` 的 `timeupdate`，
  命中区间时 `video.currentTime = end` 跳过。参考实现: BiliPai 项目
  `app/src/main/java/com/android/purebilibili/data/repository/SponsorBlockRepository.kt`（API 细节）和
  `core/player/BasePlayerViewModel.kt#checkAndSkipSponsor`（跳过时机: 位置 ∈ [start, end-0.5s)，seek 后把 UUID 记入已跳过集合防回拖重复触发）。
  浏览器扩展版（可参考 UI/提交片段功能）: hanydd/BilibiliSponsorBlock。
  用户已装官方扩展，此脚本可能不再需要，动工前先问用户。
- **去重策略迭代**: 当前是"出现过即记"，用户可能想要"点开播放过才记"（需结合历史记录 API），用户用一段时间后收集反馈再定
- **提交片段功能**: dedup 脚本侧不做，用户已装空降助手扩展

## 用户偏好（沟通与工程）

- 中文交流；终端场景正常 Markdown，Telegram 场景禁 Markdown 符号
- 讨厌推荐流重复视频（此 fork 存在的动机），表达可以带点情绪化但工作要严谨
- 在意: 不加新依赖（pnpm install --frozen-lockfile 习惯）、不污染系统环境（改动收在项目目录内）、
  去重不得波及稍后再看等自管理列表
- GitHub 账号 yanyjb1，gh CLI 已登录（https 协议，git@ SSH 不可用）；AI 可直接用 gh/git 操作其 fork
