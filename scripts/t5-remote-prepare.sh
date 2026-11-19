#!/bin/bash
# T5 remote prep — run ON the remote machine (test T5, DESIGN.md §4.2).
# Gives that machine everything the mod's remote path needs, without cc-switch:
#   ~/.cc-switch/cc-switch.db   seeded exactly like a current GUI install
#   ~/.claude/settings.json     a poisoned "live" canary (GLM-shaped)
#   ~/.local/bin/claude         a stub that dumps argv + env and sleeps
# Re-run safely: --force re-seeds the DB; the canary is only created if absent.
set -euo pipefail

SEEDER="$(dirname "$0")/seed-cc-switch-db.py"
[ -f "$SEEDER" ] || { echo "need $SEEDER next to this script" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 missing (the mod needs it too)" >&2; exit 1; }

SPEC=$(mktemp)
cat > "$SPEC" <<'EOF'
{"providers": [
  {"name": "RWork", "current": true, "sort": 0,
   "settings": {"env": {"ANTHROPIC_BASE_URL": "https://example.work", "ANTHROPIC_AUTH_TOKEN": "sk-remote-1"}}},
  {"name": "RDeep", "sort": 1,
   "settings": {"env": {"ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic", "ANTHROPIC_AUTH_TOKEN": "sk-remote-2"}}}
]}
EOF
python3 "$SEEDER" ~/.cc-switch/cc-switch.db --spec "$SPEC" --force
rm -f "$SPEC"

if [ ! -f ~/.claude/settings.json ]; then
  mkdir -p ~/.claude
  cat > ~/.claude/settings.json <<'EOF'
{"cleanupPeriodDays":90,"env":{"ANTHROPIC_AUTH_TOKEN":"glm-live","ANTHROPIC_BASE_URL":"https://open.bigmodel.cn/api/anthropic","ANTHROPIC_MODEL":"GLM-5.3[1M]","ANTHROPIC_DEFAULT_OPUS_MODEL":"GLM-5.3[1M]","ANTHROPIC_DEFAULT_HAIKU_MODEL":"GLM-5.3-Flash[1M]","API_TIMEOUT_MS":"3000000"},"attribution":{"a":1},"model":"GLM-5.3[1M]","theme":"auto","alwaysThinkingEnabled":true}
EOF
  echo "canary written to ~/.claude/settings.json"
else
  echo "~/.claude/settings.json exists — left untouched"
fi

mkdir -p ~/.local/bin
cat > ~/.local/bin/claude <<'EOF'
#!/bin/sh
{ echo "== argv ($#)"; i=0; for a in "$@"; do i=$((i+1)); printf '  [%d] %s\n' "$i" "$a"; done
  echo "== ANTHROPIC_/CLAUDE_ env"; env | grep -E '^(ANTHROPIC_|CLAUDE_)' | sort; } > "$HOME/claude-launch-dump-$CLAUDE_DUMP_TAG.txt"
echo "fake claude ran (tag $CLAUDE_DUMP_TAG)"; sleep 25
EOF
chmod +x ~/.local/bin/claude
echo "stub claude installed (PATH picks it up via the login shell on most setups;"
echo "if the real claude shadows it, launch tests will say so in their output)."
