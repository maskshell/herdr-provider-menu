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

终稿 QA(放大裁片+双全帧扫描):两帧零 <user>/<host> 命中;终端裸 `$ ` 提示符;graphite 暗色;弹窗 = Claude Code ▾ 展开(Work current 1/DeepSeek 2/Kimi 3/RouterX cc-switch 4)+ Codex 折叠 2 ▸ + Pi·OpenCode 灰显 not installed(出厂 + 菜单本就列全部已知 agent,灰显对比恰说明只装了 claude/codex);面板 = args/rc/sections + 两区块 4+3 行,无「not installed」;底栏 This computer/0 agents/Ctrl+Shift+P。提交已推（master 上游已挂)。

## Pass 47 — note 渲染回归修复 + 证据全暗色重拍 + GIF 预览(2026-11-20,用户点名)

**回归修复(本轮头号)**:agent-menu 的拒绝 note 自 cardNote 抽出共享方法那笔提交起从未渲染——实例字段 `this.note`(读库错误串)遮蔽了同名原型方法 `note(p)`,`this.note(p)`/`this.note(pick)` 实为 `""(...)` → quickjs 抛 "not a function"。键盘路径在 app.log 留栈(`error in key handler: not a function at main.js:196:41`),鼠标路径在 on_click 内同样静默死;11-19 验证通过时（note 为内联拼接文案的早前两轮）尚无此方法，cardNote 抽共享方法那笔提交引入dNote 时引入 wrapper 即撞名。修 = 删 wrapper,两处直调 `cardNote(p, this.sub)`,字段注释注明永不命名方法为 note。修后 sandbox 双路径逐字渲染("RouterX is not an env-form API card (official or routed?) — switch to it in cc-switch, not here."两行,p1-routerx-note*.png)。provider-menu 无此问题(直调 cardNote)。

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

**Pass 51——安装器补装开合键位（2026-11-22，用户 mac 实测"cmd-shift-b 不起作用"）**：根因=**键形态从未随脚本安装**——p1-install 只装 pill，键位一直是 RECIPE 里的"手动合并 keys.json"备选；连包内模板段名也还是 `layout:main-providers`（改名后即死段）。按"一条命令全覆盖"标准补齐：脚本第 2 节新增键位块——per-OS 选键（Darwin→`cmd-shift-b`，否则 `alt-p`），对**每个含固定 id `provider-menu-panel` 的个人布局**（即脚本停靠过的）在 keys.json 的 `layout:<名字>` 段绑 `layout.toggle:provider-menu-panel`；add-only（该键上已有用户绑定则打印 kept 不碰），legacy 段里我们的绑定迁出（用户其他键保留）；仅在有写入时落盘。**app 侧事实**：keys.json 活重载（keys.rs:1 + window.rs:975，mtime 监视/25-poll 兜底/notify 即时），装完数秒内生效、无需重启——实测首按 1s 内未及、再按即中（监视延迟，非失败）。离线矩阵过：fresh 建段 / legacy 迁移（global 与用户键不动）/ 用户占键 kept 且零写入 / win98 血统与无固定 id 手作块**不给**键段。sandbox E2E（t11-key-installer-{open,hidden}.png）：HOME 隔离起窗于 main-sbx，alt-p 一击隐（帧差 21%、pill 仍在）、再击复原（与原帧 AE=0）；摘绑定→键死→脚本装回→不重启再按→恢复开合。sandbox 首跑需 app 先落出厂 layouts（新 home 无 main.json 时脚本报 FileNotFoundError——真机 app 已跑过不触发，测试环境先 cp defaults）。README×2 四处 + RECIPE（Built from 键段改为"脚本自动绑、手装并模板"、Done when 增键位行）同步；脚本头注过时的"面板仍需布局块"一句顺修。

**Pass 51 增补——检测输出 + 两个伪结论作废（2026-11-22，用户二报"cmd-shift-b 仍不起作用"并点名"在 Install 脚本中做检测输出"）**：①**过程教训（先记，防复犯）**：compound 命令里 `cd /tmp` 之后相对路径 `scripts/sandbox` 静默失效（>/dev/null 吞了 No such file），"终端聚焦吞掉 layout 段键"、"global 段（ctrl-shift-b 侧栏）也不派发"两个结论全是按键根本没发出的伪结论；跨目录调用一律绝对路径。重做（绝对路径）后 **Linux 全链路再证通过，含终端聚焦**：点进终端聚焦 → alt-p → 面板开→关（OCR 证据 + 状态栏 commands 文本右移 287px=工作区变宽）。**AE 判读教训**：面板表面与工作区同为暗底，面板隐藏的可靠信号是面板区 OCR 文本消失 + 状态栏文本位移；像素 AE 大小依内容而定（同是隐藏，一次 215k 一次 27k）。②**检测输出（脚本第 4 节 key check）**：打印 CLI 版本与运行态（status 活读当前显示布局）、keys.error 内容（app 解析失败的真错误）、绑定是否在覆盖面板布局的段里、显示布局与段不符时给精确切换命令、全过时给"应立即生效"结论 + mac 特有提示（系统快捷键抢占排查、换键）。五路径实测：全好（活）/CLI 缺席（文件侧降级）/keys.json 坏（重写 + 清 stale keys.error——app 活重载成功会自删该文件，竞态属自愈）/keys.error 持留（打印）/win98 显示中（mismatch + 切换命令）。绑定步补两处：坏文件重写时明说、顺手删过期的 keys.error。③**mac 侧剩余嫌疑**（检测输出的目标即此四项）：脚本没跑到绑定步（未拉最新/中途退）、keys.json 解析失败（keys.error 会在检测里现形）、当前显示布局与段名不符、系统级或第三方快捷键抢占 cmd-shift-b。Linux 侧已无未验环节。

**Pass 52——T11 MCP 跨机携带落地（2026-11-23，用户拍板"rc 同款控件；codex 一起"+strict 做可勾选参数+易懂 label 与 tips）**：实现=providers.js 增 `readMcps`（per-harness 投影，表缺→空集不阻断）/`tomlInline`（JSON→TOML 内联，null 键丢弃）/`mcpOverrides`（strict 先 `mcp_servers={}`）/`mcpContext`（src≠dst+per-target 开关门控）/`handoffSourced`（sourced 赋值交接：读→rm→守卫→body，记录面只留 $VAR 引用）；claude 走 `--mcp-config` JSON **字符串形态**（sourced 先读后删决定了字符串是唯一保即删语义的形态——计划里的"路径形态"不成立，已按实际修正）；codex 走 `-c` 内联表；两 harness 均含 rc×mcp×shm×回落全叉乘。UI=mcpRow（rc 同款 pill + `only mine` 芯片仅开时出现 + `?` 帮助弹窗五段文案；**行不可点**——三控件各自可点，规避嵌套点击冒泡未知性）；借用弹窗补"any carried MCP definitions"从句。**验证**：node+herdr 桩 25 断言全绿（投影 claude=ctx+web/codex=ctx+cxonly、同机不带、记录面 $PMM 无 token、claude 见 mcpServers 字符串、strict 双侧、TOML 内联良构、codex strict 清空先行、回落内联、rc 叉乘、零 /dev/shm 残留）——桩 exec 走真 shell，交接文件真实生灭；sandbox UI 六项（行渲染/pill 开+持久化/only-mine+持久化/? 弹窗正文/同机启动 dump 无 --mcp-config），证据 t12-mcp-{row,dialog}.png，身份扫描零命中（唯一 token 命中是弹窗自己的说明文字）。**测试环境三教训**：桩须模拟"相对路径在那台机 home 解析"（{on}→cwd）；`bash -ic` 会 source 真实 HOME 的 bashrc（claude()/codex() 函数把 codex 解析到真机 CLI）——spawn 必须 HOME=rig home；纯构造 argv 不执行会留 shm 文件（app 语义由终端执行删除），残留断言只在纯执行测试后有意义。UI 定位教训：浅色主题下白底误判为"面板没了"；欢迎浮层吞点击（先关浮窗再验）；行内控件坐标以 cols 扫描实测为准（估坐标三次丢点击）。mac 双真机跨机轮留给用户。

**Pass 52 增补——only mine 改传统勾选框（2026-11-23，用户反馈"看着像标签不像控件"）**：边框芯片是状态描述非动词、无可供性——改 13×13 勾选框（选中=accent 底+surface 色 ✓，未选=边框空框）+整组标签可点（h20 组点击区）。验证：sandbox 干净窗内 s1 帧实测框体双边框线（x1036/x1048 间距 12px）+ only mine 文字 + pill 开（t12-mcp-checkbox.png 放大证据）；点击交互逻辑与 pill 同款已证模式，✓ 字形渲染留用户真机目验。**顺带上游发现（候选 issue，待用户定）**：herdr-app master 构建下，外部生成的布局（本安装器）+ 模型变更（如自动创建的 starter space）触发镜像文档 conflict toast 风暴（"Layout changed elsewhere / The other screen's layout is shown."，window.rs:2164，每轮询叠一条，优雅退出亦不回写本地槽）；0.1.16 装机版未见此特性故用户真机无此象。**本轮工具教训 ×2**：OCR 行首是 "(1001," 格式，awk `$1+0` 因前导括号恒 0——过滤须先 sed 剥括号（又一次文本解析假阴性）；sandbox"神秘 bash space"定性=master 构建 fresh home 启动即自动建 starter space（此前误归因于我的点击），core 会话态在 home/.local/state 下、view.json/state 目录之外，全清仍复现即源于此。

