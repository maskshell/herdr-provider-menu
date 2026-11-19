# herdr-provider-menu

Launch Claude Code and Codex in herdr terminals under a **cc-switch-managed provider identity**. Each terminal gets one identity. Parallel terminals do not cross-talk. Global configuration stays untouched. Other CLIs may follow.

```
cc-switch (config truth: GUI editing / WebDAV sync)
        │  exec("sqlite3", …, {on: machine})   ← each machine reads its own DB
        ▼
this mod (stateless: read → merge → launch)
        │  run("tab.new", {argv: [env -u …, claude, --settings, …]})
        ▼
a herdr-tracked terminal (OSC 7501 status, notifications, agents list as usual)
```

The mod uses the two extension paths that herdr documents: a new docked mod, and a clone of a shipped mod. herdr's rule: duplicate a shipped layout or mod before changing its structure or code. The mod connects cc-switch's identity store to herdr's execution surface. 中文文档: [README.zh-CN.md](README.zh-CN.md).

**Status (2026-11-19)**: design converged (DESIGN.md). Phase 0 (docked panel) and Phase 1 (three-layer clone: agent-menu submenu, my-tabs, personal layout) pass sandbox E2E. Panel render; launch by click and by digit key, with the full argv; leak-blocking with 26/26 assertions (T8); refusal of non-env providers with a note (T10); T4 closed — Esc interception is not possible, so one Esc closes the menu and digit keys act per layer. T1 (WAL concurrent reads) and T2 (settings-env precedence, against real claude 2.1.327) are verified. Codex support (Phase 2) mirrors cc-switch's own codex terminal launcher and passes the same fixture tests; its real-machine check is pending. Remaining: T5 real-remote E2E, the T9 GUI-open half, Windows. Evidence: `evidence/`. Process: REVIEW.md.

## How it works

