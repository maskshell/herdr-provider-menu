# 评审记录

设计规格在 DESIGN.md;本文件记录收敛过程与开放项状态。

## Pass 1 — 设计内部一致性(2026-11-19)

对照会话决策逐项核对(分工/读路径/启动路径/UI/安全/同步/License/ADR)。发现并已修复:

1. §11 证据行号:`hc.rs:466` → **467**(env json! 实际行)。
2. §3 查询时机表述混淆 P0/P1 → 明确 "P0:面板 init + ↻;P1:子菜单展开时"。
3. §5.2 未说明 `providers.js` 随 agent-menu 源一起覆盖 → 已补(两处共用一份)。

确认一致的关键决策锚点:合并方向(common 覆盖 provider,opt-in)、UNSET 14变量与 providers.js 逐字一致、sqlite3 方案 2、不继承 skip-permissions、行内展开不做 flyout、P0 先行后克隆。

## Pass 2 — 代码 × herdr 文档 API

逐条对照 defaults/AGENTS.md(mod 规则)与 defaults/herdr.d.ts:

- ✅ cx 纪律:`on_click((_e, cx) => this.refresh(cx))` 用回调自己的 cx;无 setTimeout/top-level await;模块顶层无副作用。
- ✅ `checking()` 守住 init 里的 exec;根元素 id;`shared() ?? []`; `when/children/hover` 等均为文档化原语。
- ✅ shell 包装推演:argv `["env","-u",…,"claude",…]` 经`zsh -ic '"$@"; exec "$0" -i'`(window.rs:115)后,`"$@"` 原样逐词传给 `env`,claude 退出后交互 shell 留守——与 tab.new 语义吻合。
- ✅ `JSON.stringify` 无字面换行,argv/ps 显示安全。
- ⚠ **假设 1**:二级模块(`providers.js`)`import … from "herdr"` 可用——文档只示例了 main.js。若 T0 报错,把 providers.js 内容内联进 main.js (机械操作,不影响设计)。
- ⚠ **假设 2**:exec 拒绝时的错误串形态(用于 hint 分支)。首次真跑后按实际报文调整正则(T0.1)。

## Pass 3 — 新鲜眼复查

- env 前缀在远程 Unix(login shell 包装)同样成立;Windows 被平台分支挡住。
- sqlite3 `-json` 零行输出空串已处理;`-readonly` 读 WAL 库列为 T1。
- P0 docked 面板会写用户的 shown layout(文档语义),README 已告诫隔离 home。

## Pass 4 — 运行时验证(2026-11-19,T0 + T6-lite)

环境:全新 Ubuntu 26.04;brew(rustup + `zig@0.16`,注意 brew `zig` 是 0.17 不能用)
+ USTC 镜像;herdr-app debug 构建成功(zig 0.16 fetch 会挂在死连接上,写`/tmp/herdr-build-loop.sh` 监控缓存/CPU 自动杀 zig 重试)。

- **T0 ✅** `check passed: mod/`。两个 Pass 2 假设同时落实:二级模块`import … from "herdr"` 合法;真实 exec 失败报文(`code!==0` + stderr/exit text)与 hint 正则吻合。
- **真 bug 修复**:sqlite3 非零退出(缺 DB)且 stdout 空时,`|| "[]"`会把"读失败"吞成"无 provider"。`query()` 改为 `code!==0 → throw` (前缀 `cc-switch.db:` 命中 hint 分支)。check 复跑通过。
- **T6-lite ✅(sandbox 全链路)**,证据在 `evidence/`:
  1. sandbox 无 core:把官方 `install.sh` 以 `HOME=$root/fakehome` 装herdr-core 0.1.21 → app 在 `$HOME/.local/bin` 找到(core_bin.rs:155)。
  2. **关键发现:shipped 布局拒绝停靠 mod**(window.rs:4492 `shipped && place!="none"` → skip)。`do layout.clone {"name":"main"}` 后 provider-menu 自动 dock 到 main-copy 根 children[2](280px)。 → **P0 用户必须先有个人布局**,README/DESIGN §5 已补。
  3. 面板渲染正确:标题/cc-switch/↻ + Work(current)+ DeepSeek,无错误行。
  4. 点击 Work → `tab.new` → core 终端:rc 文件先于 argv 生效(fakehome `.bashrc` 的 PATH 让 stub `claude` 可见)→ stub 收到恰好 `--settings {"env":{"ANTHROPIC_BASE_URL":"https://example.work", "ANTHROPIC_AUTH_TOKEN":"sk-test-123"}}`(launch-dump.txt)。
  5. **UNSET 实证**:带 `ANTHROPIC_API_KEY=leak-test-key` + `CLAUDE_CODE_OAUTH_TOKEN=leak-test-oauth` 重启 app 再点击,claude 环境中两者皆无——`env -u` 前缀生效。