**Pass 53——v0.4.0 发版：文档审计 + preview 2× 重拍（2026-11-23，用户令"检查文档是否需要更新，如OK则release"）**：①**文档审计**：RECIPE 弹窗模式清单 Three→Four（补 `mcp` 520×380）+ 持久化键补 `provider-menu.mcp/.mcpOnly`（审计抓出的唯一真缺口）；顺修 RECIPE Watch-out 重复行、README×2 制约段内部任务号 jargon（"pending T3"→平实说法）；DESIGN ADR 11 / README×2 mcp 行 / agent-menu RECIPE 的"不适用携带"注均已随 mcp 携带特性同步，无缺口。②**preview 重拍**（面板形态变了：多 mcp 行）：2× rig 重建带 `frame.welcomed:"skipped"`（昨日 rig 干净的根因；无此键 master 构建 fresh home 会自建 starter space → 模型变更 → 外部布局镜像 conflict toast 风暴，0.1.16 无此特性）；**点击两弹**：一击 (2522,312) 落 pill 右边界外 6px（r0/r1 波段逐项相同=零效果的铁证；坐标须从波段几何反推中心，不可估）；二击 (2492,312) 即 track 中心命中。**新 rig 陷阱：capture 滞后**——点击后毫秒级抓帧仍是 OFF（GPUI 重渲染未上屏），滞后 >1s 再抓即 ON（52px 实心 accent 波段）；hover 泊指针会整体抬行底色（raised），扫波段前必须先泊走。**工具事实：本机 tesseract 已不存在**——此前多轮"OCR 为空"实为 command-not-found 被 2>/dev/null 吞掉（r1 歧义的一半根源），文本验证按决策规则回落 analyzer（读态+身份扫描一体完成）。③**补种重拍**：rig 库原只有 3 张 claude 卡（Codex 空态），sqlite 直插 Kimi + 三张 dim codex 卡（meta `api_format:"openai_chat"`/`is_full_url:true`/空 config → router/follows-login 分类即灰显+cc-switch 标），点头部刷新 chip（波段 x309-459；✕ 在 x493-504 需避开）活重读，免重启。④**成片**：client 帧裁 x1768+0 792×1560 @144PPI，analyzer 终审 PASS——mcp pill ON（knob 右）+ only mine 未勾选框 + `?`、rc OFF、Claude 4 卡（Work current/DeepSeek/Kimi/RouterX dim）/Codex 3 卡全 dim 带 cc-switch 标、无渲染瑕疵、身份扫描零命中（左条纯黑无终端文本）；evidence/t11-preview2x-mcp-frame.png 留全帧。⑤v0.4.0 tag + release（mcp 携带为主打）。

**Pass 54——T12 会话迁移落地（2026-11-24，用户令"开搞吧"；设计裁决同日完成，见 memory 与 DESIGN ADR 12）**：①**migrate.js**（新，~300 行）：MOVE/MARKER/EXCLUDE/CHUNK 常量、slugOf/newId、findClaudeSession（ls -t 最新 jsonl+侧目录探测）/findCodexSession（rollout 首行 cwd 匹配，needle 在 shell 里 printf 构造规避 JS 引号坑）、buildManifest（find -prune 排除表+sha256sum 200 条批查，join 正则兼容无 ./ 前缀输出）、markerManifest/readMarker/writeMarker（标记走 writeTextChunked——writeTextFile 无 {on}）、targetGate 三分支（nofile/nowrite/empty/full+标记 id 匹配，原因句）、transferPlan/runTransfer（copy/del/keep；读 base64 写 decode-append，mode 恢复 chmod）、placeClaudeSession（目标 slug 目录+侧目录逐文件）/placeCodexSession（recodeCodexMeta 首行重写）/resumeArgs。**/tmp/t12test node 桩 22 组断言全绿**（真 shell 底座、三伪机 HOME 隔离）：slug/会话发现/清单/门×5/标记往返/计划/字节+mode 级一致传输/增量+删除/300KB 分块/双 harness 放置/recode 单元。②**main.js 接线**：moveRow（move session + stage ›）+moveCard（from 行/源机提示/shell 列表≤4+refresh/note/拒绝原因/to 行 first move|update/arm 勾选框/pick 提示）+moveDialog（go()：清单→门复验→传输进度→双端落章→放置→launchArgv(extras=resumeArgs)→closeOverlay 后零 await→tab.new→清暂存→moved 弹窗；密件句/排除句/带语境默认 prompt/hint；mBusy 封 esc 与按钮，失败落 mStat+mErr destructive 红）+movedDialog（Stop the source agent=terminal.kill / Keep it (may diverge)）+launch() armed 路由（错 harness 句/源机句/开弹窗）。③**沙箱 UI 实证（本 Pass 主战场）**：手工复刻 sandbox（rustup 空、用 11-21 既有 target/debug 构建）——**HERDR_APP_HOME 是可携根，settings/mods/shared/layouts 全在其直接下**（.config/herdr-app/ 是错路径：mod 报 no mod folder、settings 不生效）；layout clone+加块（RECIPE:32 配方）+tabs-row 包 pill；**core 隔离必须自起 serve**（私有 XDG_RUNTIME_DIR——app 默认 connect 到真实 holder，其 serve 继承真实 HOME：面板一度列出真机 GLM 卡=纪律红线，立杀杂散 serve 并以 HOME=rig home 重起；PATH 摘除 ~/.local/bin 防真 CLI）；伪 cc-switch 库（seed-cc-switch-db.py，RWork/RDeep fixture token）。验证链全绿：moveRow/卡片渲染 → list shells（**panes() 修前坑**：hc ls cwd=spawn 值，cd 后的 shell 列错目录——shellTargets 重写为 panes() 活 cwd，远端同窗可见故一个原语双机通吃，已回写仓库）→ shell 行过门 fresh → arm 勾选 → RWork 点击开 moveDialog（标题/from-to/密件/排除/prompt 默认句/hint/Cancel+Move 全项目 OCR 复核）→ Esc 取消且暂存存活 → Move 走不可达源机（fakeA）**诚实失败**（`herd exec: unknown machine "fakeA"` 落 mStat，按钮恢复）→ **无头 harness 全链路成功**（沙箱副本 init 播种+go() 同款调用序：/tmp/sbx-ws→/tmp/sbx-dst 传输、双端 .herdr-migrated 同 id 同清单、jsonl 落目标 slug 目录、stub claude 收到 `--settings {RWork env} --resume fix-1111 "continue — now on this machine"`、moved 弹窗开、暂存清空）→ moved 双按钮在。**Esc 偏差坐实**：分叉模态被 app 内建 escape→overlay.close 关闭（keys.rs:271 Overlay 域绑定），mod on_key_down+stop_propagation 拦不住——计数探针（shared 键）证明 handler 收不到键；裁决=Esc 即隐式 Keep（保守侧），ADR 12 记偏差+上游 ask（不可关闭 overlay）。④**工具教训**：analyzer 的 y 坐标漂移 ±20~60px（两次大偏差一次把 sections 行认成 RWork 卡、一次 checkbox 行偏 20px），**band 扫描+局部 5-6x 放大复核**才是地面真值；底部停靠卡内容增长时整卡上移（新增行在下），旧坐标全废——每次点击前 fresh scan；quickjs 无 setTimeout（spawn 体首行即 ReferenceError 且 try 外静默死），等待用 cx.sleep；外部写 shared.json 会被 app 内存态整文件覆写（播种必须走 setShared 或重启窗口）；`hc send` 自带回车、独立按键是 `hc keys`；pkill -f 会匹配自身命令行（用 environ 校验+pid 精确 kill）。⑤**开放**：codex resume argv 序 rig、双跳吞吐、真双机弹窗流（沙箱同机守卫放宽仅 scratch 副本，仓库语义未动）。

