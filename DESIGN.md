# herdr-provider-menu — 设计

> **EN abstract**: a herdr mod that launches Claude Code under cc-switch-managed provider identities — one frozen identity per terminal, read statelessly from each machine's own cc-switch SQLite DB (`sqlite3 -readonly -json` over machine exec), launched as `env -u …×14 claude --settings <json>` with drop-blocking (live-only keys written `""`) and an always-written `modelPicker`. Phase 0 (panel) and Phase 1 (three-layer clone) are sandbox-verified. Reasoning, ADRs and evidence pointers below are in Chinese.

在 herdr 的 "start agent" 菜单里，为每个 harness CLI(先做 Claude Code)挂一个provider 子菜单：身份配置读自 cc-switch 的数据库，以 per-launch 方式在 herdr跟踪的终端里启动。**herdr-app 核心零改动。**

本文件是 2026-11 会话的完整收敛结论。证据索引见 §11，开放验证项见 REVIEW.md。

## 1. 目标与非目标

**目标**

- 在 herdr 里以任意 provider 身份启动 claude，终端是 herdr 跟踪的终端(OSC 7501 状态、agents 列表、通知照常);
- 不同终端不同身份并行，互不影响，不碰任何全局配置；
- 配置的管理、编辑、多机同步全部交由 cc-switch(用户已信任的托管);
- 远程机器上的 space 同样可用(读那台机器自己的 cc-switch 库)。

**非目标**

- 不做配置管理 UI、不做 profile 存储、不做任何同步(§7);
- 不改 herdr-app 核心(不提 PR;CONTRIBUTING.md 的态度明确：mod 能做的不收);
- 不复刻 cc-switch 的全局切换(live 槽位留给 IDE 等场景，本 mod 只做 per-launch);
- 不追求 Windows 首发(Phase 2)。

## 2. 总体架构与分工

```
┌─────────────────────────── herdr(本机窗口)───────────────────────────┐
│  my-tabs(克隆) ──打开──> agent-menu(克隆的 new-menu,含 provider 子菜单) │
│                                        │                               │
│                    exec("sqlite3", …, {on: machine}) ──读──> cc-switch.db │
│                                        │                               │
│                    run("tab.new", {argv: [env -u …, claude, --settings, …]})│
└────────────────────────────────────────│───────────────────────────────┘
                                         ▼
                          该 space 所在机器的被跟踪终端
```

三层各自的责任：

| 层 | 责任 |
|---|---|
| cc-switch(桌面版) | 配置唯一真身：provider 编辑、common config、WebDAV 多机同步、全局 live 槽位(服务 IDE/普通终端) |
| 本 mod(无状态) | 读(每机器自己的 DB)+ 合并 + 启动(per-launch argv) |
| herdr-app | 什么都不加；终端跟踪、失败 toast、agent 识别全是现成能力 |

**live 槽位语义(2026-11-19 核实)**:cc-switch 的"切换"就是把选中 provider写进 live 客户端文件(claude → `~/.claude/settings.json`;`services/provider/ live.rs:1-3` 只分发，写入引擎在 `claude_direct.rs`),DB 的 `is_current` 镜像它。所以**不走本 mod 的默认 claude 启动 = live 槽位的身份**——cc-switch 机器上就是`is_current` 那个 provider；本 mod 的行是"仅此终端"的覆盖，不动 live。独立目录(官方账号)与临时 `--settings` 启动模式不碰 live 文件。

**无头机缺口(2026-11-19 核实)**:cc-switch 是纯 Tauri GUI(`main.rs` 无 CLI子命令；`lightweight.rs` 是托盘模式，仍需图形会话)，无 CLI/无头模式。mod 只需DB **文件**、不需 cc-switch 运行，但无头机上"谁建库/谁改库"没有正主。**边界声明(2026-11-19):DB 的供给与同步归用户自行解决(cc-switch 官方 WebDAV 同步等)，不在本 mod 与 herdr 的业务范畴**;`seed-cc-switch-db.py` 仅为验证工具——按 `database/schema.rs` 的 DDL 从 spec 造单 provider 测试库(含 `id`/`created_at` 等全列；消费者只有 mod 的只读查询,读兼容即全部意义——GUI 打开兼容性 2026-11-20 撤验:seed 仅为验证工具,真库由 GUI/WebDAV 供给,无人会把 seed 库挂到 GUI 下)，不是正式建库方式；GUI 机改完拷库会漂移，同样不算正路。长期正解仍是给上游提 CLI/headless 需求(ccs 的存在即此缺口)。

**为什么核心零改动**(herdr-app AGENTS.md 三问，全否): app 不依它行动(只在启动瞬间机械传参)、不是只有 app 看得见(mod 用`exec`/`run` 即可)、mod 小心就能做对。属于 mods，即使代价是重复。

## 3. 读路径

- **DB**:`~/.cc-switch/cc-switch.db`(SQLite,WAL)。表：`providers(name, settings_config, meta, is_current, app_type, sort_index)`;common config 在 `settings` 表 `key='common_config_claude'` 的 JSON 里。
- **查询**(P0：面板 init + ↻;P1：子菜单展开时):
  ```sql
  SELECT name, settings_config, meta, is_current
  FROM providers WHERE app_type='claude'
  ORDER BY is_current DESC, sort_index ASC, name ASC;
  ```
  ```js
  exec("sqlite3", ["-readonly", "-json", db, sql], { on: machine })
  ```
 `machine` = 当前 space 的 `machine`(本机为 null)。`-json` 需 sqlite3 ≥ 3.33。 **零行时 `-json` 输出空串**，按 `|| "[]"` 处理。
- **缓存**:`shared("provider-menu.claude")` 存上次结果供秒开，照抄 new-menu的 `KNOWN` 模式(new-menu/main.js:27-39，含 `on`)。
- **sqlite3 依赖策略(已决定：方案 2)**：用系统 sqlite3；缺失时菜单显示提示行(macOS 自带；Linux `sudo apt install sqlite3`;Windows `winget install SQLite.SQLite`)。**不自带二进制**——留给真实分发需求出现时再议 (自带涉及 macOS quarantine/arch 矩阵/远程无效，REVIEW.md 记录了完整阶梯)。
- **schema 漂移**:cc-switch 改表结构则本 mod 的 SQL 失效，跟进修复是本 mod的维护职责(这是"配置管理交由 cc-switch"分工的固有代价)。

## 4. 启动路径

### 4.1 Claude(API 卡，本相位)

**启动契约(2026-11-19 用户确认)**：对齐上游 `open_provider_terminal`的 API 卡分支(`terminal_launch.rs:204-229` 的 `None` 路径)——env 清单前缀 + settings 投递(我们内联 JSON，上游临时文件)+ drops 挡键 +必写 `modelPicker` + `extraArgs` 显式追加；`skipPermissions` 仅显式给，绝不默认(严于上游的可选参数)。

```js
run("tab.new", {
  name: `Claude (${p.name})`,
  space: space?.id,
  argv: ["env", "-u", …UNSET, "claude", "--settings", JSON.stringify(settings), …extra]
})
```

