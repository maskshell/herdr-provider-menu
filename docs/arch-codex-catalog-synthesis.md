# codex 目录合成：耦合 codex 而非 cc-switch（herdr-provider-menu 架构设计）

spec-version: 4（ODP 研究落地：上游证据证实目录启动期单次无锁读取与缺失文件硬错误——D3 升级为原子换名预植、跨机行内指针拒绝获证、schema 版本耦合披露）

## positioning（定位）

本设计定义一个**启动期单模型目录（model_catalog_json）合成器**：当目标机的 live `~/.codex/config.toml` 留有外来目录指针、而所点 codex provider 又不自带目录键时，现场生成一份只含该 provider 钉死模型的目录，预先植入目标机临时文件，以 `-c model_catalog_json=<路径>` 覆盖指针，使启动通过。合成的知识来源耦合到 **codex 本体**（schema 的拥有者 + 目标机上将被启动的那个二进制），而非 cc-switch 的调优产物——官方条目从目标机自己的 `codex debug models --bundled` 探针取得并施加**第三方改写**（见 layering），第三方模型用一份带出处的中性模板条目。

要解决的问题（本会话已查证的事实链）：live 里有 `model_catalog_json` 指针时，codex 只认该文件列出的模型（cc-switch codex_terminal.rs 注释："否则 Codex 只认上一家的模型"）；目录条目承载 `base_instructions`（系统提示词）、工具声明、截断与 reasoning 档位——是**会话身份**而非清单（gpt5_5_template.json 的 base_instructions 即完整 GPT-5 Codex 人格前言；真实 bundled 行共 42 字段，含 `use_responses_lite`，不含 `auto_compact_token_limit`——本机 codex 实捕验证）；cc-switch 以机器级单文件维护目录（内容随切换重写、指针常驻），因此指针机上非 current provider 的启动被我们的中和门拒绝（无安全中性值），已交付的 plain 支（同机 + current，已交付）不覆盖非 current 与跨机两个缺口。本设计补齐这两个缺口，**但有一条明示的残留边界**：provider 行自带目录指针且启动为跨机时**照拒**（源机路径在目标机悬空，见 failure-modes）。本设计作为**过渡方案**存在，退出条件见 version-strategy。

单一主张域声明：本文件只管合成器本身。上游"每 provider 一份目录文件"的提请（真正的解耦路径）是另一主张域，仅在 version-strategy 以锚点引用，不在本文展开。

## what-it-does-not-do（不做什么）

- 不实现全量目录规划器：多模型条目、厂商官方目录镜像（DeepSeek 类）、per-row 覆盖交互（cc-switch #9017 一类的 subtlety）全部不做——单模型钉死场景用不到。
- 不追踪 cc-switch 的模板调优序列：仅 vendor 一份中性模板（MIT，署名），其余官方内容从探针取。
- 不写 cc-switch 拥有的任何文件（live config.toml、cc-switch-model-catalog.json 均只读）；临时文件写在 `$TMPDIR`，属本 mod 的启动工件。
- 不改动已交付的 plain 支（同机 + current 跳过 live 检查）与既有拒绝语义中与本设计无关的分支（profile 拒绝、route uncovered 拒绝照旧）。
- 不为 chat 路由开放合成：classifyCodex 对 `wire_api === "chat"` 直接判 router 不可启动（providers.js），该类到不了中和门——D4 的允许集因此只含 responses（显式或缺省）。
- 不放松**双副本字节一致**约束：providers.js 的全部改动同步落到 agent-menu 同款文件，diff 为空是 CS5 的 DoD 之一。
- 不裁决上游方案 (b)：是否向 cc-switch 提请每 provider 目录文件、以什么形式提，是独立决策，本文只声明退出条件。

## layering（分层与数据流）

合成器是 providers.js 内的一个新内聚模块（纯函数）加两个机器侧探针/植入点，自上而下：