**Pass 54 增补——shell 选择器按当前 tab + 本机重构（2026-11-24，用户双机实测报告 + 三条追加意见）**：①**用户报障**："list shells on this machine" 列的是**源机** shell——根因=window.rs:1920 `panes()` 遍历所有 space 所有机器的全部 pane（`PaneInfo` 无 space/machine 字段、有 tab；本地机 `SpaceInfo.machine` 恒 null，远端具名——本地无名可取是 "this machine" 措辞歧义的土壤，chip 原来还硬编码该词、远端目标机也不报名）。②**重构语义（用户定）**：卡片目标区分两层——**current tab**（`spaces().find(s=>s.active).tabs.find(t=>t.active)`，渲染期实时计算 + init 300ms 看护循环：tab 切换不重渲染 docked mod，看护仅在 move 已暂存且未选目标时 cx.notify）领先展示；其下 **list shells on ‹machine›**（`spaces().filter(s=>(s.machine??"")===cur)` 的 tab 并集过滤 panes()——机器级圈定使源机 shell 结构性出局；列表带 "shells on ‹name›" 持久标签、current tab 已现目录去重；空/守卫句均具名）。③**move session 行移至面板底**（用户指认 "move session · stage ›" 与上下行逻辑关联弱）：行常驻贴底、暂存卡出现时停靠其下把行顶起；无 db 的 hint 态补 flex_1 占位使行照样贴底（沙箱实测发现的隐藏形态：hint 替代 flex 列表时卡片会悬在面板中部——用户"夹在中间"观感的另一半来源）。④**沙箱回归（重建双 space 三终端：src-space t1→rig-src-dir、dst-space t2→rig-dst-dir/t3→rig-dst2-dir，MOVE 播种 fakeA）**：current tab 显示活动 tab 的活 cwd（t3→rig-dst2-dir）✓；纯点 tab 头（零面板交互）1.2s 内 current tab 行变为 t2 的 rig-dst-dir ✓；list shells 得 [rig-src-dir, rig-dst-dir, rig-dst2-dir]（同机全 space，源机 fakeA 结构性缺席）✓；底部形态=move session 行被卡顶起、卡贴底、"shells on this machine" 标签 + 去重行 ✓；重启后播种 move 与活动 tab 均存活 ✓。⑤**本轮工具教训**：误起第二 app 实例→双 Herdr 窗互抢截图与点击（症状=帧内容无解释地翻转、点击落空）——pidfile 记的是 setsid leader 不是 app 本体，判活必须 environ 扫描；`magick -resize 3x` 是"宽 3 像素"不是 3 倍（用 `300%`）；底部停靠卡几何随内容增长全变，每轮点击前重扫。

**Pass 54 增补二——mac→linux 真机 move 失败：migrate.js shell 面 GNU 依赖清除（2026-11-25，用户报"move 并未 copy 成功"+纠偏"不能假设 macOS 工具链是谁，逐命令判定"）**：①**取证**：目标机（本 Linux）零落盘（无 .herdr-migrated、无新目录、~/.claude/projects 无新 slug）→ 失败在源侧 go() 第一步；静态审计坐实三处 GNU-only：buildManifest `find -printf`（stock macOS find 无此 primary，**第一雷**，永远先炸）、`sha256sum`（mac 无）、`base64 -w0`（BSD 不认 -w）；另有 writeB64 `base64 -d`（BSD 惯例 -D）与 findCodexSession 的第二处 -printf。②**重设计（用户裁决）**：**逐命令运行时判定，不按 OS 按人**——brew 场景 g- 前缀也不占原名，故判定须覆盖：哈希三级链 `command -v sha256sum → gsha256sum → shasum -a 256`（输出同形，正则通吃；全无=诚实报错 127）；manifest 列表改 POSIX `-exec sh -c` 内 `wc -c` + `stat -c %a ∥ stat -f %Lp`（皆败=空 mode→目标 644 优雅降级）；readB64 改 `base64 < file` **零旗标** + JS 端剥空白（对 76 列折行免疫，分块对齐由 JS 保证）；解码旗标**每机一次探针缓存**（`aGk=` 试 -d 再试 -D）；codex 发现改 `-exec ls -t {} +`（POSIX 新旧序）。③**验证**：主 22 组重跑全绿（GNU 臂=行为等价）+ 新增 4 回落臂桩测（/tmp/t12fb：gsha256sum 臂/stat 双败降级/-D 探针端到端字节一致/无 hasher 诚实错）全绿。**桩测两教训**：PATH 前置 stub 目录**不构成隐藏**（/usr/bin 仍可达）——隔离须 PATH=仅 stub 目录并补 sh 符号链接；模块级探针缓存（B64D）要求跨用例分进程跑。④**待用户 mac 真机复测**（本机无法验 BSD 臂真身；shasum 输出格式为代码审读+正则宽松匹配，未桩测）。

**Pass 54 增补三——全线 move→copy 措辞裁决 + arm 标签补工作区（2026-11-25，用户令 review 提示句并问"全线 move 是否改 copy"）**：①arm 勾选框改 `copy the session and workspace above`（原 "copy the session above" 隐去了工作区随行这一裁决要点）。②**全线 move→copy**（用户裁决）：整个流程无任何自动"移动"——源端不删不停，真正的移动只在分叉模态按 Stop 时由人完成；move 是全 UI 最大的 overpromise，且与 checkbox 的 copy 混用正是要消灭的指代不清。改动 15 处用户可见串：面板行 `copy session`、卡片标题 `copy claude session`、to 行 `first copy`、提示句 `pick a Claude Code provider above to copy and resume`（用户抓错：卡停面板底、providers 在卡上方，"below" 自初版即错，我上轮 review 误放行）、弹窗标题 `Copy session`+按钮 `Copy`、分叉模态 `Session copied`/`diverge from the new copy`、5 条 launchNote 前缀 `Copy:`、2 条拒绝理由 `no copy marker`/`a first copy needs an empty directory`。**不改的内部名**（零用户可见、避免无价值 churn）：shared 键 `provider-menu.move`、弹窗 mode `move`/`moved`、标记文件 `.herdr-migrated`、函数名（startMove/moveCard 等）、T12/迁移 特征名。测试同步（/no copy marker/）22 组全绿。

**Pass 54 增补四——默认 prompt 弃机器名，改可转换语境三件套（2026-11-25，用户两问："机器名可由 app 重命名、目标 agent 无法识别"；"用机器名能有效转换 context?"）**：裁决=**机器名不进 prompt**——herdr 注册表标签可重命名、agent 端零解析途径；能转换的语境=①**新绝对根路径**（transcript 满是旧机路径，新根是唯一可验证地面真值）②**目标平台**（`uname -s` 每机一次缓存：Linux→linux / Darwin→macOS，mac↔linux 命令面全变）③**被排除依赖重装句**（源侧 `[ -d ]` 探测 EXCLUDE 实存目录、点名列出——同时补上"裁决过但没进 prompt"的旧缺口）。实现=migrate.js 增 `targetPlatform`/`excludedPresent`/`defaultPrompt`（纯函数）；launch() armed 分支改 cx.spawn 双探针后随 props.prompt 开弹窗（探针失败=对应分句静默省略，诚实降级）；弹窗 init 用 p.prompt ?? 兜底。形态例：`continue — now at /home/b/proj on linux; node_modules stayed behind — reinstall them there`。shell 小坑两枚（桩测抓出）：`for d do` 迭代全部位置参数含 $1（须先 shift）；`[ -d ] && printf` 末项失败即整脚本退 1（须收尾 `exit 0`）。25 组全绿（+3）。

**Pass 54 增补五——打包传输/面板滞留卡/标记确定性三连（2026-11-25，用户三提议：tar 打包、panel 状态停在最后、resume 后 agent 自发校验 .herdr-migrated 引出的显式提及之问）**：①**tar 打包**：通道成本=每往返非每字节（逐文件 1 读+N 写+chmod，300 文件≈千次 exec）→ plan>16 文件或>512KB 走单包：源侧 tar（500/批 argv 安全追加）→ dd 96KB 原始分块读 → 原 base64 argv 通道 → 目标侧 untar（mode 由 tar 携带）；小 delta 仍逐文件。8MB 树往返数 ~4000→~115（35×）。**测试抓出两个 shell 坑**：`"$@"` 展开含 $1/$2（tar 把包文件和根目录全路径一并打包，"archive cannot contain itself"是铁证——须 `p1=$1;p2=$2;shift 2`，与 excludedPresent 同病第二次犯）；writeB64 首片 `>` 截断是"一文件一调用"语义，累积文件复用即每块截断（12/300 文件幸存的现场）——runPacked 自管追加。压缩（gzip）暂不加：只省 3 成块数非数量级，且费两端 CPU，留作下档。②**面板滞留卡**：copy 成功后暂存卡不消失——根因=实例隔离：清暂存的 setShared(MOVE,null) 由 dialog 那个 mod 实例发出，setShared 只重渲染各 mod、不重跑 init，而面板 this.move 仅 init 读一次 shared → 卡片停在 armed 态直到重启。修=面板 render 时重读 `this.move = shared(MOVE)`（面板本就是唯一写者+读者，渲染期读取即收敛）。③**标记文件确定性（用户真机证据：resumed agent 自发对 250 文件 SHA-256 全校验通过）**：模型确实会看 .herdr-migrated 并自证完整性——但自证不可靠（另一轮可能误读/清理）。裁决=**双重确定性**：prompt 显式点名（"`.herdr-migrated` is this copy's manifest — keep it, later copies delta by it"——预期家具、承重、勿清理）；工具侧 verifyCopied（传输后、落章前，目标侧对 plan.copy 重哈希与源清单比对，失配即抛计数错）——完整性由工具保证，模型的自发校验从必要降级为冗余。测试 30 组全绿（+verify 通过/篡改捕获两织、+tar 三组）。

