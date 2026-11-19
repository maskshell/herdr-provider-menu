# herdr-provider-menu（中文版）

> 本文件为中文版；英文版 [README.md](README.md) 为主版本。

herdr 的个人 mod：在终端里按 **cc-switch 管理的 provider 身份**启动 Claude Code（后续：Codex 等）。每个终端一个身份，并行互不串扰，不碰任何全局配置。

```
cc-switch（配置真身：编辑 / WebDAV 同步）
        │  exec("sqlite3", …, {on: machine})   ← 每台机器读自己的库
        ▼
本 mod（无状态：读 → 合并 → 启动）
        │  run("tab.new", {argv: [env -u …, claude, --settings, …]})
        ▼
herdr 跟踪的终端（OSC 7501 状态、通知、agents 列表照常）
```

**状态**（2026-11-19）：设计已收敛（DESIGN.md）。Phase 0（docked 面板）与 Phase 1（三层克隆：agent-menu 子菜单 + my-tabs + 个人布局）均已通过 sandbox E2E：面板渲染、点击与数字键启动（完整 argv）、泄漏阻断 26/26 断言（T8）、非 env 形态 provider 拒启带提示（T10）、T4 定论（Esc 拦截不可行——一次 Esc 全关，数字键按层作用域）。T1（WAL 并发读）、T2（settings env 优先级，真 claude 2.1.327 实测）已过。剩余：T5 真远端 E2E、T9 的 GUI 打开复验、Windows（Phase 2）。证据在 `evidence/`，过程在 REVIEW.md。

## 目录

| 路径 | 内容 |
|---|---|
| `DESIGN.md` | 完整设计：架构分工、读/启动路径、UI 集成、安全、ADR |
| `REVIEW.md` | 收敛评审记录 + 开放验证项（T0–T10） |
| `mod/` | Phase 0：docked 面板（`place: right`，280px） |
| `agent-menu/` | Phase 1：new-menu 克隆源（Claude 行 provider 子菜单） |
| `my-tabs/` | Phase 1：tabs 克隆源（`+` 改开 agent-menu，7 行补丁） |
| `layouts/` | 示例个人布局（`main-providers.json` = 出厂 main + 面板停靠） |
| `scripts/` | 可复现测试与工具（见下） |
| `evidence/` | sandbox 验证截图 + 启动 dump |

## scripts/

| 脚本 | 用途 |
|---|---|
| `t1-wal-test.sh` | WAL 活跃库 `sqlite3 -readonly` 读取正确性（5 案例） |
| `t2-precedence-probe.sh` + `t2-server.py` | 真 claude 优先级/泄漏探针（localhost 回显服务器、假 token） |
| `seed-cc-switch-db.py` | 无头机 seed cc-switch DB（全量 DDL + user_version，GUI 零迁移打开） |
| `t5-remote-prepare.sh` + `t5-remote-e2e.md` | 远端机准备 + T5 E2E 清单 |
| `p1-install.sh` | GUI 机三层安装的自检+修复（幂等；覆盖源、打布局补丁、缺克隆时打印 `do` 命令） |

## 新机安装（从本仓库）

先分清机器角色：**跑 herdr-app 窗口的 GUI 机装 mod；跑 core/claude 的机器只要 DB**（mod 经 machine exec 现场读那台机的 `~/.cc-switch/cc-switch.db`，无头机用 `seed-cc-switch-db.py` 造，装有 cc-switch GUI 的机器不用管）。

```sh
git clone https://github.com/maskshell/herdr-provider-menu
```

### GUI 机（装三层子菜单）

```sh
cd herdr-provider-menu
herdr-app do mod.clone '{"name":"new-menu","as":"agent-menu"}'
herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'
herdr-app do layout.clone '{"name":"main"}'    # 还没有个人布局时；并在 app 里切过去
sh scripts/p1-install.sh                        # 覆盖源 + 给所有个人布局打 tabs 补丁（幂等）
```

然后**完全退出并重开 Herdr**（mod.clone 后覆盖的源要 restart 才加载）。隔离测试 home 时给脚本传 `HERDR_APP_HOME=<目录>`。手动等价步骤：两个 `mod.clone` 后，`cp agent-menu/{main.js,providers.js,mod.json} ~/.config/herdr-app/mods/agent-menu/`、`cp my-tabs/main.js ~/.config/herdr-app/mods/my-tabs/`，再把布局 json 里 tabs 块的 `"mod": "tabs"` 改 `"my-tabs"`。

可选 Phase 0 侧栏面板：`cp -r mod/ ~/.config/herdr-app/mods/provider-menu/`（个人布局 dock，280px）；或直接复制 `layouts/main-providers.json` 到 `~/.config/herdr-app/layouts/` 得到带面板的现成布局。

装好后：标签栏 `+` 打开 agent-menu；Claude Code 行尾 `N ▸`，点击展开 provider 子菜单（Default = live 槽，之后是 cc-switch 里这台机的 providers；灰显行是 endpoint/apiKey 形态，点了给提示不启动）。数字键按层：顶层 1-9 直启已装 agent；子菜单内 1=Default、2..=providers。Esc 一次关整个菜单（app 级键绑定，mod 拦不了——REVIEW.md Pass 7/T4）。

### 无头/core 机（只造 DB）

```sh
python3 scripts/seed-cc-switch-db.py ~/.cc-switch/cc-switch.db --spec <spec.json>
```

spec 的 `providers[].settings` = 该机 live `~/.claude/settings.json` 的 **env 全量**（含 `CLAUDE_CODE_*` 调优——per-provider，见 REVIEW Pass 7"真机 seed 修正"）+ `model`；机器须有系统 `sqlite3`（mod 用 `sqlite3 -readonly -json` 读，缺失时菜单会给装包提示行）。

## 克隆基线

`agent-menu/`、`my-tabs/` 是从 herdr-app 出厂 `new-menu`/`tabs`（@ `4deb605`）克隆后扩展的工作副本（子菜单层；7 行 `+` 补丁）。出厂件在上游持续更新：herdr-app 升级后重跑 `mod.clone` + `p1-install.sh` 重新套用。出厂件由 Herdr 更新，你的克隆属于你。

## 验证（按序）

```sh
# 1. 构建 herdr-app（需要 Rust 1.95 + zig 0.16）
cd ../herdr-app && just build

# 2. 语法/初始渲染
./target/debug/herdr-app check ../herdr-provider-menu/mod

# 3. sandbox 全链路（UI 一律在 sandbox 里，绝不在真实环境跑裸 app）
scripts/sandbox up
scripts/sandbox do layout.clone '{"name":"main"}'   # shipped 布局不停靠
scripts/sandbox do space.new '{}'                    # 空 home 需先建 space
scripts/sandbox shot
```

sandbox 备忘（完整版见 REVIEW.md Pass 5）：`up` 前先 `mkdir -p /var/tmp/herdr-app-sandbox/state`（脚本不建，缺了会 toast 风暴）；`down` 杀不掉 core 进程对，残留 socket 会让下次 up 卡死——手动杀 `pgrep -f herdr-app-sandbox.*herdr-core` 并删 `/run/user/1000/herdr-core/herdr-app-sandbox*.sock`；欢迎浮层挡点击且外部关不掉，正解是停窗后向 `home/shared.json` 写 `"frame.welcomed"`；input 命令依赖 uv，无 uv 时 `apt-get install python3-xlib` 后直接 `python3 scripts/sandbox-input.py <cmd> …`。

## 许可

MIT，见 [LICENSE](LICENSE)。