1. **判定层**（既有 `codexOverrides` 的中和循环内，CS4 负责）：残留键为 `model_catalog_json` 且 provider 行不自带该键、且路由为 responses（显式或缺省——D4 允许集的**消费点在此**，CS1 的纯函数接收已判定的路由）时，进入合成分支；其余残留照旧拒绝或中和。
2. **合成层**（新纯函数 `catalogEntry(card, official|null) -> { json, degraded }`，CS1 负责，无 IO）：provider 钉死的 `model` 名命中**规范化后的**探针条目 → 官方条目 + **第三方改写清单**（照抄参考实现 codex_official_model_entry 的强制项，缺一不可）：`slug` ← 钉死模型名、`priority` ← 1000+序、`visibility` ← `"list"`、`service_tiers`/`additional_speed_tiers` ← `[]`、`availability_nux`/`upgrade` ← `null`、`use_responses_lite` ← `false`（真实 bundled 行带此字段且为官方账号专属协议标记，不改写会让 codex 把第三方端点当 Responses Lite 网关）、`display_name` 按 alias 规则、**条件窗口改写**——provider 行显式配 `model_context_window` 时 `context_window` 与 `max_context_window` 同时 ← 该值（codex 把前者钳制到后者，陈旧的官方上限会静默砍掉用户的显式窗口）；其余字段与规范化探针输出逐字段一致。未命中 → 中性模板条目（模板常量 + 模型名 + `context_window` 与 `max_context_window` **配对**取 provider config 值或 128000 缺省——不配对则模板 max 262144 会把更大的窗口钳回去），`degraded=true`。
3. **探针层**（`bundledModels(machine) -> catalog|null`，CS2 负责）：在**启动目标机**上执行 `codex debug models --bundled`，解析 JSON，**规范化**（照抄参考 normalize_codex_native_rows：从 vendored 模板回填 parser 必需字段 `supports_reasoning_summaries`/`supports_parallel_tool_calls`——codex 0.148.0 缺后者即拒整个目录，其 #6661——及 `base_instructions`，弃无效行），按机缓存（会话内复用；失败/缺 codex/PATH 空返回 null，不抛）。**可回填的行计为命中，不可回填的计为未命中**。**环境对齐**：探针的解析环境必须与启动一致——RC 模式开启时探针走 `bash -lic` 包装（与启动同形态），否则裸 exec；两环境仍可能解到不同二进制（novel-4），以 spike 验证收口（CS2 DoD）。
4. **植入层**（CS3 负责，spawn 前）：**在 launch 闭包内、argv 构建前**经 exec 预植目录 JSON——**先写同目录 `.part` 再原子换名**（`cat > "$dest.part" && mv "$dest.part" "$dest"`，POSIX rename 原子性：并发启动互见旧文件或新文件、永不见半写；上游证据：codex 启动期单次 `read_to_string`、无锁无重试，撕裂读窗口真实存在且换名即消除）到 `$TMPDIR/.herdr-codex-catalog-<providerSlug>.json`（handoffFile 同款预植模式；写入失败 → 此处抛出、拒绝启动、_best-effort 清除 `.part`——真正的启动期拒绝，而非 tab 已开后才死）；成功后 argv 仅携带 `-c model_catalog_json=<该路径>`——目录 JSON 不上命令行、不进 terminals.json 永久记录。

数据流：源库 provider 行（model、wire_api、context window 配置）+ 目标机 live 文本 → 判定 → 条目 → 目标机临时文件（预植）→ `-c` 覆盖。凭证通道（env key / RAM handoff）不变。

## key-decisions-rationale（关键决策与理由）

决策包（推荐先行；决策权：用户，结果轴人工确认，本节为过程轴记录）：

**D1 官方条目来源 = 目标机探针，不 vendor 官方表。**
推荐：`codex debug models --bundled` 按机探针 + 缓存，**解析环境与启动形态对齐**（RC 开 → bash -lic；否则裸 exec）；探针失败回退中性条目并标记 degraded。
理由：探针输出与将被启动的 codex 二进制**同版本**，schema 天然同步——比任何 vendor 表都抗漂移；cc-switch 运行时同源探针。已知陷阱：非登录环境 PATH 找不到 codex（cc-switch #9764/#8653）——herdr exec 承载 app 进程环境而非登录 shell（本 mod 自己的 RC 文档即此事实的另一面：word-vector exec 解析 FUNCTIONS 不解析 ALIASES），故环境对齐是必要条件而非优化；对齐后仍解不到（桌面启动器的窄 PATH）→ 中性回退兜底，spike（CS2）量化该路径的触发面。
替代：vendor 一份官方表快照（缺点：与机上 codex 版本脱钩，漂移自担）。成本：探针每次冷启一条 exec（缓存后仅一次）。回滚：删探针即回 vendor 姿势或拒绝。