**Pass 54 增补六——目标漂移警示（2026-11-25，用户问"首次 copy 后分支不一致会怎么处理"）**：①**现状澄清**：.git 随行（裁决定案），分支无特殊性——HEAD/refs/objects/工作树差异全是普通文件；回程增量把目标同步成源当前分支状态，目标侧改动按停车位语义被覆盖（改过文件覆写、新增文件孤儿存留、commit 对象留在 .git/objects 通常不可达但不删）、源赢且**静默**。②**缺口**：ADR 写过"目标改动被覆盖=弹窗提及"但弹窗从未实现（只在 RECIPE watch-out）。补齐：launch() 探针加 readGitBranch（两端，纯 shell 读 .git/HEAD：ref: 前缀剥分支名/detached 取短 sha/无 .git 空）与 countDrift（目标对基线 marker 的漂移计数：存在性扫 [ -e ]（shift 防 $@ 含 $1 + 收尾 exit 0 防末项退 1）+ hashRels 比对，改动+消失都计）；弹窗在排除行下加条件句"The target drifted since the last copy: N files differ (source on ‹b1›, target on ‹b2›) — copying overwrites the target's versions."（分支名仅两端可读且不同时显示）。不硬拒绝——停车位语义定案，警示不阻断通勤。③**readGitBranch 教训**：原按 machine|root 缓存，桩测暴露同 key 二读返旧值——两次 copy 间切分支会命中陈旧名，一发 exec 不值缓存，删之。32 组全绿。

**Pass 54 增补七——候选行单选控件 + re-pick 回路（2026-11-25，用户两问："› path 高亮前无点击可供性，是否加同组单选控件"；"选错了如何返回重选——目前只能 stage 重来"）**：①**radio 圆点**：所有候选（current tab 行 + list shells 行）统一为单选组语义——11px 空心圆（border input/accent）+ 选中内点 5px accent，路径文本选中变 foreground；替换原 "› " 前缀（纯箭头在 hover 前读作文本）。选中判定=this.move?.target?.dir === dir（选择随 target 落定即刻收敛折叠，圆点主要是可供性+互斥感知）。②**re-pick › 芯片**：to 行右侧（refused 态同样给，红色原因句旁）——清 target+armed、保留 m.shells，卡片即时回到候选行，无需重 stage；**顺带修掉一个未防的死局**：pick 被门拒绝后 target 已置、候选行隐藏、原 UI 只剩 ✕ 从头再来。refused 句从 dim 升 destructive 红以配严重度。33 组桩测（含既有全部）过；视觉以用户真机为准（rounded_full 已在 kit 验证存在）。

**Pass 54 增补七补——re-pick 芯片改前导 ✕ 列（2026-11-25，用户两步追改："候选行可消失，被选中移上去的行前面加叉叉"；"叉叉和单选同一列，选择/取消位置统一"）**：候选行保留折叠（界面干净），回路从 to 行右侧芯片改为**提升行前导 ✕**；几何统一=候选行与提升行同用 16px 前导控制位（radio 11px 圆居中其中 / ✕ text10 占其中）、行框同 px(3)+h(20)+gap(5)——选择与取消的点击位置物理重合。refused 红句同款 ✕ 前导。壳测无涉（纯渲染），视觉待用户真机。

**Pass 54 增补八——组缩进 + Refresh 按钮 + 大小写规则（2026-11-25，用户三连问："各组信息应有合适缩进"；"refresh 做成按钮、位置与 stage› 一致"；"文案大小写需要考虑"）**：①**缩进层级**：组标签降 9.5px 纯标签（label helper，pt 参数化——行内复用时 pt=0 防错位），组内容统一 pl(8)（行 hover 高亮随组成块）、组间 pt(4) 气口；提升行/拒绝行同步缩进保 ✕ 列对齐。②**Refresh 成按钮**：从组尾裸文本 chip 移入 "shells on ‹machine›" 标签行右端，bordered+raised 同 `Stage ›` 形制（h16 px7 rounded6 border input bg raised）——与 `copy session … Stage ›`、`args … Edit ›` 同构（标签左、按钮右）。③**大小写规则（定）**：可点控件句首大写（Stage › / Refresh / Fold all / Edit › 既有）、被动标签小写（current tab / shells on X / copy session / args / rc profile / mcp）、成句提示首字母大写（No shells on… / This is the source machine… / Switch to a space…）；"list shells on" 芯片随之 → "List shells on"。遗留不一致（only mine 小写）记为未来顺手项。桩测全绿；视觉待真机。

**Pass 54 增补九——拒绝分支渲染崩溃修复 + 卡片标题/路径视觉层级（2026-11-25，用户报错："单选框不可选，This view could not be re-rendered; showing the last version. expected a string, got nil"）**：①**根因**：拒绝行与弹窗 mStat 用了 `t.destructive`——theme() 根本没有这个键（herdr.d.ts 权威清单无、两套 shipped 主题无；native 侧 cx.theme 的 destructive 是另一 API，其映射源正是 `blocked`，src/mods.rs:1269）。`.text_color(undefined)` 在 native 绑定抛 "expected a string, got nil"→整视图 re-render 失败→冻结在末帧→单选框"不可选"。触发面=拒绝分支：用户点的目录非空无标记（真机常见——现存项目目录），fresh 路径永不经过。修复：两处改 `t.blocked`（canonical 键、明暗主题同名）。审计其余 t.* 键全部 canonical。②**同批落地用户上一问的（a）**：卡片标题 `copy claude session`→`Copy Claude session`（标题非被动标签；弹窗标题 "Copy session" 同制）；from 行路径 foreground+左侧截断（>30 字符）——被 stage 的路径是卡片主语；arm 勾选句与 arm 后提示句按"成句首字母大写"规则改 `Copy the session and workspace above`/`Pick a Claude provider above…`；`copy session` 行标签与 `current tab` 组标签维持小写（被动标签规则，与 args/rc profile/mcp 同列）。③**拒绝行防截断**：理由 `"not empty and no copy marker — empty it or pick another directory"` 在 280px 面板溢出，且自带出路句与卡片追加的 `. Pick another.` 冗余——migrate.js 理由缩短为 `"not empty and no copy marker"`，拒绝行目录左侧截断（>14 字符）。④**沙箱验证**：fresh 拾取→提升行/勾选框渲染✓；拒绝目标种子注入启动→红字理由行渲染✓无冻结无横幅；`{on:null}`（本机）exec/readTextFile 实测放行（SpaceInfo.machine 本机=null）。⑤**沙箱工程教训（记入记忆）**：`scripts/sandbox shot` 管道把截图缩到 1100px 宽——点击坐标必须从 `$root/full.png`（未缩放原图）推，否则全部偏左上（本轮多组"点击无效"实为此）；gpui X11 只处理 XI2 按钮事件（client.rs:1250 无 core ButtonPress 分支），headless weston 下按钮投递可整靴死（渲染/截图仍活）且逐启动随机——判别法=on_click 探针写 note 到 shared.json；llvmpipe 下输入延迟可达 10s+，判"未生效"前要等够。rig 32 组全绿。

**Pass 54 增补十——红字溢出修复（2026-11-25，用户报"红字溢出了"）**：拒绝行与提升行在 280px 面板溢出的双重根因——flex_1 不加 `min_w(0)` 时 flex item 的 min-content 宽度会把文本撑出容器（flex_1 只管分配不管收缩下限），固定 `h(20)` 又把换行后的行裁掉。修法=文本 div `flex_1().min_w(0)` + 行改 `min_h(20).items_start()`（随折行生长，✕ 顶对齐首行），两行同制；顺带撤掉增补九的 14 字符目录截断（整路径可展示，交给折行）。沙箱双态截图验证（analyzer 判读）：拒绝行 42 字符目录+理由折三行全在卡内；提升行同路径折两行 + 勾选框行完好，均无溢出。RECIPE 无需改（从未描述过截断行为）。

