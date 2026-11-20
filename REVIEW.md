# 评审记录

设计规格在 DESIGN.md；本文件记录收敛过程与开放项状态。

## Pass 1 — 设计内部一致性(2026-11-19)

对照会话决策逐项核对(分工/读路径/启动路径/UI/安全/同步/License/ADR)。发现并已修复：

1. §11 证据行号：`hc.rs:466` → **467**(env json！ 实际行)。
2. §3 查询时机表述混淆 P0/P1 → 明确 "P0：面板 init + ↻;P1：子菜单展开时"。
3. §5.2 未说明 `providers.js` 随 agent-menu 源一起覆盖 → 已补(两处共用一份)。

确认一致的关键决策锚点：合并方向(common 覆盖 provider,opt-in)、UNSET 14变量与 providers.js 逐字一致、sqlite3 方案 2、不继承 skip-permissions、行内展开不做 flyout、P0 先行后克隆。

## Pass 2 — 代码 × herdr 文档 API

逐条对照 defaults/AGENTS.md(mod 规则)与 defaults/herdr.d.ts:

- ✅ cx 纪律：`on_click((_e, cx) => this.refresh(cx))` 用回调自己的 cx；无 setTimeout/top-level await；模块顶层无副作用。
- ✅ `checking()` 守住 init 里的 exec；根元素 id;`shared() ?? []`; `when/children/hover` 等均为文档化原语。
- ✅ shell 包装推演：argv `["env","-u",…,"claude",…]` 经`zsh -ic '"$@"; exec "$0" -i'`(window.rs:115)后，`"$@"` 原样逐词传给 `env`,claude 退出后交互 shell 留守——与 tab.new 语义吻合。
- ✅ `JSON.stringify` 无字面换行，argv/ps 显示安全。
- ⚠ **假设 1**：二级模块(`providers.js`)`import … from "herdr"` 可用——文档只示例了 main.js。若 T0 报错，把 providers.js 内容内联进 main.js (机械操作，不影响设计)。
- ⚠ **假设 2**:exec 拒绝时的错误串形态(用于 hint 分支)。首次真跑后按实际报文调整正则(T0.1)。

## Pass 3 — 新鲜眼复查

- env 前缀在远程 Unix(login shell 包装)同样成立；Windows 被平台分支挡住。
- sqlite3 `-json` 零行输出空串已处理；`-readonly` 读 WAL 库列为 T1。
- P0 docked 面板会写用户的 shown layout(文档语义),README 已告诫隔离 home。

## Pass 4 — 运行时验证(2026-11-19,T0 + T6-lite)

环境：全新 Ubuntu 26.04;brew(rustup + `zig@0.16`，注意 brew `zig` 是 0.17 不能用)
+ USTC 镜像；herdr-app debug 构建成功(zig 0.16 fetch 会挂在死连接上，写`/tmp/herdr-build-loop.sh` 监控缓存/CPU 自动杀 zig 重试)。

- **T0 ✅** `check passed: mod/`。两个 Pass 2 假设同时落实：二级模块`import … from "herdr"` 合法；真实 exec 失败报文(`code!==0` + stderr/exit text)与 hint 正则吻合。
- **真 bug 修复**:sqlite3 非零退出(缺 DB)且 stdout 空时，`|| "[]"`会把"读失败"吞成"无 provider"。`query()` 改为 `code!==0 → throw` (前缀 `cc-switch.db:` 命中 hint 分支)。check 复跑通过。
- **T6-lite ✅(sandbox 全链路)**，证据在 `evidence/`:
  1. sandbox 无 core：把官方 `install.sh` 以 `HOME=$root/fakehome` 装herdr-core 0.1.21 → app 在 `$HOME/.local/bin` 找到(core_bin.rs:155)。
  2. **关键发现：shipped 布局拒绝停靠 mod**(window.rs:4492 `shipped && place!="none"` → skip)。`do layout.clone {"name":"main"}` 后 provider-menu 自动 dock 到 main-copy 根 children[2](280px)。 → **P0 用户必须先有个人布局**,README/DESIGN §5 已补。
  3. 面板渲染正确：标题/cc-switch/↻ + Work(current)+ DeepSeek，无错误行。
  4. 点击 Work → `tab.new` → core 终端：rc 文件先于 argv 生效(fakehome `.bashrc` 的 PATH 让 stub `claude` 可见)→ stub 收到恰好 `--settings {"env":{"ANTHROPIC_BASE_URL":"https://example.work", "ANTHROPIC_AUTH_TOKEN":"sk-test-123"}}`(launch-dump.txt)。
  5. **UNSET 实证**：带 `ANTHROPIC_API_KEY=leak-test-key` + `CLAUDE_CODE_OAUTH_TOKEN=leak-test-oauth` 重启 app 再点击，claude 环境中两者皆无——`env -u` 前缀生效。
- sandbox 操作备忘：欢迎浮层会吃掉点击(`do overlay.close '{}'` 先关)；新 home 无 space 时 tab.new 报 "no space yet"(先 `space.new`); `scripts/sandbox` 的 input 依赖 uv，本机无 → `apt-get python3-xlib` 后直接 `python3 scripts/sandbox-input.py`。

## Pass 5 — T8 泄漏阻断 E2E(2026-11-19,sandbox)

金丝雀：`~/.claude/settings.json` 为 GLM 形态(env 含 AUTH_TOKEN/BASE_URL/ ANTHROPIC_MODEL/OPUS/HAIKU/API_TIMEOUT_MS；顶层 model/theme/attribution{}/ cleanupPeriodDays/alwaysThinkingEnabled)。点击 Work 与 DeepSeek 各一次， `hc get` 取完整 argv + stub claude dump 取进程 env，断言 26/26 全过：

