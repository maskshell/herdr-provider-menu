#!/bin/sh
# P1 install — check & fix on the machine that runs the herdr-app window.
# Usage (from a checkout/sync of this repo):  sh scripts/p1-install.sh
# Idempotent: safe to re-run. File work only; needs python3.
# mod.clone / layout.clone need the app OPEN (they talk to the running app);
# this script tells you when to run them and exits.
set -eu

CFG="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MODS="$CFG/mods"

echo "app home: $CFG"

# --- 1. the two clones must exist (created via the app) --------------------
missing=0
[ -d "$MODS/agent-menu" ] || { echo "  [agent-menu] MISSING — run first:
    herdr-app do mod.clone '{\"name\":\"new-menu\",\"as\":\"agent-menu\"}'"; missing=1; }
[ -d "$MODS/my-tabs" ]    || { echo "  [my-tabs] MISSING — run first:
    herdr-app do mod.clone '{\"name\":\"tabs\",\"as\":\"my-tabs\"}'"; missing=1; }
[ "$missing" = 0 ] && echo "  clones present: agent-menu, my-tabs" || exit 1

# --- 2. overwrite clone sources with ours (this is the step most often missed)
mkdir -p "$MODS/agent-menu" "$MODS/my-tabs"
cp "$ROOT/agent-menu/main.js" "$ROOT/agent-menu/providers.js" "$ROOT/agent-menu/mod.json" "$MODS/agent-menu/"
cp "$ROOT/my-tabs/main.js" "$MODS/my-tabs/main.js"
grep -q "herdr-provider-menu — Phase 1" "$MODS/agent-menu/main.js" \
  && echo "  agent-menu source: ours ✓"
grep -q 'mod: "agent-menu"' "$MODS/my-tabs/main.js" \
  && echo "  my-tabs opens agent-menu ✓"

# --- 3. layouts: every user layout whose tabs block still points at "tabs" --
echo "layouts:"
python3 - "$CFG/layouts" <<'EOF'
import glob, json, os, sys
d = sys.argv[1]
if not os.path.isdir(d) or not glob.glob(os.path.join(d, "*.json")):
    print("  no personal layouts — in the app run:")
    print("      herdr-app do layout.clone '{\"name\":\"main\"}'")
    print("  then switch to the clone and re-run this script")
    sys.exit(0)
patched = already = 0
for p in sorted(glob.glob(os.path.join(d, "*.json"))):
    try:
        doc = json.load(open(p))
    except Exception as e:
        print("  ?", os.path.basename(p), e)
        continue
    changed = []
    def walk(n):
        if isinstance(n, dict):
            c = n.get("content")
            if isinstance(c, dict) and c.get("mod") == "tabs":
                c["mod"] = "my-tabs"
                changed.append(n.get("id"))
            for ch in n.get("children", []):
                walk(ch)
        elif isinstance(n, list):
            for ch in n:
                walk(ch)
    walk(doc)
    if changed:
        json.dump(doc, open(p, "w"), indent=2)
        print(f"  patched {os.path.basename(p)}: tabs block {changed} -> my-tabs")
        patched += 1
def hasmytabs(n):
    if isinstance(n, dict):
        c = n.get("content")
        if isinstance(c, dict) and c.get("mod") == "my-tabs":
            return True
        return any(hasmytabs(ch) for ch in n.get("children", []))
    if isinstance(n, list):
        return any(hasmytabs(ch) for ch in n)
    return False
for p in sorted(glob.glob(os.path.join(d, "*.json"))):
    try:
        doc = json.load(open(p))
    except Exception:
        continue
    if hasmytabs(doc):
        already += 1
print(f"  {patched} patched, {already} layout(s) now use my-tabs")
if not already:
    print("  NOTE: no layout uses my-tabs — clone one first (see above)")
EOF

echo
echo "Done. Now FULLY restart Herdr (quit + reopen): mod sources load at start."
echo "Then: tab-bar + -> Claude Code row shows 'N ▸'; click it for the provider submenu."