**Pass 54 增补十一——copy 卡字号提到面板基准（2026-11-25，用户报"字体太小了，要瞎了"）**：卡内阅读文本 10.5 → 12.5（面板基础字号，与 Providers 名单齐平）：标题/from 行/候选行/拒绝行/提升行/arm 句/提示句；层级件同步放大——组标签 9.5→11、List shells on 与 Refresh 芯片 10/9.5→11（Refresh h16→18）、两个 ✕ 10→11；arm 勾选框 13px 不动（与 mcp 行同款控件）。**字号放大改变截断边界**：候选行 40→32 字符 + `min_w(0).whitespace_nowrap()`（app 自己的单行路径习惯用法，agents/main.js:316 同款——左截断给 …，nowrap 下容器只会硬裁无信号）；from 路径 30→24 + `min_w(0)`（估算错了优雅折行而非溢出）。折行的行（拒绝/提升/提示句）零字符逻辑，边界即容器。沙箱三态验证（analyzer 判读）：拒绝行 12.5px 折两行卡内、候选行长路径单行左省略号不碰边、提升行折三行 + arm 勾选 + 提示句全在卡内，面板全域无溢出。moveRow（copy session · Stage ›）维持 10.5/10——与 args/rc profile/mcp 行同构的面板元行惯例。rig 32 组全绿。

**Pass 54 增补十二——staged 路径改换行悬挂缩进（2026-11-25，用户令"from this machine 后的已选中路径换行缩进显示"）**：撤 from 路径 24 字符左截断，全文展示；悬挂缩进零新结构——label 本就是 flex_none 独立项，路径 div 折行后续行天然对齐路径首字符（越过 label），min_w(0) 已在。验证走本地波段扫描（几何按决策规则）：42 字符路径折行后连续行 left_x 全部 179 对齐路径起点，analyzer 放大复核转录一致、无半字形裁切；四行偏高的复现条件是种子的 18 字符假机器名挤窄路径列，真实 "this machine" 下约两行。RECIPE from 行描述同步（截断→换行缩进）。

**Pass 54 增补十三——armed 态全元素自审（2026-11-25，用户令 review 排布/大小写/字体/风格并给草图）**：①**维持项**（逐条核对代码事实）：标题 12.5 semibold 与面板 Providers/节头同级；`·` 分隔符 from/to 成对仗（用户草图写 `:`，对仗优先）；大小写全卡无违例（被动标签小写、控件句首大写、`first copy` 括注被动小写）；moveRow 10.5/10 维持元行惯例（与 args/rc profile/mcp 同构）；卡片辅助件 11 vs 面板芯片 10 属容器相对尺寸（10.5 行配 10、12.5 卡配 11）；勾选框 13px/✓9.5 与 mcp 行同款控件；✕ items_start 顶对齐折行首行；候选行未选全 dim（圆点+变色双选号，维持）。②**修两处真问题**：提升行全 dim 与 from 行层级不对称（from 路径 foreground 是增补九裁决，落点同样是要事）——镜像 from 结构：dim `to X ·` 标签 + 路径 foreground + 悬挂缩进，`(first copy|update)` 括注随路径同色（单字符串才可整体折行；三段 span 各自 flex item 不能集体折行，Style::default Row+NoWrap 实证）；arm 行 px(3) 缩进既不齐控制列也不齐边距——改 pl(8)+16px 控制列（radio→✕→勾选框一列，提升行与 arm 句同起 29px，hover 块与候选行几何一致）。③**验证**：rig 32 组全绿；沙箱 armed 态五问全过（路径深色/标签灰、续行悬缩进、勾选框在 ✕ 列下、arm 句与路径同 x 且其折行同列对齐、无溢出）。**新形态**：arm 句在 29px 起点下折行（`above` 落次行对齐整齐）——12.5px+29px 起点该句单行放不下，折行是干净解。

**Pass 54 增补十四——armed 点击无响应：`{on: ""}` 静默死（2026-11-25，用户真机报"所有动作做完后点击 provider 没有任何响应"）**：①**根因链**：launch() armed 探针块的 `dst = spaces()?.machine ?? ""` 把本机编成空串喂 `{on: ""}`——herdr 实义（mods.rs exec_future）`Some(m)` 一律走远端、`None` 走本地，空串被当远端机器名 `""` 查找 → reject；`readGitBranch`/`countDrift` 无 try/catch → Promise.all 整体 reject → cx.spawn 体无声死亡 → 无弹窗无提示。`targetPlatform`/`excludedPresent` 有 catch 只静默降级（prompt 丢 "on linux" 分句——次级错误）。go() 本身干净（`=== "" ? null` 转换过），死点只在 launch() 探针块。②**三层修复**：探针机器取自暂存态（m.src/m.target.machine，非当前焦点 space——顺带修掉 arm 后切 space 探错机的隐患）且 `""`→null 规范化；四个探针函数全部 try/catch 自卫（display probe 永不抛，readGitBranch→""、countDrift→0）；外层再包 catch 落 launchNote 可见错误——静默死是敌人，任何失败必须有声。③**rig 桩忠实化**：herdr 桩原先 `HOMES[""]` 把 `{on:""}` 静默当本地跑——正是 32 组全绿却漏此 bug 的原因；改为 `on:""` reject、未知机器名 reject（对齐 mods.rs），测试全线改说 app 的语言（本地=null，35 组含新三回归全绿：`armed probe set survives a local ("") target` 修复前必挂、两探针 reject 降级）。④**真机链路验证**：全沙箱（假库 Work 卡 + armed 暂存 + 本机目标）xtest 真点 Work 卡 → Copy 弹窗打开；prompt 含 `on linux`（规范化后本机探测成功）、fakeA 源机探针拒绝被吞（无分支句）、Cancel/Copy 完整。**方法论教训：桩的宽容度就是测试的盲区**——桩必须复刻真实现的拒绝语义，不只是成功路径。

**Pass 54 增补十五——path×label 排布裁决（2026-11-25，用户问"path 和前面的 label 到底该怎么排布，有没有更优化的 UX"）**：三案对比——A 现行（label 内联、路径折行悬挂缩进于路径首字符）：成句感强、首行空间零浪费，弱点是路径列宽随 label 宽浮动（18 字符假机器名实测把 42 字符路径挤成四行）；B label 独占行（路径全宽折行）：路径列宽确定（约 38 字符/行），代价 from/to 各 +1 行、卡片增高 ~34px；D 段落式回边折行：行数最少但路径失去块标识。**裁决：维持 A + 机器名 12 字符帽**（`slice(0,11)+"…"`，与 header 刷新芯片同款既有惯例）——帽住最坏情形（路径列 ≥ ~160px）且零结构改动；from/to 平行对仗保留。**纪律披露：帽代码误混入空机名修复那笔提交**（与 "" 修复同文件同批编辑，推送后才发现）——不改写已推历史，特此记录；如需拆分历史由维护者定。rig 35 组全绿（帽为纯展示，桩测无涉）。

**Pass 54 增补十六——Copy 弹窗按钮死：go() 同步段缺 cx.notify()（2026-11-25，用户真机报"prompt 对话框中无法继续，只有取消生效"）**：①**根因**：go() 点下后同步段置 mBusy/mStat 即入 cx.spawn，但**中间无 cx.notify()**——gpui 的 mod 状态变更不会自己触发重渲染；慢源（真机 mac 上 buildManifest 秒级）期间 busy 态零呈现：按钮看似全活着、状态行不存在，而后续每次 Copy 点击都被 `if (this.mBusy) return` 静默吞掉；Cancel 走 app 层关闭所以"只有取消生效"。沙箱此前没暴露=fakeA 源瞬间失败，第一个异步更新前就进了终态。修复=spawn 前 `cx.notify()`（4 行）。②**沙箱 E2E（真 app 内首次全链路）**：1500 文件本地源 → 打包传输 → verify → 双端 marker → transcript 落位 `~/.claude/projects/-tmp-sbx-dst2/<uuid>.jsonl` → launchArgv → tab.new → moved modal（Stop 实心/Keep 描边）；mid-flight 1.2s 截图证实修复——灰 `listing the workspace…` 状态行可见、按钮/输入框隐藏。③**E2E 三只害虫全是我方 seed/操作之过，代码守卫全部正确拒绝**：seed `id:null` 撞目标已有 marker → gate 正确拒绝（resume 分支要求 expectId 匹配 marker.id）；seed session 形状 `{kind,file}` 缺 dir/uuid → `placeClaudeSession` 读 undefined 路径报 `read failed: the session transcript`（真实 findClaudeSession 产物含 dir+uuid）；手工重启 app 未带沙箱 HOME → kill 扫荡按 HERDR_APP_HOME 匹配把沙箱 core 一并带走、重生 core 继承真实 HOME → machineHome 落进真实 `~/.claude/projects`（空目录 breach，已 rmdir 清除，真实 home 复验零残留；恢复=HOME+XDG 指沙箱重启并复验 core environ）。④**点击坐标教训（第三次同类）**：按钮必须按**实心填充矩形**定位（列扫整高暗块 x837-901），合并文本带的中心会落进按钮间隙（833 落空 vs 869 命中）。⑤冷沙箱全链 ~35s（多 exec 冷启动），截图判定前要等够。rig 35 组全绿。

