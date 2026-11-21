# herdr-provider-menu

[English](README.md) | **简体中文**

在 [Herdr](https://github.com/herdrdev/herdr-app) 里以 cc-switch 管理的供应商身份启动 Claude Code 与 Codex。每个终端使用一个供应商。并行终端互不影响。全局配置保持不变。一个终端用 DeepSeek，旁边的终端用 Kimi，都可以。

Claude Code 与 Codex 已在 sandbox 与真机(macOS、Linux)验证，含跨机启动。Windows 暂不支持。[DESIGN.md](DESIGN.md) 说明工作原理、设计决策与安全姿态；[REVIEW.md](REVIEW.md) 记录验证过程。

![带供应商子菜单的 + 菜单](agent-menu/preview.png)

![停靠的供应商面板](provider-menu/preview.png)

仓库含两个包，各自以独立条目(附配方与预览图)列于 herdr.dev/mods：`agent-menu/`(+ 弹窗，两个 mod)与 `provider-menu/`(停靠面板)。

## 依赖

- Herdr 桌面应用。这是一个 Herdr mod，不是独立应用。
- cc-switch，并在其中配好供应商。cc-switch 仍是编辑供应商的唯一入口。本 mod 只读它的数据库。
- 每台显示供应商菜单的机器装有 sqlite3。macOS 自带。Linux 上执行 `sudo apt install sqlite3`。
- CLI 本体。`claude` 与 `codex` 装在它们运行的机器上。

## 安装

在 GUI 机上执行，即显示 Herdr 窗口的机器：

```sh
git clone https://github.com/maskshell/herdr-provider-menu && cd herdr-provider-menu
herdr-app do layout.clone '{"name":"main"}'    # 尚无个人布局时执行；随后在 app 里切换到该布局
sh scripts/p1-install.sh                        # 安装三个 mod 并停靠面板(幂等)
```

然后完全退出 Herdr 并重开。标签栏 `+` 打开菜单。Claude Code 行与 Codex 行各自展开该机的 cc-switch 供应商。每一条是一个显式身份。行上的数字键仍按原样启动 CLI。

不经 checkout、直接从 herdr.dev/mods 安装也可以：把各包的 `mods/*` 复制进 `~/.config/herdr-app/mods/`(配方文件说明了少数额外步骤，例如 `+` 按钮的接线和面板的布局块)。

### 侧栏面板

面板以 280px 停靠进个人布局，提供：

- 各 harness 的 cc-switch 供应商列表，按堆叠区块分组，可折叠。
- 每机一个 `args` 行：持久附加参数，例如 `--allow-dangerously-skip-permissions`。本 mod 自身不添加任何参数。参数进入启动的唯一途径是这个被记录的行。
- 每机一个 `rc profile` 行：经 shell profile 运行启动，shell 的 alias 与 function 因此生效。默认关闭。

面板记住上次刷新所用的机器。刷新按钮显示所示列表的来源机器，并按当前 space 的机器重读。

`p1-install.sh` 把它与菜单一并安装，并在每个个人布局里停靠一个 `providers` 块。`layouts/main-providers.json` 是带停靠面板的完整示例布局。只想要菜单？从布局里删掉该块，或用 `layout.toggle {id: "providers"}` 隐藏(个人键位可以绑定该命令，例如 `"ctrl-shift-p": "layout.toggle:providers"`)。

rc 模式把启动改为经 `bash -[l]ic` 执行的命令串：profile 先运行，alias 与 function 都会生效。普通启动不经 shell 解析，alias 从不展开。参数与动态环境变量因此可以放进 profile，而不必依赖本 mod。例如，两种写法都可以：

```sh
alias claude='workspaceFolder="$(pwd)" command claude --allow-dangerously-skip-permissions'

claude() {
  workspaceFolder="$(pwd)" command claude --allow-dangerously-skip-permissions "$@"
}
```

(`command` 防止 alias 或函数递归调用自身。)

### 无头机

无头机只运行 core 与 CLI。无头机上不需要安装。菜单打开时读取该机自己的 `~/.cc-switch/cc-switch.db`。把数据库带到该机由用户自行解决。用 cc-switch 自带的同步(WebDAV)，或在装有 cc-switch GUI 的机器上配置。

无头机也可以没有自己的数据库。在 GUI 机的 space 里刷新面板，切到无头机的 space，在那里点击供应商即可。身份随启动命令本身传递。面板记住上次刷新所用的机器；启动落在当前 space。要用无头机自己的数据库，切到它的 space 再刷新。

## 更新

```sh
git pull
sh scripts/p1-install.sh
```

Herdr 升级后，这样对菜单与面板就已足够。`my-tabs` 是出厂标签栏的分叉，出厂标签栏的改动要等分叉刷新才会出现：把 `tabs` 重新克隆为 `my-tabs`，重打那一行 `+` 接线(见 [agent-menu/RECIPE.md](agent-menu/RECIPE.md))，再执行脚本并重启 Herdr。

## 卸载

```sh
rm -rf ~/.config/herdr-app/mods/agent-menu ~/.config/herdr-app/mods/my-tabs ~/.config/herdr-app/mods/provider-menu
herdr-app do layout.switch '{"name":"main"}'
```

以上命令执行后回到出厂布局。不需要的个人布局文件(`~/.config/herdr-app/layouts/` 下)可以删除。记录过的 `args` 与 `rc profile` 值留在 Herdr 共享状态里。mod 移除后它们不再起作用。

## 制约

- Windows 暂不支持作为 GUI 机或启动目标：启动命令使用 `env`、`bash` 与 `/dev/shm`（Windows 配方是待做的 T3）；从 Windows space 启动会显示解释弹窗。Windows 机器可以作为数据库源——读取它的 cc-switch.db 只需要那台机器装有 sqlite3。
- 某些供应商只能经 cc-switch 本身运行：官方 OAuth 账号，以及需要本地路由的格式。它们灰显并注明原因。本 mod 不启动它们。
- 本 mod 绝不自行添加 `--dangerously-skip-permissions` 或任何其他参数。参数只能经用户记录的 `args` 行进入启动。
- 凭据经内存交接送达 CLI（机器支持时）：一次 exec 把凭据写入 `/dev/shm` 下的 0600 文件，终端命令只读取该路径并随即删除文件——不落盘，也不进被记录的启动命令。无 `/dev/shm` 的机器（macOS）回落为凭据随启动命令本身传递：此时目标机上的 herdr core 会把启动命令（含凭据）记录进状态文件 `~/.local/state/herdr-core/<会话>/terminals.json`，且无自动清理；跨机借用的首次启动会按机器对弹窗确认。回落形态下，活会话期间命令也出现在 `/proc` 里。细节见 DESIGN.md §6。
- 仅存在于 live 设置文件(`~/.claude/settings.json`)里的环境变量键会被逐次启动挡掉。`CLAUDE_CODE_*` 等调优键应配在各供应商上(cc-switch 里)，而不是只写在 live 文件里。
- 无头机上，数据库由用户自行解决。`scripts/seed-cc-switch-db.py` 是验证工具，不是建库方式。

## 延伸阅读

- [README.md](README.md)，英文主版本。
- [agent-menu/RECIPE.md](agent-menu/RECIPE.md)与[provider-menu/RECIPE.md](provider-menu/RECIPE.md)：两个包在 herdr.dev/mods 上的条目内容。
- [DESIGN.md](DESIGN.md)：架构、启动配方、安全、测试与 scripts 说明。
- [REVIEW.md](REVIEW.md)：验证记录。证据在 `evidence/`。
- [LICENSE](LICENSE)，MIT。