- **env 挡键**:live-only 4 键(ANTHROPIC_MODEL、OPUS、HAIKU、API_TIMEOUT_MS)均写为 `""`；卡片自有键保留原值。dump 的 `ANTHROPIC_/CLAUDE_` env 段为空 → `env -u` ×14 照常生效。
- **顶层挡键**：字符串 `model`/`theme` → `""`，对象 `attribution` → `{}`；数字/布尔(cleanupPeriodDays/alwaysThinkingEnabled)不写，按上游配方继承。
- **modelPicker**:Work → 仅 sonnet 行`{label:"Sonnet · GLM 4.7", description:"Work · glm-4.7 · 1M"}` ([1m] 后缀剥离进 description 标记),replaceBuiltInOptions:true; DeepSeek → `{replaceBuiltInOptions:false, options:[]}`(live 的 GLM picker 整层被顶掉)。**总开关语义证实：picker 按层整体胜出，必须无条件写**。
- 证据：`evidence/t8-dump-{work,deepseek}.txt`、`t8-argv-{work-t2,deepseek-t3}.json`、`t8-panel-clean.png`、`t8-tabs-launched.png`。

sandbox 运维教训(本轮踩坑，复用 sandbox 时先看这里):

1. `scripts/sandbox` 只 export `XDG_STATE_HOME=$root/state` 不创建它：目录缺失时core 的 layout doc 全部落盘失败，app 症状为 `layout local: doc.set … (os error 2)`
   + "Layout changed elsewhere" toast 持续累积。**up 前先 mkdir $root/state**。
2. `down` 的 `hc server stop` 杀不掉 serve+holder 进程对，socket/`core.lock` 残留→ 下次 up 的 app 连回旧 core(内存态全在)或卡死在 "the window did not answer"。**down 后手动杀两个 core 进程 + 删 /run/user/1000/herdr-core/herdr-app-sandbox*.sock**。
3. 欢迎浮层是 `kind:"window"` 型 overlay，外部 `overlay.close`(带 id 也)关不掉；正解 = 停窗后向 home/shared.json 预写 `"frame.welcomed"`。
4. `hc ls` 的 `created_ms` 对部分新终端为 null：发现新终端用地址集合差，别排序。
5. toast 堆不拦截指针(点击可穿透);welcome 浮层才吞点击。

## Pass 6 — Tx 系列收口(2026-11-19,T1/T2/T9/T10 + T5 备妥)

### T1 WAL 并发读(`scripts/t1-wal-test.sh`,5 案例全过)

用 fifo 卡住 writer 的 BEGIN..COMMIT 构造活跃写事务，SIGKILL 构造孤儿 WAL:

1. 活跃写事务中 `-readonly -json` 读 → 快照隔离，返回已提交数据(34ms 内);
2. 干净 commit 后读 → 新数据立即可见；
3. writer 被 SIGKILL(孤儿 WAL)→ 读正常、数据一致；
4. 无 `-shm` 的 WAL 库 → 照常读(SQLite 自建);
5. plain journal 模式 → 照常读。

结论：mod 的 `sqlite3 -readonly -json` 读法对 cc-switch GUI 常驻场景安全，无需复制 DB。

### T2 settings env 优先级(真 claude 2.1.327,`scripts/t2-precedence-probe.sh` + `t2-server.py`)

本地 127.0.0.1 请求记录服务器 + 假 token，隔离 `CLAUDE_CONFIG_DIR`:

- **settings env 逐键覆盖进程 env**(A):live settings.json 里的AUTH_TOKEN/BASE_URL 赢过导出的进程同名变量 → `--settings` 的挡键语义可靠；
- **空字符串挡 live 值**(B):settings env 写 `""` 后请求头不再带 live token, claude 报 "Not logged in" 而非回退 live —— T8 结论在 2.1.327 复验成立；
- **跨键不互通**(C/D)：进程 ANTHROPIC_API_KEY 在 settings 设 AUTH_TOKEN 时被忽略(只发 Bearer，不发 x-api-key)；进程 ANTHROPIC_MODEL 未出现在请求 model 字段。

结论：**UNSET 清单从"正确性必需"降级为纵深防御** ——它仍必要(挡CLAUDE_CODE_USE_BEDROCK 等 settings 覆盖不到的键、防未来版本变化)，但泄漏阻断的第一道墙是 settings env 挡键。

### T9 无头 seed(`scripts/seed-cc-switch-db.py`，无头半已过)

按 schema.rs 当前 DDL 建齐**全部**表 + `PRAGMA user_version=27` + 4 行proxy_config 种子，providers 以 `seed-N` 为主键插入。关键发现：GUI 迁移链的`add_column_if_missing` 对缺表直接报错(schema.rs:4064-4068)，所以"只建providers+settings、version=0"的最小 seed 会在 v0→v1 崩——必须全量。脚本自带校验：integrity_check=ok、user_version=27、mod 的原样 SELECT。**剩余：GUI 打开零迁移的肉眼复验(需要一台装了 cc-switch GUI 的机)。**

### T10 非 env 形态 provider(sandbox 验证通过)

DB 加 RouterX 行(`{"endpoint":…,"apiKey":…}` 非 env 形态):

- `providers.js`:`launchableCard()` 判 env 形(含非空 AUTH_TOKEN 或 API_KEY)，行数据多带 `launchable`;
- `main.js`：非 launchable 行灰显 + `cc-switch` 右标签，点击不启动、面板底部显示 `Launch failed: <name> is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.`(截图逐字核对)。

sandbox 实证：三行渲染正确；点 RouterX → **零新终端** + note 渲染；回归点击Work/DeepSeek → 各自新终端，argv 14×`-u` + `--settings` 挡键全在(`t10-argv-*.json`)。老缓存行(无 launchable 字段)走 `=== false` 判断，保持可点击，不误伤。

### T5 远程 E2E(脚本备妥，待真远端机)

`t5-remote-prepare.sh`(远端：seed RWork/RDeep + GLM 形 canary + stub claude)
+ `t5-remote-e2e.md`(本端：hc machine add → 隔离 home 的窗口 → 远程 space → ↻ 出远端行 → 点 RWork → 断言 dump/canary/本地库未动)。

## Pass 7 — P1 三层克隆子菜单(2026-11-19,sandbox E2E)

三层安装(sandbox 实操):`mod.clone new-menu → agent-menu` 后用仓库源覆盖(`agent-menu/{main.js,providers.js,mod.json}`);`mod.clone tabs → my-tabs`后打两处补丁(头注释 + `openOverlay({mod:"agent-menu",…})`)；个人布局my-main 的 tabs 块 `content.mod: tabs → my-tabs`(脚本断言 hits==["tabs"])。

