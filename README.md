# herdr-provider-menu

**English** | [简体中文](README.zh-CN.md)

Start Claude Code and Codex in [Herdr](https://github.com/herdrdev/herdr-app) with a provider identity from [cc-switch](https://github.com/farion1231/cc-switch). Each terminal uses one provider. Terminals running side by side do not affect each other. The global configuration stays untouched. One terminal can run DeepSeek while the one next to it runs Kimi. A session can also be copied to another machine with its workspace (regenerables stay behind) and resumed there under any provider of that harness the mod can launch.

Claude Code and Codex are verified in the sandbox and on real machines (macOS and Linux), including cross-machine launches. Session copies are verified end to end on real machines for Claude Code; the codex side is rig-verified and its resume argument matches codex 0.172.0's documented form (`resume <id> <prompt>`); a real-codex round is still pending. Windows is not supported yet. [DESIGN.md](DESIGN.md) explains how the mod works, its decisions, and its security posture. [REVIEW.md](REVIEW.md) records the verification.

<p><img src="agent-menu/preview.png" width="258" alt="The + menu with a provider submenu"></p>

<p><img src="provider-menu/preview.png" width="403" alt="The docked provider panel"></p>

The repo holds two packages, each listed on herdr.dev/mods with its own recipe and preview: `agent-menu/` (the `+` popup, two mods) and `provider-menu/` (the docked panel).

## Requirements

- Herdr, the desktop app. This is a Herdr mod, not a standalone app.
- cc-switch, with providers configured in it. cc-switch stays the only place to edit providers. The mod only reads its database.
- sqlite3 on each machine that shows a provider menu. macOS ships it. On Linux run `sudo apt install sqlite3`.
- The CLIs themselves. Install `claude` and `codex` on the machines where they run.

## Install

Run this on the GUI machine, the machine that shows the Herdr window:

```sh
git clone https://github.com/maskshell/herdr-provider-menu && cd herdr-provider-menu
sh scripts/p1-install.sh    # mods in, a main clone named after you built, the panel docked (idempotent)
```

Then quit Herdr completely and open it again (the script switches you there when Herdr cannot be driven live). The tab-bar `+` opens the menu. The Claude Code and Codex rows expand into the cc-switch providers of that machine. Each entry is one explicit identity. The digit key on a row still starts the CLI as-is.

Installing from herdr.dev/mods instead of a checkout works too: copy each package's `mods/*` into `~/.config/herdr-app/mods/` (the recipe files describe the few extra steps, such as the `+` wiring and the panel's layout block).

### The side panel

The panel docks into personal layouts at 280px and gives:

- The cc-switch providers of each harness, in stacked sections that fold.
- A close ✕ in the header and a "Providers" pill in the tab bar: the panel hides and comes back, and the state survives restarts. A key does the same (`alt-p`; `cmd-shift-b` on macOS — `alt` is the option key there and ⌥P types π).
- An `args` row per machine: persistent extra parameters, for example `--allow-dangerously-skip-permissions`. The mod itself adds no parameter. The recorded row is the only way one enters a launch.
- An `rc profile` row per machine: run launches through the shell profile, so shell aliases and functions apply. Off by default.
- An `mcp` row per machine: cross-machine launches also carry the MCP servers cc-switch has enabled here for that agent — Claude and Codex keep their own sets, and `only mine` makes the session use just the carried set. Same-machine launches never carry; the machine's own cc-switch has already written its set into the live config.
- A `COPY SESSION  STAGE ›` row at the very bottom: stage the focused Claude Code or Codex session, then copy — or delta-update — the session's workspace to a directory on another machine (regenerables stay behind) and resume it there under any provider of that harness the mod can launch.

The panel keeps the machine it last refreshed from. The refresh button shows the machine the shown lists came from and re-reads the active space's machine.