- The mod reads the machine's own `~/.cc-switch/cc-switch.db` with `sqlite3 -readonly -json` over `exec {on: machine}`. It makes no DB copies. The read is safe under an active WAL writer (T1).
- The mod merges the provider card over the live `~/.claude/settings.json`. Env keys that only the live file has are written `""`; claude treats an empty value as unset (verified on 2.1.327). The mod always writes `modelPicker`, so routing and aggregation menus do not leak in (T8; cc-switch's own isolated-terminal launcher uses the same recipe).
- The mod launches `env -u …×14 claude --settings <inline json>`. The identity is frozen per terminal. The terminal stays fully herdr-tracked.
- Non env-form providers (for example official OAuth accounts and routed contract cards) show grey and refuse to launch. A note states the reason (T10).
- The panel has an `args` row for each machine. The row stores extra arguments, for example `--allow-dangerously-skip-permissions`. The mod appends these arguments to every launch, from the panel and from the submenu. The user records the arguments; the mod adds no flags by itself. The record stays visible in the panel and in the launch argv.
- The panel has an `rc profile` row for each machine. The mode is off by default. When the mode is on, the launch becomes a `bash -[l]ic` command string, and the shell profile resolves `claude`. Shell aliases and shell functions both apply. Example: a `claude()` function that sets an environment variable or appends flags also applies to mod launches. In rc mode the profile is the trust boundary: it runs before claude and can change the environment.
- Codex uses the same submenu on the Codex row. The launch is `codex --no-daemon` with `-c key=value` overrides that swap the provider for this one process; `config.toml` stays untouched. The key travels in the `CC_SWITCH_CODEX_API_KEY` environment variable, never on the command line. Cards cc-switch itself cannot launch in a terminal — the official card (it follows Codex's own sign-in), router-only formats, built-ins, keyless cards — show grey with the reason. Leftover keys in the live config that no override can neutralize (example: `model_catalog_json`, `model_context_window`, extra route-table keys) also refuse, with a note to switch to the card in cc-switch first — the same refusals cc-switch's launcher makes.

## Security — read before installing

herdr mods are trusted code, not sandboxed extensions. This mod handles credentials. Its posture:

- The mod reads the cc-switch DB and the live settings file readonly, to compute drop keys. It never writes these files.
- Tokens travel inline in the launch argv and are visible through `/proc/PID/cmdline`. This trade-off is accepted. The only static copy stays in the cc-switch DB. The stricter recipe — temp file, mode 0600, deleted on exit, as upstream's launcher uses — is a Phase 3 option. Codex is stricter already: the key rides in an environment variable (`env_key`), so the codex command line carries no token.
- The mod never inherits and never adds `--dangerously-skip-permissions`. A flag enters a launch in one way only: the user records it in the `args` row. The record stays visible.
- Leak-blocking is tested end to end: 26/26 assertions in sandbox (T8), re-verified against real claude 2.1.327 (T2).

## Install

Machine roles: the GUI machine (the machine that shows the herdr-app window) gets the mods. A machine that only runs core and claude needs only the DB: the mod reads that machine's own `~/.cc-switch/cc-switch.db` over machine exec. DB provisioning and sync are the user's responsibility and outside this mod's scope — use cc-switch's own sync (WebDAV), or configure the machine once from a cc-switch GUI. `seed-cc-switch-db.py` is a verification tool, not a provisioning path.

### GUI machine (three-layer submenu)

```sh
git clone https://github.com/maskshell/herdr-provider-menu && cd herdr-provider-menu
herdr-app do mod.clone '{"name":"new-menu","as":"agent-menu"}'
herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'
herdr-app do layout.clone '{"name":"main"}'    # run when no personal layout exists yet; switch to the clone in the app
sh scripts/p1-install.sh                        # overlays sources + patches the tabs block in personal layouts (idempotent)
```

Then fully quit and reopen Herdr: overlaid sources load at start. To test against an isolated home, pass `HERDR_APP_HOME=<dir>` to the script. Manual equivalent: after the two `mod.clone`s, copy `agent-menu/{main.js,providers.js,mod.json}` and `my-tabs/main.js` into the clones under `~/.config/herdr-app/mods/`, then change `"mod": "tabs"` to `"my-tabs"` in the personal layout file.

After install: the tab-bar `+` opens agent-menu. The Claude Code row and the Codex row each show an inline submenu with this machine's cc-switch cards; every entry is an explicit identity. The current card carries the `current` badge. Grey rows are non env-form; a click shows an explanation note instead of a launch. The plain live-slot launch stays on the top level — with the submenu closed, a row's digit key starts the CLI as-is. Digit keys act per layer (in the submenu, 1.. pick providers). One Esc closes the whole menu (app-level binding; REVIEW Pass 7/T4).

### Optional Phase 0 side panel

Copy `mod/` to `~/.config/herdr-app/mods/provider-menu/`; the panel docks into personal layouts at 280px. As an alternative, copy `layouts/main-providers.json` to `~/.config/herdr-app/layouts/` — that layout comes with the panel docked.

### Headless / core machines (DB only)

Real use: bring the DB to the machine through cc-switch's own sync (WebDAV), or configure the profiles once from a machine with the cc-switch GUI. Include the `CLAUDE_CODE_*` tuning keys in each profile — they are per-provider (see REVIEW.md Pass 7). The machine needs a system `sqlite3`; when it is missing, the menu shows an install hint instead of an empty list.

Tests only (T9): `python3 scripts/seed-cc-switch-db.py ~/.cc-switch/cc-switch.db --spec <spec.json>` builds a single-provider test DB from a spec (full DDL + user_version).

## Clone baseline

`agent-menu/` and `my-tabs/` are working copies, cloned from herdr-app's shipped `new-menu`/`tabs` at herdr-app `4deb605` and extended here (the submenu layer; a 7-line `+` patch). Shipped mods keep evolving upstream. After a herdr-app update, run `mod.clone` and `p1-install.sh` again to re-apply. Herdr updates the shipped originals; user copies stay unchanged.

## Scripts

| script | purpose |
|---|---|
| `t1-wal-test.sh` | WAL-active DB `sqlite3 -readonly` read correctness (5 cases) |
| `t2-precedence-probe.sh` + `t2-server.py` | real-claude precedence/leak probe (localhost echo server, fake tokens) |
| `seed-cc-switch-db.py` | verification tool: build a single-provider test DB from a spec (full DDL + user_version; T9) |
| `t5-remote-prepare.sh` + `t5-remote-e2e.md` | remote-machine prep + T5 E2E checklist |
| `p1-install.sh` | three-layer install self-check + repair (idempotent; overlays sources, patches layouts, prints `do` commands for missing clones) |

## Development & verification

```sh
cd ../herdr-app && just build                     # Rust 1.95 + zig 0.16
./target/debug/herdr-app check ../herdr-provider-menu/mod
scripts/sandbox up                                # UI testing lives in the sandbox, never on a real setup
scripts/sandbox do layout.clone '{"name":"main"}'
scripts/sandbox do space.new '{}'
scripts/sandbox shot
```

Never start a bare herdr-app on a machine that also runs a personal herdr setup, unless `HERDR_APP_HOME` points to a scratch home. Sandbox ops notes: REVIEW.md Pass 5.

## License

MIT — see [LICENSE](LICENSE).
