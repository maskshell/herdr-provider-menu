# herdr-provider-menu（中文版）

> 本文件为中文版；英文版 [README.md](README.md) 为主版本。

herdr 的第三方 mod：在 herdr 跟踪的终端里，按 **cc-switch 管理的 provider 身份**启动 Claude Code。每个终端一个身份。并行终端互不串扰。全局配置不受影响。Codex 等 CLI 属 Phase 2。

```
cc-switch（配置真身：编辑 / WebDAV 同步）
        │  exec("sqlite3", …, {on: machine})   ← 每台机器读自己的库
        ▼
本 mod（无状态：读 → 合并 → 启动）
        │  run("tab.new", {argv: [env -u …, claude, --settings, …]})
        ▼
herdr 跟踪的终端（OSC 7501 状态、通知、agents 列表照常）
```

本 mod 使用 herdr 文档化的两条扩展路径：新建 docked mod，以及克隆出厂 mod。herdr 的规则：改动结构或代码前，先复制一份出厂布局或 mod。本 mod 把 cc-switch 的身份库接到 herdr 的执行面上。

**状态**（2026-11-19）：设计已收敛（DESIGN.md）。Phase 0（docked 面板）与 Phase 1（三层克隆：agent-menu 子菜单、my-tabs、个人布局）均通过 sandbox E2E。验证项：面板渲染；点击与数字键启动（完整 argv）；泄漏阻断 26/26 断言（T8）；非 env 形态 provider 拒启并给出提示（T10）；T4 定论——Esc 拦截不可行，故一次 Esc 关闭整个菜单，数字键按层生效。T1（WAL 并发读）、T2（settings env 优先级，真 claude 2.1.327 实测）已过。剩余：T5 真远端 E2E、T9 的 GUI 打开半场、Windows（Phase 2）。证据在 `evidence/`，过程在 REVIEW.md。

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
| `seed-cc-switch-db.py` | 验证工具：从 spec 造单 provider 测试库（全量 DDL + user_version；T9） |
| `t5-remote-prepare.sh` + `t5-remote-e2e.md` | 远端机准备 + T5 E2E 清单 |
| `p1-install.sh` | GUI 机三层安装的自检+修复（幂等；覆盖源、打布局补丁、缺克隆时打印 `do` 命令） |

## 新机安装（从本仓库）

先分清机器角色。**跑 herdr-app 窗口的 GUI 机安装 mod；只跑 core/claude 的机器只需要 DB**：本 mod 经 machine exec 现场读取目标机的 `~/.cc-switch/cc-switch.db`。**DB 的供给与同步由用户自行解决，不在本 mod（及 herdr）的业务范畴**——例如 cc-switch 官方的 WebDAV 同步，或在装有 cc-switch GUI 的机器上配置。`seed-cc-switch-db.py` 是验证工具，不是正式的建库方式。

```sh
git clone https://github.com/maskshell/herdr-provider-menu
```

### GUI 机（装三层子菜单）

```sh
cd herdr-provider-menu
herdr-app do mod.clone '{"name":"new-menu","as":"agent-menu"}'
herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'
herdr-app do layout.clone '{"name":"main"}'    # 尚无个人布局时执行；随后在 app 里切换到该布局
sh scripts/p1-install.sh                        # 覆盖源 + 给个人布局打 tabs 补丁（幂等）
```

随后**完全退出并重开 Herdr**：覆盖后的源在启动时加载。隔离测试时，给脚本传 `HERDR_APP_HOME=<目录>`。手动等价步骤：两个 `mod.clone` 之后，`cp agent-menu/{main.js,providers.js,mod.json} ~/.config/herdr-app/mods/agent-menu/`、`cp my-tabs/main.js ~/.config/herdr-app/mods/my-tabs/`，再把个人布局文件里 tabs 块的 `"mod": "tabs"` 改为 `"my-tabs"`。

安装后：标签栏 `+` 打开 agent-menu。Claude Code 行展开内联子菜单，列出该机 cc-switch 中的身份卡；每一条都是显式身份。当前卡带 `current` 徽标。灰显行为非 env 形态：点击显示说明提示，不启动。原样启动（live 槽）保留在顶层——子菜单收起时，按 Claude 行的数字键即原样启动 claude。数字键按层生效（子菜单内 1.. 为 providers）。Esc 一次关闭整个菜单（app 级键绑定；REVIEW Pass 7/T4）。

面板为每台机器提供两个设置行。`args` 行存储持久附加参数（shell 引号分词；例如 `--allow-dangerously-skip-permissions`）。本 mod 把这些参数追加到每次启动，面板与子菜单相同。参数由用户显式记录；本 mod 自身不添加任何旗子。记录在面板与启动 argv 中保持可见。`rc profile` 行默认关闭。开启后，启动变为 `bash -[l]ic` 命令串，由 shell profile 解析 `claude`。alias 与 function 均生效（词向量只能携带函数）。举例：`claude()` 函数中设置环境变量或追加参数，同样作用于本 mod 的启动。rc 模式下，profile 即信任边界——它先于 claude 运行，可以改变环境。

### 可选 Phase 0 侧栏面板

`cp -r mod/ ~/.config/herdr-app/mods/provider-menu/`；面板以 280px 停靠进个人布局。另一方式：复制 `layouts/main-providers.json` 到 `~/.config/herdr-app/layouts/`——该布局自带停靠好的面板。

### 无头/core 机（只造 DB）

正式使用：通过 cc-switch 官方同步（WebDAV）把 DB 带到该机，或在装有 cc-switch GUI 的机器上配置一次各 profile。每个 profile 须包含 `CLAUDE_CODE_*` 调优键——它们按 provider 各自配置（见 REVIEW Pass 7）。机器需要系统 `sqlite3`；缺失时菜单显示安装提示，而非空白列表。

仅供测试（T9）：`python3 scripts/seed-cc-switch-db.py ~/.cc-switch/cc-switch.db --spec <spec.json>` 从 spec 造单 provider 测试库（全量 DDL + user_version）。

## 克隆基线

`agent-menu/`、`my-tabs/` 是工作副本，克隆自 herdr-app 出厂 `new-menu`/`tabs`（@ `4deb605`）并在此扩展（子菜单层；7 行 `+` 补丁）。出厂 mod 在上游持续更新。herdr-app 升级后，重新执行 `mod.clone` + `p1-install.sh` 以重新套用。出厂件由 Herdr 更新；用户副本保持不变。

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