- sandbox 操作备忘:欢迎浮层会吃掉点击(`do overlay.close '{}'` 先关);新 home 无 space 时 tab.new 报 "no space yet"(先 `space.new`); `scripts/sandbox` 的 input 依赖 uv,本机无 → `apt-get python3-xlib` 后直接 `python3 scripts/sandbox-input.py`。

## Pass 5 — T8 泄漏阻断 E2E(2026-11-19,sandbox)

金丝雀:`~/.claude/settings.json` 为 GLM 形态(env 含 AUTH_TOKEN/BASE_URL/ ANTHROPIC_MODEL/OPUS/HAIKU/API_TIMEOUT_MS;顶层 model/theme/attribution{}/ cleanupPeriodDays/alwaysThinkingEnabled)。点击 Work 与 DeepSeek 各一次, `hc get` 取完整 argv + stub claude dump 取进程 env,断言 26/26 全过:

- **env 挡键**:live-only 4 键(ANTHROPIC_MODEL、OPUS、HAIKU、API_TIMEOUT_MS)均写为 `""`;卡片自有键保留原值。dump 的 `ANTHROPIC_/CLAUDE_` env 段为空 → `env -u` ×14 照常生效。
- **顶层挡键**:字符串 `model`/`theme` → `""`,对象 `attribution` → `{}`;数字/布尔(cleanupPeriodDays/alwaysThinkingEnabled)不写,按上游配方继承。
- **modelPicker**:Work → 仅 sonnet 行`{label:"Sonnet · GLM 4.7", description:"Work · glm-4.7 · 1M"}` ([1m] 后缀剥离进 description 标记),replaceBuiltInOptions:true; DeepSeek → `{replaceBuiltInOptions:false, options:[]}`(live 的 GLM picker 整层被顶掉)。**总开关语义证实:picker 按层整体胜出,必须无条件写**。
- 证据:`evidence/t8-dump-{work,deepseek}.txt`、`t8-argv-{work-t2,deepseek-t3}.json`、`t8-panel-clean.png`、`t8-tabs-launched.png`。

sandbox 运维教训(本轮踩坑,复用 sandbox 时先看这里):

1. `scripts/sandbox` 只 export `XDG_STATE_HOME=$root/state` 不创建它:目录缺失时core 的 layout doc 全部落盘失败,app 症状为 `layout local: doc.set … (os error 2)`
   + "Layout changed elsewhere" toast 持续累积。**up 前先 mkdir $root/state**。
2. `down` 的 `hc server stop` 杀不掉 serve+holder 进程对,socket/`core.lock` 残留→ 下次 up 的 app 连回旧 core(内存态全在)或卡死在 "the window did not answer"。**down 后手动杀两个 core 进程 + 删 /run/user/1000/herdr-core/herdr-app-sandbox*.sock**。
3. 欢迎浮层是 `kind:"window"` 型 overlay,外部 `overlay.close`(带 id 也)关不掉;正解 = 停窗后向 home/shared.json 预写 `"frame.welcomed"`。
4. `hc ls` 的 `created_ms` 对部分新终端为 null:发现新终端用地址集合差,别排序。
5. toast 堆不拦截指针(点击可穿透);welcome 浮层才吞点击。

## Pass 6 — Tx 系列收口(2026-11-19,T1/T2/T9/T10 + T5 备妥)

### T1 WAL 并发读(`scripts/t1-wal-test.sh`,5 案例全过)

用 fifo 卡住 writer 的 BEGIN..COMMIT 构造活跃写事务,SIGKILL 构造孤儿 WAL:

