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
- 证据：`evidence/t8-dump-{work,deepseek}.txt`、`t8-argv-{work,deepseek}.json`、`t8-panel-clean.png`、`t8-tabs-launched.png`。(Pass 47 重拍：argv 取自 `hc get`，文件名不再带终端地址后缀。)

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
| T5 | 远程 space:on 读+启动 | ✅ 关闭(2026-11-20,Pass 44):mac 实机轮双向实证——mac 读本机 DB 启动于 Linux space(交接形态,增量断言过)+ Linux 读本机 DB 启动于 mac space(回落形态+借用三键);脚本版清单留作可重复证明 |
| T6 | sandbox 全链路 UI | ✅ T6-lite(渲染+点击+启动+env 清洗)；真 claude 未测 |
| T8 | `--settings` × live 逐键合并泄漏 | ✅ sandbox E2E 26/26(Pass 5)+ 真 claude 2.1.327 复验(Pass 6/T2-B) |
| T9 | seed 的 DB 被 mod 读路径接受 | ✅ 关闭(2026-11-20,Pass 41):读兼容即全部意义,GUI 半场撤销;schema 漂移被动看上游 SCHEMA_VERSION(§11) |
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

## Pass 40 — T5 清单更新至 RAM 交接形态 + 维护项(2026-11-20,用户指派)

A 类可自行完成项:t5-remote-e2e.md 头部标注 2026-11-20 借库实测已实质覆盖远端读+远端启动(Pass 33),脚本版留作可重复证明;断言新增三行(hc get 只见 bash -c 脚本无 sk-、terminals.json grep 计 0、/dev/shm 残留计 0)——stub 收到的 --settings JSON 断言不变。维护:本地 backup-pre-squash/backup-nov20 分支删除(公开史已验证干净并发布);machineHome 按机 Memoize(homeCache,与 platformCache/shmAvailable 同款)。mac 实机轮、T9 GUI 半场、Windows 弹窗验证仍归用户。check 双过(显式)。

## Pass 41 — T9 GUI 打开半场撤销(2026-11-20,用户裁决)

用户指正:该半场是 Pass 14(seed 降为纯验证工具)之前的遗留——当年 seed 被当作无头机建库路径时「GUI 能否零迁移接管」才有意义;如今 seed 库的唯一消费者是 mod 的只读查询,读兼容由 T1/T8/sandbox 每次读库即证,GUI 打开与否对产品零影响,还要求用户备份/还原真库(风险换不来价值)。T9 重定义并关闭:seed 产出可被读路径接受的库 = 已证;schema 漂移监控维持被动看上游 SCHEMA_VERSION(§11 已记 27 未动)。验证指南对应段删除;DESIGN §2/§9.1 措辞同步。

## Pass 42 — 借用弹窗两缺陷修复(2026-11-20,用户实测报告)

① Proceed 无效:go 原为 closeOverlay 后 doLaunch(cx.spawn)——spawn 挂在对话框视图 context 上,浮层关闭即拆除,首个 await(读远端/交接 exec)处被取消,启动永不发生。修为 agent-menu 可证模式:spawn 内先 await 算完 argv,再 closeOverlay + 同步 run;错误路径保持弹窗开启并显示 bNote(如 codex uncovered 拒启)。② Esc 标签纯装饰:三处弹窗(args/borrow/windows)统一换可点 escChip(hover+cursor),键盘 Esc 处理不变。用户实测背景:Linux→mac 反向借用,弹窗正确出现(mac 为回落目标)——门控本身工作正常。check 过(显式)。

## Pass 43 — terminals.json 断言改增量式(2026-11-20,用户实测疑问)

用户 grep -c sk- 得 1:非新泄漏——分类核查证明 #21/#23/#25(含 live)均为交接形态(argv 仅 herdr-pm 路径,零 sk-,Phase 3 生产实证);残留是 05:25-05:37 的 Phase 3 之前内联条目(#16-20,原始借库实验),且 terminals.json 为紧凑单行 JSON,行计数恒 ≤1、绝对断言在有历史机器上无效。两处清单(t5-remote-e2e.md、验证指南)改为增量式:启动前记基线,启动后 grep -o 计数不增、新条目为 handoff 形态、/dev/shm 残留 0。附用户侧安全清旧账步骤(core 停机→删含 sk- 的 finished 条目→重启)入验证指南不在仓库。附带实证:herdr shell 适配器经 "$@" 原样透传 bash -c 词,适配器无秘密。

## Pass 44 — mac 实机轮 1-4 段全过,T5 正式关闭(2026-11-20,用户报告)

验证指南段 1-4 逐项通过,正式关账:①codex Phase 2 真机(mac 为内联回落形态,official 供应商灰显提示正确,DeepSeek 启动应答正常);②面板全套(堆叠区块/单折叠/Fold all·Expand all/args Edit 芯片/rc 开关胶囊/来源机器刷新按钮/借库态标签);③手风琴换开;④借库+RAM 交接端到端:mac→Linux 无弹窗直启、交接形态 argv、增量断言过(Pass 43 证据含 live 条目);Linux→mac 回落形态、借用弹窗三键(Cancel/Proceed/Always)过——Pass 42 修复实证;⑤rc/extras 回归过。**T5 关闭**(读远端+启动远端双向真机实证)。剩余:上游 asks 提交(用户)、可选段(Windows 机/公开 flip/Discord)。mac 轮其余发现(弹窗两缺陷、grep 断言)已在 Pass 42/43 即修即闭。

