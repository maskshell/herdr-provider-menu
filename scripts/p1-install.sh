#!/bin/sh
# Install the herdr-provider-menu mods on the machine that runs the herdr-app
# window. Usage (from a checkout of this repo):  sh scripts/p1-install.sh
# Idempotent: safe to re-run. File work only; needs python3.
# Two packages, three mods:
#   provider-menu/mods/provider-menu   the docked 280px panel
#   agent-menu/mods/agent-menu         the + popup with cc-switch submenus
#   agent-menu/mods/my-tabs            tabs clone wiring + to that popup
# Plus the layout work: a once-created main clone named after you (panel +
# reopen pill docked), the panel docked into your other personal layouts,
# and the alt-p / cmd-shift-b toggle key. Herdr reloads keys.json live.
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

# --- 2. layouts ---------------------------------------------------------------
# main-providers.json is GENERATED here from Herdr's own shipped main.json
# (the app keeps that pristine and refreshes it on every Herdr update), so
# `git pull && sh scripts/p1-install.sh` is the whole update story: no layout
# file ships in this repo, nothing to copy by hand, no drift.
# Never touch Herdr's shipped layouts (main/terminals/win98): an edited
# shipped file is moved aside by the app on next start as <name>-edited(-N)
# and proliferates copies. Personal layouts only get the panel + pill.
echo "layouts:"
python3 - "$CFG/layouts" <<'EOF'
import glob, json, os, subprocess, sys
d = sys.argv[1]
SHIPPED = {"main", "terminals", "win98"}          # herdr's own (src/window.rs LAYOUTS)
# A user-owned main clone: named after the person, created once, theirs from
# then on (the same contract as the my-tabs fork). Legacy installs under the
# product-y name "main-providers" migrate to it, tweaks and click state kept.
user = "".join(c for c in (os.environ.get("USER") or os.environ.get("LOGNAME") or "")
               if c.isalnum() or c in "-_") or "mine"
NAME = "main-" + user
LEGACY = "main-providers"
PANEL = {"id": "provider-menu-panel", "type": "block", "size": {"px": 280}, "min": 200,
         "content": {"mod": "provider-menu"}}
PILL = {"id": "provider-toggle", "type": "block", "size": {"px": 104},
        "content": {"mod": "provider-menu", "props": {"role": "toggle"}}}

def shared():
    try:
        return json.load(open(os.path.normpath(os.path.join(d, "..", "shared.json"))))
    except Exception:
        return {}
def save_shared(s):
    try:
        json.dump(s, open(os.path.normpath(os.path.join(d, "..", "shared.json")), "w"))
    except Exception:
        pass
def app_version():
    try:
        v = subprocess.run(["herdr-app", "--version"], capture_output=True, text=True, timeout=5)
        return (v.stdout or v.stderr).strip().splitlines()[-1] if v.returncode == 0 else ""
    except Exception:
        return ""

# lineage: the shipped layout a file descends from. App clones carry a
# cloned_from marker; files without one (hand-made, or the app's
# "<name>-edited" aside copies of main) are treated as main-shaped.
def lineage(path):
    try:
        return (json.load(open(path)).get("cloned_from") or {}).get("name") or ""
    except Exception:
        return "?"

# migrate the legacy name once
legacy_path = os.path.join(d, LEGACY + ".json")
name_path = os.path.join(d, NAME + ".json")
if NAME != LEGACY and os.path.exists(legacy_path) and not os.path.exists(name_path):
    os.rename(legacy_path, name_path)
    st = os.path.join(d, ".state")
    if os.path.exists(os.path.join(st, LEGACY + ".json")):
        os.rename(os.path.join(st, LEGACY + ".json"), os.path.join(st, NAME + ".json"))
    s = shared()
    if s.get("layout") == LEGACY:
        s["layout"] = NAME
        save_shared(s)
    try:
        subprocess.run(["herdr-app", "do", "layout.switch", json.dumps({"name": NAME})],
                       capture_output=True, timeout=8)
    except Exception:
        pass
    print(f"  renamed {LEGACY} -> {NAME} (yours; tweaks and click state kept)")

cur = shared().get("layout") or "main"