1. 活跃写事务中 `-readonly -json` 读 → 快照隔离,返回已提交数据(34ms 内);
2. 干净 commit 后读 → 新数据立即可见;
3. writer 被 SIGKILL(孤儿 WAL)→ 读正常、数据一致;
4. 无 `-shm` 的 WAL 库 → 照常读(SQLite 自建);
5. plain journal 模式 → 照常读。

结论:mod 的 `sqlite3 -readonly -json` 读法对 cc-switch GUI 常驻场景安全,无需复制 DB。

### T2 settings env 优先级(真 claude 2.1.327,`scripts/t2-precedence-probe.sh` + `t2-server.py`)

本地 127.0.0.1 请求记录服务器 + 假 token,隔离 `CLAUDE_CONFIG_DIR`:

- **settings env 逐键覆盖进程 env**(A):live settings.json 里的AUTH_TOKEN/BASE_URL 赢过导出的进程同名变量 → `--settings` 的挡键语义可靠;
- **空字符串挡 live 值**(B):settings env 写 `""` 后请求头不再带 live token, claude 报 "Not logged in" 而非回退 live —— T8 结论在 2.1.327 复验成立;
- **跨键不互通**(C/D):进程 ANTHROPIC_API_KEY 在 settings 设 AUTH_TOKEN 时被忽略(只发 Bearer,不发 x-api-key);进程 ANTHROPIC_MODEL 未出现在请求 model 字段。

结论:**UNSET 清单从"正确性必需"降级为纵深防御** ——它仍必要(挡CLAUDE_CODE_USE_BEDROCK 等 settings 覆盖不到的键、防未来版本变化),但泄漏阻断的第一道墙是 settings env 挡键。

### T9 无头 seed(`scripts/seed-cc-switch-db.py`,无头半已过)

按 schema.rs 当前 DDL 建齐**全部**表 + `PRAGMA user_version=27` + 4 行proxy_config 种子,providers 以 `seed-N` 为主键插入。关键发现:GUI 迁移链的`add_column_if_missing` 对缺表直接报错(schema.rs:4064-4068),所以"只建providers+settings、version=0"的最小 seed 会在 v0→v1 崩——必须全量。脚本自带校验:integrity_check=ok、user_version=27、mod 的原样 SELECT。**剩余:GUI 打开零迁移的肉眼复验(需要一台装了 cc-switch GUI 的机)。**

### T10 非 env 形态 provider(sandbox 验证通过)

DB 加 RouterX 行(`{"endpoint":…,"apiKey":…}` 非 env 形态):

- `providers.js`:`launchableCard()` 判 env 形(含非空 AUTH_TOKEN 或 API_KEY),行数据多带 `launchable`;
- `main.js`:非 launchable 行灰显 + `cc-switch` 右标签,点击不启动、面板底部显示 `Launch failed: <name> is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.`(截图逐字核对)。

sandbox 实证:三行渲染正确;点 RouterX → **零新终端** + note 渲染;回归点击Work/DeepSeek → 各自新终端,argv 14×`-u` + `--settings` 挡键全在(`t10-argv-*.json`)。老缓存行(无 launchable 字段)走 `=== false` 判断,保持可点击,不误伤。

### T5 远程 E2E(脚本备妥,待真远端机)

`t5-remote-prepare.sh`(远端:seed RWork/RDeep + GLM 形 canary + stub claude)
+ `t5-remote-e2e.md`(本端:hc machine add → 隔离 home 的窗口 → 远程 space → ↻ 出远端行 → 点 RWork → 断言 dump/canary/本地库未动)。

## Pass 7 — P1 三层克隆子菜单(2026-11-19,sandbox E2E)

三层安装(sandbox 实操):`mod.clone new-menu → agent-menu` 后用仓库源覆盖(`agent-menu/{main.js,providers.js,mod.json}`);`mod.clone tabs → my-tabs`后打两处补丁(头注释 + `openOverlay({mod:"agent-menu",…})`);个人布局my-main 的 tabs 块 `content.mod: tabs → my-tabs`(脚本断言 hits==["tabs"])。

E2E 中发现并修复的三个问题:

1. **mod 无热重载**:mod.clone 后覆盖 `mods/<name>/main.js` 不生效,须`restart` 才加载新代码(首开弹层行为 stale 即此因)。
2. **subRow 灰显守卫 bug**:`on_click` 里 `if (!dim) action(cx)` 把RouterX 的提示 action 整个吞掉(与注释"dim rows explain themselves" 矛盾)——去掉守卫,hover 灰显逻辑不变;键盘路径本就正确。
3. **launchNote 被裁剪**:弹层高度公式没算 note(两行折行 ≈44px),note落在滚动区可视范围之外——`extra` 在 launchNote 时 +44。

### T4 结论(定论)

子菜单展开时按 Esc:**整个弹层一起关**(子菜单 + popup),`on_key_down` 里`cx.stop_propagation()` 挡不住 app 级 Esc 键绑定(`escape` → `overlay.close`,src/keys.rs:271)。"退一层"无法从 mod JS 实现。接受的fallback:一次 Esc 全关,重开时 init() 复位 `sub=null`;数字键按层作用域不受影响(顶层 1-9 直装启动;子菜单内 1=Default、2..=providers)。

### 验证矩阵(evidence/p1-*)

| 动作 | 结果 |
|---|---|
| my-tabs `+` | agent-menu 弹层:Terminal / Claude `1 ▸` / 2 行 not installed / New space / worktrees |
| 点 Claude 行 | 内联子菜单:Default (live) `1`、Work `current` `2`、DeepSeek `3`、RouterX `cc-switch` `4`(灰显) |
| 点 Work | 新终端:argv = `bash -ic` + `env -u`×14 + `claude --settings`(480 字 Work JSON)+ stub dump(`p1-argv-work-menu.json`、`p1-dump-work-menu.txt`) |
| 顶层 `1` | 默认 claude 启动(t3:`bash -ic … claude`) |
| 子菜单 `2` | Work 启动(t4,`p1-argv-work-digit.json`,14×`-u`) |
| RouterX 点击 / 键盘 `4` | 零新终端 + launchNote 两行渲染(`p1-routerx-note*.png`) |
| Esc(T4) | 全关(见上) |

运维注:restart 后窗口几何会变(本次 1280×820 X-px,截图 1100×705 = ×0.8594;input 坐标 = 窗口逻辑 px = 截图 ÷0.8594,每次 restart 后须重新标定);无 space 时 `tab.new` 报 app toast "no space yet: make one first (space.new)"(shipped 行为,shipped new-menu 同样如此,先 `space.new`); knownAgents 经 `bash -ic 'command -v …'` 探测,stub claude 即可被识别。

### 真机 seed 修正(2026-11-19,用户纠偏)

本机(无 GUI,跑 core)真库首 seed 曾把 `CLAUDE_CODE_*` 调优键留在live settings.json、不进 provider profile——**错误**:`MAX_OUTPUT_TOKENS` `EFFORT_LEVEL` `SUBAGENT_MODEL` 等在第三方兼容 API 下是 per-provider调优(cc-switch 即按每 provider profile 独立配置);且 mod 的合并语义是"live-only env 键一律挡空"(providers.js launchSettings),这种 seed 会让provider 启动静默丢掉这些调优。已重 seed:GLM profile = live env 全量18 键 + model。mod 代码无须改动(逐键合并本就与 per-profile 模型一致)。已知边界:mod 只读 providers 表,cc-switch 的 common config 不参与provider 启动(profile 是唯一真身)。

### 上游二次核实(2026-11-19,本地 clone @ 6da70837)

四条事实入档(战略 02 号文档同源,细节以本地源码为准):① master `SCHEMA_VERSION` 仍 =27(`database/mod.rs:54`)——T9 seed 无漂移;② v4 直连/路由/聚合三模式下「以此供应商打开终端」全部物化 DB 真实上游直连(`terminal_launch.rs:167/217/596-597/1089`,live 的 `PROXY_MANAGED` 被 drops 写 `""` 挡住)——ADR-10 与上游同构,已封板;③ T10 判据硬化:Accounts(Beta) OAuth 卡被上游限定非官方客户端必须走路由,结构性无 env 形态——拒启与灰显正确且必然;④ AppType 枚举已 14+ CLI(含 OpenClaw/Pi/Kimi)——cc-switch 是整个 harness 动物园的身份库,codex 配方是「第 N 个实例」而非第二个(P2 定位参考)。