## Pass 45 — sandbox 预览截图轮 + herdr.dev/mods 打包(2026-11-20)

**截图轮(沙箱)**:两包预览图定稿。关键工程事实:① `scripts/sandbox shot` 产出是 1100px 宽的缩图(`import -window Herdr` + `magick -resize '1100x>'`),把它的坐标当窗口坐标用必错——本窗实际 1356×917,屏幕 1400×900,三个坐标系;② 窗口原点随 Weston 布局漂移,跨进程点击必带陈旧偏移;③ `sandbox-input.py` 按 `WM_NAME=="Herdr"` 找窗,而被映射的真窗口 WM_NAME 为 None,它匹配到另一窗口再加 ox/oy——指针实测偏 (+38,+59)。可行模式(单进程 uv python-xlib):查 map_state==2 的无名单窗 → `root.translate_coords(win,0,0)` 取活原点 → xtest 点击 → `win.get_image` 原生截屏(`magick -size 1356x917 -depth 8 BGRA:` 解码,BRGBA 通道序经橙色 Claude 图标验证)。弹窗几何用 `do mod.open '{"name":"agent-menu"}'` 确定性取得:折叠态 (467,307)-(886,630),Claude Code 行 374-404 中心 (676,389),展开态长到 (468,255)-(886,682)。终稿两帧均过分析器 QA:agent-menu(Claude Code ▾ 展开,Work current 1 / DeepSeek 2 / Kimi 3 / RouterX cc-switch 4,Codex 折叠 2 ▸,hover 高亮已清,单 bash 标签,无裁切)与 provider-menu(无弹窗,面板头部/args/rc/sections/两区块 4+3 行全对,无残影)。期间误点教训:`+` 按钮面板按钮命中难(一次点到 Changes 面板)→ 全程改走 `mod.open`;误点弹出行两次(展开 Codex 一次、目标移动关弹窗一次)→ 定帧测量 + 单进程活原点后成功。tab 栏清理为单原始 bash 标签(`tab.close {confirmed:true}` + terminal.kill {terminal},注意参数名是 `terminal` 非 `address`)。