# create the user-owned clone once (only when the person sits on shipped main,
# the one layout whose shape we know we fit; win98/terminals are left alone)
if cur == "main" and not os.path.exists(name_path):
    doc = json.load(open(os.path.join(d, "main.json")))
    found = {}
    def locate(n, parent):
        if isinstance(n, dict):
            c = n.get("content")
            if (isinstance(c, dict) and c.get("mod") == "tabs" and n.get("type") == "block"
                    and "tabs" not in found):
                found["tabs"] = (parent, n)
                return
            for ch in n.get("children", []):
                locate(ch, n)
        elif isinstance(n, list):
            for ch in n:
                locate(ch, parent)
    locate(doc, None)
    if "tabs" not in found:
        print("  ! shipped main.json has no tabs block — no clone created")
    else:
        work_col, tabs_node = found["tabs"]
        bar_px = tabs_node.get("size", {}).get("px", 42)
        work_col["children"] = [ch for ch in work_col.get("children", []) if ch is not tabs_node]
        tabs = json.loads(json.dumps(tabs_node))
        tabs["content"]["mod"] = "my-tabs"
        tabs["size"] = {"weight": 1}
        inner = next((ch for ch in work_col.get("children", [])
                      if isinstance(ch, dict) and ch.get("type") == "row"), None)
        pad, gap = 8, 8
        if inner is not None and ("padding" in inner or "gap" in inner):
            pad, gap = inner.pop("padding", pad), inner.pop("gap", gap)
        shell = {"id": "shell", "type": "column", "children": [
            {"id": "tabs-row", "type": "row", "size": {"px": bar_px},
             "children": [tabs, json.loads(json.dumps(PILL))]},
            {"id": "body", "type": "row", "padding": pad, "gap": gap,
             "children": [work_col, json.loads(json.dumps(PANEL))]}]}
        doc["children"] = [shell if ch is work_col else ch for ch in doc.get("children", [])]
        doc["cloned_from"] = {"name": "main", "version": app_version()}
        json.dump(doc, open(name_path, "w"), indent=2)
        print(f"  built {NAME}.json from the shipped main (created once — now yours)")
elif os.path.exists(name_path):
    print(f"  {NAME}.json exists — kept as yours (refresh: delete it and re-run)")

# personal layouts: add-only dock + pill. Skipped: herdr's own files, and
# clones of layouts we do not fit (win98 and friends carry their own look).
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
def has(n, mod, role=None):
    if isinstance(n, dict):
        c = n.get("content")
        if isinstance(c, dict) and c.get("mod") == mod:
            if role is None or (c.get("props") or {}).get("role") == role:
                return True
        return any(has(ch, mod, role) for ch in n.get("children", []))
    if isinstance(n, list):
        return any(has(ch, mod, role) for ch in n)
    return False
def wrap_tabs(n):
    if isinstance(n, dict):
        kids = n.get("children")
        if isinstance(kids, list):
            for i, ch in enumerate(kids):
                c = ch.get("content") if isinstance(ch, dict) else None
                if (isinstance(ch, dict) and ch.get("type") == "block"
                        and isinstance(c, dict) and c.get("mod") == "my-tabs"):
                    size = ch.get("size") or {"px": 42}
                    tabs = dict(ch)
                    tabs["size"] = {"weight": 1}
                    kids[i] = {"id": "tabs-row", "type": "row", "size": size,
                               "children": [tabs, json.loads(json.dumps(PILL))]}
                    return True
                if wrap_tabs(ch):
                    return True
    elif isinstance(n, list):
        for ch in n:
            if wrap_tabs(ch):
                return True
    return False
def has_id(n, i):
    if isinstance(n, dict):
        if n.get("id") == i:
            return True
        return any(has_id(ch, i) for ch in n.get("children", []))
    if isinstance(n, list):
        return any(has_id(ch, i) for ch in n)
    return False