## 开放项

| # | 项 | 状态 |
|---|---|---|
| T0 | `herdr-app check mod/` | ✅ 通过(含 bug 修复后复跑) |
| T0.1 | 真实 exec 报文 × hint 正则;二级模块 herdr import | ✅ 随 T0/T6 落实 |
| T1 | WAL 活跃库 `-readonly -json` 读取正确性 | ✅ Pass 6:5 案例全过,读法安全 |
| T2 | 进程 env vs settings env 块优先级 | ✅ Pass 6:settings 逐键赢;UNSET 降为纵深防御(仍保留) |
| T3 | Windows pwsh 内联 JSON(P2) | ⛔ |
| T4 | 子菜单 Esc 拦截(P1) | ✅ Pass 7 定论:拦截不可行(stop_propagation 挡不住 app 键绑定)→ fallback = 一次 Esc 全关,数字键按层作用域已验证 |
| T5 | 远程 space:on 读+启动 | 🔶 Pass 6:prepare/e2e 脚本备妥;真机载体已就绪——本机(headless,跑 core)DB 已 seed GLM 全量 env,GUI 机三层装通即 T5 首跑 |
| T6 | sandbox 全链路 UI | ✅ T6-lite(渲染+点击+启动+env 清洗);真 claude 未测 |
| T8 | `--settings` × live 逐键合并泄漏 | ✅ sandbox E2E 26/26(Pass 5)+ 真 claude 2.1.327 复验(Pass 6/T2-B) |
| T9 | 无头 seed 的 DB 被 GUI 零迁移打开 | 🔶 无头半已过(全量 DDL + user_version=27 + 校验);master @ 6da70837 复核 SCHEMA_VERSION=27 无漂移;GUI 打开复验待用户机 |
| T10 | 非 env 形态 provider 拒启 + 提示 | ✅ Pass 6:sandbox 三行渲染、拒启零终端、note 逐字、回归启动无恙;判据硬化:OAuth 账号卡结构性非 env(上游源码背书),拒启/灰显必然 |
| P1 | 三层克隆子菜单(agent-menu/my-tabs/布局) | ✅ Pass 7:sandbox E2E 全通(弹层/子菜单/点击+数字键启动/RouterX 拒);真机安装排障中——GUI 机子菜单未现,`scripts/p1-install.sh` 自检修复已备 |
| — | 项目自身 LICENSE | ✅ 2026-11-19 MIT(转公开准备;README 英文化 + README.zh-CN + 示例布局同批) |

## 结论

P1 三层克隆(my-tabs → agent-menu 子菜单)sandbox E2E 全通:弹层、内联provider 子菜单、Work 点击与数字键启动(14×`-u` + `--settings` 全 argv)、RouterX 拒启 note;T4 定论为拦截不可行、fallback 已文档化。E2E 顺带修了三个实现 bug(mod 无热重载认知、灰显行点击守卫、note 高度裁剪)。Tx 系列: T1/T2/T10 ✅,T9 无头半 ✅(GUI 复验待用户),T5 脚本备妥。剩余:T3 (Windows,P2)、T5/T9 真机半场、真 claude 联网复验(用户机)。

## Pass 8 — 实机事件:顶层挡键 × 枚举校验(2026-11-19,macOS GUI 机)

现象:选 DeepSeek 卡启动,claude 弹 Settings Error——`autoUpdatesChannel: Invalid value. Expected one of: "latest","stable","rc"`,"files with errors are skipped **entirely**"。事故链:live settings 有 `autoUpdatesChannel` → 卡没有 → 旧逻辑按"live-only 顶层串键"写 `""` → 枚举校验拒绝 → 整个 `--settings` 被弃,终端静默回落 live 身份(对话框选项 3 即此路径,比报错更危险)。T8 的 26/26 未覆盖此键:sandbox fresh home 的 live 无此键。