- **settings 合并语义**(与 cc-switch 桌面版"打开终端"一致)：以 provider 的`settings_config` 为底，`meta.commonConfigEnabled` 为真且 common config 非空时，common **覆盖** provider 深合并。claude 的 `settings_config` 就是 settings.json 原文(provider env 块可直接承载身份)。
- **UNSET 列表**(env -u 前缀，防 rc 串扰；变量名是事实，清单参考cc-switch `CLAUDE_ACCOUNT_UNSET`):`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_CUSTOM_HEADERS` / `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` / `CLAUDE_CODE_OAUTH_SCOPES` / `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` / `CLAUDE_CODE_USE_FOUNDRY` / `CLAUDE_CODE_USE_GATEWAY` / `CLAUDE_CODE_USE_MANTLE` / `CLAUDE_CODE_USE_ANTHROPIC_AWS`。前置在 rc 之后(herdr 的 agent_argv 把 argv 放在交互 shell 的 `"$@"` 位)， 优先级正确。⚠ 优先级实测未做(T2)：若 settings 的 env 块能压过进程 env, UNSET 可简化。
- ⚠ **live settings.json 的逐键合并泄漏(2026-11-19 发现；修法已从上游拿到实测配方，T8 降为复验)**: `--settings`(CLI 档)优先级高于 `~/.claude/settings.json`(用户档)， 但合并是**逐键**的——live 文件里未被本 provider 覆盖的键会存活。上游 `terminal_launch.rs:1088` 注释原话证实前提："这个文件叠在用户级 `settings.json` 上：`env` 按键合并、顶层按键覆盖"。泄漏分两层：env 键 (如 live=GLM 的 `ANTHROPIC_MODEL` 泄进 DeepSeek 启动、auth 键名错位双活) 与**顶层键**(live 的顶层 `model`/`modelPicker` 同样逐键存活)。`env -u` 管不了：settings env 是 claude 进程内读档后自己 set 的。 **上游配方(`write_claude_config`，直接采用)**:
  1. `drops` = 切到这张卡时 live 会清掉的键 = live 有而本卡没有的键(launch 时 `readTextFile` 读 live，与合并后的 provider settings 做 diff， 零状态可算);
  2. drops 的 **env 键置 `""`** 挡住——"Claude Code 把空串当没设(2.1.314 实测：代理的占位凭据不再随请求发出，没配的档位回到内置模型)";
  3. drops 的**顶层键白名单置空**(仅 `model`/`theme`/`attribution`,T8 实测空值安全；2026-11-19 实机修订：枚举校验键写 `""` 会使**整个** settings 文件被弃——`autoUpdatesChannel` 事件，过程见 REVIEW Pass 8；其余 live-only 顶层键**继承**——机器偏好，继承即正确语义，且与上游实测 drops 窄集一致);
  4. **`modelPicker` 必须总是写**(整键按层级胜出，不写则路由/聚合模式的菜单漏进本终端，选了就把别家模型发给这张卡)——由卡的 env + 名称生成。