patched = docked = pilled = skipped = 0
managed = []
for p in sorted(glob.glob(os.path.join(d, "*.json"))):
    base = os.path.basename(p)[:-5]
    if base in SHIPPED:
        continue
    lin = lineage(p)
    if lin in (SHIPPED - {"main"}):
        print(f"  skipped {base}.json — a {lin} layout with its own look; the panel targets the main window")
        skipped += 1
        continue
    try:
        doc = json.load(open(p))
    except Exception as e:
        print("  ?", os.path.basename(p), e)
        continue
    walk(doc)
    if not has(doc, "provider-menu") and isinstance(doc.get("children"), list):
        doc["children"].append(json.loads(json.dumps(PANEL)))
        print(f"  docked provider-menu into {os.path.basename(p)}")
        docked += 1
    if has(doc, "provider-menu") and not has(doc, "provider-menu", "toggle") and wrap_tabs(doc):
        print(f"  added the reopen pill to {os.path.basename(p)}")
        pilled += 1
    json.dump(doc, open(p, "w"), indent=2)
    if has(doc, "my-tabs"):
        patched += 1
    if has_id(doc, "provider-menu-panel"):
        managed.append(base)
print(f"  {patched} personal layout(s) use my-tabs, {docked} docked, {pilled} pilled, {skipped} skipped this run")

# --- the same toggle under a key ------------------------------------------------
# alt-p; cmd-shift-b on macOS, where alt is the option key and option+letter
# types a character. Bound in every personal layout that carries the panel
# under its fixed id (the command needs the id). Herdr reloads keys.json
# live, so the key works as soon as the script has run. An existing binding
# at the key is the person's and is never touched.
key = "cmd-shift-b" if os.uname().sysname == "Darwin" else "alt-p"
VAL = "layout.toggle:provider-menu-panel"
kp = os.path.normpath(os.path.join(d, "..", "keys.json"))
had_file = os.path.exists(kp)
parsed = True
try:
    keys = json.load(open(kp))
    if not isinstance(keys, dict):
        raise ValueError("not an object")
except Exception:
    parsed = False
    if had_file:
        print("  ! keys.json did not parse — rewritten (its other bindings were unreadable)")
    keys = {}
kerr = os.path.normpath(os.path.join(d, "..", "keys.error"))
moved = False
leg = keys.get("layout:" + LEGACY)           # the package template's old section name
if isinstance(leg, dict):
    for k in [k for k, v in leg.items() if v == VAL]:
        del leg[k]
        moved = True
    if not leg:
        del keys["layout:" + LEGACY]
bound = kept = 0
for name in managed:
    sec = keys.setdefault("layout:" + name, {})
    if not isinstance(sec, dict):
        print(f"  ! keys.json 'layout:{name}' is not an object — left alone")
        continue
    if key in sec and sec[key] != VAL:
        kept += 1
        continue
    if sec.get(key) != VAL:
        sec[key] = VAL
        bound += 1
if bound or moved:
    json.dump(keys, open(kp, "w"), indent=2)
if not parsed and had_file and os.path.exists(kerr):
    os.remove(kerr)          # stale: the rewrite above heals what caused it
msg = f"  key {key} -> {VAL}: bound in {bound} layout section(s)"
if moved:
    msg += ", moved out of the old layout:main-providers section"
if kept:
    msg += f", kept an existing binding of yours in {kept}"
print(msg)
EOF

# --- 3. layout selection ------------------------------------------------------
# Sitting on shipped main -> switch to the user-owned clone (live if Herdr
# runs, else at next start). Other shipped layouts (win98, terminals) are a
# deliberate choice: the clone is ready but never switched to behind the
# person's back. Personal layouts keep the selection: the panel docks into them.
echo "layout selection:"
python3 - "$CFG" <<'EOF'
import json, os, subprocess, sys
cfg = sys.argv[1]
user = "".join(c for c in (os.environ.get("USER") or os.environ.get("LOGNAME") or "")
               if c.isalnum() or c in "-_") or "mine"
NAME = "main-" + user
try:
    cur = json.load(open(os.path.join(cfg, "shared.json"))).get("layout") or "main"
except Exception:
    cur = "main"
if cur == NAME:
    print(f"  already on {NAME}")
    sys.exit(0)
if cur not in ("main", "terminals", "win98"):
    print(f"  kept your layout {cur!r} — the panel is docked into it")
    sys.exit(0)