**D2 第三方条目 = vendor 一份中性模板（MIT 署名）。**
推荐：vendor cc-switch 的 `codex_native_responses_template.json`（1.1KB），文件头注明出处仓库、commit、MIT 许可。
理由：模板的约束是 codex 知识（native 网关拒 custom 工具 → 无 freeform apply_patch、`shell_type="shell_command"`、保守 reasoning 档位 none/high、`supports_parallel_tool_calls=false`），自写同约束条目与 vendor 的差异只在署名与保真——vendor 更忠实，MIT 无法律障碍。
替代：按其注释自写（去 vendor 依赖，代价是保真责任自担）。成本：一个常量文件。回滚：删常量即回到拒绝分支。

**D3 投递 = spawn 前预植 + 确定性路径 + 原子换名（上游研究后升级）。**
推荐：launch 闭包内 exec 预植——写 `.part` 后 `mv` 到 `$TMPDIR/.herdr-codex-catalog-<providerSlug>.json`，argv 只带最终路径；写入/换名失败启动期拒绝并清除 `.part`。
理由（含上游证据）：与 failure-modes 的"拒绝启动"承诺自洽；argv 只带路径使目录 JSON 完全不进 terminals.json 永久记录。**并发裁决的证据**：codex 对目录是启动期**单次** `fs::read_to_string`、无锁、无重试、解析值内传不保留路径（openai/codex main：ConfigToml 注释 "applied on startup only"；load_catalog_json 无 exists 检查无回退）——直接覆写确定性路径在同 provider 并发启动时存在真实的撕裂读窗口（读到截断半文件 → 解析硬错误 → 启动 abort）；同目录 write-temp + rename 的原子性消除该窗口且保留确定性地址。**先例勘误**：cc-switch 用唯一临时名 + 显式失败/会话清理（terminal_launch.rs）——与本设计的原子换名是同一并发问题的两种正确解。
替代：mktemp 唯一名 + 显式清理（更贴先例，代价是不可寻址 + 清理状态机）。回滚：还原 argv 形态即可。

**D4（ODP，resolve-now，已裁决待用户确认）profile 覆盖面 = 仅 responses（显式或缺省）。**
推荐：合成分支仅对 wire_api 为 responses（含缺省——codexArgv 已缺省补 `'responses'`）的路由开放；chat 类到不了门（classify 即拒），其余异类路由**维持拒绝**。
理由：允许集里写 chat 是死机器（novel-8 核实：providers.js classifyCodex 对 `"chat"` 判 router）；本 mod 的可启动 codex provider 全部走 responses 或缺省。错误方向保持"少放行"。成本：无（收窄的是不可达分支）。回滚：若未来 classify 放开 chat，按参考实现的 CHAT_WIRE_APIS 六种拼写扩集合。

**D5（ODP，resolve-now，已裁决待用户确认）窗口类残留按键拆分。**
推荐：`model_context_window` 残留在合成激活时从条目 `context_window` 字段 `-c` 设值（官方改写条目自带；中性模板用 config 值或 128000）；`model_auto_compact_token_limit` **维持拒绝**。
理由：真实 bundled 行不含 `auto_compact_token_limit` 字段（本机实捕），条目无源；参考实现的 Neutral::top 对该键无分支 → Uncovered → 即使有目录也照拒（novel-5 两重核实）。为一个无源值发明 window*9/10 是猜测。回滚：查明 codex 语义后单独开 ODP。

**方案对局**（本文只存档结论，论证过程见会话审计）：(b) 上游每 provider 目录文件 = 真解耦，提请后等待，不阻塞本设计；(c) 维持拒绝 = 零成本零能力。选 (a) 作为过渡由用户裁决（高频使用非 current provider 成立则值得背耦合）。

## cross-boundary-contracts（跨界契约与验收）

公开边界（AC 以 `— seam:` 尾注声明，供 parallel-development Phase-0 锁定）：