**Pass 54 增补十七——staged 卡重排：锁定单选/红框 ✕/缩进路径/淡金提示（2026-11-25，用户规格排版+两处中途纠正）**：规格=from 行前导**绿色已选单选**（独立一组不可取消、无值纯装饰）、to 行 ✕ **包上框**渲染红、两条 path 各自**缩进行于 label 之下**（排版如草图）、tips 上……中途纠正：淡黄是**提示文字颜色**非分割线。实现：绿 `#15803d` 11px 圆与候选行 radio 同形制（无 on_click，锁定）；repickX 改 13px 红框盒（t.blocked，与 arm 勾选框同形制——前导列三控件成一族，16px 命中区与点击行为不变，拒绝行同款继承）；from/to 改两行结构=label 行（前导控制列 + dim `from/to <machine>:`，分隔符 `·`→`:` 从草图）+ path 行 `pl(21)`（16px 列+5gap，块缩进：折行全行对齐 label 起，foreground 不变，`(first copy|update)` 随路径单字符串）；tips `#a16207` 淡金（浅底 12.5px 仍可读的金阶，pt(4) 与上块气口）。RECIPE from/to 行描述同步。验证：像素探针 `#15803d` 精确命中、pl(21) 对齐 x34=列+gap；analyzer 五问全过（绿单选/红框✕/双行缩进/金色提示/checkbox 与提示间无夹杂物）。**工具自省两笔**：编辑时多一 `)` 由 `node --check` 抓出（长链 paren 配平不靠肉眼）；波段扫描器跑到区域末端的 band 被 silently 丢弃（无闭合 append）——扫描器自身的边界条件也要测。rig 35 组全绿（纯渲染，桩测无涉）。

**Pass 54 增补十八——卡片抛光回合 + Esc 分阶段实测 + 取消安全（2026-11-25，用户三问+两追加+一回归报告）**：①**用户报回归**：目标未选定时 arm 勾选框已出现——根因=增补十七重构时把 `when(target && gate.ok)` 在 to-path 行提前一个括号闭合，arm 行被挤上无条件链（原代码尾行 4 括号可证 arm 本在 when 内）。单括号复位修复；**教训：链式 DSL 的行为改动可以藏在纯排版编辑里，重构后必须逐条件核对渲染矩阵**（无 target/拒绝/通过×armed 四态）。②**path 缩进**：pl(21) 差 8px（行自带 pl(8)：label 文本起点=8+16+5=29）——两 path 行 pl(29) 对齐控件后文本。③**分割线**：增补十七把用户"淡黄是文字色不是分割线"纠正执行过头（撤了线）——补回 hairline（h(1) bg t.input，mt(5)），淡金只归提示文字。④**弹窗进度**：mStat 裸文本改 bordered 域（px10 py7 rounded9 border input bg background，与输入框同族）：busy=accent 蓝、失败=bordered+text 双红、空闲=dim。⑤**Esc 分阶段实测**（沙箱真点）：空闲态=对话框关、暂存存活（既有结论）；**busy 态=app 先关对话框、整条异步任务随视图搁浅**（app log 铁证：`a reload stranded script tasks that will never settle`）——marker 不写、moved 不弹、tab 不开、catch 永不运行；moved 态=隐式 Keep（既有裁决）。mod 的 on_key_down 收不到 Esc（app 绑定先闭），**无法阻断**。⑥**取消安全（用户两追加：制品双端安全删除；增量场景谨慎）**：设计=确定性包路径（`$TMPDIR/.herdr-pack-<slugOf(root)>` 源端、`.in` 后缀目的端——**同机双端撞名是 rig 逼出的真缺陷**：单一名下 chunk0 的 `>` 截断毁掉未读 tar）+ 双重入点清扫（launch() armed 探针 Promise.all 并入 cleanupPacks + go() 起手；runPacked finally 照旧）+ busy 标志（go 起手 setShared true/catch 清 false/成功清 null）+ 卡片红字提示**按 gate 分支**：fresh=「部分写入目标须清空再试」，resume=「直接重试即自愈」——**绝不建议清空有 marker 的目标**（旧 marker 描述旧态，重试 delta 会补齐半写文件、rm 幂等）。⑦**E2E 证链**：1501 文件 delta→盯包文件出现即 Esc→stranded=1+marker 未动+双端两制品残留→卡片红字（busy 滞留）→重点 provider→**清扫执行+对话框正常开**。rig 36 组全绿（+packPath/cleanupPacks 组；`/tmp` 陈旧 mktemp 残留先清）。**边界披露**：同 slug 工作区并发 copy 理论上可互删包（重试自愈，接受）；busy 提示在运行中也短暂可见（模态遮挡，措辞两态皆真）。

**Pass 54 增补十九——大 bug：staging 认错会话 + 传输归属重构（面板持有，取消=可捕获按钮）（2026-11-25，用户报"当前 session Stage› 未识别到正确会话，两三轮前是对的"+提议"不响应 esc、只留取消按钮，总之要可捕获的事件"）**：①**staging 根因**：startMove 的 cwd 取 `hc ls` 的 terminal 记录=**spawn 时文件夹**（shellTargets 注释自己早写过这个坑，staging 处漏改）；终端 spawn 后 `cd` 再起 claude 时，会话落在 cd 后目录的 slug 下，发现却去 spawn 目录找→抓到别的会话。"两三轮前正确"=当时终端恰好 spawn 在项目里。修复=cwd 优先取 `panes()` 的**live folder**（PaneInfo.terminal===focus.address 匹配，d.ts 证实 live），hc ls 降为回退、space.folder 兜底。②**传输归属重构（用户裁决方向）**：mod 永远收不到 Esc（app Overlay 绑定先关）→「不响应 Esc」唯一实现=busy 期间**没有弹窗可关**。Copy 对话框退化为纯确认：点 Copy=setShared(busy)+prompt+provider+自关；**面板实例**（dock 视图 Esc 杀不死）的 300ms watcher 认领运行（owner 判定=无 mode/role props，防 dialog/toggle 实例竞跑）。③**取消=卡片上的 Cancel 芯片**（on_click 完全可捕获）：协作式检查（步骤间+传输 progress 回调内抛出）→catch 存活→**双端包制品即时清扫**+诚实 note+卡片复位；运行行=accent 状态+Cancel 芯片，**busy 时 tips 块让位**（卡片贴底，+20px 会把运行行挤出面板外——实测被裁）。④**守卫**：busy 期间 stage/✕/re-pick/arm/provider 点击全部惰化（一句诚实提示或 no-op）；**app 重启杀死的运行**：init 把滞留 busy 转成"interrupted by a restart"提示而非静默自动重跑。⑤**E2E 四链全绿**（15MB/1501 文件 delta 拉窗）：交接→面板全程→moved modal 由面板发起 ✓；传输中按 Esc→运行存活到完整收尾 ✓；Cancel 芯片→下一检查点中止→双端包立即消失→note 落卡 ✓；重启滞留 busy→转换提示 ✓。rig 36 组全绿。**边界披露**：多面板同 layout 双 owner 理论上竞跑（单面板假设与全 mod 一致）；cancel 点击与检查点之间的在途 exec 须等其完成（≤单条超时）；moved modal 的 Esc=Keep 语义不变。

**Pass 54 增补二十——运行行入 tips 槽 + 运行期全控件锁定（2026-11-25，用户裁决："进度信息位于 tips 的位置 replace，原动作已执行完毕 tips 无必要"；"copy 过程中 to 前叉叉/勾选框/Stage›/Providers 均不可点或无实质动作，含卡题 ✕"）**：①运行行（accent 状态+Cancel 芯片）移入 when(armed) 的引导槽——hairline 后 busy?运行行:金 tips 二选一，卡尾不再追加（贴底卡片追加会被裁的教训直接消化进结构）；取消后 tips 自动回归（用户语义："直到其他动作触发新 tips"），成功则整卡消失。②**视觉锁定**（功能守卫上轮已有，本轮补可供性）：卡题 ✕、re-pick ✕、arm 行、Stage › 行、provider 行——busy 时 hover/cursor 移除、文字 dim（provider 行 foreground→dim），点击仍走守卫的诚实提示句。③E2E：运行行落位 793-804（divider 761 之下，卡内不溢出）；新芯片位 (1250,798) 取消→双端包 0、marker 未动、note 落卡、tips 复现 335 金像素。rig 36 组全绿（纯渲染无涉）。

