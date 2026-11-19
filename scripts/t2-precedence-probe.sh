#!/bin/bash
# T2 probe + T8 re-verify on the CURRENT claude (2.1.327), fully isolated:
# scratch HOME + CLAUDE_CONFIG_DIR, localhost-only endpoints, fake tokens.
#   A  precedence: process env vs --settings env  (which base URL is used)
#   B  empty-string drop: live settings.json keys blocked by "" in --settings
#   C  cross-key leak: process ANTHROPIC_API_KEY vs settings AUTH_TOKEN
#   D  model leak: process ANTHROPIC_MODEL vs settings env
set -u
H=/tmp/t2-home; CFG=$H/.claude-config; LOGS=/tmp/t2-logs
PROBE_USER="${PROBE_USER:-$USER}"          # unprivileged user to run the probe under
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
sudo -u "$PROBE_USER" rm -rf $H $LOGS
sudo -u "$PROBE_USER" mkdir -p $CFG $LOGS
A=18171; B=18172; C=18173; D=18174
for p in $A $B $C $D; do
  sudo -u "$PROBE_USER" python3 /tmp/t2-server.py $p $LOGS/hits-$p.log >/dev/null 2>&1 &
done
sleep 0.6

CL="sudo -u $PROBE_USER -H env HOME=$H CLAUDE_CONFIG_DIR=$CFG \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 PATH=$(dirname "$CLAUDE_BIN"):/usr/bin:/bin \
  $CLAUDE_BIN"

run() { # label, then env assignments + claude args
  local label=$1; shift
  timeout 40 "$@" >$LOGS/out-$label.txt 2>&1
  echo "run $label rc=$? (last line: $(tail -1 $LOGS/out-$label.txt | cut -c1-140))"
}

echo "== A: process env BASE_URL=$A vs --settings BASE_URL=$B =="
run A env ANTHROPIC_BASE_URL=http://127.0.0.1:$A $CL -p "hi" \
  --settings '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:'$B'","ANTHROPIC_AUTH_TOKEN":"tok-settings"}}'

echo "== B: live settings.json (BASE_URL=$C, live-tok) blocked by empty strings =="
printf '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:%s","ANTHROPIC_AUTH_TOKEN":"live-tok"}}' $C > $CFG/settings.json
run B $CL -p "hi" --settings '{"env":{"ANTHROPIC_BASE_URL":"","ANTHROPIC_AUTH_TOKEN":""}}'
rm -f $CFG/settings.json

echo "== C: process ANTHROPIC_API_KEY=proc-key vs settings AUTH_TOKEN (BASE_URL=$D) =="
run C env ANTHROPIC_API_KEY=proc-key $CL -p "hi" \
  --settings '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:'$D'","ANTHROPIC_AUTH_TOKEN":"tok-settings"}}'

echo "== D: process ANTHROPIC_MODEL=glm-proc leak (BASE_URL=$D) =="
run D env ANTHROPIC_MODEL=glm-proc $CL -p "hi" \
  --settings '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:'$D'","ANTHROPIC_AUTH_TOKEN":"tok-settings"}}'

pkill -f t2-server.py
echo; echo "== hits =="
for p in $A $B $C $D; do
  echo "--- port $p ($( [ -s $LOGS/hits-$p.log ] && echo HIT || echo no-hit )) ---"
  sudo -u "$PROBE_USER" cat $LOGS/hits-$p.log 2>/dev/null | head -8
done