- AC1：指针机上非 current provider（responses 路由）启动通过，argv 含 `-c model_catalog_json=<临时路径>`，临时文件内容为单条目目录 — seam: launchArgv-return
- AC2：模型名命中官方条目时，临时文件中的条目 = 规范化探针条目 + layering #2 改写清单（slug/priority/visibility/service_tiers/additional_speed_tiers/availability_nux/upgrade/use_responses_lite/display_name + 条件窗口改写），**其余字段逐字段一致** — seam: catalog-entry-builder
- AC3：探针失败（codex 缺失/PATH 空/输出坏/行不可回填）时启动仍通过，条目为中性模板且其 `context_window`/`max_context_window` 配对取 provider 行的 `model_context_window`、否则 128000，degraded 记录在案 — seam: bundled-probe
- AC4：植入在 spawn 前经 exec 完成（写 `.part` + 原子换名到最终路径）；写入失败 → 启动拒绝 + 诚实句 + `.part` 清除；三种 argv 形态（plain/rc/handoff）均只携带路径不携带 JSON — seam: launch-wrapper-write
- AC5：D4 之外的路由 profile 照旧拒绝；provider 行自带目录指针且**跨机**启动照旧拒绝（诚实句点名源机路径悬空）— seam: launchArgv-return
- AC6：既有 rig 40 组全绿（回归），新增合成分支用例覆盖 AC1–AC5，含探针子命令的 stub 用例 — seam: cross-cutting（覆盖 launchArgv-return / catalog-entry-builder / bundled-probe / launch-wrapper-write 四边界）
- AC7：改动后 `provider-menu/mods/provider-menu/providers.js` 与 `agent-menu/mods/agent-menu/providers.js` diff 为空（字节一致）— seam: cross-cutting

## parallel-boundaries（并行边界）

实现工作包（executable subset，供下游排队）：CS1 条目构建纯函数（**不含 profile 门**——接收已判定路由，门在 CS4）与 CS2 探针+缓存+环境对齐互不依赖，为第一波并行组；CS3 预植投递依赖 CS1；CS4 门改接（D4 允许集消费点、D5 拆分、行内指针跨机拒绝）依赖 CS1+CS3；CS5 rig 集成 + twin 字节一致 diff + 探针 stub 用例依赖 CS2+CS4；CS6 文档（RECIPE Watch out、REVIEW 增补、模板出处注记）依赖 CS5。

## failure-modes（失败模式）

- 探针失败 → 中性条目回退 + degraded 披露（不静默：REVIEW 与 launch 记录）；桌面启动器窄 PATH 下这可能成为常态（D1 spike 量化），届时官方名模型走通用前言（对 GPT 名即官方前言被替换的已知降级），披露明说。
- 官方条目未命中（模型改名/私有名）→ 同上回退。
- 探针输出 schema 漂移 → 解析防御式（parser 必需字段缺失先按规范化回填，仍缺才视为未命中），不抛不崩。
- 预植写入失败 → **启动期拒绝** + 诚实句（"could not stage the model catalog: …"）+ 半写清除，无半启动状态。
- profile 误判 → D4 只放行 responses 且 chat 类在 classify 已拒，错误方向是"少放行"而非"错放行"。
- provider 行自带目录指针 + 跨机 → 拒绝 + 诚实句（源机路径在目标机悬空）。**已获上游证据**：缺失文件是硬错误——load_catalog_json 无 exists 检查、无回退，`?` 直接失败配置加载（openai/codex main），实证 codex-cli 0.148.0-alpha.9 开局 abort（openai/codex#38934）。同机行内指针照旧通过（路径在本机有效）。
- **目录 schema 与 codex 版本耦合且无版本契约**（#38934：必填字段 `supports_parallel_tool_calls` 在 main 被移除，一份目录跨版本可解析失败）——官方条目按构造自洽（探针与被启动者为同一二进制）；中性模板对未来的 codex 是残余风险，解析拒绝时启动可见地失败（硬错误、可恢复），REVIEW 跟踪 cc-switch 模板演进。
- 中性模板过时（codex 行为演进）→ REVIEW 纪律跟踪 cc-switch 上游模板变更（出处注记含 commit，diff 即现）；升级路径明确。

## version-strategy（版本与退出）

过渡性质是本设计的第一属性：**退出条件 = cc-switch 发布每 provider 目录文件**（上游提请，独立主张域——届时同机 `-c` 直指 provider 自带目录、跨机摆渡该文件，合成器整体删除：模板常量、探针、预植投递一并退役，中和门的 catalog 分支收敛为"自带即覆盖"）。在此之前：中性模板携带出处（仓库、commit、MIT），REVIEW 增补跟踪上游模板与 `debug models` 子命令的变更；本设计的实现提交以独立 commit 落 t12，回滚 = revert 单提交。