E2E 中发现并修复的三个问题：

1. **mod 无热重载**:mod.clone 后覆盖 `mods/<name>/main.js` 不生效，须`restart` 才加载新代码(首开弹层行为 stale 即此因)。
2. **subRow 灰显守卫 bug**:`on_click` 里 `if (!dim) action(cx)` 把RouterX 的提示 action 整个吞掉(与注释"dim rows explain themselves" 矛盾)——去掉守卫，hover 灰显逻辑不变；键盘路径本就正确。
3. **launchNote 被裁剪**：弹层高度公式没算 note(两行折行 ≈44px),note落在滚动区可视范围之外——`extra` 在 launchNote 时 +44。

### T4 结论(定论)

子菜单展开时按 Esc:**整个弹层一起关**(子菜单 + popup),`on_key_down` 里`cx.stop_propagation()` 挡不住 app 级 Esc 键绑定(`escape` → `overlay.close`,src/keys.rs:271)。"退一层"无法从 mod JS 实现。接受的fallback：一次 Esc 全关，重开时 init() 复位 `sub=null`；数字键按层作用域不受影响(顶层 1-9 直装启动；子菜单内 1=Default、2..=providers)。

### 验证矩阵(evidence/p1-*)

| 动作 | 结果 |
|---|---|
| my-tabs `+` | agent-menu 弹层：Terminal / Claude `1 ▸` / 2 行 not installed / New space / worktrees |
| 点 Claude 行 | 内联子菜单：Default (live) `1`、Work `current` `2`、DeepSeek `3`、RouterX `cc-switch` `4`(灰显) |
| 点 Work | 新终端：argv = `bash -ic` + `env -u`×14 + `claude --settings`(480 字 Work JSON)+ stub dump(`p1-argv-work-menu.json`、`p1-dump-work-menu.txt`) |
| 顶层 `1` | 默认 claude 启动(t3:`bash -ic … claude`) |
| 子菜单 `2` | Work 启动(t4,`p1-argv-work-digit.json`,14×`-u`) |
| RouterX 点击 / 键盘 `4` | 零新终端 + launchNote 两行渲染(`p1-routerx-note*.png`) |
| Esc(T4) | 全关(见上) |

运维注：restart 后窗口几何会变(本次 1280×820 X-px，截图 1100×705 = ×0.8594;input 坐标 = 窗口逻辑 px = 截图 ÷0.8594，每次 restart 后须重新标定)；无 space 时 `tab.new` 报 app toast "no space yet: make one first (space.new)"(shipped 行为，shipped new-menu 同样如此，先 `space.new`); knownAgents 经 `bash -ic 'command -v …'` 探测，stub claude 即可被识别。

### 真机 seed 修正(2026-11-19，用户纠偏)

本机(无 GUI，跑 core)真库首 seed 曾把 `CLAUDE_CODE_*` 调优键留在live settings.json、不进 provider profile——**错误**:`MAX_OUTPUT_TOKENS` `EFFORT_LEVEL` `SUBAGENT_MODEL` 等在第三方兼容 API 下是 per-provider调优(cc-switch 即按每 provider profile 独立配置)；且 mod 的合并语义是"live-only env 键一律挡空"(providers.js launchSettings)，这种 seed 会让provider 启动静默丢掉这些调优。已重 seed:GLM profile = live env 全量18 键 + model。mod 代码无须改动(逐键合并本就与 per-profile 模型一致)。已知边界：mod 只读 providers 表，cc-switch 的 common config 不参与provider 启动(profile 是唯一真身)。

### 上游二次核实(2026-11-19，本地 clone @ 6da70837)

四条事实入档(战略 02 号文档同源，细节以本地源码为准):① master `SCHEMA_VERSION` 仍 =27(`database/mod.rs:54`)——T9 seed 无漂移；② v4 直连/路由/聚合三模式下「以此供应商打开终端」全部物化 DB 真实上游直连(`terminal_launch.rs:167/217/596-597/1089`,live 的 `PROXY_MANAGED` 被 drops 写 `""` 挡住)——ADR-10 与上游同构，已封板；③ T10 判据硬化：Accounts(Beta) OAuth 卡被上游限定非官方客户端必须走路由，结构性无 env 形态——拒启与灰显正确且必然；④ AppType 枚举已 14+ CLI(含 OpenClaw/Pi/Kimi)——cc-switch 是整个 harness 动物园的身份库，codex 配方是「第 N 个实例」而非第二个(P2 定位参考)。

## 开放项

| # | 项 | 状态 |
|---|---|---|
| T0 | `herdr-app check mod/` | ✅ 通过(含 bug 修复后复跑) |
| T0.1 | 真实 exec 报文 × hint 正则；二级模块 herdr import | ✅ 随 T0/T6 落实 |
| T1 | WAL 活跃库 `-readonly -json` 读取正确性 | ✅ Pass 6:5 案例全过，读法安全 |
| T2 | 进程 env vs settings env 块优先级 | ✅ Pass 6:settings 逐键赢；UNSET 降为纵深防御(仍保留) |
| T3 | Windows pwsh 内联 JSON(P2) | ⛔ |
| T4 | 子菜单 Esc 拦截(P1) | ✅ Pass 7 定论：拦截不可行(stop_propagation 挡不住 app 键绑定)→ fallback = 一次 Esc 全关，数字键按层作用域已验证 |
| T5 | 远程 space:on 读+启动 | 🔶 Pass 6:prepare/e2e 脚本备妥；真机载体已就绪——本机(headless，跑 core)DB 已 seed GLM 全量 env,GUI 机三层装通即 T5 首跑 |
| T6 | sandbox 全链路 UI | ✅ T6-lite(渲染+点击+启动+env 清洗)；真 claude 未测 |
| T8 | `--settings` × live 逐键合并泄漏 | ✅ sandbox E2E 26/26(Pass 5)+ 真 claude 2.1.327 复验(Pass 6/T2-B) |
| T9 | 无头 seed 的 DB 被 GUI 零迁移打开 | 🔶 无头半已过(全量 DDL + user_version=27 + 校验);master @ 6da70837 复核 SCHEMA_VERSION=27 无漂移；GUI 打开复验待用户机 |
| T10 | 非 env 形态 provider 拒启 + 提示 | ✅ Pass 6:sandbox 三行渲染、拒启零终端、note 逐字、回归启动无恙；判据硬化：OAuth 账号卡结构性非 env(上游源码背书)，拒启/灰显必然 |
| P1 | 三层克隆子菜单(agent-menu/my-tabs/布局) | ✅ Pass 7:sandbox E2E 全通(弹层/子菜单/点击+数字键启动/RouterX 拒)；真机安装排障中——GUI 机子菜单未现，`scripts/p1-install.sh` 自检修复已备 |
| — | 项目自身 LICENSE | ✅ 2026-11-19 MIT(转公开准备；README 英文化 + README.zh-CN + 示例布局同批) |

