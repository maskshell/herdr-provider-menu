#!/bin/sh
# Install the herdr-provider-menu mods on the machine that runs the herdr-app
# window. Usage (from a checkout of this repo):  sh scripts/p1-install.sh
# Idempotent: safe to re-run. File work only; needs python3.
# Two packages, three mods:
#   provider-menu/mods/provider-menu   the docked 280px panel
#   agent-menu/mods/agent-menu         the + popup with cc-switch submenus
#   agent-menu/mods/my-tabs            tabs clone wiring + to that popup
# The panel still needs a layout block: see provider-menu/RECIPE.md.
set -eu

CFG="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MODS="$CFG/mods"

echo "app home: $CFG"

# --- 1. copy the three mods (plain copy is the official install flow) -------
for m in provider-menu/mods/provider-menu agent-menu/mods/agent-menu agent-menu/mods/my-tabs; do
  name=${m##*/}
  if [ -d "$MODS/$name" ] && ! cmp -s "$ROOT/$m/main.js" "$MODS/$name/main.js"; then
    if grep -q "herdr-provider-menu" "$MODS/$name/main.js" 2>/dev/null; then
      echo "  [$name] updating (was an earlier copy of ours)"
    else
      echo "  [$name] name taken by a mod that is not ours — rename it first:" >&2
      echo "      mv '$MODS/$name' '$MODS/$name.old'" >&2
      exit 1
    fi
  fi
  mkdir -p "$MODS/$name"
  cp "$ROOT/$m"/* "$MODS/$name/"
done
grep -q "herdr-provider-menu" "$MODS/agent-menu/main.js" && echo "  agent-menu: ours ✓"
grep -q 'mod: "agent-menu"' "$MODS/my-tabs/main.js" && echo "  my-tabs opens agent-menu ✓"
grep -q 'id("provider-menu")' "$MODS/provider-menu/main.js" && echo "  provider-menu: ours ✓"

# --- 2. layouts: dock the panel, point tab bars at my-tabs -------------------
# The + button only opens agent-menu from my-tabs, and the panel only shows
# when a layout has a provider-menu block. Patch personal layouts; to dock
# into the shipped main layout, clone it first (the script says how).
echo "layouts:"
python3 - "$CFG/layouts" <<'EOF'
import glob, json, os, sys
d = sys.argv[1]
if not os.path.isdir(d) or not glob.glob(os.path.join(d, "*.json")):
    print("  no personal layouts — in the app run:")
    print("      herdr-app do layout.clone '{\"name\":\"main\"}'")
    print("  then switch to the clone and re-run this script")
    sys.exit(0)
BLOCK = {"id": "providers", "type": "block", "size": {"px": 280}, "min": 200,
         "content": {"mod": "provider-menu"}}
def walk(n):
    if isinstance(n, dict):
        c = n.get("content")
        if isinstance(c, dict) and c.get("mod") == "tabs":
            c["mod"] = "my-tabs"
        for ch in n.get("children", []):
            walk(ch)
    elif isinstance(n, list):
        for ch in n:
            walk(ch)
def has(n, mod):
    if isinstance(n, dict):
        c = n.get("content")
        if isinstance(c, dict) and c.get("mod") == mod:
            return True
        return any(has(ch, mod) for ch in n.get("children", []))
    if isinstance(n, list):
        return any(has(ch, mod) for ch in n)
    return False
patched = docked = 0
for p in sorted(glob.glob(os.path.join(d, "*.json"))):
    try:
        doc = json.load(open(p))
    except Exception as e:
        print("  ?", os.path.basename(p), e)
        continue
    walk(doc)
    if not has(doc, "provider-menu") and isinstance(doc.get("children"), list):
        doc["children"].append(json.loads(json.dumps(BLOCK)))
        print(f"  docked provider-menu into {os.path.basename(p)}")
        docked += 1
    json.dump(doc, open(p, "w"), indent=2)
    if has(doc, "my-tabs"):
        patched += 1
print(f"  {patched} layout(s) use my-tabs, {docked} docked this run")
if not patched:
    print("  NOTE: no layout has a tabs block — cloned a non-main layout?")
EOF

echo
echo "Done. Now FULLY restart Herdr (quit + reopen): mod sources load at start."
echo "Then: tab-bar + -> Claude Code row shows '1 ▸'; click it for the provider"
echo "submenu. The panel sits on the right; see the RECIPE.md files for the rest."