if cur != "main":
    print(f"  kept {cur} (a deliberate choice); {NAME} is ready — switch with:")
    print("    herdr-app do layout.switch '{\"name\": \"%s\"}'" % NAME)
    sys.exit(0)
try:
    ran = subprocess.run(["herdr-app", "do", "layout.switch", json.dumps({"name": NAME})],
                         capture_output=True, text=True, timeout=8)
except Exception:
    ran = None
if ran is not None and ran.returncode == 0:
    print(f"  switched {cur} -> {NAME} (live)")
else:
    try:
        p = os.path.join(cfg, "shared.json")
        d = json.load(open(p))
        d["layout"] = NAME
        json.dump(d, open(p, "w"))
        print(f"  {cur} -> {NAME} at next start (Herdr is not running)")
    except Exception as e:
        print(f"  ! could not switch off {cur}: {e} — switch by hand:")
        print("    herdr-app do layout.switch '{\"name\": \"%s\"}'" % NAME)
EOF
# --- 4. key check ---------------------------------------------------------------
# The toggle key needs all of these to hold; each is checked and the failing
# one is named: the binding sits in keys.json under a section for a layout
# that carries the panel, keys.json parses (Herdr writes keys.error when it
# does not), and the layout Herdr shows is one of those sections. Herdr
# reloads keys.json live, so no restart is involved anywhere below.
echo "key check:"
python3 - "$CFG" <<'EOF'
import glob, json, os, subprocess, sys
cfg = sys.argv[1]
KEY = "cmd-shift-b" if os.uname().sysname == "Darwin" else "alt-p"
VAL = "layout.toggle:provider-menu-panel"

def run(*a):
    try:
        r = subprocess.run(a, capture_output=True, text=True, timeout=8)
        return r if r.returncode == 0 else None
    except Exception:
        return None

shown = None
st = run("herdr-app", "status")
if st is not None:
    try:
        d = json.loads(st.stdout)
        shown = d.get("layout")
        for e in d.get("errors") or []:
            print(f"  ! Herdr reports: {e}")
    except Exception:
        pass
v = run("herdr-app", "--version")
ver = v.stdout.strip().splitlines()[-1] if v else "herdr-app CLI not on PATH"
print(f"  {ver}"
      + (f", showing layout {shown!r}" if shown else " — not running, file checks only"))

err = os.path.join(cfg, "keys.error")
if os.path.exists(err):
    print(f"  ! Herdr rejected keys.json: {open(err).read().strip()}")
try:
    keys = json.load(open(os.path.join(cfg, "keys.json")))
    if not isinstance(keys, dict):
        raise ValueError("not an object")
except Exception as e:
    keys = {}
    print(f"  ! keys.json does not parse: {e}")

def has_id(n, i):
    if isinstance(n, dict):
        if n.get("id") == i:
            return True
        return any(has_id(c, i) for c in n.get("children", []))
    if isinstance(n, list):
        return any(has_id(c, i) for c in n)
    return False

sections = []
for p in sorted(glob.glob(os.path.join(cfg, "layouts", "*.json"))):
    base = os.path.basename(p)[:-5]
    if base in ("main", "terminals", "win98"):
        continue
    try:
        doc = json.load(open(p))
    except Exception:
        continue
    if has_id(doc, "provider-menu-panel") and (keys.get("layout:" + base) or {}).get(KEY) == VAL:
        sections.append(base)
if not sections:
    print(f"  ! the {KEY} binding is missing from keys.json (run this script again)")
elif shown is not None and shown not in sections:
    print(f"  ! the binding covers {', '.join(sections)} but Herdr shows {shown!r} — switch with:")
    print("    herdr-app do layout.switch '{\"name\": \"%s\"}'" % sections[0])
else:
    print(f"  {KEY} is bound in {', '.join(sections)}; all checks pass — it should toggle the panel now")
    if os.uname().sysname == "Darwin":
        print(f"  still nothing? a mac shortcut may grab {KEY} first (System Settings > Keyboard > Keyboard Shortcuts),")
        print( "  or move the binding to another key in keys.json — Herdr reloads it live")
EOF