## 结论

P1 三层克隆(my-tabs → agent-menu 子菜单)sandbox E2E 全通：弹层、内联provider 子菜单、Work 点击与数字键启动(14×`-u` + `--settings` 全 argv)、RouterX 拒启 note;T4 定论为拦截不可行、fallback 已文档化。E2E 顺带修了三个实现 bug(mod 无热重载认知、灰显行点击守卫、note 高度裁剪)。Tx 系列： T1/T2/T10 ✅,T9 无头半 ✅(GUI 复验待用户),T5 脚本备妥。剩余：T3 (Windows,P2)、T5/T9 真机半场、真 claude 联网复验(用户机)。

## Pass 8 — 实机事件：顶层挡键 × 枚举校验(2026-11-19,macOS GUI 机)

现象：选 DeepSeek 卡启动，claude 弹 Settings Error——`autoUpdatesChannel: Invalid value. Expected one of: "latest","stable","rc"`,"files with errors are skipped **entirely**"。事故链：live settings 有 `autoUpdatesChannel` → 卡没有 → 旧逻辑按"live-only 顶层串键"写 `""` → 枚举校验拒绝 → 整个 `--settings` 被弃，终端静默回落 live 身份(对话框选项 3 即此路径，比报错更危险)。T8 的 26/26 未覆盖此键：sandbox fresh home 的 live 无此键。

修复：`launchSettings` 顶层挡键改白名单 `TOP_DROPS = ["model","theme","attribution"]`(全部 T8 实测空值安全)；其余 live-only 顶层键继承。env 块挡键不变(空 env 值=未设，env 名无枚举校验)。`herdr-app check` mod/agent-menu 双过。

上游对照(实机抓取 cc-switch 隔离终端 launcher + temp json)：上游 temp 文件**无** `autoUpdatesChannel`——其 drops 为窄集(本次仅 `model:""` + live-only env 键 `CLAUDE_CODE_AUTO_MODE_SERVER:""`)，**上游无此 bug，此前"上游同 bug"判断撤销**；白名单修复恰与上游实际语义收敛。上游 launcher 另两个 posture 差异实锤：无 `env -u` 前缀(进程 env 不清)、默认带 `--dangerously-skip-permissions`——本 mod 两者都更严，维持(DESIGN §4.1 立场)。

## Pass 9 — UX 修订：子菜单去 Default 行(2026-11-19，实机反馈)

用户指摘：子菜单的 Default 行没有显式指向(不像 cc-switch 里每项都是命名卡)。裁决：去除。理由：①菜单语义是"选身份",live 槽是指针不是身份，改名显式化不可行(routing 模式 live=127.0.0.1:15721、官方 OAuth 无 base_url 可标);②与顶层数字键冗余(子菜单收起时按 Claude 行数字键即原样启动，键盘路径不变);③鼠标路径有 Terminal 行兜底。顺带补齐零卡 empty-state 行("No providers in cc-switch yet…",§4.5 不静默空白——此前 Default 行占位掩盖了该场景)；子菜单数字键改 1..=providers(原 2..)。check 过。

## Pass 10 — extra-args 与 workspaceFolder(2026-11-19)

背景：用户实机必须项 = `workspaceFolder` 动态 env + `--allow-dangerously-skip-permissions`(其个人 `claude()` 函数约定)；上游 PR #9015(rc 遵从，open 待审)与上游 dialog(每 session 自由输入)各有优劣——dialog 装不下动态 env,rc 遵从要拆 env -u 前缀(UNSET 承重)。本批设计各走正道：静态参数 = per-machine 持久 extras(EXTRA key、面板 args 行 + 自绘 dialog 按 shipped prompt mod 的 InputState/Input 范式、splitArgs 引号分词)；动态 env = launchSettings 设 `env.workspaceFolder = SpaceInfo.folder`(空则不设，远程机为其本机路径；Pass 12 撤除)。launchArgv 统一接线 `[...extra, ...mine]`，面板与子菜单同享。ADR"绝不默认"不变；dialog 架构留 `props.mode="launch"` 一态可补 per-launch。check:mod/agent-menu 双过；实机复验待 GUI 机(argv 尾部参数 + settings env 内 workspaceFolder + hooks 读到)。

## Pass 11 — rc 遵从启动模式(2026-11-19,opt-in)