**Pass 54 增补二十一——三连修：阶段命名/进程级单飞/AppleDouble（2026-11-25，用户三报："进度提示似乎仍是一个个文件的 copy？没有 tar？"；"似乎启动了两个 agent？"；"目标文件夹出现 `._` 开头文件，如 test.md 旁多一个 ._test.md"）**：①**阶段命名**：此前两路传输共用一套状态词，tar 路径的块计数读起来仍像逐文件——runCopy 以 planWantsPack 定型，packed 路 `packing the workspace…` → `sending the pack N/M`（块计数），per-file 路 `copying file N/M`。沙箱真 app 帧捕获 OCR 实证：1500 文件 28KB delta 走 tar 路，帧 f5 读出 "sending the pack 16/16 Cancel"（16 块）。②**单飞守卫升进程级**：实例级 this.xfer 在 layout 把面板 dock 两次时放行两个 owner 并行 runCopy——用户"两个 agent"的最可能解释（两次 resume 各起一个 tab）；改模块级 `let XFER`（同进程全实例共享一处认领，runCopy 起手认领 finally 释放）。沙箱单面板 layout 不可复现双 dock，逻辑级修复，待用户查其 layout 是否双 dock 确认病根。③**AppleDouble**：mac 源 bsdtar 打包把 xattr 存成 `._*` tar 成员，Linux 端 GNU tar 落成真文件且 manifest 不知情（污染下次 drift 计数）。双修=packFrom 命令前缀 `COPYFILE_DISABLE=1`（GNU 忽略、bsdtar 抑制生成）+ untar 后 sweepAppleDouble（find `._*`，**basename 前缀配对**：`d/._f0` 配 `d/f0`——首版 rel.startsWith 判错位被 rig 逼出；仅在配对在 manifest 且自身不在时删除，真名 `._` 开头的源文件保留）。rig 37 组（新增 droppings 删/真 `._` 留）；沙箱真 app 复验：`._f0000.txt`（有配对）删、`._orphan`（无配对）留、包残留 0、marker 重写。④**种子教训**：沙箱首植 `._f0` 而 fixture 工作区根本没有 `f0`（实名 f0000.txt）——sweep 正确地把它当真名文件保留，"清扫没跑"是种子错误不是代码错误；**配对类断言先核 manifest 再下结论**。⑤**沙箱伪影披露**：手工重启后 app 落在无 active space 态，runCopy 尾部 `run("tab.new")` 被 app 记 WARN `no space yet` 且**错误不抛给 mod**（返回式）→ moved modal 照开、resume tab 未开。真机不可达（面板居于 space 内必有 active space）；暴露的形态=mod 侧 run() 结果未检查，如需彻底须 herdr 侧提供错误回传（upstream 事项，不阻塞本轮）。

**Pass 54 增补二十二——arm 动词随 gate 走（2026-11-25，用户提议："update 场景下勾选句改 Update the session and workspace above 是否更确切、动作指向更明确"）**：裁决=采纳，且不止勾选句——同屏会自相矛盾的面一起随 gate.kind 换词，共四处：勾选句（Copy/Update the session and workspace above）、金色提示句（to copy/update and resume）、弹窗标题（Copy/Update session）、弹窗确认钮（Copy/Update）；机制动词保留 copy（状态行 copying file N/M、drift 句 copying overwrites、moved 弹窗 session copied——机制/结果描述，非动作指向）。验证：沙箱双种子（resume: hm-…/sbx-dst2 marker；fresh: id null/sbx-fresh3 空目录）各重启截图——resume 卡 OCR "Update the session and workspace above"+"to update and resume"+标题 Update session；fresh 卡 OCR "Copy the session and workspace above"+"to copy and resume"+标题 Copy session；按钮以**实心块宽度量测定案**：150px vs 135px（2 字符差=Update vs Copy，右缘同界 x≤900）。**工具教训**：按钮区裁剪 y 取 520-575 实际落在按钮行（477-506）之下——两张空裁剪字节相同（md5 同）一度误读为"两弹窗同词"；OCR 空回就应起疑，**裁剪坐标先量测后结论**。rig 无涉（纯文案渲染）。RECIPE 三处同步（勾选句描述/流程句/dialog 模式条目）。

**Pass 54 增补二十三——卡题动词随 gate + moveRow 升格为功能区入口（2026-11-25，用户两问："标题 Copy Claude session 是否也要变动？"；"copy session Stage› 文案不变但默认态太没存在感——字号颜色对齐顶端 Providers、全大写、STAGE› 绿底与 from 单选同绿"）**：①卡题成第五处随 gate 换词的面（Update/Copy Claude session，选拾前无 gate 用 Copy）——至此动作指向五面（卡题/勾选句/提示句/弹窗题/确认钮）全随 gate，机制动词（copying file/session copied）保留 copy。②moveRow 升格：10.5 dim 元行 → 12.5 前景 CAPS `COPY SESSION`（与 Providers 同款写法：显式 text_size、无显式 color 继承 foreground）+ `STAGE ›` 实心 #15803d（from 单选同字面量）白字 11px、h18/px7/rounded6 与 Refresh 芯片同几何、去边框。**大小写规则破例**：增补八"被动标签小写"让位于入口显著性（用户裁决，特此记录规则例外）。白字用字面量 #ffffff 而非 t.surface——固定绿配固定白，暗色主题下 t.surface 为深色会失对比。③验证：默认态绿芯片像素命中 740px@#15803d+芯内白字 54px+OCR "COPY SESSION"+整行目验；resume 卡题 OCR "Update Claude session ✕"。rig 无涉（纯渲染）。RECIPE 两处同步（moveRow 描述、卡题括注）。

**Pass 54 增补二十四——卡题 ✕ 改红色 Clear 按钮（2026-11-25，用户三轮裁决：问"✕ 改 Cancel 是否更明确"→我陈词词级冲突（卡内两个 Cancel 均为"停手保暂存"，标题控件是唯一毁暂存者）→用户先裁"红色的 Cancel 按钮"再改词"Clear？"）**：①**终形=红框 Clear 芯片**（border+text t.blocked，h18/px7/rounded6 与 Refresh/run-Cancel 同几何，取代 16px 灰 ✕ 字形）——Clear 独占"清掉整张暂存卡"语义，Cancel 不变量保住（run 行 Cancel/dialog Cancel 停手保暂存），红色仍作破坏性预告（与 to 行红框 ✕ 同族）。②**busy 期整钮隐藏**（when(!m.busy)）：传输运行时运行行的 Cancel 是唯一活的，避免同卡双 Cancel 的瞬时歧义（此为"红色 Cancel"方案遗留问题，改词+隐藏双解）。clearMove 行为不变（含 busy 守卫）。③验证：armed 卡红像素 158@标题行（border+text blocked）、目验红框 Clear 芯片；点击→卡消仅剩 COPY SESSION 行。rig 无涉（纯渲染）。RECIPE 卡题句同步（含 Cancel/Clear 语义分野说明）。

**Pass 54 增补二十五——current provider 同机启动跳过 live 检查（2026-11-25，用户报"mac 上 codex provider 无法启动：keeps model_catalog_json，切 current 无效，以前可以"，经三轮讨论定案）**：①**根因链**：mac 的 live config.toml 常驻 `model_catalog_json="/Users/…/.codex/cc-switch-model-catalog.json"`（cc-switch 机器级目录指针——内容随切换维护、指针不清）；所点 provider 不自带该键→门拒。**切 current 后仍拒是 false positive**：current 时 live 文件即此 provider 自身状态（cc-switch 每次切换重写），cc-switch 自己的启动终端在此情形走 plain 支（裸跑，codex_terminal.rs:78-88）——我们的门缺这一支，把 provider 自己的指针当外来残留。"以前可以"=指针出现前文件无此键。②**参考实现研读**（用户指向 ~/dev/ws-ai/cc-switch 源码）：非 current 支=全套 -c 重建+**目录合成**（settings 规划→单模型目录→临时文件→`-c model_catalog_json=<tmp>` 覆盖；注释明言"否则 Codex 只认上一家的模型"；官方 GPT 条目须逐字镜像，否则通用模板顶掉其 system preamble——load-bearing）——**裁定不移植**：模板/官方镜像/厂商目录随 codex 版本调优，JS 侧 vendor 等于养一个分叉，错则静默劣化 agent 行为。委托路径亦不通：deeplink 仅导入、terminal launch 是 Tauri 内部命令，且**委托本就覆盖不了远程机**（用户确认：cc-switch 每机各自为政；跨机"读 A 库在 B 跑"的 argv 合成天然是 mod 的活）。③**实现**：launchArgv 下传 src→codexHarness.launch 计算 `plain = (machine??"")===(src??"") && !!card.current`→codexArgv/codexOverrides 增 plain 参：profile 检查、route uncovered、中和循环三处 `!plain` 全站开；拒绝句改 "from the machine's current provider — switch to this provider"（点名机器+对外用词 provider）。**边界两条**：跨机永远走检查（current 说的是源库标记，管不到目标机文件）；cc-switch proxy 模式下 is_current 语义为 in-use，plain 放行的最坏情形=live 路由表指向本地代理（proxy 模式本义），记为已知边界。④rig +3 组（40 绿）：非 current 照拒 / current+plain 通过（model 覆盖在场）/ plain 默认 false（守卫只能由 launch 显式给入）。**用户真机待验**：mac 切 current 后原 provider 随点随用。RECIPE Watch out 增一条。**行文规范**：应用户要求，此后行文与文案一律 provider/供应商，不再用"卡"。

