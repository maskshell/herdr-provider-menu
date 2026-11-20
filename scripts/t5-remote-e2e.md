# T5 remote E2E — checklist (run when a remote machine is available)

Proves the mod's remote path end to end: a space on another machine reads
THAT machine's cc-switch DB and launches claude THERE (DESIGN.md §4.2).

Status 2026-11-20: materially covered live by the real cross-machine borrow
test (mac cc-switch DB → headless Linux launch, both directions, codex;
REVIEW Pass 33). This scripted version stays for repeatable proof and now
also asserts the RAM-handoff posture (no credential in the recorded argv,
nothing left in /dev/shm).

## On the remote (once)

```sh
git -C <this repo> ... # or just copy scripts/ over
bash scripts/t5-remote-prepare.sh
```

Seeds `~/.cc-switch/cc-switch.db` (RWork current, RDeep), a GLM-shaped
canary `~/.claude/settings.json`, and a stub `~/.local/bin/claude` that
dumps argv + env to `~/claude-launch-dump-*.txt`.

## On the local machine

```sh
hc machine add <name>          # ssh host from ~/.ssh/config
# herdr (isolated home! never your real one):
HERDR_APP_HOME=/tmp/t5-home herdr-app &     # mod installed + layout.clone done once
# in the window:
#   1. New space on <name>            (space.new {machine: "<name>"})
#   2. select that space, open the provider panel, press ↻
#      -> rows must be RWork (current) + RDeep  (remote DB, not the local one)
#   3. click RWork
```

## Assert (local shell)

```sh
hc --on <name> exec cat .local/bin/claude >/dev/null && echo stub there
hc ls                            # new terminal "Claude (RWork)" on <name>
hc --on <name> exec sh -c 'cat ~/claude-launch-dump-*.txt'
# dump must show:
#   argv: --settings {"env":{"ANTHROPIC_BASE_URL":"https://example.work",
#                   "ANTHROPIC_AUTH_TOKEN":"sk-remote-1", ...blocked keys ""...},
#                     "attribution":{},"model":"","theme":"",
#                     "modelPicker":{"replaceBuiltInOptions":false,"options":[]}}
#   env section: NO ANTHROPIC_/CLAUDE_ vars (env -u ran on the REMOTE side)
hc --on <name> exec cat .claude/settings.json   # canary unchanged

# RAM handoff (Linux remote, Pass 37) — the stub still receives the inline
# --settings JSON as ITS argv, but the terminal argv recorded by core must
# carry only the bash -c script reading /dev/shm:
hc get <terminal>            # argv = bash -c 's="$(cat /dev/shm/herdr-pm.…)"…' — NO sk- string
hc --on <name> exec sh -c 'grep -c sk- ~/.local/state/herdr-core/*/terminals.json'   # 0
hc --on <name> exec sh -c 'ls /dev/shm/herdr-pm.* 2>/dev/null | wc -l'               # 0
```

Pass = all of the above, and the LOCAL ~/.cc-switch (if any) untouched.