修复:`launchSettings` 顶层挡键改白名单 `TOP_DROPS = ["model","theme","attribution"]`(全部 T8 实测空值安全);其余 live-only 顶层键继承。env 块挡键不变(空 env 值=未设,env 名无枚举校验)。`herdr-app check` mod/agent-menu 双过。

上游对照(实机抓取 cc-switch 隔离终端 launcher + temp json):上游 temp 文件**无** `autoUpdatesChannel`——其 drops 为窄集(本次仅 `model:""` + live-only env 键 `CLAUDE_CODE_AUTO_MODE_SERVER:""`),**上游无此 bug,此前"上游同 bug"判断撤销**;白名单修复恰与上游实际语义收敛。上游 launcher 另两个 posture 差异实锤:无 `env -u` 前缀(进程 env 不清)、默认带 `--dangerously-skip-permissions`——本 mod 两者都更严,维持(DESIGN §4.1 立场)。

## Pass 9 — UX 修订:子菜单去 Default 行(2026-11-19,实机反馈)

用户指摘:子菜单的 Default 行没有显式指向(不像 cc-switch 里每项都是命名卡)。裁决:去除。理由:①菜单语义是"选身份",live 槽是指针不是身份,改名显式化不可行(routing 模式 live=127.0.0.1:15721、官方 OAuth 无 base_url 可标);②与顶层数字键冗余(子菜单收起时按 Claude 行数字键即原样启动,键盘路径不变);③鼠标路径有 Terminal 行兜底。顺带补齐零卡 empty-state 行("No providers in cc-switch yet…",§4.5 不静默空白——此前 Default 行占位掩盖了该场景);子菜单数字键改 1..=providers(原 2..)。check 过。

## Pass 10 — extra-args 与 workspaceFolder(2026-11-19)

背景:用户实机必须项 = `workspaceFolder` 动态 env + `--allow-dangerously-skip-permissions`(其个人 `claude()` 函数约定);上游 PR #9015(rc 遵从,open 待审)与上游 dialog(每 session 自由输入)各有优劣——dialog 装不下动态 env,rc 遵从要拆 env -u 前缀(UNSET 承重)。本批设计各走正道:静态旗子 = per-machine 持久 extras(EXTRA key、面板 args 行 + 自绘 dialog 按 shipped prompt mod 的 InputState/Input 范式、splitArgs 引号分词);动态 env = launchSettings 设 `env.workspaceFolder = SpaceInfo.folder`(空则不设,远程机为其本机路径;Pass 12 撤除)。launchArgv 统一接线 `[...extra, ...mine]`,面板与子菜单同享。ADR"绝不默认"不变;dialog 架构留 `props.mode="launch"` 一态可补 per-launch。check:mod/agent-menu 双过;实机复验待 GUI 机(argv 尾部旗子 + settings env 内 workspaceFolder + hooks 读到)。

## Pass 11 — rc 遵从启动模式(2026-11-19,opt-in)