**Pass 54 增补二十六——codex 目录合成落地（2026-11-25，架构设计 docs/arch-codex-catalog-synthesis.md v4 经 bc 双环收敛+research 档案后，pd 执行 CS1-CS6）**：①**背景**：指针机上非 current codex provider 启动被中和门拒（无安全中性值）；上游研究证实 codex 对 model_catalog_json 是启动期单次无锁无回退读取（缺失=硬错误，0.148.0-alpha.9 实证 abort）、目录条目承载 base_instructions 等会话身份、schema 与版本耦合无契约（#38934）。②**裁决链**：两轮对抗评审（2 blocker+8 warning → 0 blocker+3 warning → 全修复）揪出初稿真错误——"逐字镜像"漏了参考实现的 9 项强制改写（use_responses_lite=false 最致命：官方账号协议标记漏给第三方网关；priority、条件性 window/max 配对改写防钳制）；探针行须规范化回填（codex 0.148.0 拒缺 supports_parallel_tool_calls 的目录）；投递须 spawn 前预植（包装内写盘做不到启动期拒绝）。③**实现**（rig 52 组全绿，RED→GREEN）：catalogEntry 纯函数（官方命中=规范化条目+改写清单，未命中=中性模板配对窗口 degraded）/ normalizeBundled（回填+弃无效行，可回填=命中）/ bundledModels（缓存键=机器+解析形态，rc 模式下 bash -lic 环境对齐——herdr exec 继承 app 进程环境的源码事实；仅成功解析入缓存，失败不缓存）/ stageCatalog（mktemp 唯一部分文件+原子 mv，body 走 argv 因 exec 无 stdin；目标被目录占用显式拒绝）/ launch 门改接（跨机行内指针拒绝、responses 门+钉死 model 守卫、预植穿线三 argv 形态，指针以 JSON 双引号字面量入 -c——含撇号路径不再破 TOML）。twin 字节同步同 commit。**工程教训**：shellQuote 的 POSIX 转义（`'\''`）会让天真正则取不到 argv 内的指针值——取段+剥引号反斜杠；裸数字 TOML literal tomlString 返回 null（只认带引号形式），数值键须自矫直；POSIX `mv part dest` 在 dest 是目录时**移入并报成功**（`mv -T` 不可移植）——占用检测须显式 `[ -d ]`，写 W6 测试时抓到，评审的 W2 假设（mv 会失败）不成立。④**外环轮**（Tier 2 code-review，1 blocker+6 warning+6 note，B1/W1/W2/W3/W4/W5/N1/N2 已修）：缓存键忽略解析形态（plain 与 rc 解到不同二进制会互答）；共享 .part 名重开撕裂窗口+可预测路径可被预置符号链接劫持→mktemp；失败路径不清部分文件；负缓存把一次探针失败钉死整个会话→只缓存成功；model-less 行会写出 null-slug 条目→门加钉死 model 守卫；同名 slugify 撞车→dest 混入 model；手工单引号字面量破含撇号路径→JSON.stringify。**披露未修**：degraded 启动在 UI 无任何标记（W3 残余——mod 无日志通道，RECIPE 明说）；auto_compact 拒绝句在窗口来自条目时读起来文不对题（N5，触发面极窄）；探针无自有超时，仅受 herdr exec 上限约束（N6）；两轮评审均同源（solidforge ADR #38——异源评审基建未武装，如需可补一轮）。⑤**残留**：中性模板对未来 codex 的 schema 漂移（失败可见可恢复，REVIEW 跟踪 cc-switch 模板演进）；探针 PATH 陷阱（桌面启动器窄 PATH → degraded 常态化，spike 待真机量化）；上游 (b) 每 provider 目录文件提请仍待写。RECIPE Watch out：provider-menu 侧改写过时 bullet（原"照拒"表述已被合成推翻）、agent-menu 侧增一条。**用户真机待验**：mac 非 current provider 在指针机上随点随用（官方名与私有名各一）。

**Pass 54 增补二十七——目录合成的异源评审轮（2026-11-25，deepseek-flash 经 hetero_review.py 单轮，verdict=rewrite：2 blocker+7 warning，全数落地）**：①**两个 blocker 均实证为真**：normalizeBundled 从中性模板回填官方行——supports_parallel_tool_calls 应取经典模板的 true（本机 0.172.0 的 14 条 bundled 行全部缺该字段，false 回填等于给所有官方行静默关掉并行工具调用），base_instructions 应照抄行自带 model_messages.instructions_template（绝不为官方行捏造中性前言——那正是本设计要避免的人格替换）；agent-menu 调用点从未传 src——远程空间一律被当跨机，同机行内指针误拒、plain 支不可达。②**修复**（providers.js×2 字节同步+两侧 main.js）：经典值回填+自模板指令+无指令行弃置（对参考的故意偏离——cc-switch 整份作废 vs 我们单模型查找弃行，代码注明）；officialHit 照抄 codex 自身查找规则（最长前缀+一层命名空间，别名不冒用官方 display_name——`gpt-5.5-high` 不再无谓降级）；stageCatalog 重写（TMPDIR 按机记忆化、失败句携带 stderr、exec 传输错误也走诚实句、占用 dest 回退不可预测同胞名——sticky $TMPDIR 下的目录抢占从永久 DoS 变为可用性保持，POSIX mv 会移入目录并报成功是写测试时抓到的）；degraded 经 launchArgv 可选出参穿到 provider-menu 面板 note（AC3 的"launch 记录"落地；agent-menu 弹窗即关无此面，RECIPE 不再主张）；agent-menu 传 src。③**rig 入库 scripts/rig**（异源 W6：AC 从 diff 可执行）：自同步——每次运行从 mods 拷活源码并断言 twin 字节一致（AC7 进 rig），herdr shim 供应商化免安装，54 组全绿。④**残留披露**：staging 先于 profile/auto-compact 拒绝发生时，已植文件留在 $TMPDIR（确定性名、无凭证、下次启动覆写，判良性）；探针无自有超时（N6 沿袭）；normalizeBundled 弃行 vs 参考整份作废为已注明偏离。**用户真机待验**不变。

**Pass 54 增补二十八——目录合成的 Pi 跨 harness 评审轮（2026-11-25，pi 1.6.1 无头模式两遍——第一遍输出被编排侧 tail 截断丢失 finding 1，同题重跑全量落盘补齐；它在中途读到未提交的修订树并如实标注，其"红树"观察与真实进度吻合）**：①**1 blocker（真，已修）**：officialHit 的 `slug.length > best.slug` 数字比字符串恒假——最长前缀退化为首个命中，嵌套目录（gpt-5 ⊂ gpt-5-codex）会把 gpt-5-codex 的启动钉到 gpt-5 的人格前言上且 degraded=false（AC2 违背）；本机 0.172.0 的 14 行恰好无嵌套对所以未现形，单行夹具也测不出。修为 `.length` 对比 + 嵌套夹具（catalogEntry 级 + stub 探针 e2e 级）。②**3 warning（全落）**：行内目录指针从未穿线——同机行内指针"通过"实为静默丢弃（codex 跑 bundled）、live 也有指针时照拒，与 failure-modes 的"同机行内指针照旧通过"矛盾；修为 model_catalog_json 入 CODEX_EXCLUSIVE_TOP 行键复制（同机真携带自身 -c 值，跨机拒绝句从此名副其实）。degraded 成功启动被渲染成 "Launch failed: …"；修为独立 notice 通道 + 原因串（"model"=探针在而模型未命中 / "probe"=探针没跑成，面板句子分别点名）。单 argv 字在 MAX_ARG_STRLEN（131,072B，实测）悬崖边——真实 gpt-6.2-sol 条目已 90KB；修为字节有界分块（Buffer.byteLength 累计，码点不拆分）——第一版按字符数分块被 Pi 当场抓出对 CJK 字节不安全（96k 字符≈288k 字节），是本条的第二轮修复。③**5 note（处置）**：dest 的 model 段不再 toLowerCase（GPT-5.5/gpt-5.5 同址异容）；AC4 的字面 `.part` 措辞被 mktemp 形态取代（同一 write-temp+rename 契约的强化形，空断言改为真实同胞残留检查）；rig 的 codex 依赖改 bin/codex stub（hermetic，且让嵌套对成为确定性夹具）；agent-menu 的 src 改捕获 expand() 读取时机（菜单开着切空间不再错配 X 的 current 与 Y 的 live）；notice 生命周期=下次启动前保留。④**rig 57 组全绿**（stub 化 + 嵌套 + CJK 字节 + 五改写镜像 + 窗口下限）。⑤**披露**：中性条目的 input_modalities 沿袭模板的 ["text","image"]（参考的 text-only 注册表查询未移植，维护成本裁决）；sticky-EPERM 的 mv 失败回退分支无第二用户可本地复现（仅代码审查）；无真实第三方网关回合（Pi 用 codex debug 验证了四种合成条目均可解析、悬空指针硬失败、-c 覆盖有效——设计前提成立）。
