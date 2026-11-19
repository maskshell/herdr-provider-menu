# herdr-provider-menu

Launch Claude Code in herdr terminals under a **cc-switch-managed provider identity**: one identity per terminal, parallel terminals never cross-talk, no global config touched. Codex and other CLIs later (Phase 2).

```
cc-switch (config truth: GUI editing / WebDAV sync)
        │  exec("sqlite3", …, {on: machine})   ← each machine reads its own DB
        ▼
this mod (stateless: read → merge → launch)
        │  run("tab.new", {argv: [env -u …, claude, --settings, …]})
        ▼
a herdr-tracked terminal (OSC 7501 status, notifications, agents list as usual)
```

It uses herdr's two sanctioned extension paths — new docked mods, and clones of shipped mods ("duplicate a shipped layout or mod before changing its structure or code") — to bring cc-switch's identity store onto herdr's execution surface. 中文文档: [README.zh-CN.md](README.zh-CN.md).

**Status (2026-11-19)**: design converged (DESIGN.md, ADRs 1–10). Phase 0 (docked panel) and Phase 1 (three-layer clone: agent-menu submenu + my-tabs + personal layout) both pass sandbox E2E — panel render, click and digit-key launches with the full argv, leak-blocking 26/26 assertions (T8), non-env providers refused with a note (T10), T4 settled (Esc interception is not possible; one Esc closes the menu, digit keys are per-layer). T1 (WAL concurrent reads) and T2 (settings-env precedence, against real claude 2.1.327) verified. Remaining: T5 real-remote E2E, T9 GUI-open half, Windows (Phase 2). Evidence in `evidence/`, process in REVIEW.md.

## How it works

- Reads each machine's own `~/.cc-switch/cc-switch.db` with `sqlite3 -readonly -json` over `exec {on: machine}` — no DB copies, safe under an active WAL writer (T1).
- Merges the provider profile over the live `~/.claude/settings.json` with drop-blocking: live-only env keys are written `""` (claude treats empty as unset, verified on 2.1.327) and `modelPicker` is always written so routing/aggregation menus never leak in (T8 — the same recipe cc-switch's own isolated-terminal launcher uses).
- Launches `env -u …×14 claude --settings <inline json>` so the identity is frozen per terminal and the terminal stays fully herdr-tracked.
- Non env-form providers (official OAuth accounts, routed contract cards) are greyed out and refuse to launch with an honest note (T10).

## Security — read before installing

herdr mods are trusted code, not sandboxed extensions. This one handles credentials; its posture:

- Reads the cc-switch DB and the live settings (to compute drop keys) **readonly**; it never writes either.
- Tokens travel inline in the launch argv (`/proc/PID/cmdline` visible) — an accepted trade-off; the only static copy stays in the cc-switch DB. The stricter temp-file + 0600 recipe (as upstream's launcher uses) is a planned Phase 3 option.
- Never inherits or adds `--dangerously-skip-permissions`; extra args are explicit only.
- Leak-blocking is tested end-to-end: 26/26 assertions in sandbox (T8), re-verified against real claude 2.1.327 (T2).

## Install

Machine roles: the GUI machine (running the herdr-app window) gets the mods; machines that only run core/claude need nothing but the DB — the mod reads each machine's own DB over machine exec, and headless machines seed it with `scripts/seed-cc-switch-db.py`.

### GUI machine (three-layer submenu)

```sh
git clone https://github.com/maskshell/herdr-provider-menu && cd herdr-provider-menu
herdr-app do mod.clone '{"name":"new-menu","as":"agent-menu"}'
herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'
herdr-app do layout.clone '{"name":"main"}'    # if you have no personal layout yet; switch to it in the app
sh scripts/p1-install.sh                        # overlays sources + patches tabs in your personal layouts (idempotent)
```

Then fully quit and reopen Herdr — cloned-mod overlays load after a restart. When testing against an isolated home, pass `HERDR_APP_HOME=<dir>` to the script. Manual equivalent: after the two `mod.clone`s, copy `agent-menu/{main.js,providers.js,mod.json}` and `my-tabs/main.js` into the matching `~/.config/herdr-app/mods/` clones, and change `"mod": "tabs"` to `"my-tabs"` in your layout json.

After install: the tab-bar `+` opens agent-menu; the Claude Code row grows an inline provider submenu — Default is the live slot, then this machine's cc-switch providers; grey rows are non env-form and explain themselves. Digit keys act per layer; one Esc closes the whole menu (app-level binding, REVIEW Pass 7/T4).

### Optional Phase 0 side panel

`cp -r mod/ ~/.config/herdr-app/mods/provider-menu/` — docks into personal layouts at 280px. Or copy `layouts/main-providers.json` to `~/.config/herdr-app/layouts/` for a ready-made layout with the panel docked.

### Headless / core machines (DB only)

```sh
python3 scripts/seed-cc-switch-db.py ~/.cc-switch/cc-switch.db --spec <spec.json>
```

The spec's `providers[].settings` is the **full env set** of that machine's live `~/.claude/settings.json` — including the `CLAUDE_CODE_*` tuning keys, which are per-provider (see REVIEW.md Pass 7 for the correction) — plus `model`. The machine needs a system `sqlite3`; if it is missing, the menu shows an install hint instead of an empty list.

## Clone baseline

`agent-menu/` and `my-tabs/` are working copies cloned from herdr-app's shipped `new-menu`/`tabs` at herdr-app `4deb605`, extended here (the submenu layer; a 7-line `+` patch). Shipped mods keep evolving upstream: after a herdr-app update, re-run `mod.clone` and `p1-install.sh` to re-apply. Herdr updates the shipped originals; your clones stay yours.

## Scripts

| script | purpose |
|---|---|
| `t1-wal-test.sh` | WAL-active DB `sqlite3 -readonly` read correctness (5 cases) |
| `t2-precedence-probe.sh` + `t2-server.py` | real-claude precedence/leak probe (localhost echo server, fake tokens) |
| `seed-cc-switch-db.py` | seed a cc-switch DB for headless machines (full DDL + user_version, opens in the GUI with zero migrations) |
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

Never run a bare herdr-app on a machine where you use the app without `HERDR_APP_HOME` pointing at a scratch home. Sandbox ops notes: REVIEW.md Pass 5.

## License

MIT — see [LICENSE](LICENSE).