**打包**:仓库改包结构——`provider-menu/` 与 `agent-menu/` 两包根,各含 RECIPE.md(官方六节:# Name+段落+图/What you see/How it behaves/Built from/Watch out/Done when,AGENTS.md:490-509 已将后两节收编为官方项)+ preview.png(1356×917 原生帧)+ `mods/<mod>/`;agent-menu 包连 my-tabs 一起发(+ 按钮接线是它)。克隆前提取消:官方安装流程即普通复制,包内是完整源(sandbox 装配全程纯复制,已证)。开发套件(gpui-kit.d.ts、jsconfig.json,三份字节一致)上移仓库根,jsconfig 无 include 即覆盖全仓 JS。p1-install.sh 重写:纯复制三个 mod(官方流程)、个人布局补 tabs→my-tabs 并自动停靠 providers 块、重名且非本仓 mod 拒装提示改名;README 双语同步(去 clone 步、面板随脚本停靠、Update 节改写、延伸阅读挂两 RECIPE、篇首嵌两预览图);DESIGN §5.2 打包注记 + §9.1 表 + §9.2 路径。`tab.new` argv 参数确认为正式版能力(defaults/AGENTS.md:583),无版本门槛。check ×3 过(显式;agent-menu 有 reload 后搁浅脚本任务的调度器 WARN,非失败)。新事实:check 会向每个 mod 目录写入 gpui-kit.d.ts + jsconfig.json(jsconfig 注释自述 "Written once by gpui-shell")——包目录因此曾被种入套件,已移除并 .gitignore(`mods/*/` 两式);用户机上 app 首启自会再生,包保持纯运行时文件。/tmp/sandbox-setup.sh 复制路径同步。seed 脚本 app_type 支持随本包提交。

**移交用户**:`gh repo edit maskshell/herdr-provider-menu --visibility public --accept-visibility-change-consequences` + `--add-topic herdr-mod`(herdr.dev/mods 一小时内收录);Issue 1(tab.new env 通道)草稿待其审后提交。RECIPE 已按 §6 要求披露 exec 与读取 ~/.cc-switch 之外文件(readTextFile/exec {on} 跨机、/dev/shm 写入)。

## Pass 46 — 预览图暗色重拍 + 三缺陷根因(2026-11-20,用户报告)

用户否掉首版预览,三缺陷:① 用户名泄露(终端提示符 <user>@<host>);② provider-menu 实为 Pi Agent 界面(遗留实验标签);③ 亮色主题。根因与修法:① core 以 passwd 真实 HOME 生成终端 shell(/proc/environ 实证,HERDR_APP_HOME 不参与),shell 读真实 ~/.bashrc 得 user@host;修 = 演示标签走 tab.new argv `bash --noprofile --norc -c "PS1='$ '; export PS1; exec bash --noprofile --norc -i"`(export 必需,否则回落 bash-5.3$)。② knownAgents 经 bash -ic 探 shell PATH(遵 rc),旧 rig 继承真实 PATH 暴露 ~/.local/bin/pi → 被诚实列为已装 → 误点启动(旧「清理」根本没关那些实验标签;当时分析器全帧 QA 也放行了 = 小字幻觉,本轮终检改放大裁片+像素测量);修 = app 以受限 PATH 启动($root/bin+系统目录,真 herdr-core 软链入内)+ 桩 claude/codex 放 rig home ~/.local/bin 且 .bashrc PATH 前置,重探后 claude/codex installed、其余(含 pi)全部 not installed。③ 无头 Weston 报亮色 → settings.json {"theme":"graphite","theme_light":"graphite","theme_dark":"graphite","dark":true} 强制暗色。

**Pass 45 截图事实两处修正**:其一,1356×917 是 Weston 装饰框(WM_NAME None,外层),客户端窗是它的子窗 1280×820(WM_NAME 'Herdr')——旧预览带着窗口管理器边框,框坐标也误导了点击;正解 = 取该子窗,get_image 纯客户端帧,新预览均为 1280×820。其二,点击偏移符号:root.translate_coords(win,0,0) 给出客户端原点的 root 坐标,客户端 (tx,ty) 应落 root(原点+tx,原点+ty);Pass 45 的脚本在做减法 → 每次点击落在 (tx−38,ty−59) 弹窗外 → 一律被当 outside-click 关掉(这才是 Pass 45「点击难命中」的真因)。改加法后点击全确定性:mod.open → 点 Claude Code 行(客户端 500,345)→ 子菜单即展开;清 hover = 指针泊在死区(弹窗顶部内边距 (600,268));泊在节标题行会因展开后几何位移落在 Work 行上——死区必须选内边距带。

「not installed」标签一轮:面板节头曾显 Claude/Codex not installed,两层根因——knownAgents 结果缓存在 shared 键 new-menu.agents + host 侧 SEEN 60 秒;而面板实例在 10:12 挂载时读到陈旧 false,**layout.toggle 隐藏/重显并不重挂 mod 实例**(内存 this.agents 不换),只有重启 app 才重挂。重启后节头 Claude 4 ▾ / Codex 3 ▾ 干净。探测本身证为确定(按 programs.json 原始 20 命令行 + /proc/environ 逐字环境 5 连跑,claude/codex 全中——「不稳定」是误判,实为缓存/实例陈旧)。

GIF 之问的像素级答案:preview.png 是 get_image 原始转储的无损 PNG(字形边缘 255→90 单像素硬台阶、万余色),观感「压缩模糊」= GPUI 灰度反锯齿 + 查看器缩小;格式维持 PNG(herdr.dev/mods 规范固定 preview.png 文件名)。

终稿 QA(放大裁片+双全帧扫描):两帧零 <user>/<host> 命中;终端裸 `$ ` 提示符;graphite 暗色;弹窗 = Claude Code ▾ 展开(Work current 1/DeepSeek 2/Kimi 3/RouterX cc-switch 4)+ Codex 折叠 2 ▸ + Pi·OpenCode 灰显 not installed(出厂 + 菜单本就列全部已知 agent,灰显对比恰说明只装了 claude/codex);面板 = args/rc/sections + 两区块 4+3 行,无「not installed」;底栏 This computer/0 agents/Ctrl+Shift+P。提交 303b6b3 已推(6cf140b..303b6b3,master 上游已挂)。

## Pass 47 — note 渲染回归修复 + 证据全暗色重拍 + GIF 预览(2026-11-20,用户点名)

**回归修复(本轮头号)**:agent-menu 的拒绝 note 自 4a7b2a1 起从未渲染——实例字段 `this.note`(读库错误串)遮蔽了同名原型方法 `note(p)`,`this.note(p)`/`this.note(pick)` 实为 `""(...)` → quickjs 抛 "not a function"。键盘路径在 app.log 留栈(`error in key handler: not a function at main.js:196:41`),鼠标路径在 on_click 内同样静默死;11-19 验证通过时(note 为内联拼接文案,ec719f1/8bbf6ac)尚无此方法,4a7b2a1 抽共享 cardNote 时引入 wrapper 即撞名。修 = 删 wrapper,两处直调 `cardNote(p, this.sub)`,字段注释注明永不命名方法为 note。修后 sandbox 双路径逐字渲染("RouterX is not an env-form API card (official or routed?) — switch to it in cc-switch, not here."两行,p1-routerx-note*.png)。provider-menu 无此问题(直调 cardNote)。

**展开态几何定标(纠正 Pass 46 的行位误标)**:折叠 Terminal 284/header 318/Claude 345;展开后整个弹窗内容上移约 54px——Terminal 230/header 264/Claude 291/子菜单 Work 320/DeepSeek 348/Kimi 374/**RouterX 401**/Codex 430/Pi 461/OpenCode 493/New space 527/note 两行 499+517(带 note 再上移 22px)。此前扫描窗从 y300 起,漏掉顶部两带 → 行位整体误标 54px:Pass 46 的"点 374=Work"实为 Kimi(经 core 继承的用户 PATH 启动了真 claude,trust 对话框,tab 已关),"461=RouterX"实为 Pi(dim 顶层行,按设计 no-op)——两桩"点不中"皆是打错行,非命中分发问题。xtest 特性:指针远跳后的单次 motion+click 会丢失命中(独立 @motion 到位、停 0.5s、再点击则全确定性);泊指针必须 motion-only——带 press 的"泊"就是一次 outside-click,直接关弹窗。

**stub/HOME 教训**:core 终端继承 core 进程 HOME(/proc/environ 实证 = 真实家目录)——stub 的 `$HOME/claude-launch-dump.txt` 一度写进真实家目录(3 分钟内删除,内容仅 fixture 凭据 + core env 泄漏的模型名变量,无真实 token);修 = stub 写绝对路径,env 观察收窄到凭据面(AUTH_TOKEN/BASE_URL/API_KEY/CUSTOM_HEADERS/OAUTH*)。$root/bin 在 tab 终端 PATH 首位,claude/codex 桩已入其中——面板启动均命中桩,dump 落 sandbox home。

**证据重拍(11 图全暗色、零身份泄漏,×0.8594=1100×705,面板裁 396×820→340×705)**:p1-menu-popup/p1-submenu-expanded(无 hover)/p1-routerx-note(鼠标)/p1-routerx-note-keyboard(键盘)/t6-panel-rendered+t6-tab-launched+t6-launch-dump/t8-panel-clean+t8-tabs-launched+t8-dump-{work,deepseek}+t8-argv-{work,deepseek}(hc get,现行 /dev/shm 交接形态)/t10-panel-3rows+t10-refusal+t10-argv-{work,deepseek}。金丝雀 live settings.json 按 Pass 5 形态重建;dual 断言照旧——Work 卡键保留+live-only 4 键置 ""+model/theme ""+attribution {}+modelPicker 双语义(Sonnet·GLM 4.7 行 replaceBuiltInOptions:true / DeepSeek 空 options:false);env 段零凭据。p1-t4-esc-before.png 弃:Esc"一次全关"是 Pass 7 定论的验收行为,无 before/after 可截,REVIEW/DESIGN 亦无引用。Esc 本轮再证:note+子菜单态按 Esc 即全关(stop_propagation 挡不住 app 键绑定,与定论一致)。

**GIF 预览(用户点名)**:两包 preview.gif 直接从 get_image 原始 BGRA 位图编码(magick `BGRA:` 子表达式内联裁剪,不经任何中间文件;PNG 中转本就无损——双路产物逐字节相同可为证)。agent-menu 440×500 三帧(折叠 1.3s→展开 1.3s→note 2s)34KB;provider-menu 305×760 两帧(面板干净 1.5s→拒绝 note 2.2s)12.6KB。README 双语内嵌改 GIF;herdr.dev/mods 规范仍收 preview.png(两包均保留)。GIF 文字 200% 放大可见调色板量化软边,100% 展示尺寸可读;面板裁剪内看不到 tab 标题(在窗口左端),故 provider GIF 只做"干净→拒绝 note"两态,启动叙事留给静态图。

**历史清洗**:上述 11 张旧亮色 PNG(真机身份像素)各存在于恰 1 个历史提交,filter-repo --strip-blobs 按旧 blob SHA 剥除后 force push,tag v0.1.0 重指新历史(旧 blob 于 rev-list --objects --all 验空)。

## Pass 48 — retina 2× 密度全量重拍(2026-11-21,用户报告 macOS retina 仍糊)

**根因**:Pass 47 的图按 1× 逻辑像素抓取(全幅 1280×820→缩 1100×705),retina 默认分辨率下查看器需把 1280px 宽上采样到约 1660 物理px——糊感来自像素密度不足,与 GPUI 渲染/AA(Xwayland 整数像素、灰度 AA、单像素硬边已证)无关。GIF 路线同因不治本,弃(两包 preview.gif 删除,README 双语内嵌回退 preview.png)。

**2× 方案**:settings.json `"zoom": 2.0`(settings.rs set_pixel_scale 直驱,0.5..3.0 合法)+ window.json `{"state":"windowed","bounds":[70,80,2560,1640]}`(place.rs 首启 1280×820 默认,尺寸由该文件记忆)→ 客户端 2560×1640 = 完整逻辑布局的 2× 物理像素,herdr.dev/mods 要求的文件名 preview.png 不变。私有 rig:weston headless 2700×1800(socket herdr-app-2x)+ rig env 起调试构建;app 找不到 herdr-core 时只弹安装引导(620×460 小窗),$root/bin 需软链真 core/hc。共享状态在 `$home/shared.json` 顶层(非 state/ 子目录):`{"layout":"main-providers","frame.welcomed":"skipped"}` 一次定布局并跳过欢迎弹窗。

**重拍(11 PNG 全部原生 2×,零缩放;txt/json 证据与缩放无关,原样保留)**:p1-* 弹窗场景裁 x820-1700/y470-1250(880×780);t6-tab-launched/t8-tabs-launched/t10-refusal 全幅 2560×1640;面板裁 x1768-2560(792 宽)。场景状态:z5 收起菜单、z9 干净展开(Work current·1/DeepSeek·2/Kimi·3/RouterX cc-switch·4)、wd 鼠标路径 note、w8 键盘"4"note(note 文本"RouterX is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.")、z7 单 tab 启动、wf 双 tab(Claude (DeepSeek)+Claude (Work))、wh 面板 Packless 拒绝("Launch failed: Packless has no route of its own — switch to it in cc-switch first.")。

**工具链定则(用户点名的方案选型)**:几何验证一律 scan-bands.py(确定性像素测量);读屏幕文字用本地 CPU OCR——`uv run --python 3.12 --with rapidocr-onnxruntime`(onnxruntime 无 cp315 wheel,必须钉 3.12;z.ai analyze_image 仅留作"看图说话"兜底,本 Pass 两次调用分别定位 herdr-core 缺失引导弹窗与确认 Size 200% 生效)。rapidocr 在 2× 密度深色 UI 上置信度 0.9-1.0,弹窗/面板/拒绝 note 全文可读。

**xtest 三陷阱(Pass 47 协议的修正)**:①展开态弹窗有两个相差 109px 的锚位——note 使高度超 491 逻辑上限后中段滚动、内容整体移位,按旧坐标连击必错位(本轮两次误启动 DeepSeek/t4 均此因,已关停清理);铁律=每次点击之间重新实测落点。②单击可能纯丢失(无任何效果),同坐标补击即中;③Read 工具在本环境只回 CDN URL 不显图,语义识别外部工具或本地 OCR 二选一。tab 误关可由 view.json 的 tabs 键序恢复;`hc ls` 的 address(t1..tN)与 view.json 的 tab id 是两套标识。

**pHYs 修复(2026-11-21,用户在 macOS retina 复验)**:2× 图在看图软件里感官放大一倍、缩到 50% 才恢复自然大小与锐度——像素内容本就正确,缺的是 DPI 元数据(默认按 72/96 DPI 解释→2× 像素=2× 尺寸)。全部新 PNG 补写 pHYs 144 PPI(magick `-units PixelsPerInch -density 144`,等价 56.69 px/cm),macOS 预览按原尺寸渲染且 retina 点对点锐利;像素数据逐字节不变。

**泄漏修复(2026-11-21,用户发现)**:t6-tab-launched.png 全幅左栏终端提示符带出真机 ``<user>@<host>:~$``(\u@\h 默认 PS1)——Pass 48 重拍时 OCR 输出在眼前仍漏检,教训:凡新帧必按身份词全量扫描,不能只查面板/弹窗。修复=rig .bashrc 设中性 `PS1='\w \$ '`(登录链路已通,PATH 同路生效可证),重拍同场景(tab Claude (DeepSeek)+~ $ 提示符);两字符提示符 rapidocr 读不出(非漏,是无字可读),像素直方图(#96B2D7 路径蓝+#D2D4D9 $)与放大裁图可证渲染正确。全库 PNG 复扫零命中(实测 12 张);update-notes.json 需预置 presented 否则重启后左下冒"Updated to 0.1.16"更新条。

## Pass 49 — 面板关闭/重开：学 skillshare 的停靠开关方式（2026-11-21，用户点名）

**skillshare 机制拆解（runkids/skillshare herdr/skillshare-mod）**：`mod.json {"place":"none"}` 不自动停靠，改由安装器往用户现有布局加两个节点——tab 栏旁 toggle block（`props:{role:"toggle"}`，118px）+ 工作区旁 column（约定 id `skillshare-panel`，min/max 可拖宽），JS 里 `find(layout(), PANEL)` 定位，toggle 钮 `run("layout.toggle",{id})`、面板头 ✕ `run("layout.hide",{id})`；`hidden` 是布局节点一级属性、状态由 app 持久化，故开合换 space/重启皆保留；其 RECIPE 明确告诫勿放进 per-space Files/Changes `panel` 栈（换 space 会复原该栈把面板关掉）。herdr-app 侧事实核对：`layout.toggle/hide/show` 自初始提交即在（commands.rs:83-85，window.rs:3618 经 `chrome.find_mut(id)` 改 hidden，缺节点报 `no node … in the shown layout`）；`place` 的真实语义（window.rs:4486+）=非 none 且**首次 seen** 且当前布局未显示时自动 dock 一个 `fresh_id("b")` **随机 id** 的块（root 为 row 时直挂、无 wrapper），且 **shipped 布局上一律不自动 dock**——skillshare 弃 place:none 之外的路就是因为随机 id 没法当约定用。

**我们的方案（不约定 id，比 skillshare 更稳）**：mod.json 不动（保 `place:"right"`，自定义布局首装仍免费自动停靠），✕/pill 改为**按 `content.mod === "provider-menu" && props.role !== "toggle"` 自查节点**（toggle 块同样挂 content.mod，必须排除）——对自动停靠（随机 id）、手改布局裸块、skillshare 式 column 三种挂载全成立。隐藏目标=块本身，或"只含该块的容器"（column/自动 dock wrapper）——只藏块会留空列占宽（dock() 语义：root 为 row 直挂无 wrapper，此时父即 root 多子、藏块本身正确）。main.js 变更：+`later`（`cx.spawn` 内 `cx.sleep(0)`，规避不许把 render 的 cx 带出回调）、`findPanel/panelTarget` 两助手、init 对 role==="toggle" 早退（toggle 不读库零开销）、`render()` 改 `render(cx)`、面板头 `when(target)` 挂 20×20 ✕（hand-rolled，平台无原生 icon helper）、reveal-refresh（`wasHidden` 三态 null/true/false，null 挡首轮与 init 双读，隐藏→复现时 later 一次 refresh——skillshare 同款）。布局 `main-providers.json`：tabs 块包进 `tabs-row`（42px row），尾加 `provider-toggle` block px104 `props:{role:"toggle"}`。

**RECIPE.md 同步**：What you see（头部 ✕）、How it behaves（✕ 隐/pill 复原、开合是布局状态故重启保留、复开自动重读）、Built from（pill 节点写法、"无约定 id，对手改块与自动停靠同样生效"、`layout` 补进 herdr imports 清单）、Watch out（勿入 per-space panel 栈，换 space 会关）、Done when（✕→pill→重启留态）。术语沿用已发布版本先例，未新引入表述。

**sandbox 两个新陷阱（本轮实测踩中）**：①`scripts/sandbox shot` 的实现是 `import -window Herdr` 后 `-resize '1100x>'`——**截图被缩到 1100 宽，而 click 坐标是 client px（1280×820）**，shot 图坐标 ×1.1636 才是可点坐标；坐标定位必须走 sbx-capture.py 原生 BGRA（`-size 1280x820 -depth 8 BGRA:` 解码）。本轮开头两次"单击被吃"实为缩放错位，非 xtest 丢击。②`scripts/sandbox` 只设 `HERDR_APP_HOME` 不设 `HOME`——mod 里 `~/.cc-switch` 经 shell 展开到**真机库**（首帧 claude=[GLM(current)]/codex=[] 与 fixtures 不符，当场识破；污染截图已删）。修=按 start_window 原样手动起窗并带 `HOME=$root/home`（setup 脚本头注释本就要求 "a window started with HOME=$root/home"）。附带：带 HOME 前缀跑 `sandbox restart` 会连 CARGO_HOME 一起指过去触发全量重建（已中止清理 `$home/.cargo`），手动拉起时跳过 build 即可。

**验证（全部通过，evidence/t9-close-*.png）**：✕(1256,16) 一击隐整列（工作区展开、pill 仍钉 tab 栏尾 x1189）；pill(907,21) 复原、几何与原帧逐项一致；开→杀窗重启→仍开；关→重启→仍关（排除"默认即开"假阳性）；HOME 隔离后 fixture 全读对（Work(current)/DeepSeek/Kimi/RouterX+Codex 三张），status errors []。自动停靠（place:right 首装）未单独实测——与实测路径同一代码分支（按 content.mod 树遍历，节点 id 无关），root-row 直挂的几何情形与 main-providers 相同。**遗留**：两包 preview.png 仍是旧面板（无 ✕ 头），下次发版前 2× rig 重拍面板 crop 即带上。

**Pass 49 增补——重开守卫 + skillshare 共存实测（2026-11-21，用户实测反馈"关掉之后如何再开"）**：①用户实机证实可关，暴露缺口——只更新 mod 文件、布局无 pill 的安装=能关不能开。修=**布局无 toggle 块则不画 ✕**（`hasToggle()`，成对原则：关闭钮必须有其可见回路；成对安装不受影响）。RECIPE 同步：pill 从可选升为成对安装，Watch out 补 `herdr-app do layout.show '{"id":…}'` 兜底。②**与 skillshare 并列共存实测通过（用户点名场景：其 star 最高、共装概率大）**：真装 runkids/skillshare-mod 全量 mod + 其 RECIPE 双节点，顶栏四钮并排 `Files/Changes/skillshare/Providers`；点谁谁开（各占独立右列， ours 280 / theirs 400），各自可关互不干扰——点我们 ✕ 后 state 文件仅 `providers:hidden:true`、skillshare 列保持开。单变量复现定案；此前一帧"两列同关"系恢复轮两次乱点污染（xtest 教训再现：坐标必须逐帧实测）。**布局侵入结论**：唯一新增布局依赖=pill 块（wrap tab 栏）；无 id 约定故无撞车，兄弟块/嵌套 row 可组合，与 skillshare 同装即证明；零 wrap 备选（约定 id+keys.json 绑定，app 自身 ctrl-shift-b→layout.toggle:sidebar 先例）已向用户提出、待拍板未实现。③工具教训两条：**像素暗计数脚本曾用 awk 字符串比较全数成暗**（`$3<0.85` 里 $3 是 "(246" 这类非数值串→恒真）——计数法换 magick compare -metric AE 差分或修 awk 数值转换；**布局持久态真值表在 `$home/layouts/.state/<name>.json`**（nodes.<id>.hidden / stack active），排障先读它再做像素考古。④守卫双侧 sandbox 验证：成对（✕ 在、关/开回归）/无 pill（✕ 消失、面板常驻，与成对帧同区 zoom OCR+AE 差分证差异）。sandbox up 自起的窗带真机 HOME（须先杀再手动带 HOME 拉起，本Pass 再踩一次，layout=main 无面板故未读库）。

**Pass 49 增补二——alt-p 键路径落地（2026-11-21，用户拍板"做"）**：约定 id `provider-menu-panel` 上到 RECIPE 块示例、完整窗口布局与 p1-install.sh 的停靠块（README 双语旧例 ctrl-shift-p 实为 app.palette 占用，一并修正）；包根新增 `keys.json`：`{"layout:main-providers": {"alt-p": "layout.toggle:provider-menu-panel"}}`——**绑 layout 段不绑 global**（跨布局按到会 toast "no node"；RECIPE 注明安装时改段名）。格式循 app 自家先例 ctrl-shift-b→layout.toggle:sidebar；alt-p 全库空闲。守卫不变：键路径用户以键双向开合，不画 ✕（键即回路）。sandbox 实测（t9-key-open/hidden.png）：无 pill 布局 ✕ 消失、面板常驻；alt-p 一击关、再击开。键与 pill 同一命令，持久化由 Pass 49 重启双测覆盖；layouts/.state 落盘是惰性的（交互后数十秒仍未 flush，屏幕证据为准，排障勿依赖即时读它——修正前述"真值表"结论为"沉降后真值"）。

**Pass 49 增补三——alt-p 的 macOS 陷阱（2026-11-22，用户问"alt 在 macOS 下的键位"）**：keys.json 的 `alt-` 在 macOS=option(⌥)，US 布局 ⌥P 打出 π——app 键位指南明文"option+字母会产字符、别自己选"（defaults/AGENTS.md:544），而出厂 mac 表（keys.macos.json）**零 alt-\* 绑定**、侧栏走 `cmd-b`。我选 alt-p 违反该指南。修正=分平台：Linux/Windows 维持 alt-p（包内 keys.json 不动），macOS 装键时换 **`cmd-shift-b`**（出厂 mac 表空闲——cmd-shift 已占仅 d/l/p/w/[ ]/，且与 app 自家 cmd-b→layout.toggle:sidebar 同族成对；Linux 侧 ctrl-shift-b 被侧栏占用故不能用 ctrl 系做跨平台单键）。RECIPE/README 双语/卸载段四处同步；mac 实机验证留给用户（本机无 mac，cmd-shift-b 空闲以出厂表源码为证）。

**Pass 49 增补四——安装面拆分澄清 + p1-install.sh 补 pill（2026-11-22，用户 mac 实测未见 ✕）**：用户在 mac 更新 mod 文件后无 ✕——非 bug，是守卫按设计起效（其布局文件无 pill 块）：**分支把"可关可开"拆在 mod 代码与布局文件两处**，mod 热重载只更新面板本体，✕/pill 的布局节点必须随布局文件更新（换 layouts/main-providers.json / 手加两节点 / 或键形态）。暴露的真缺口=**p1-install.sh 只停靠面板块、从不装 pill**，自家安装器产出的恰是"无 ✕"形态。修=脚本对每个个人布局（在面板块存在且无 toggle 块时）把 my-tabs 块包成 `tabs-row [tabs(weight1) | provider-toggle(px104)]`（沿用原 tab 栏 px 作 row 高），幂等（已有 toggle 则跳过）；离线 fixture 单测：v0.2.0 形态布局→加 pill ✓、重跑 0 变更 ✓。脚本尾部提示补 ✕/pill 一句。mac 用户即时修法（README 已有）：换分支布局文件重启，或键形态加 cmd-shift-b 绑定。

**Pass 49 增补五——完整窗口布局重排为 shell 形（2026-11-22，用户点名）**：main-providers.json 重构为 `root [sidebar | shell[tabs-row | body[work[work-body+status] | provider-menu-panel]]]`——**pill 栏（tab 栏）横跨终端+面板满宽**，面板与「终端+底部状态栏」整组平行（状态栏只垫终端、不伸到面板下），padding/gap 自 work-body 上移到 body 防双垫。意外收益：栏满宽后 **pill/Files/Changes 按钮位置不再随面板开合漂移**（旧形态面板开合会横移整个按钮组）。sandbox 验证（evidence/t9-layout-shell-{open,closed}.png）：几何三项（栏满宽到右缘 1280、面板头降到栏下方 y62、底部状态文字止于 x~840）+ 功能回归（pill 关/开、✕ 关在新结构下全过）；新帧全量身份扫描零命中。RECIPE 的"加进现有窗口"路径不变（用户自有布局不强制此形）；p1-install 的停靠仍是 root 追加满高块，侵入最小。preview.png 仍为旧形态，发版前需按此新布局 2× 重拍。

**Pass 49 增补六——弃拷贝式布局，安装器生成式重写（2026-11-22，用户两轮定调："一条命令全覆盖、用户不懂实现细节"+"copy json 混乱"）**：**根因坐实 `main-edited` 副本增殖**——旧 p1-install 的 glob 打了出厂 `main.json`（tabs→my-tabs+停靠面板），而 app 每次启动复原出厂件、把被改的搬成 `<name>-edited(-N).json`（mods.rs edited_name）并 toast "Your edits are in main-edited"；脚本再跑连 edited 副本也打补丁→`-edited-2`…无限增殖。**重设计**：仓库删除 `layouts/main-providers.json`（不再有任何"示例布局文件"可拷贝/漂移）；安装器第 2 节改为 ①从 **app 自己维护、升级自动刷新**的 `~/.config/herdr-app/layouts/main.json` 现场**生成** main-providers（my-tabs + shell 重排[tabs 提升/满宽 tabs-row+pill/body 行] + 面板块，inner row 的 padding/gap 上移防双垫）②个人布局照旧只停靠+包 pill，**显式跳过出厂名 main/terminals/win98 与 main-providers 自身**。用户更新= `git pull && sh scripts/p1-install.sh` 一条命令，零手动文件操作；main-providers 每次重生成（脚本拥有该文件，个人微调需重跑后重做）。离线单测：出厂件字节不动 ✓、生成结构与 sandbox 实证结构相同 ✓（修掉一个 identity bug：tabs 深拷贝重绑定后 `is not` 失效致原块残留）、个人件 dock+pill ✓、幂等 ✓；sandbox 实机：生成布局启动渲染与手写 shell 形逐项一致（evidence/t9-generated-open.png），pill 一击关 ✓，home 出厂 main.json 保持 pristine ✓。README 双语三处同步（安装/更新/卸载）。

**Pass 49 增补七——安装器自动布局选择（2026-11-22，用户确认根因"当前不是 main-providers"并要求自动切换）**：脚本第 3 节——当前布局为**出厂名**（main/terminals/win98，出厂布局永不载 mod、装完必"什么都不显示"，即用户两次踩的坑）时切到 main-providers：app 在跑走 `herdr-app do layout.switch` 活切（subprocess，8s 超时，二进制不在 PATH/失败落 fallback），没跑则改 shared.json 的 layout 键下次启动生效（读改写仅该键，避开运行中竞态——活切优先正为此）；**个人布局不动**（面板已停靠其中，切换反打断），打印 kept 一行。测试三案例：未跑 app+main→next-start ✓、跑中+main→live ✓、个人 myclone→kept ✓（注意：运行中的 app 拥有 shared.json，测试间手改会被其回写——验证输入要以 app 视角为准）。教训入档：herdr-app do 必须经 PATH 找到二进制——开发机裸 shell 无 herdr-app 于 PATH，subprocess FileNotFoundError 落 fallback 是正确行为。

**Pass 49 增补八——main-providers 改 create-once 所有权（2026-11-22，用户以自己的架构论反问"copy+切换正确么"+问 skillshare 怎么处理）**：接受批评的一半——切换正确（出厂布局永不载 mod 是 app 所有权规则，clone 是官方路径），"脚本每次重生成、拥有该文件"错误（重跑覆盖用户微调，与 my-tabs 分叉同病）。改为 **创建一次、此后视为用户的**：存在即跳过生成（打印 kept as yours + 刷新法=删文件重跑，与 my-tabs 同款契约）；(b) 的排除表放开 OURS，让它与个人布局同走 add-only 幂等维护（重跑只补缺失的面板/pill 节点，用户 divider 等改动幸存——离线三连测过：创建/保持/微调幸存）。README 双语更新段同步。**skillshare 对照**（用户点名）：其 mod 包同样零 layout 文件，由安装 agent 往用户现有布局合并两节点（在出厂布局上则先 `layout.clone`——app 的 clone 自带切换副作用）；"完整窗口"另作独立 herdr.dev/layouts 布局包发布（herdr-layout 通道）；更新走 mod 内建自更新器（只换 mod 文件，"布局要动时只合并那些节点"）。我们与它的差异=用 shell 脚本替代 agent 手术（用户要的一条命令），create-once 后所有权语义已对齐（文件归用户，脚本只 add-only）。

**Pass 49 增补九——用户名命名克隆 + 血统检测（2026-11-22，用户两问）**：①"main-providers 过于指向产品"→ 克隆改以用户命名 **`main-<用户名>`**（$USER/$LOGNAME 清洗为 herdr 合法字符，空则 mine）；旧 `main-providers.json` 一次性改名迁移（连同 `.state/<name>.json` 点击态与 shared.json 引用，app 在跑则活切）。②"非 main 出厂布局/无法判断血统怎么办"→ **`cloned_from` 标记**（layout.rs:322，app clone 时自动写入 `{"name","version"}`，我们的生成克隆也带上）：shipped win98/terminals 及其克隆**跳过停靠**并说明（win98 自带 theme:"win98"+VGA 字体+teal 底的整套外观，面板目标只是默认窗口）；手作/无标记文件（含 app 搬出的 `<name>-edited` aside，本就是 main 形）视为 main 形照常 add-only。切换策略同步收紧：仅 current==main 才切（win98/terminals 是用户的刻意选择，克隆就绪但打印手切命令，绝不背后切换）。离线 T1-T6 全过：fresh 创建+next-start 切换 / 旧名迁移三件套 / win98-clone skip / handmade 补 / win98 保留提示 / 幂等。修一个自产 bug：print f-string 双引号嵌套（python SyntaxError），改 %s 格式。README×3+RECIPE 键段名同步（keys.json 模板段名由 RECIPE 指示改名，保留作示例）。

**Pass 50——v0.3.0 发版：preview.png 按新形态 2× 重拍（2026-11-22，用户令"合到 master 并 release"）**：独立 2× rig（/var/tmp/herdr-2x，weston headless 2700×1800，socket herdr-2x）替代 sandbox 做发版素材——settings `{"zoom":2.0,"appearance":"dark"}`（appearance 小写变体，"Dark" 报 unknown variant 且**整份 settings 拒用、zoom 一并回落 1.0**）、window.json **在 home 顶层**（`frame/` 是目录，写 `frame/window.json` 是死路径；bounds [70,80,2560,1640]）、shared.json `{"layout":"main-demo","frame.welcomed":"skipped"}`（welcomed 缺省会弹欢迎层）。流程：seed 库（7 fixtures）→app 起一次让出厂 layouts 落盘→杀窗→写定三 json→`USER=demo p1-install.sh` 生成 main-demo（真实安装器产物即预览对象）→再起窗（运行中 app 内存持有 shared.json，**活切失败落 fallback 后必须杀窗重写再起**，否则惰性回写冲掉 layout 键）。验证链：status（layout/zoom/errors []）→sbx-capture 原生 BGRA 2560×1640→暗底判定（bg 23,25,29）→面板区 OCR 全读对（Files/Changes/Providers pill 满 width 栏、Work current、cc-switch 灰标）→✕ 几何证明（rows 120-159 上下边框 + cols 493-504 字形 = 40×40 chip）+全帧 OCR 复认 X(2494,133)→全帧身份扫描零命中→analyzer 终审（✕/pill/内容/无泄漏/无裁切异常全过，并抓出我漏的左下 status 碎字——截到 y1560 修掉）。成片 792×1560 @144PPI（pill 栏+✕ 头+全部区块；旧版 792×1600 无 ✕ 无 pill）。教训：analyzer 核对要核 CDN URL 对应文件（本轮误传首帧浅色图，prompt 又自带"dark theme"偏见——模型顺着说，幸内容项独立可验）。证据 evidence/t10-preview2x-{frame,panel}.png。rig 用毕整体拆除（含 fixtures token）。