T8 剩余工作：在当前 claude 版本复验空串语义；T6 未暴露的原因：sandbox fresh home 无 live 文件。
- **明确不继承 ccs 的默认**:**绝不默认 `--dangerously-skip-permissions`**。extra 参数由用户显式给。
- **rc 遵从路线(2026-11-19 记录，考虑过、暂不取，有复评条件)**：让启动走 shell 函数/alias(如用户 `claude()` 内带 `--allow-dangerously-skip-permissions`)在 herdr 里机械可行——包装 shell 本就 source rc(`window.rs:114-118` "after their rc files")，挡路的只是我们自己的 `env -u` 前缀把 `claude` 放进了参数位。上游参考实现 = farion1231/cc-switch PR #9015(本仓作者提，open 待审)：**赋值前缀(`NAME=value … claude`)保持程序在命令位**使 alias/函数展开 + macOS 按 `.bash_profile` 存在与否选 `-lic`/`-ic`(修 #9013)；上游同期的产品答案是开终端弹窗的勾选框+参数框，launch-args 需求另见其 #2508/#9008。**不取的原因**：本 mod 的 UNSET×14 是 unset 型需求，赋值前缀只能 set——去掉 env 前缀则 `USE_BEDROCK/VERTEX/GATEWAY` 等认证路径开关(settings 挡不到)从导出环境漏入；字符串化 argv 则引号/注入面 + 逐词审计性全失。**复评触发**：若 claude 演进使 settings env `""` 可证覆盖这些路由键，env 前缀可退役，rc 遵从随之免费获得。
- **extra-args(2026-11-19 定；同日修订)**：静态参数(`--allow-…` 等)= **per-machine 持久 extras**:`shared("provider-menu.extraArgs")["<machine>|"""]`，面板 footer `args` 行常显 + 一键自绘 dialog 编辑(InputState/Input,shipped prompt mod 范式),shell-lite 引号分词(splitArgs)，面板与子菜单统一经 `launchArgv` 追加。曾同时引入 `env.workspaceFolder = SpaceInfo.folder` 注入，**同日撤除**——workspaceFolder 是用户的举例而非 mod 需求，动态 env 的通用机制是 rc 遵从模式；公开参考 mod 不携带未被要求的 env 注入，与"砍 Default 行/白名单挡键"同一原则(显式 > 环境暗示)。三种路线各有所长：上游 dialog = 每 session 自由(每次重打、装不下动态 env);shell rc 遵从 = 动态 env(藏 rc、要拆 env 前缀)；本设计 = 持久免打(不 per-session——dialog 架构留 `props.mode="launch"` 一态可补)。ADR"绝不默认"不变：extras 是用户的显式记录，面板与 argv 双可见。
- **rc 遵从启动模式(2026-11-19,opt-in)**：面板 `rc` 行每机开关。开启后 argv 变为 `env -u …×14 bash -[l]ic '<shellQuote 包裹的 claude --settings …>'`——命令串经 interactive shell 解析，**alias 与 function 都生效**(词向量只能带函数：alias 仅在解析期展开，参数展开产物不重扫——用户当年 alias→function 迁移的同因)。`-lic` 当且仅当该机存在 `.bash_profile`(PR #9015/#9013 的文件探测智慧);shellQuote = 单引号包裹 + `'\''` 转义，任意字节安全。**信任边界照实声明**:rc 模式下 profile 即信任边界——它先于 claude 运行，可重新 export 被 env -u 清掉的变量；rc 双 source(herdr 包装 + 内层 bash)通常无害。用户实形(两种等价，`command` 防递归，`$(pwd)` 在解析期求值——rc 模式下两者皆通):
  ```
  alias claude='workspaceFolder="$(pwd)" CLAUDE_CODE_ATTRIBUTION_HEADER=0 command claude --allow-dangerously-skip-permissions'
  claude() { workspaceFolder="$(pwd)" CLAUDE_CODE_ATTRIBUTION_HEADER=0 command claude --allow-dangerously-skip-permissions "$@"; }
  ```
  `CLAUDE_CODE_ATTRIBUTION_HEADER` 不在 UNSET×14，无冲突；本设计曾同日注入 `env.workspaceFolder`(SpaceInfo.folder)，后撤除——个例不应成为公开 mod 的静默行为，动态 env 的通用机制即本模式。默认关：公开参考形态保持词向量纯度，rc 遵从是显式选择。
- **token 暴露面(已接受)**:settings JSON 内联在 argv,`/proc/PID/cmdline`可见；静态存储始终只有 cc-switch DB 一份。本地可选后续(2026-11-19 升级为已验证配方):settings 临时文件 + 0600 + 退出即删——上游隔离终端即此做法(`terminal_launch.rs:342` 临时文件 0600 读完即删、`:1086` 含凭据文件 0600)，移植路径 = `writeTextFile` + `exec chmod 0600` + 包装 argv 在 claude 退出后自删(Phase 3，想收就收)。

### 4.2 后续相位

- **codex(Phase 2)**：已落地 → §4.6(2026-11-19，配方镜像上游 `codex_terminal`，纯 argv)。Windows 的 pwsh 验证仍在后续(T3)。
- **官方账号(Phase 3，可选)**:`CLAUDE_CONFIG_DIR` 指向 per-account 目录；仅本机(目录需存在于目标机)。隔离轴：API 卡只切**身份**(临时 settings， 世界共享)，官方账号才切**世界**(登录/钥匙串本来就该分)。
- **无逃生门的 CLI(grok 类)**：菜单显式拒绝行，绝不静默落到全局切换

### 4.3 开放决策(ADR-9 候选):identity(--settings)vs world(CLAUDE_CONFIG_DIR)

**此决策从未正式做过**:P0 选 `--settings` 是沿用 cc-switch 对 API 卡的机制分类，不是评估后的结论；T8 的逐键合并泄漏是让它重新开门的新证据。且先前"world 轴 = 会话/历史全分家"的描述**有误**——cc-switch 的账号目录(`claude_account/shared.rs`)实际做法：

| 内容 | cc-switch 做法 |
|---|---|
| skills/ commands/ agents/ output-styles/ plugins/ rules/ workflows/ | **目录符号链接**到默认 `~/.claude` 下同名目录 |
| projects/ file-history/ todos/ plans/(**会话历史**) | 同样**链接共享**("换账号后会话历史照样看得到") |
| settings.json | **镜像而非链接**：剥掉身份/重定向键(`CLAUDE_CONFIG_DIR` 等)，顶层三方合并(`.mirror-state.json` 记账号自己改过什么),`cleanupPeriodDays` 强制随默认 |
| .claude.json | 只镜像 `mcpServers`，补 `hasCompletedOnboarding`/`theme`(免重走引导) |
| CLAUDE.md | 一行 `@<默认 CLAUDE.md>` 导入 |
| 安全不变量 | 只链接**空**目录；绝不复制、绝不删用户文件 |

即真实语义是：**world 只分离 settings 权威 + 凭据，历史与全部用户定制经布线共享**。`CLAUDE_CONFIG_DIR` 本身只搬"配置根"(含 projects/plugins/ skills/CLAUDE.md…)，项目级(.claude/、CLAUDE.md、.mcp.json)与二进制不动； macOS 钥匙串按目录串哈希分槽。

**2026-11-19 二次核实(用户推测验证)**：「以此供应商打开终端」确实存在(`OpenTerminalDialog` → `commands/terminal_launch.rs:167` `open_provider_terminal`)，且 world 是**点击时运行时装配**：账号卡分支在启动路径里调 `sync_shared(&config_dir)` 接共享层。但**API 卡今天不走world**——分派为 `None` 分支：临时 settings 文件 + `--settings` + drops挡键，与我们 P0 同机制；官方账号卡才走 `CLAUDE_CONFIG_DIR`(且放**进程env** 而非 settings:macOS 钥匙串预取在进程启动即读，写 settings 的话前30 秒会用默认登录的令牌)。即上游的"隔离终端"是双轨：账号卡=world, API 卡=identity;T8 已有实测配方后，world 路线的紧迫性进一步下降。

**连接模式(直连 / 路由 / 聚合)对读与启动的影响**:`mode/` 为设备本地live-state + 直连/代理两模式；代理模式下 live 客户端文件写的是"契约" (`mode/contract.rs`：由路由供应商 + 本地代理地址决定；代理内切换只换上游，客户端文件不动)，真 token 只在 DB，经本地代理注入。对 mod:
- **直连**：无影响；我们即上游终端启动的语义。
- **路由/聚合**：我们读 DB `settings_config` 拿到的是**真实上游** → 绕过代理直连。对"终端绑死一个身份"语义上正确(不该跟着代理热切换走)，但失掉 failover、代理侧模型别名与用量统计；且**路由型 provider 的 settings_config 可能不是 env 形态** → 面板须识别并给提示行，不能瞎启动(REVIEW T10；判据硬化 2026-11-19:Accounts(Beta) OAuth 卡被上游限定非官方客户端必须走路由——结构性无 env 形态，拒启与灰显正确且必然)。无头机上代理模式整体不可用(代理活在 GUI 进程里),DB 直连路线反而更契合。

**同步场景的模式问题(2026-11-19 定，ADR-10)**：模式**不随同步走**——`live-state.json` 是"设备本地的(0600，不同步)"(`mode/state.rs`),WebDAV只传 DB 的 SQL 快照 + skills 包；DB 的 `is_current` 是**直连指针**，代理路由在 live-state(`mode/current.rs`:"两个当前，互相独立")。因此不存在"db 记着非直连模式"：同步机读不到模式，也无须读。**决策：面板恒为直连语义**——不是折中，而是 per-launch 固定身份的正确语义(代理热切换与单终端无关；failover 与固定身份矛盾；模型别名按上游配方写进卡自身env/modelPicker)。提示只留一处：settings_config 非 env 形态的行 → T10 阻断(mode=代理非阻断注记已砍——上游同场景无提示，对齐优先)。注：同步机上 `is_current` 徽标跟随源机器的直连指针，无害，文档记一句。**上游背书(2026-11-19 二次核实，本地 clone `~/dev/ws-ai/cc-switch` @ `6da70837`)**:v4 直连/路由/聚合三模式下「以此供应商打开终端」全部物化 DB 真实上游直连(`terminal_launch.rs:167/217/596-597/1089`;live 的 `PROXY_MANAGED` 被 drops 写 `""` 挡住，与本 mod T8 挡键同构)——ADR-10 与上游同构，非权宜，封板不再动。

**卡的可携性判据(2026-11-19 补)**：身份库 vs 路由表管"能不能当源";env 形与否管"能不能启动";**端点是否机器无关管"能不能跟着同步走"**——env 形+公网端点的卡完全可携；localhost 网关卡(magpie/litellm 类)需目标机有同服务，端点改写机器无关地址(局域网 IP/Tailscale 主机名)即可携；OAuth 账号卡与路由/聚合产物不可携(T10)。源机模式与可携性无关(mode 不同步、DB 无模式)。

**上游 asks 清单(2026-11-19 定，共三条，提 issue 时引本地 clone 源码行号)**:① API 卡走账号目录(= §4.3 选项 C；成了可删整个 T8 挡键机制);② headless/CLI(cc-switch 无 CLI，无头机的建库/同步缺官方通道，DB 供给现归用户自行解决，§2 已记);③ **可配置终端启动器**——上游「以此供应商打开终端」是固定终端清单、无自定义命令模板(`terminal_launch.rs:1142-1146` macOS / `:1499-1506` Linux)；成了 → cc-switch 可把隔离终端直接开进 herdr(`herdr-app do tab.new` 即现成落点)，本 mod 三层克隆可退位。

**选项**:
- **A(现状，已按此实现)**:`--settings` 身份启动 + drops 挡键/必写modelPicker(上游 `write_claude_config` 配方，见 §4.1)。mod 保持读+ 启动零状态。
- **B**:API 卡也走 per-provider world。结构性消灭 T8 与 auth 键名错位，且每 provider 可有自己的调优(超时/模型映射随端点走)。代价：mod 需建/维目录(writeTextFile + exec ln)，实质重造 shared.rs 的镜像状态机——违背"配置管理归 cc-switch"的分工。
- **C(推荐)**:A 先行；把 B 作为**上游需求**提给 cc-switch——账号目录的全套机制(layout/shared/identity)已存在，推广到 API 卡 provider 即可， 我们的 argv 退化为读 meta 里的目录路径 + `CLAUDE_CONFIG_DIR` 前缀，mod 仍零状态。若 T8 补丁失败/难看，再评估本地 B。


### 4.4 plugin / skills / MCP：遵从 cc-switch 的继承行为(2026-11-19 定)

上游对三者的管理与「打开终端」的继承行为，经代码核实：

| 项 | cc-switch 管理 | 存放 | WebDAV 同步 | 隔离终端里的行为 |
|---|---|---|---|---|
| **MCP** | `mcp_servers` 表，**按 harness 启用**(`enabled_claude`/`enabled_codex`/…每应用一旗，"复制到具体 harness"即此);McpService「重新同步到各应用」部署进各 harness 配置(claude → 用户域 `.claude.json` 的 `mcpServers`) | DB | ✅ 随 DB 快照 | 继承本机 `.claude.json` 现状(= cc-switch 部署结果) |
| **skills** | v3.10+ SSOT `~/.cc-switch/skills/`，安装记录与启用态在 DB,"按需同步到各应用目录"(部署进 `~/.claude/skills` 等) | SSOT 目录 + DB 记录 | ✅ skills zip 随同步 | 继承本机 `~/.claude/skills`(部署是 GUI 侧动作) |
| **plugins** | 直接管理 harness 自己的目录(`claude_plugin.rs` 写 `~/.claude/config.json`，支持 override 目录) | harness 本地文件 | ❌ 不在 DB，不同步 | 继承本机 `~/.claude/plugins` 等 |

**两条隔离终端轨道都不做 per-provider 选择**:API 卡轨道用默认配置目录 →整套 `~/.claude` 状态原样继承；账号目录轨道 mirror `mcpServers` + symlink skills/plugins 等目录(`shared.rs`)。即 cc-switch 语义里MCP/skills/plugins 是**机器级(按 harness)**的，不是 provider 级的。

**对 mod 的结论**：我们的启动与 API 卡轨道同构(从不碰`CLAUDE_CONFIG_DIR`,per-launch settings 只写 env/modelPicker/挡键)→ **遵从是自动获得的**——GUI 机器上，cc-switch 部署过什么，面板终端就继承什么。mod 不做任何部署(那是配置管理，归 cc-switch)；无头同步机的缺口(MCP 定义随 DB 到了、但没人把它部署进 `~/.claude.json`)与 live 槽位同属一个缺口(DESIGN §2 无头机缺口)，不由 mod 接管。

**实现状态**:`launchSettings`(live diff 挡键 + modelPicker)与`launchArgv`(live 读取，读不到→无挡键照启，同上游 warn-and-proceed)已实现于 `providers.js`,`check` 通过；E2E sandbox 实测见 REVIEW Pass 5。

### 4.5 失败面与 agent 识别

- sqlite3 缺失 / DB 缺失 / 解析失败：exec reject 或非零退出 → 菜单提示行(区分"装 sqlite3"与"先在 cc-switch 里加 provider")，不静默空列表。
- 启动后 2 秒内非零退出：herdr 现成的 launch_failure toast 兜底(window.rs:138),mod 不用自己报。
- argv[0] 是 `env`:7501 上报前终端显示 "program"+哈希色(programs.rs 的resolve 不认识 env),claude 起来后 `app` 报告优先，自动纠正。可接受， 无需 programs.json 条目。

### 4.6 Codex(API 卡，2026-11-19 Phase 2 落地)

cc-switch 存 codex 卡为 `settings_config = { auth: {OPENAI_API_KEY} | string, config: TOML 文本 }`，切换时把卡投影写进 live `~/.codex/config.toml`(键集 = floor.rs 的 FLOOR/EXCLUSIVE);`-c key=value` 与 config.toml **逐键合并、只改值不删键**，这是整个配方的约束源。代码组织：providers.js 以 HARNESS 注册表分派(claude/codex 各一个策略：classify/mergeCommon/launch)，共享管道(query/rcMode/extras/machineHome)作上下文，新 harness = 新增一个条目。

**配方**(镜像 `services/provider/codex_terminal.rs`):`env CC_SWITCH_CODEX_API_KEY=… CODEX_HOME=$HOME/.codex codex --no-daemon -c …`。路由表重写为 `model_providers.custom={…}` 且 `env_key=CC_SWITCH_CODEX_API_KEY`——**key 走环境变量不上命令行**(上游同款；`env_key` 还压得住 live 残留 bearer，且 codex 进程的 /proc/PID/cmdline 不含 key，比 claude 侧 argv 内联 token 更优，姿态见 §6)。`requires_openai_auth` 按 live auth.json 有无登录态现算(上游 `requires_openai_auth(auth, login)` 语义);`wire_api` 缺省 `'responses'`、`supports_websockets` 缺省 `false`。`--no-daemon` 来自 herdr programs.json 的 codex run 约定。CODEX_HOME 显式钉住，防 shell 导出改道；cc-switch 设置里的 override 目录不读，恒用 `~/.codex`(限制，本节已记)。卡的 TOML 用行级子集解析(表头/键值/行内表，值保留原文重渲染，免引号往返)。

**可启判定(白名单 = 上游 `codexHasOwnRoute` + key)**：非 official、带 key(auth 或表内 bearer)、自带路由表(base_url)、非 router-only(meta.is_full_url / api_format ∈ {openai_chat, anthropic} / wire_api=chat)。拒启原因入 UI 提示：official(跟 Codex 自身登录走，`-c` 换不动登录——用户实机观察到"official 无终端图标"即此因，非凭据缺失；上游 App.tsx:1643 只给 {claude, codex, agy, grokbuild, copilot} 五家注入终端按钮，pi/dsh 等无此按钮)/follows-login/builtin/no-table/no-key/router。

**live 残留中和**(镜像上游 Neutral 表):effort 两键→`'medium'`、verbosity→`'medium'`、supports_reasoning_summaries→`false`、review_model/subagent/memories 模型→卡 model；中和不了的一律拒启并提示"先在 cc-switch 切到这张卡"(model 缺、model_context_window、model_auto_compact_token_limit、model_catalog_json、路由表未覆盖键如 http_headers、live 选了 profile)。`experimental_bearer_token`(env_key 压制)与 PROXY_KEPT_CLIENT_KEYS(重试/超时三键)豁免。

**与上游的有意分歧**:① live 残留 `model_catalog_json`——曾为拒启分歧，2026-11-25 起按 [docs/arch-codex-catalog-synthesis.md](docs/arch-codex-catalog-synthesis.md) 合成单模型目录盖过(responses 路由含缺省、钉死 model、路由表覆盖齐全者；官方名且探针成功时镜像目标机 `codex debug models --bundled` 条目+第三方改写，其余回退中性模板；仍拒：selected profile、`model_auto_compact_token_limit`、跨机行内指针)；② BuiltIn 路由(裸选 ollama/lmstudio/bedrock)上游可直启 `model_provider=<id>`,mod 拒(本地 provider 场景罕见，拒绝语义诚实)。rc 模式与 extra args 通用机制对 codex 同样生效(launchArgv 统一分派)。

**验证**：上游 codex_terminal.rs 的测试夹具作 oracle 的纯函数冒烟(KIMI 卡 × PROXY_MANAGED live、http_headers 残留、keyless、context_window、subagent 跟随、profile 六场景全对齐，分歧②按上记落拒启；分歧①已改为目录合成，见 ADR 13);`herdr-app check` mod/agent-menu 双过。mac 实机 E2E 已过(2026-11-20 轮：子菜单/手风琴/official 灰显/DeepSeek 真应答/argv 回落形态复核)；T5 远端半场以跨机借库双向实证关账(Pass 44)。余：sandbox UI 半场(T6 惯例项)。

## 5. UI

### 5.1 Phase 0(本仓库的骨架)：独立 docked 面板

`mod.json` `{"place":"right","size":280}`：装进 herdr home 后停靠为面板，列表 + 点击启动 + ↻ 刷新 + 提示行。目的：先验证读→合并→启动全链路，不碰任何出厂 mod。2026-11-20 定稿(同日两轮：先按钮切换、后按用户意见改为堆叠——横排 tab 在 harness 增多后难操作，面板下方空白才是可用空间)：**顶部一行总标题说明侧栏性质**(Providers · cc-switch，右端 ↻)，**其下每 harness 一个纵向堆叠区块**——小节头 = 图标(knownAgents，共用 "new-menu.agents" 缓存)+ 名称 + 卡数 + 未安装标注，卡列表 `pl(24)` 缩进对齐小节头标题(与菜单子菜单同款层级几何)；区块由 `Object.keys(HARNESS)` 驱动，新 harness 自动出现；每 harness 各自缓存(`provider-menu.<app>`,↻ 并行重读)；拒启文案与子菜单同源(providers.js `cardNote`，单一事实源);args/rc 两行作用于该机全部 harness 启动(经 launchArgv 统一追加)。

**前提(2026-11-19 实测确认)**:shipped 布局不接受停靠 mod (`src/window.rs:4492`:`shipped && place!="none"` → 跳过)。用户需先有个人布局(`do layout.clone {"name":"main"}`),mod 才会在下次扫描时 dock到根 children 末尾。README 安装节已写明。

### 5.2 Phase 1：三层克隆，子菜单进 "start agent" 组

```sh
herdr-app do mod.clone '{"name":"new-menu","as":"agent-menu"}'
herdr-app do mod.clone '{"name":"tabs",     "as":"my-tabs"}'
herdr-app do layout.clone '{"name":"main",  "as":"my-main"}'
```

- `agent-menu/main.js`：加入 §5.3 的子菜单(克隆后用本仓库的源覆盖， `providers.js` 原样随行——读写启动逻辑两处共用一份);
- `my-tabs/main.js:150`:`openOverlay({mod:"new-menu"…})` → `"agent-menu"` (克隆不改别的 mod 里的引用，所以 tabs 必须一起克隆);
- `my-main`:tabs 块 `content.mod` → `"my-tabs"`(layout.clone 文档语义)。
- 每个克隆过 `herdr-app check`。三份克隆归个人，不再随出厂更新(文档明示)。

**打包(2026-11-20)**:仓库改为 herdr.dev/mods 包结构——`provider-menu/` 与 `agent-menu/` 两个包根，各含 `RECIPE.md` + `preview.png` + `mods/<mod>/`;`agent-menu` 包连 `my-tabs` 一起发(没有它 `+` 打不开弹窗)。克隆前提取消：官方安装流程就是普通复制，包里已是完整源(纯复制在 sandbox 全程验证过)。`my-tabs` 仍是出厂 tabs 的分叉，升级后需重克隆重打那一行；两包的 `providers.js` 字节一致。开发套件(`gpui-kit.d.ts`、`jsconfig.json`)上移到仓库根，不进包。

**子菜单形态：行内展开**(agent 行尾 `▸`,hover/点击切 `this.sub`，子行缩进，现有 `overflow_y_scrollbar` 消化变长)。**不做 flyout**:openOverlay 的`kind:"popup"` 虽有 `at` 坐标，但元素不暴露自身绝对位置，锚不到父行。

**键盘**：顶层 1-9 保持直启默认 agent；子菜单行可点击，数字/Enter 作用域随层级；Esc 拦截能否做到"只退一层"未验证(T4)，先给显式返回(再点父项)。

**远程 space**:new-menu 已把 machine 传 `knownAgents({on})`；子菜单的sqlite 读同样带 `on` —— 已天然覆盖。

### 5.3 更轻的退路(不需要克隆)

providers 平铺为顶层条目(programs.json 每个 provider 一行 `run`，指向一个薄 wrapper)——零代码但非嵌套；或独立 picker 挂自己的键。仅当三层克隆的维护成本被证明过高时降级。

## 6. 安全与凭据姿态

- 凭据静态存储：**仅** cc-switch DB。本 mod 无档案、无凭据落盘、无网络(fetch 不用)。
- 启动瞬间：settings JSON 经 argv 到目标机(远程时 token 出现在远端 argv，同一信任域，会话中已接受的框架：本地与远程无信任级别差异，只有运维纪律差异——聚合点与静态持久性，而本 mod 两者都不新增)。
- mod 是 herdr 信任模型内的受信 JS(可 exec、可读文件)；将来若分享到herdr.dev/mods,RECIPE.md 必须披露 exec 与读取自己目录外的文件。

**落盘审计(2026-11-20，用户问询触发，本机实测)**:① herdr-core 把终端 argv 持久化在 `~/.local/state/herdr-core/<会话>/terminals.json`——实测 16 条(7 live + 9 finished),**finished 条目含凭据仍留盘，无会话结束清理**；文件 mode 664，其上两层目录 700，实际仅 owner+root 可达，但凭据文件 664 原则错误。② exec 命令不持久化(state 目录 grep 无 sqlite3 记录)——DB 读取路径无泄漏，只有 tab.new 的 argv 落盘。③ `writeTextFile` 仅本机(无 `{on}` 参数)，远程写须借 exec。④ /proc 无 hidepid：活会话 wrapper 链 cmdline 含 key。⑤ 对照：`~/.cc-switch` 目录 755 + `cc-switch.db` 644 = **其他本地用户可读**(上游 cc-switch 姿势)；本仓 seed 脚本已修建库即 0600。**缓解分层**：本机启动 = key 本就在该机 DB,argv 落盘只是多一份副本；跨机借用(Pass 33)= key 落到原本没有它的机器。

**缓解落地(Phase 3,2026-11-20 完成)**:① **RAM 交接配方**(/dev/shm 可用的机器，即全部 Linux):exec 把凭据写入 `mktemp /dev/shm/herdr-pm.*`(0600;exec argv 不持久化)，终端 argv = `bash -c 's="$(cat F)"; [ -n "$s" ] || 拒启; rm -f F; <body>'`——**读完即删，文件寿命毫秒级**；实测教训：trap … EXIT 与 exec 不兼容(exec 替换进程，trap 永不触发，首版泄漏文件)，故不用 trap;KILL 无残留(文件早已删除)；终端死后被 restart 时 cat 落空 → 守卫拒启并提示从菜单重新启动；claude 侧 body 用 `--settings "$s"`(rc 模式经导出变量 PMS 过内层 bash),codex 侧 export CC_SWITCH_CODEX_API_KEY="$s" + CODEX_HOME;terminals.json 只记脚本(路径无 key),cmdline 无 key。② macOS(无 /dev/shm)回落内联 argv = 旧姿态；跨机借用确认弹窗**仅在该回落场景**出现(每 src>dst 机对一次，Always 记入 shared `provider-menu.borrowOk`;handoffAvailable 按机探测缓存)。③ mod 永不碰 core 状态文件(写写竞争 + restart 语义)。实测：claude/codex/rc-claude/守卫四形态全过(rc 形态顺带真实验证了用户 .bashrc 的 claude() 函数前置参数行为)。**上游 asks(经 Can)**:herdr-core——state 文件 600、finished 终端 argv 脱敏或不持久化、tab.new 增与 argv 分离的 env 通道；cc-switch——DB 建库即 600。

## 7. 同步模型

**无。** 启动配置随 argv 旅行(这是选内联路线的第二个理由)；各机器的cc-switch 库各自管理；多机一致是 cc-switch WebDAV 的事；远程机器经`exec {on}` 现场读。本 mod 无任何同步职责。

## 8. License 立场

自写实现。仅借用 cc-switch / ccs 的**想法、机制、事实**(per-CLI 逃生门、合并语义、UNSET 变量名、DB schema)——想法与事实不受版权保护，无 MIT继承义务。不复制代码、注释、命名结构。SQLite 公有领域(且方案 2 连分发都不涉及)。

## 9. 测试计划

| # | 项 | 方法 |
|---|---|---|
| T0 | mod 语法/初始渲染 | `herdr-app check <folder>`(本机无 Rust 工具链，装后首验) |
| T1 | WAL 库 `-readonly` 读(cc-switch 桌面版运行中) | `sqlite3 -readonly -json` 对照 `better-sqlite3` 结果 |
| T2 | 进程 env vs settings env 块优先级 | 导出 `ANTHROPIC_BASE_URL` 后启动，看生效者；决定 UNSET 是否可简化 |
| T3 | Windows pwsh 内联 JSON 投递 | Phase 2，真机 |
| T4 | 子菜单 Esc 拦截(只退一层) | sandbox 里改 agent-menu 试 |
| T5 | 远程 space:on 读 + 启动 | sandbox + 第二个 core，或真远程机 |
| T6 | 全链路 UI | `scripts/sandbox up` → `do`/`shot`;**绝不**在无 `HERDR_APP_HOME` 的真实环境跑裸 app |

sandbox 是 herdr-app 仓库自带的(`scripts/sandbox`，独立 core/home/显示), UI 变更按其 AGENTS.md 要求一律在 sandbox 验证。

### 9.1 scripts/ 一览(2026-11-20 自 README 迁入)

| 脚本 | 用途 |
|---|---|
| `t1-wal-test.sh` | WAL 活跃库 `sqlite3 -readonly` 读取正确性(5 案例) |
| `t2-precedence-probe.sh` + `t2-server.py` | 真 claude 优先级/泄漏探针(localhost 回显服务器、假 token;PROBE_USER/CLAUDE_BIN 可参数化) |
| `seed-cc-switch-db.py` | 验证工具：从 spec 造单 provider 测试库(全量 DDL + user_version；消费者只有 mod 的只读查询)，非正式建库方式 |
| `t5-remote-prepare.sh` + `t5-remote-e2e.md` | 远端机准备 + T5 E2E 清单 |
| `p1-install.sh` | GUI 机安装的自检+修复(幂等；普通复制三个 mod、个人布局补 tabs→my-tabs 并停靠 providers 块、重名非本仓 mod 时拒装并提示改名) |

### 9.2 开发与验证(2026-11-20 自 README 迁入)

```sh
cd ../herdr-app && just build                     # Rust 1.95 + zig 0.16
./target/debug/herdr-app check ../herdr-provider-menu/provider-menu/mods/provider-menu
./target/debug/herdr-app check ../herdr-provider-menu/agent-menu/mods/agent-menu
./target/debug/herdr-app check ../herdr-provider-menu/agent-menu/mods/my-tabs
scripts/sandbox up                                # UI testing lives in the sandbox, never on a real setup
scripts/sandbox do layout.clone '{"name":"main"}'
scripts/sandbox do space.new '{}'
scripts/sandbox shot
```

check 的输出必须显式查看——2026-11-20 曾因 `2>/dev/null` 吞掉失败，把语法错误推进了提交(Pass 21 教训)。绝不在无 `HERDR_APP_HOME` 指向 scratch home 的真实环境跑裸 `herdr-app`;sandbox 备忘见 REVIEW Pass 5。

## 10. Phase 划分与完成判据

| Phase | 内容 | 完成判据 |
|---|---|---|
| P0(本仓库骨架) | docked 面板：读→合并→启动 + 提示行 | T0/T1 过；sandbox 里以两个 provider 各启一个终端，并行不串扰，7501 正常 |
| P1 | 三层克隆 + 行内展开子菜单 | T4 结论落地；`check` ×3 过；数字键/返回可用 |
| P2 | codex `-c` 路线(对齐上游 `codex_terminal` 纯 argv)——**已落地(§4.6,2026-11-19)**，实机 E2E 待验；Windows(T3)；附带上游 issue 三条：①API 卡走账号目录(ADR-C，成则 T8 挡键机制可删)②headless/CLI 支持 ③可配置终端启动器(成则 cc-switch 可直开进 herdr，本 mod 退位)——写时引本地源码行号 | T3 过；codex 两 provider 并行。注：AppType 已 14+ CLI(含 OpenClaw/Pi/Kimi)——cc-switch 是整个 harness 动物园的身份库，codex 配方是「第 N 个实例」而非第二个 |
| P3(可选) | 本地 settings 文件路由(0600+惰性清理)、官方账号 CLAUDE_CONFIG_DIR | 按需 |

## 11. 证据索引(本会话核实)

**herdr-app**(`~/dev/ws-ai/herdr-app`):
- `defaults/mods/tabs/main.js:150` — + 按钮打开 `new-menu`(popup 250×512);
- `defaults/mods/new-menu/main.js:27-39` — `KNOWN` shared 缓存 + `knownAgents({on})`;
- `defaults/herdr.d.ts:14,29-32,34-37` — `exec(cmd,args,{cwd,on,timeout})` / `readTextFile(path,{on})` / `writeTextFile`(**仅本机**)/ `knownAgents`;
- `src/programs.rs:310` — 7501 `app` 报告优先于 argv 识别；
- `src/window.rs:115` — agent argv 经交互 shell(UNSET 前缀落在 rc 后);
- `src/window.rs:138` — launch_failure:2s 内非零退出 → 错误 toast;
- `src/window.rs:4492` — shipped 布局拒绝停靠 place≠none 的 mod(§5.1 前提);
- `src/core_bin.rs:155` — app 在 `$HOME/.local/bin` 等处找 herdr-core(sandbox 供 core 依据);
- `src/hc.rs:467` — app 给 core 的 env 仅 TERM/COLORTERM/TERM_PROGRAM(+HERDR_LAUNCH);
- AGENTS.md(defaults)— 克隆规则(layout.clone/mod.clone、克隆不改他 mod 引用)、`herdr-app check`、mod 信任模型、sandbox 要求、CONTRIBUTING 的"mod 能做的不收"。

**cc-switch**(farion1231,MIT,main @ 2026-11):
- `terminal_launch.rs` — claude：临时 settings 文件 + `--settings`;codex: `-c` 覆盖 + env；官方账号：`CLAUDE_CONFIG_DIR` + unset 重定向变量；grok： 无进程级逃生门 → 报错拒绝；env 经 0600 临时文件(读完即删);
- (2026-11-19 二次核实 @ `6da70837`,clone 在 `~/dev/ws-ai/cc-switch`)`database/mod.rs:54` SCHEMA_VERSION=27——master 未动，T9 seed 无漂移；`terminal_launch.rs:167/217/596-597/1089` 三模式「以此供应商打开终端」均物化 DB 真实上游直连，live 的 `PROXY_MANAGED` 由 drops 写 `""` 挡住；`:342/1086` settings 0600 临时文件 + 退出即删(argv 暴露收口的上游先例，P3 配方参照);AppType 枚举 14+ CLI——cc-switch 定位是整个 harness 动物园的身份库；
- `login.rs:38` — `CLAUDE_ACCOUNT_UNSET` 变量清单；
- SQLite 存贮(`database/dao/`),WAL。

**运行验证(2026-11-19，本仓库 `evidence/`)**:
- `check passed: mod/`(T0，含 sqlite 非零退出吞错修复后复跑);
- `t6-panel-rendered.png` — main-copy 布局 dock 后面板：标题/cc-switch/↻
  + Work(current)+ DeepSeek，无错误行；
- `t6-launch-dump.txt` — 点击 Work 后 stub `claude` 收到的 argv：恰好 `--settings {"env":{…Work 的 BASE_URL/AUTH_TOKEN…}}`;
- env 清洗实证：app 带 `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`毒化重启再点击，claude 环境中两者皆无(`env -u` 前缀生效)。

**ccs**(luckybilly/cc-switch-helper,MIT):
- `db.js` — DB 路径/SQL/WAL 注释(本设计 §3 的直接来源);
- `launcher.js:71-79` — `buildSettings`:common 覆盖 provider 的深合并、`commonConfigEnabled` opt-in;
- `launcher.js:275,343-378` — spawn stdio inherit；内联 `--settings` JSON; **默认 `--dangerously-skip-permissions`(:347，本设计明确不继承)**。

## 12. 决策记录(ADR 摘要)

1. **核心零改动** — 三问全否；CONTRIBUTING 明确 mod 能做的不收 PR。
2. **cc-switch 为唯一真身，mod 无状态** — 管理与同步是 cc-switch 的存量能力； mod 只读+启动，schema 漂移是可接受的跟进成本。
3. **内联 `--settings` 而非配置目录** — 身份/世界两隔离轴：API 卡只需切身份；目录路线留给官方账号(P3)。
4. **sqlite3 方案 2(系统 + 提示行)** — 自带二进制的三坑(macOS quarantine、arch 矩阵、远程无效)大于收益；真实分发需求出现再议。
5. **不默认 skip-permissions** — ccs 的默认是安全相关默认，不继承。
6. **UNSET 前缀** — settings 的 env 块只能设置不能取消；rc 串扰是 cc-switch桌面版已证实的问题(T2 可能简化)。
7. **行内展开子菜单，不做 flyout** — 元素无绝对位置，锚定做不到。
8. **P0 先独立面板，再三层克隆集成** — 先证链路，再动 UI；克隆是不可逆地脱离出厂更新的，值得推迟到链路已证。
9. **面板开合按 content 发现，不约定 id**(2026-11-22，Pass 49)——✕/pill 以 `content.mod === "provider-menu"` 自查节点，对自动停靠(随机 id)/手改块/约定块一律成立；与 skillshare(约定 id)同装不冲突。防呆守卫：布局无 toggle 块则不画 ✕(可关必有可见回路)；键路径(alt-p / mac cmd-shift-b)以键为双向回路，同样无陷阱。
10. **安装器不拥有布局，create-once 克隆**(2026-11-22，Pass 49)——仓库不带布局文件；脚本从 app 维护的出厂 `main` 生成一次 `main-<用户名>`(带 cloned_from 标记)，此后视为用户的(add-only 幂等维护，刷新=删文件重跑，与 my-tabs 同契约)。绝不改出厂布局(app 会搬成 `<name>-edited(-N)`)；血统检测(cloned_from)跳过 win98/terminals 系(自带外观)；仅当前在出厂 main 上才自动切换，其余保留用户选择。

**ADR 11 — MCP 跨机携带（T11，2026-11-23）**：cc-switch 的 MCP 存于 `mcp_servers` 表——全局定义 + 按 harness 启用位（enabled_claude/codex/…，非 per-provider），供应商 apply 联动投影进 live；携带集 = 来源机（面板刷新源）上该 harness 的启用子集，与 cc-switch 自身投影同源。**通道**：claude `--mcp-config` 以 JSON 字符串形态接收（"files or strings"；sourced 赋值先读后删，故字符串形态是唯一能保住即删语义的形态）；codex 每 server 一条 `-c mcp_servers.<name>={…}` 内联表覆盖，strict 用 `-c mcp_servers={}` 整表清空先行（codex 无 strict 旗标，-c 整键覆盖即等效）。**合并语义（实测 2.1.330）**：默认并集——目标机 user 域/project 域全保留，同名不并存、携带定义胜（优先级携带 > 目标 user > 目标 project）；`only mine`（strict）= 该会话只用携带集。**门控**：仅 src≠dst（同机 live 已有投影，携带只会在同名上自我遮蔽）；per-TARGET-machine 开关（MCP/MCPONLY 键，与 args/rc 同款）；集合来自所启动卡片的同一数据库（launchArgv 第五参 src；agent-menu 子菜单恒本机读故恒不携带）。**威胁模型**：MCP env 可含 token；RAM 交接的 sourced 赋值形式使记录面（terminals.json）只留 $PMM 引用——活动进程 cmdline 展开后含定义（claude 旗标/codex -c），与凭据 env 在 /proc 的会话期暴露同级，不新增水位；无 shm 回落 argv 内联（借用弹窗先确认，弹窗文案含 MCP 从句）。**明确不做**：skills/prompts 携带（无原生会话通道，物种否决，见 2026-11-23 评估）；写 .mcp.json（团队共享域错配+机密姿态+写入姿态三重否决）；项目级需求走零代码配方（仓库 `${VAR}` 占位 + 既有 env 通道）。

**ADR 13 — codex 目录合成（T12，2026-11-25，设计 docs/arch-codex-catalog-synthesis.md v4 经 bc 双环收敛）**：指针机(live config.toml 带 cc-switch 的 `model_catalog_json`)上非 current codex 供应商不一概拒启——responses 路由(含缺省)、钉死 model、路由表覆盖齐全者走现场合成单模型目录，其余照拒(D4/W4 边界)：官方名命中=目标机自身 `codex debug models --bundled` 探针条目(规范化回填+9 项第三方强制改写；别名列按 codex 自身最长前缀+一层命名空间规则命中，不冒用官方 display_name)；未命中=vendor 中性模板(MIT 署名，配对窗口；degraded 原因 "probe"/"model" 经 launchArgv 出参入面板 notice)。投递=spawn 前 exec 预植(mktemp 唯一部分文件+原子 mv；按字节有界分块防 MAX_ARG_STRLEN；目录/文件抢占回退不可预测同胞名)；argv 只携带路径，目录 JSON 不进 terminals.json。残留边界：`model_context_window` 从条目取值；`model_auto_compact_token_limit`、selected profile 照拒；行自带目录指针跨机照拒(悬空=硬错误，上游实证)，同机作为行键 `-c` 直传。current 供应商同机 plain 直启(cc-switch 自家终端同款)。**退出条件**：cc-switch 发布每 provider 目录文件(上游提请，独立主张域)后合成器整体退役——模板常量、探针、预植投递一并删除。**验证**：rig 57 组(scripts/rig——嵌套 slug 命中、CJK 字节分块、占用回退等回归)；沙箱对真 codex 0.172.0 全链路(合成→预植→模型行解析 rig-private-model，evidence/t12-codex-synthesis-real-codex.png)；三轮评审(同源+deepseek 异源+Pi 跨 harness)；真机 provider 轮待跑。

**ADR 12 — 会话迁移（T12，2026-11-24 裁决定稿，同日实现+沙箱验证）**：把活动窗口的 agent 会话连同工作区复制到另一台机器、以选定供应商身份 resume。**语义（快照派）**：transcript 密集引用文件状态，工作区是会话上下文的组成部分，必须随行——一体化快照拷贝是唯一 v1 语义，「迁会话不迁工作区」撤回；目标永不是陌生树。**三分支门**：目标目录空=首次全量；含血统标记 `.herdr-migrated` 且 id 匹配=增量（拷变更/新增、删消失，标记门控=--delete 语义）；非空无标记或 id 不匹配=拒绝（身份不明）。标记={v,id,manifest(rel→sha256)} 双端落章，id 首迁分配、方向无关（A→B 晨、B→A 晚同一血统）；源侧每次现算 manifest（find -prune 排除表+sha256sum 批量），目标侧以标记内存的 manifest 为基准做差分——mtime 不可信（通道重写），存储清单不依赖时钟。「目标位=停车位」：目标期间的手工改动在下轮快照中被静默覆盖，v1 明示语义（git 血统检查被否：非前代快照一律全量覆盖，血统不提供正确性增量）。**通道**：herdr 拓扑 A→GUI→B 双跳、无机器直连/ssh 假设，rsync 二进制不可用——manifest 差分是 rsync 思想的编排层实现；全部文件内容走 exec argv 的 base64 分块（96KB/参数，4 的倍数保 decode-append 对齐，MAX_ARG_STRLEN 128KB 下留余量；二进制安全单一代码路径），文本走 64KB 引号 printf 追加（writeTextFile 无 {on}，远端写不可能）。**会话放置**：claude=jsonl 拷入目标机 slug 目录 `~/.claude/projects/<cwd 的 / 全换 ->/>/`+checkpoint 侧目录逐文件；codex=rollout 首行 session_meta 重写（cwd+runtime_workspace_roots 指向目标根，id 不动），同相对路径落 `~/.codex/sessions/`。**resume 参数**：`claude --resume <uuid> <prompt>`（prompt 必带——裸 --resume 在某些 tail 态报 "No deferred tool marker…Provide a prompt"，2026-11-24 实测）；codex `resume <id> <prompt>`（argv 序 rig 待验）。经 launchArgv 的 extras 通道注入，providers.js 启动路径零改动。**UX**：面板 `copy session` 行 stage › → 刷新为当前机+找聚焦 agent（OSC 7501 app 判 harness；shell 态=诚实句子）→ 暂存卡（shared `provider-menu.move`，跨 space 切换与分钟级跨度存活）→ 切目标机 space、开 shell、cd 到位 → 「list shells」（panes() 活 cwd——hc ls 的 cwd 是 spawn 值，cd 过的 shell 会列错目录；远端终端同样显示在本窗，一个原语双机通吃；候选必须上屏，流程本就要求它是活动窗口）→ 点行过门（fresh/前代/拒绝+原因）→ 「copy the session and workspace above」勾选 arm → 点对应 harness 的 provider 卡=确认弹窗（密件警示句、排除清单、带语境默认 prompt=可转换语境三件套（新绝对根路径+目标平台 uname+被排除依赖重装句，如 "continue — now at /home/b/proj on linux; node_modules stayed behind — reinstall them there"；**不用 herdr 机器名**——可重命名且目标 agent 无法解析，2026-11-25 用户裁决））→ Move=清单→门→传输（双端落章）→会话放置→resume 启动→分叉模态。**停靠规则**：sections 行及以上固定；列表 flex_1+min_h(0) 滚动；暂存卡 flex_none 尾部停靠——卡的下沿顶到面板底后唯一滚动区=列表。**分叉模态的 Esc 偏差（实测）**：app 内建 Overlay 域 escape→overlay.close 绑定先于 mod 的 on_key_down（handler 根本收不到键，沙箱以计数探针坐实），「强制二选一」无法在 mod 层实现——Esc=隐式「保留（可能分叉）」，保守侧（杀源端才是破坏性动作）；已入上游 ask：不可关闭 overlay 选项。**开放项**：codex resume 子命令 argv 序（`codex -c … resume <id> <prompt>` rig 核）、双跳吞吐实测、`--resume` 对 claude 各 tail 态的容忍面、真双机 E2E（用户已实测 mac↔Linux 往返一轮）。