Codex providers also launch on machines whose live `config.toml` keeps a cc-switch catalog pointer (`model_catalog_json`): the launcher synthesizes a single-model catalog for the provider's pinned model, stages it under `$TMPDIR` before the terminal spawns, and points `-c model_catalog_json` at it. An official model name mirrors the launch machine's own `codex debug models --bundled` entry with the mutations cc-switch applies for third-party endpoints, when that probe succeeds; anything else — an unknown name or a failed probe — gets a neutral vendored entry, and the panel notes when that happened. The current provider of the machine the shown lists came from skips the live-config checks when the launch lands on that same machine — the same pass cc-switch's own terminal gives it. Outside that same-machine pass, still refused — among others — a provider with a selected cc-switch profile, a `model_auto_compact_token_limit` override, and — cross-machine only — a provider whose own config carries a catalog pointer (the path would dangle on the target). (Verified in the sandbox against a real codex 0.172.0; the real-machine round is next.)

`p1-install.sh` installs it together with the menu, docks a `provider-menu-panel` block into every personal layout, and builds a clone of Herdr's shipped `main` named after you (`main-<username>`; full-width tab bar with the reopen pill, the panel beside the terminal-and-status column). No layout file ships in this repo and nothing is copied by hand. The same toggle is bound to a key (`alt-p`; `cmd-shift-b` on macOS) in every layout the panel is docked into; Herdr reloads key bindings live. Want the menu only? Delete the block from your layout, or hide it with the key or `layout.toggle {id: "provider-menu-panel"}`.

The rc mode turns the launch into a command string under `bash -[l]ic`. The profile runs first, so aliases and functions both apply. A plain launch runs the argv directly, without a shell parse; aliases never expand there. Parameters and dynamic environment variables can therefore live in the profile instead of this mod. For example, either form works:

```sh
alias claude='workspaceFolder="$(pwd)" command claude --dangerously-skip-permissions'

claude() {
  workspaceFolder="$(pwd)" command claude --dangerously-skip-permissions "$@"
}
```

(`command` keeps the alias or the function from calling itself.)

### Copying a session to another machine

The row at the panel's bottom stages the focused agent session for a copy (a same-machine copy works the same way):

1. Focus a Claude Code or Codex terminal and click `STAGE ›`. The card names the source machine and the session's workspace.
2. Switch to a space on the target machine, open a shell there, and `cd` into an empty directory (a first copy) or the directory an earlier copy made (an update).
3. Pick that directory from the card's list, arm the checkbox (it reads `Update the session and workspace above` on an update target), and click a provider of the same harness. The workspace travels as a verified snapshot, sized for a project rather than a monorepo — regenerables (`node_modules`, `target`, `.venv`, …) stay behind and reinstall on demand, every other regular file crosses, including `.env` files and credentials (symlinks are skipped in v1; the confirm dialog names what crosses) — the transcript lands where the target's CLI looks for it, and the session resumes under the clicked provider's identity, with a first message you can edit in the confirm dialog.
4. A modal then decides the source's fate: keep it (it may drift from the copy) or stop its tab. Esc counts as keep.

Both ends carry a `.herdr-migrated` marker after a copy — the source workspace gains one too. Later copies onto the target update by delta, deletions included; the target's own edits are overwritten by the next copy (a target is a parking spot, by design), drift is counted and warned about before the run, and everything is re-hashed on the target after the transfer. `Cancel` stops a run and sweeps the temporary pack files off both machines — a first copy stopped mid-run leaves the target unmarked, so empty it before retrying, while an interrupted update retries as-is; the card's red `Clear` drops the staging itself.

### Headless machines

A headless machine runs only core and the CLIs. Install nothing on it. The menu reads that machine's own `~/.cc-switch/cc-switch.db` when it opens. Bringing the database to that machine is the user's job. Use cc-switch's own sync, WebDAV, or configure the providers from a machine with the cc-switch GUI.

A headless machine can also run without its own database. Refresh the panel while the GUI machine's space is active, switch to the headless space, and click a provider there. The identity travels inside the launch command. The panel keeps the machine it last refreshed from; launches land in the active space. To use the headless machine's own database, switch to its space and refresh.

## Update

```sh
git pull
sh scripts/p1-install.sh
```

