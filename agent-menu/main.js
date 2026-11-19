// herdr-provider-menu — Phase 1 (DESIGN.md §5.2): the cloned new-menu with a
// provider submenu on the Claude Code row. Install over a mod.clone of
// new-menu named agent-menu; providers.js travels unchanged with it.
// Differences from the shipped new-menu: the Claude row grows a ▸ and opens
// an inline submenu (Default = live slot, then cc-switch providers), digits
// scope to the open layer, and Esc tries to retreat one layer (T4).
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";
import { readProviders, launchArgv } from "./providers.js";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

// The harness CLI this build gives a provider submenu (Phase 2 adds more).
const SUBMENU_KEY = "claude";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class AgentMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.sub = null;        // SUBMENU_KEY while the provider submenu is open
    this.providers = null;  // null = reading, [] = read done
    this.note = "";
    this.launchNote = "";
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }

  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }

  /// Submenu open: query THAT machine's cc-switch now (DESIGN.md §3), not at
  /// menu init — machines without cc-switch pay nothing until they ask.
  expand(cx) {
    const machine = spaces().find(s => s.active)?.machine ?? null;
    this.sub = SUBMENU_KEY;
    this.providers = null;
    this.note = "";
    this.launchNote = "";
    cx.notify();
    cx.spawn(async cx => {
      try { this.providers = await readProviders(machine); }
      catch (e) { this.note = String(e?.message ?? e); }
      cx.notify();
    });
  }

  launchProvider(p, cx) {
    const space = spaces().find(s => s.active);
    cx.spawn(async cx => {
      try {
        const argv = await launchArgv(p, [], space?.machine ?? null);
        closeOverlay(props().overlay);
        run("tab.new", { name: "Claude (" + p.name + ")", space: space?.id, argv });
      }
      catch (e) {
        this.launchNote = String(e?.message ?? e);
        cx.notify();
      }
    });
  }

  /// The Claude row: click toggles the submenu instead of launching (the
  /// Default sub-row and digit keys keep the plain live-slot launch).
  agentRow(a, i) {
    const t = theme();
    const open = this.sub === SUBMENU_KEY;
    const icon = a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14);
    return h_flex().id(a.key).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(t.foreground).hover(s => s.bg(t.selected))
      .on_click((_e, cx) => {
        if (this.sub) { this.sub = null; cx.notify(); }
        else this.expand(cx);
      })
      .child(icon).child(div().flex_1().child(a.name))
      .child(div().text_size(11).text_color(t.dim).child(open ? "▾" : (i < 9 ? String(i + 1) + " ▸" : "▸")));
  }

  /// One indented submenu row (Default, or a provider). dim rows explain
  /// themselves on click instead of launching.
  subRow(id, name, action, hint, tag = "", dim = false) {
    const t = theme();
    return h_flex().id(id).h(27).pl(28).pr(9).gap(8).rounded(7).items_center().flex_none()
      .text_size(12.3).text_color(dim ? t.dim : t.foreground)
      .when(!dim, el => el.hover(s => s.bg(t.selected)))
      .on_click((_e, cx) => action(cx))
      .child(div().flex_1().child(name))
      .child(div().text_size(10).text_color(t.dim).child(tag))
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }

  /// Rows under the Claude row: Default (live slot) + cc-switch providers.
  subList(a, space) {
    const t = theme();
    const rows = [this.subRow("sub-default", "Default (live)",
      () => { closeOverlay(props().overlay); run("tab.new", { name: a.name, space: space?.id, argv: a.run }); },
      "1")];
    if (this.note) {
      const hint = /sqlite3|not found|no such file|cannot start/i.test(this.note)
        ? "sqlite3 is missing on this machine"
        : /cc-switch\.db|unable to open/i.test(this.note)
          ? "no cc-switch.db here (add a provider in cc-switch first)"
          : "could not read cc-switch";
      rows.push(h_flex().id("sub-error").h(27).pl(28).pr(9).items_center().flex_none()
        .text_size(12.3).text_color(t.dim).child(hint));
    }
    else if (this.providers === null) {
      rows.push(h_flex().id("sub-loading").h(27).pl(28).pr(9).items_center().flex_none()
        .text_size(12.3).text_color(t.dim).child("Reading cc-switch…"));
    }
    else {
      this.providers.forEach((p, i) => {
        const n = i < 8 ? String(i + 2) : "";
        if (p.launchable === false) {
          rows.push(this.subRow("sub-" + i, p.name, cx => {
            this.launchNote = p.name + " is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.";
            cx.notify();
          }, n, "cc-switch", true));
        }
        else rows.push(this.subRow("sub-" + i, p.name, cx => { this.launchProvider(p, cx); }, n,
          p.current ? "current" : ""));
      });
    }
    return v_flex().id("sub").children(rows);
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    const extra = this.sub ? 27 * (1 + (this.note || this.providers === null ? 1 : (this.providers?.length ?? 0))) + (this.launchNote ? 44 : 0) : 0;
    return v_flex().min_h(0).w_full().h(Math.min(491, 167 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 31 + extra)).bg(t.popover).p(5).text_size(12.8)
      .id("agent-menu").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        if (e.key === "escape") {
          // T4: try to retreat one layer only; closed state falls through to
          // the app's Esc (overlay.close) and dismisses the menu.
          if (this.sub) { this.sub = null; this.launchNote = ""; cx.notify(); cx.stop_propagation(); }
          return;
        }
        if (!/^[1-9]$/.test(e.key)) return;
        const n = Number(e.key);
        if (this.sub) {
          // Digits scope to the open submenu: 1 = Default, 2.. = providers.
          const rows = [{ d: true }, ...(this.providers ?? [])];
          const pick = rows[n - 1];
          if (!pick) return;
          if (pick.d) {
            const a = installed.find(x => x.key === SUBMENU_KEY);
            if (!a) return;
            closeOverlay(props().overlay);
            run("tab.new", { name: a.name, space: space?.id, argv: a.run });
          }
          else if (pick.launchable === false) {
            this.launchNote = pick.name + " is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.";
            cx.notify();
          }
          else this.launchProvider(pick, cx);
          return;
        }
        const agent = installed[n - 1];
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.flatMap((a, i) => {
          if (a.key !== SUBMENU_KEY || !a.installed)
            return [this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
              () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)];
          return [this.agentRow(a, i), ...(this.sub ? [this.subList(a, space)] : [])];
        }))
        .when(this.launchNote, el => el.child(div().id("launch-note").px(9).py(4).text_size(11.5).text_color(t.dim).child(this.launchNote)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