用户核心诉求：启动应读取其 shell profile，不摒弃 alias 与 function(其两种等价实形均以 `workspaceFolder="$(pwd)" CLAUDE_CODE_ATTRIBUTION_HEADER=0 command claude --allow-dangerously-skip-permissions` 为约定)。机制事实：herdr 词向量包装("$@")只解析函数，alias 仅在解析期展开——故完整支持只有命令串形式。实现：RC key(每机开关，面板 rc 行)+ `claudeArgv(settings, extra, {login})` 的 rc 分支(`env -u …×14 bash -[l]ic '<shellQuote>'`,shellQuote=单引号+'\'\''转义)+ `launchArgv` 探测 `.bash_profile` 存在则 `-lic`(PR #9015/#9013 智慧)。信任边界照实：rc 先于 claude 运行、可重新 export 被清变量；rc 双 source 通常无害。CLAUDE_CODE_ATTRIBUTION_HEADER 不在 UNSET×14。路线收束：上游 dialog = 每 session 自由输入；上游 PR #9015 = 同思路的未采纳版；本仓 = 持久 extras(默认)+ rc 遵从模式(opt-in)。check 双过；实机复验：rc 开启后 hc get 应见 `bash -ic 'claude --settings …'` 串，claude 进程 env 有 workspaceFolder/ATTRIBUTION_HEADER，且 extras 与函数参数并存不冲突。

## Pass 12 — mac 实机复验全绿 + workspaceFolder 注入撤除(2026-11-19)

mac GUI 机复验 extras 与 rc 两条路径无误(args 行持久参数、rc profile 模式经 bash -lic 命令串、alias/function 均生效)。同日决策：撤除 env.workspaceFolder 注入(Pass 10 同批引入)——workspaceFolder 是用户举例而非 mod 需求，动态 env 的通用机制是 rc 遵从模式；公开参考 mod 不携带未被要求的 env 注入，与"砍 Default 行/白名单挡键"同一原则(显式 > 环境暗示)。用户实跑 rc 模式，函数的 $(pwd) 原生生效，零损失。README 双语仅保留 rc bullet 中的例证提法；launchSettings 回落 (provider, liveText) 签名，providers.js 不再 import spaces。check 双过。

## Pass 13 — 文风统一：STE/STC(2026-11-19)

用户要求：README 面向公众，不用第二人称所有格("your/你的")，示例显式标注(e.g./例如)，行文遵循 STE100/STC。处理：两份 README 全文重写——短句单义、主动语态、现在时、术语一致(the mod/本 mod、extra arguments/附加参数、per machine/每机、launch/启动)；"your recorded choice"→"the user records the arguments; the mod adds no flags by itself"；克隆基线尾句改为陈述式；警告句保留祈使但去第二人称。UI 字符串同步(args dialog 提示句)。DESIGN/REVIEW 为内部工程日志，保持既有文风不在此范围。

## Pass 14 — seed 脚本定位纠偏：验证工具而非建库方式(2026-11-19)

用户指正：README 曾把「无头机用 seed-cc-switch-db.py 造库」写成安装路径，错位——seed 只从 spec(取自当前 live settings)造出单 provider 测试库，无实用供给价值；正式路径是 cc-switch 官方 DB 同步(WebDAV 等)或 GUI 机配置。边界定案：**DB 的供给与同步由用户自行解决，不在本 mod(及 herdr)的业务范畴**。落地：README 双语三处改写(Install 分流"正式使用/仅供测试"、无头机段分两段、scripts 表行改"验证工具");DESIGN §2 无头机缺口段补边界声明，seed 降为验证工具、拷库标注会漂移不算正路、上游 CLI/headless ask 维持。上游三条 asks 不变。

## Pass 15 — Phase 2 codex 落地(2026-11-19)

上游事实先行(本机 clone @ 6da70837)：终端按钮只注入 {claude, codex, agy, grokbuild, copilot} 五家(App.tsx:1643)——pi/dsh/opencode 等无此按钮，grok 仅当前卡可开且无隔离(OpenTerminalDialog.tsx:152/192);codex official 卡无按钮是结构性的(`codexHasOwnRoute` 首行排除 official;`-c` 换不动 OAuth 登录，codex_terminal.rs follows_login)，非凭据缺失——用户实机观察到的现象由此定谳；claude official 恒有按钮(绑授权中心账号→CLAUDE_CONFIG_DIR 隔离，未绑→跟全局登录"不能说隔离")。配方镜像 codex_terminal.rs:`env CC_SWITCH_CODEX_API_KEY=… CODEX_HOME=… codex --no-daemon -c …`，路由表重写为 model_providers.custom + env_key(key 不上命令行，优于 claude 侧 argv 内联);requires_openai_auth 按 live auth.json 登录态；live 残留按上游 Neutral 表中和，中和不了拒启。代码组织按用户要求引入设计模式：HARNESS 注册表 + 每 harness 策略(classify/mergeCommon/launch),readProviders/launchArgv 退化为薄分派，UI 侧同构 SUBMENUS 注册表(拒启原因映射表)。验证：上游测试夹具作 oracle 的纯函数冒烟六场景对齐(http_headers 残留拒、keyless 拒、context_window 拒、subagent 跟随、profile 拒、KIMI over PROXY_MANAGED live 全对);check 双过。两处有意分歧(记入 DESIGN §4.6/README):model_catalog_json 残留上游生成单模型目录、mod 拒启；BuiltIn 路由上游可启、mod 拒。待验：mac 实机 codex 真卡 E2E、T5 远端、sandbox UI 半场、Windows T3。

## Pass 16 — 面板 harness 通用化(2026-11-20)

用户指出遗漏：Phase 2 只动了子菜单，Phase 0 侧栏面板仍写死 claude(标题、"Claude providers"、拒启文案、tab 名)，且 args 对话框"appended to every claude launch"已与事实错位——EXTRA/RC 经统一 launchArgv 对 codex 同样生效。修法即注册表的自然延伸：title 上收进 HARNESS(每策略一个字段)；拒启文案上收为 providers.js `cardNote(card, app)`(面板与子菜单单一事实源，agent-menu 的 SUBMENUS 私有副本删除，改 import)；面板头部改 `Object.keys(HARNESS)` 按钮切换(选中持久化 shared `provider-menu.app`，每 harness 缓存键 `provider-menu.<app>`,claude 键名与旧 CACHE 一致无缝)。新 harness = providers.js 加一个策略条目，面板按钮与子菜单行自动出现，零 UI 改动。check 双过；待 sandbox/实机复验面板按钮切换与 codex 列表渲染。

## Pass 17 — 子菜单缩进对齐 + 面板按钮图标(2026-11-20，用户观察)

用户指出：start agent 菜单里 harness 行是「图标+名称」(名称起点 = px9 + 图标14 + gap10 = 33px),provider 子菜单行 pl(28) 没对齐。修：subRow 及 subList 的提示/加载/空态行统一 pl(33)，注释记下几何出处。面板同步采纳 icon+文本：头部按钮加 12px 图标(knownAgents 的 icon/tint，缓存共用 agent-menu 的 "new-menu.agents" 键——面板先渲染文本、图标到位后补；选中态 tint 图标随文字走 accent)。check 双过；像素级效果随 mac 实机轮一并复验(sandbox rig 为 T8 级成本，本次微改动不值得重搭)。

## Pass 18 — 面板布局定稿：总标题 + 纵向堆叠区块(2026-11-20，用户两轮意见)

第一轮(Pass 16/17 的按钮切换)被用户否掉方向：横排 tab 在 harness 增多后难操作，面板下方大量空白才是该用的空间。定稿：顶部一行总标题说明侧栏性质(Providers · cc-switch,↻ 在右端)，其下每 harness 一个堆叠区块——小节头 = 图标 + 名称 + 卡数，knownAgents 报未安装则标注(not installed，标题同步置 dim)；卡列表 pl(24) 缩进对齐小节头标题(几何同子菜单对齐：px6 + 图标12 + gap6)。区块由 Object.keys(HARNESS) 驱动(新 harness 自动出现)，每 harness 缓存键不变(provider-menu.<app>)，↻ 改为 Promise.all 并行重读全部 harness(单 DB，一败俱败进全局 hint);APP 选中态与 switchApp 删除。空区块诚实提示(§4.5)："No X providers yet — add some in cc-switch."。check 过；视觉随 mac 实机轮复验。

## Pass 19 — 手风琴换开：一次点击收旧开新(2026-11-20，用户报告)

agentRow 的点击判断是 `if (this.sub)`(任何展开态下，点哪个 harness 都只收起)，造成"点另一个 harness 要两击"。改为 `this.sub === a.key` 判同：点已展开行 = 收起；点未展开行 = expand 换开(expand 本就重置 providers/note 并按新 app 重读；渲染侧 `this.sub === a.key` 的子菜单挂载与高度计算无需动，Esc 语义不变)。check 过。

## Pass 20 — 面板收起/展开：走 herdr 原生 layout.toggle，不自绘(2026-11-20)

用户问面板有无收起控制。事实：herdr 原生 `layout.toggle|show|hide {id}` 按布局节点 id 显隐(出厂 sidebar 即此模式，ctrl-shift-b)；示例布局的面板块本就带 id "providers" → 命令今天可用，缺的只是文档与键位建议，已补 README 双语(含 keys.json 个人键位示例与 layout.resize)。裁决：不做 mod 自绘"整块隐藏"按钮——按钮随面板一起消失，恢复只剩键位，不对称；herdr 自家 sidebar 的收起也是缩成 32px 图标栏的自持态而非隐藏节点。若将来要面板内交互，正确形态是 workspace-chrome 式图标栏收缩(另立 pass)。

## Pass 21 — 面板控件可供性 + harness 区块折叠(2026-11-20，用户两则意见)

事实核查：mod SDK 无原生 Switch/Button——gpui-base 仅导出 h_flex/v_flex/Input/Editor/Scrollbar 等原语，出厂按钮(tabs panelButton、terminals-bar iconButton)全部手绘 flex+边框+hover+cursor_pointer，此为平台习惯用法。用户批评 args/rc 两行"像状态显示不像控件"成立：无边框无按压感。重画：rc 行换手绘开关胶囊(track 26×15，开=accent 底 knob 右、关=border 底 knob 左，标签随开点亮);args 行右侧换带边框 Edit › 按钮；两行 22→26px 加大点击域，预览截断 40→34 字符。同批：harness 区块折叠(用户追加)——区块头可点，▾/▸ 箭头放右侧(与 agent-menu 子菜单同语义；箭头不左移，卡片 pl(24) 与标题的对齐永不破坏)，折叠态仅留小节头与计数，状态持久化 shared("provider-menu.fold")。过程教训：首推提交带一个多余右括号(check 因 2>/dev/null 静默失败仍进了提交),amend 修复；此后 check 一律显式输出。

## Pass 22 — Fold all / Expand all 行(2026-11-20，用户要求)

rc 行下方、区块列表上方加一行：左侧 dim 标签 "sections"，右侧两枚带边框按钮 Fold all / Expand all(Pass 21 同款控件习惯)。两动作恒显恒可用——no-op 点击无害，且无论当前折叠混合态如何，两个方向都一键直达；写入即 setShared(FOLD) 持久化，与单区块折叠同一状态源。check 过(显式输出)。

## Pass 23 — README 分层重写(2026-11-20，用户定方向)

用户定阅读分层：README 只留用户手册五块——是什么/做什么、依赖(Herdr、cc-switch、sqlite3、CLI)、安装/更新/卸载、制约与特殊情况(Windows、灰显卡、token 可见性一句话、无头 DB 自理)、延伸阅读链接；技术描述与原理全部外移。落地：两份 README 重写为该结构(STE 风格，新增 Update/Uninstall 节——卸载 = 删三个 mod 目录 + layout.switch 回出厂；更新 = pull + p1-install + 面板 cp + Herdr 升级后先重跑 mod.clone)；删除的 ASCII 管线图(DESIGN §2 已有同款)、How-it-works 六条(§3/§4/§4.6 已覆盖)、security 段(§6 更全)、Scripts 表与开发验证(迁入 §9.1/§9.2，含 Pass 21 的 check 显式输出教训)。README 首段保留一句话定位 + 示例场景(DeepSeek/Kimi 并排)。

## Pass 24 — 语言切换行按社区惯例上移(2026-11-20，用户意见)

两份 README 的 H1 正下方加 switcher 行(vue/vite 系惯例):`**English** | [简体中文](…)` / `[English](…) | **简体中文**`，当前语言加粗；原 EN 第二段内嵌的"中文文档"链接与 zh 标题下的引用块删除(zh 的"英文为主版本"事实保留在延伸阅读节)。

## Pass 25 — README 去「卡」与去 AI 腔(2026-11-20，用户意见)

术语：「卡」是本仓内部速记，cc-switch 自身中文文案用「供应商/提供商」——zh 全文对齐为「供应商」(强调 per-launch 概念处用「身份」),EN 同步把 card 收敛回 provider。AI 腔三个来源逐一拆除：破折号长链改句号断句；括号补语拆成独立短句或删除；粗体标签式列表改为平实陈述句。STE100/STC 复核：短句、一句一事、主动现在时、无第二人称、术语单一(provider/供应商 各只一个义)。「Limits and special cases」缩为「Limits/制约」。结构不变(Pass 23 五段式 + Pass 24 switcher)。

## Pass 26 — 中文标点规范 + 术语全面复检(2026-11-20,用户两则意见)

标点:三份中文文档(README.zh-CN/DESIGN/REVIEW)两轮转换——① 半角 , ; : ? ! 邻接 CJK 即转全角;② 强化轮(跳空格看邻接、右括号后接非字母数字亦转),代码块/行内代码/URL/`file:line` 引用跳过;首版脚本因 MAP 键宽歧义空转,码位硬编码后 CJK 邻接半角残留 = 0。括号维持半角(夹英文与链接,惯例两可)。内部日志残留(↻ 后分号、行尾括号后冒号、① 序列)不追。术语复检结论:修正「旗子」→「参数」(中文语境 flag 通称参数,与「附加参数」统一、cc-switch zh UI 同词;「旗标」系 MS 术语表直译,罕用)、「芯片」→「按钮」、「本件」→「这是一个 Herdr mod」;维持「供应商/provider」(Pass 25 定)、「身份」「无头机」「出厂」「灰显」「安全姿态」「调优键」「个人布局」;英文保留 harness、mod、live、profile、panel 生态词。验证:URL 与内联代码引用零误转。

## Pass 27 — 面板段格式化(2026-11-20,用户意见)

「可选侧栏面板」由整段文字升级为小节:先一句定位(280px 停靠、提供什么),再三条要点列表——供应商分组列表(可折叠)/每机 args 行(持久附加参数;mod 自身不添加任何参数,被记录的行是参数进入启动的唯一途径)/每机 rc profile 行(经 shell profile 启动,alias 与 function 生效;默认关闭)——args/rc 两特性首次在 README 获得独立描述;随后安装命令独立成块,收起/键位说明收尾。格式化即凸显,未新增章节。双语同步(参数术语按 Pass 26 定案)。

## Pass 28 — rc 条目补机制说明与两形示例(2026-11-20,用户提供示例)

面板小节的 rc 条目扩为:机制一句(rc 模式 = 经 bash -[l]ic 的命令串,profile 先运行,alias 与 function 都生效;普通启动是词向量形式,词向量只解析 function、从不展开 alias)+ 用户实形的两种写法示例(alias 单行式与 claude() 函数式,均含 workspaceFolder="$(pwd)" 动态 env 与 --dangerously-skip-permissions 参数、command 防递归,后者附一句括注)。示例由用户明确要求入文(Pass 12 撤的是 mod 代码里的 env 注入,示例属于 rc 模式的用户侧说明,两者不冲突)。双语;新写 zh 段落经标点规范化(Pass 26 转换器幂等复用)。

## Pass 29 — 面板小节次序:简介即安装(2026-11-20,用户意见)

「可选侧栏面板」次序对齐 README 总逻辑:三条要点(简)→ 安装(cp 块 + 布局替代)→ 补充说明(收起/键位)→ rc 机制句与两形示例(深)。rc 细节从要点与安装之间后移至小节末尾,读者先装上再读深。

## Pass 30 — 无头机段独立成节(2026-11-20,用户指误)

Pass 29 重排后,无头机段落紧跟面板小节末尾、结构上被归入侧面板小节。补小节头「### Headless machines / ### 无头机」,Install 节下恢复三个平级小节(安装正文、可选侧栏面板、无头机)。

## Pass 31 — CLAUDE_CODE_* 句归位(2026-11-20,用户指误)

「每个供应商应包含各自的 CLAUDE_CODE_* 调优键」是无头机段的旧 seed 文档残留,无因果语境。真实含义是通用行为:逐键合并把仅存在于 live 设置文件的 env 键挡成空 → 调优键应配在各供应商而非只写 live 文件。处理:无头机段删除;Limits 新增一条带因果的说明(env-only-live 键逐次启动被挡;调优键配在供应商上)。双语。

## Pass 32 — 全文档复查(2026-11-20,用户要求)

两份 README 通读 + DESIGN 交叉引用抽查,修 8 类:① zh 示例函数体误漏 --allow- 前缀(实质错误,已修);② 状态句超证据——「支持 Claude Code 与 Codex」改为分句:Claude Code 已验(sandbox+macOS 真机),Codex 同上游配方夹具已过、实机待验;③ rc 机制句去内部术语「词向量」,改「普通启动不经 shell 解析,alias 从不展开」;④ 「无头 Linux」改「无头机」(不挑系统);⑤ fenced 注释里的半角分号手工全角(转换器按设计跳过 fenced);⑥ 括号宽度统一半角(Pass 26 决策执行到底);⑦ LICENSE 行链接边界半角逗号;⑧ 卸载节补布局文件路径、措辞对齐命令数。DESIGN:169 两处指向已迁走的 README 安全段改指 §6/本节。终验:EN/zh 小节行号逐行对齐(9/16/30/60/64/74/83/92),--allow- 四处齐全,CJK 邻接半角标点 = 0。

## Pass 33 — 跨机借库模式实证与文档化(2026-11-20,用户实验)

用户实证:macOS 刷新面板(codex 两供应商)→ 切无头 Linux space 不刷新 → 点击 → Linux 上正确以该供应商身份启动 codex;反向亦然。机制确认:refresh() 在刷新时刻绑定活动 space 的机器,供应商对象(key+config)完整物化进内存;launch() 的 machine 参数只决定启动落点与防护文件来源(目标机 live config.toml/auth.json/$HOME),从不回查 DB;身份全量内联于 argv/env(§7「启动配置随 argv 旅行」的直接推论)。边界语义均按目标机:残留中和/拒启、requires_openai_auth、CODEX_HOME、EXTRA/RC 附加项;key 经远程 argv/env 属已接受信任域(§6)。定案:**面板 = 上次刷新机器的 DB(刷新即选库),启动 = 当前 space;跨机借用是特性**——无头机由此获得零 DB 路线;要用本机 DB 则切到本机 space 刷新。start agent 子菜单仍展开即按当前机重读(跟随语义不变)。README 双语补两处:面板小节一句 sticky 语义;无头机节一段借库用法。候选改进(未做):面板头部显示来源机器名。

## Pass 34 — 刷新按钮承载来源机器名(2026-11-20,用户采纳建议并定排布)

Pass 33 的候选改进落地,兼顾用户两则意见(↻ 图标太弱、标题行放不下机器名):刷新控件从裸 12px 字符升级为带边框按钮(Pass 21 控件习惯),**标签即来源机器**——`↻ mac-mini` / `↻ this machine`,按钮自己解释"按下会重读谁的库",标题行零新增占位。来源随刷新持久化(shared "provider-menu.src",{app: name|""}),init 恢复;未刷新过显示 `↻ refresh`(动作名兜底,兼强化可供性);机器名截断 12 字符。space.machine 即 hc machine 名(herdr.d.ts:134-135,null = 本机),无需映射。README 面板小节 sticky 语义句补充按钮即来源。check 过(显式)。

## Pass 35 — 远程凭据落盘审计(2026-11-20,用户三问)

问:远程传递是否落盘?无落盘解法?会话结束自动清理?实测本机(core pid 在跑、昨日借库测试痕迹在):① herdr-core 持久化终端 argv 于 ~/.local/state/herdr-core/<会话>/terminals.json,16 条(7 live/9 finished)含 CC_SWITCH_CODEX_API_KEY 等 17 处凭据串,**finished 不清理**;mode 664(目录 700×2 掩护,仅 owner+root 实际可达)。② exec 不持久化(grep 证实),DB 读取无泄漏。③ tab.new 无 env 通道,writeTextFile 无 {on} → **无纯不落盘解法**;Phase 3 备选:exec 写 0600 临时件 + argv 只含读取脚本 + 退出自删。④ /proc 活会话 cmdline 含 key(wrapper 链)。⑤ 对照发现 ~/.cc-switch 755 + cc-switch.db 644 = 本机其他用户可读(上游 cc-switch 姿势);本仓 seed 脚本同病并即修:建库后 chmod 0600(实测验证 oct 600)。落文档:README Limits 凭据条改写为精确预期(记录于 terminals.json、无自动清理、/proc、用目标机自己的 DB 规避);DESIGN §6 审计块 + 上游 asks ×4(herdr-core 600/脱敏/env 通道;cc-switch DB 600)。

## Pass 36 — 跨机借用确认弹窗 + 「mod 能否自动清理」定论(2026-11-20,用户两问)

自动清理定论:① 清 core 的 terminals.json 不可行且不该——他人进程的活状态文件(内存模型随时回写,写写竞争),argv 是 restart 语义的组成部分,绕进程改状态违反「不动别人 core」边界;清理责任在上游(asks 已立)。② mod 自清理只适用于 mod 自有产物,当前 argv 内联路线没有。③ **避免落盘优于事后清理**——Phase 3 配方方向定为 /dev/shm:key 经 exec 写目标机内存盘 0600(exec 不持久化),终端 argv 只含读取+trap 自删脚本,KILL 残留也在内存、重启即失,磁盘无痕;mod 可自行实现,不等上游。近期防线:借用确认弹窗落地——launch() 检测 源(面板 src)≠ 目标(当前 space 机器)且该 "src>dst" 对未确认 → 打开 mode="borrow" 自绘 dialog(说明凭据随命令传输、记录于目标机 terminals.json、关闭后留存、/proc 可见、用目标机自己的 DB 规避),三按钮 Cancel / Always for this pair(记入 shared provider-menu.borrowOk)/ Proceed;子菜单恒本机读取,不经此路径。check 过(显式)。

## Pass 37 — Phase 3 RAM 交接配方落地(2026-11-20,用户拍板)

实现 /dev/shm 交接:handoffFile(exec 写 mktemp 0600,exec argv 不持久化)+ handoffScript(bash -c 读→守卫→**读完即删**→body;$s 变量承载凭据);claude(--settings "$s",rc 模式导出 PMS 过内层 bash)与 codex(export CC_SWITCH_CODEX_API_KEY/CODEX_HOME)双 harness 接入;handoffAvailable 按机探测缓存,面板借用弹窗**降级为仅回落场景**(macOS 无 /dev/shm 时)。实测抓到并修复关键缺陷:首版 trap 'rm' EXIT + exec——exec 替换 bash 进程,trap 永不触发,文件泄漏(测试实据);改读完即删后文件寿命毫秒级,KILL 无残留,restart-after-death 由 [ -n "$s" ] 守卫拒启。本机四形态验证:claude JSON 到位+文件即删、codex key/home 到位+即删、rc-claude 经用户真实 .bashrc 的 claude() 函数(函数前置 --allow-dangerously-skip-permissions 使 $2 位移,证明 rc 遵从生效)、守卫拒启 exit 1。README Limits 双语改写为两档姿势;DESIGN §6 缓解块更新;check 双过(显式)。

## Pass 38 — 术语:「秘密」→「凭据」(2026-11-20,用户指误)

Phase 3 文档初稿把 secret 直译作「秘密」,不合技术习惯;统一为「凭据」(与全文「凭据可见性」等一致)。同批补齐:Pass 35/36 的 DESIGN §6 审计与缓解块曾因锚串半角/全角不匹配静默未落(replace 无断言的教训——与 Pass 21 check 静默同类),已按实际文本重锚补入;新增块的半角标点同步规范化。

## Pass 39 — Windows 目标模式弹窗拦截(2026-11-20,用户拍板)

T3 前对 Windows 目标显式拦截,优于 spawn 必死终端+神秘 toast。检测:machinePlatform(machine)——本地 window().platform;远端 uname -s 一次探测缓存(MINGW/MSYS/CYGWIN 前缀或 *_NT = windows,含 Git Bash 环境——T3 前一律未测即拦);探测失败 = unknown 不拦(离线误拦比天然失败更糟),launchArgv 顶层共享守卫(两 UI 同源,子菜单经此抛错入 launchNote)。面板 launch() 重构为单 spawn:T3 门优先 → 借用门(handoff 可用则免确认)→ doLaunch;windows 弹窗说明三件事(env/bash//dev/shm 未建 Windows 配方、原样 agent 行仍可用、读该机 DB 仍可用——想用它的供应商就去别的机 space 启动)。README Limits Windows 条补一句「从 Windows space 启动会显示解释弹窗」。发版后首笔,进新一轮。