After a Herdr update this is enough for the menu, the panel, your clone layout and the toggle key: the script creates your clone **once** (`main-<username>`; an earlier `main-providers` is renamed to it, tweaks kept) and from then on treats it as yours — your edits survive re-runs; refresh it by deleting the file and re-running (the same contract as the my-tabs fork). Layouts with their own look (a win98 clone, say) are skipped: the panel targets the main window. It never touches Herdr's own layout files (an edited shipped file is moved aside by the app as `<name>-edited(-N)` copies). `my-tabs` is a fork of the shipped tab bar, so stock tab-bar changes do not appear in it until the fork is refreshed: re-clone `tabs` as `my-tabs`, re-apply the one-line `+` change (see [agent-menu/RECIPE.md](agent-menu/RECIPE.md)), run the script again, restart Herdr.

## Uninstall

```sh
rm -rf ~/.config/herdr-app/mods/agent-menu ~/.config/herdr-app/mods/my-tabs ~/.config/herdr-app/mods/provider-menu
herdr-app do layout.switch '{"name":"main"}'
```

These commands return to the shipped layout. Delete the personal layout file under `~/.config/herdr-app/layouts/` when it is no longer wanted. The recorded `args` and `rc profile` values stay in Herdr's shared state. They do nothing once the mods are gone. Also remove the `alt-p` binding (`cmd-shift-b` on macOS) the script added under the `layout:<name>` section in `~/.config/herdr-app/keys.json`. A personal layout kept on disk still carries the panel and toggle blocks and its wrapped tab bar; delete the file, or remove those two nodes and unwrap the tab bar, to clean it fully.

## Limits

- Windows is not supported as the GUI machine or as a launch target yet: the launch commands use `env`, `bash`, and `/dev/shm` (Windows recipes are pending); launching from a Windows space shows an explanation dialog. A Windows machine works as a database source — reading its cc-switch.db only needs sqlite3 there.
- Some providers work only through cc-switch itself: official OAuth accounts, and formats that need the local router. They appear grey, with the reason. The mod never launches them.
- The mod never adds `--dangerously-skip-permissions` or any other flag by itself. A flag enters a launch only through the recorded `args` row.
- Credentials reach the CLI through a RAM-only handoff where the machine allows it: an exec plants the secret in a 0600 file under `/dev/shm`, the terminal command only reads that path and deletes the file at once, and nothing lands on disk or in the recorded command. Machines without `/dev/shm` (macOS) fall back to the credential riding in the launch command itself. There, herdr's core records the command — including the credential — in its state file `~/.local/state/herdr-core/<session>/terminals.json`, with no automatic cleanup, and a first cross-machine launch asks for confirmation per machine pair. Live sessions show the fallback command in `/proc`. DESIGN.md §6 has the details.
- Environment keys that exist only in the live settings file (`~/.claude/settings.json`) are blocked on each launch. Put tuning keys such as `CLAUDE_CODE_*` on each provider in cc-switch, not only in the live file.
- Carried MCP definitions can hold tokens in their env. They travel the same RAM-only handoff as credentials; on a machine without /dev/shm they ride the launch command (the cross-machine dialog asks first), and the definitions sit on the launched process's command line for as long as it lives. On the target the carried set merges with the machine's own definitions — on the same name, the carried one wins for that session.
- A session copy writes the workspace's files to the target machine's disk — `.env` files and credentials included; the confirm dialog names this before the run. The launch credential channels above do not cover workspace contents, and the transfer's chunks ride exec command lines, so file contents are briefly visible in the receiving machine's process list while the copy runs.
- On a headless machine the database is the user's job. `scripts/seed-cc-switch-db.py` is a verification tool, not a provisioning path.

## Further reading

- [README.zh-CN.md](README.zh-CN.md), the same manual in Chinese.
- [agent-menu/RECIPE.md](agent-menu/RECIPE.md) and [provider-menu/RECIPE.md](provider-menu/RECIPE.md): the two packages as they appear on herdr.dev/mods.
- [DESIGN.md](DESIGN.md): architecture, launch recipes, security, tests, and the scripts reference.
- [REVIEW.md](REVIEW.md): the verification log. The evidence sits in `evidence/`.
- [LICENSE](LICENSE), MIT.