用户核心诉求:启动应读取其 shell profile,不摒弃 alias 与 function(其两种等价实形均以 `workspaceFolder="$(pwd)" CLAUDE_CODE_ATTRIBUTION_HEADER=0 command claude --allow-dangerously-skip-permissions` 为约定)。机制事实:herdr 词向量包装("$@")只解析函数,alias 仅在解析期展开——故完整支持只有命令串形式。实现:RC key(每机开关,面板 rc 行)+ `claudeArgv(settings, extra, {login})` 的 rc 分支(`env -u …×14 bash -[l]ic '<shellQuote>'`,shellQuote=单引号+'\'\''转义)+ `launchArgv` 探测 `.bash_profile` 存在则 `-lic`(PR #9015/#9013 智慧)。信任边界照实:rc 先于 claude 运行、可重新 export 被清变量;rc 双 source 通常无害。CLAUDE_CODE_ATTRIBUTION_HEADER 不在 UNSET×14。路线收束:上游 dialog = 每 session 自由输入;上游 PR #9015 = 同思路的未采纳版;本仓 = 持久 extras(默认)+ rc 遵从模式(opt-in)。check 双过;实机复验:rc 开启后 hc get 应见 `bash -ic 'claude --settings …'` 串,claude 进程 env 有 workspaceFolder/ATTRIBUTION_HEADER,且 extras 与函数旗子并存不冲突。

## Pass 12 — mac 实机复验全绿 + workspaceFolder 注入撤除(2026-11-19)

mac GUI 机复验 extras 与 rc 两条路径无误(args 行持久旗子、rc profile 模式经 bash -lic 命令串、alias/function 均生效)。同日决策:撤除 env.workspaceFolder 注入(Pass 10 同批引入)——workspaceFolder 是用户举例而非 mod 需求,动态 env 的通用机制是 rc 遵从模式;公开参考 mod 不携带未被要求的 env 注入,与"砍 Default 行/白名单挡键"同一原则(显式 > 环境暗示)。用户实跑 rc 模式,函数的 $(pwd) 原生生效,零损失。README 双语仅保留 rc bullet 中的例证提法;launchSettings 回落 (provider, liveText) 签名,providers.js 不再 import spaces。check 双过。

## Pass 13 — 文风统一:STE/STC(2026-11-19)

用户要求:README 面向公众,不用第二人称所有格("your/你的"),示例显式标注(e.g./例如),行文遵循 STE100/STC。处理:两份 README 全文重写——短句单义、主动语态、现在时、术语一致(the mod/本 mod、extra arguments/附加参数、per machine/每机、launch/启动);"your recorded choice"→"the user records the arguments; the mod adds no flags by itself";克隆基线尾句改为陈述式;警告句保留祈使但去第二人称。UI 字符串同步(args dialog 提示句)。DESIGN/REVIEW 为内部工程日志,保持既有文风不在此范围。

## Pass 14 — seed 脚本定位纠偏:验证工具而非建库方式(2026-11-19)

用户指正:README 曾把「无头机用 seed-cc-switch-db.py 造库」写成安装路径,错位——seed 只从 spec(取自当前 live settings)造出单 provider 测试库,无实用供给价值;正式路径是 cc-switch 官方 DB 同步(WebDAV 等)或 GUI 机配置。边界定案:**DB 的供给与同步由用户自行解决,不在本 mod(及 herdr)的业务范畴**。落地:README 双语三处改写(Install 分流"正式使用/仅供测试"、无头机段分两段、scripts 表行改"验证工具");DESIGN §2 无头机缺口段补边界声明,seed 降为验证工具、拷库标注会漂移不算正路、上游 CLI/headless ask 维持。上游三条 asks 不变。

## Pass 15 — Phase 2 codex 落地(2026-11-19)

上游事实先行(本机 clone @ 6da70837):终端按钮只注入 {claude, codex, agy, grokbuild, copilot} 五家(App.tsx:1643)——pi/dsh/opencode 等无此按钮,grok 仅当前卡可开且无隔离(OpenTerminalDialog.tsx:152/192);codex official 卡无按钮是结构性的(`codexHasOwnRoute` 首行排除 official;`-c` 换不动 OAuth 登录,codex_terminal.rs follows_login),非凭据缺失——用户实机观察到的现象由此定谳;claude official 恒有按钮(绑授权中心账号→CLAUDE_CONFIG_DIR 隔离,未绑→跟全局登录"不能说隔离")。配方镜像 codex_terminal.rs:`env CC_SWITCH_CODEX_API_KEY=… CODEX_HOME=… codex --no-daemon -c …`,路由表重写为 model_providers.custom + env_key(key 不上命令行,优于 claude 侧 argv 内联);requires_openai_auth 按 live auth.json 登录态;live 残留按上游 Neutral 表中和,中和不了拒启。代码组织按用户要求引入设计模式:HARNESS 注册表 + 每 harness 策略(classify/mergeCommon/launch),readProviders/launchArgv 退化为薄分派,UI 侧同构 SUBMENUS 注册表(拒启原因映射表)。验证:上游测试夹具作 oracle 的纯函数冒烟六场景对齐(http_headers 残留拒、keyless 拒、context_window 拒、subagent 跟随、profile 拒、KIMI over PROXY_MANAGED live 全对);check 双过。两处有意分歧(记入 DESIGN §4.6/README):model_catalog_json 残留上游生成单模型目录、mod 拒启;BuiltIn 路由上游可启、mod 拒。待验:mac 实机 codex 真卡 E2E、T5 远端、sandbox UI 半场、Windows T3。
