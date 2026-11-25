// herdr-provider-menu — Phase 0 (DESIGN.md §5.1): a docked picker proving
// read → merge → launch. Phase 1 moves this into the cloned new-menu as
// per-agent submenus; providers.js carries over unchanged.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, spaces, run, shared, setShared, window, checking, props, openOverlay, closeOverlay, knownAgents, layout, agents, panes, hc, exec } from "herdr";
import { readProviders, launchArgv, handoffAvailable, machinePlatform, EXTRA, RC, SRC, MCP, MCPONLY, HARNESS, cardNote } from "./providers.js";
import { MOVE, EXCLUDE, findClaudeSession, findCodexSession, buildManifest, markerManifest, readMarker, writeMarker, targetGate, transferPlan, runTransfer, placeClaudeSession, placeCodexSession, resumeArgs, newId, targetPlatform, excludedPresent, defaultPrompt, verifyCopied, readGitBranch, countDrift, cleanupPacks, slugOf, planWantsPack } from "./migrate.js";

/// shared() key for the last good read of one harness (instant open, re-check).
const cacheKey = app => "provider-menu." + app;
/// shared() key for the folded-away harness sections ({app: true}; persists).
const FOLD = "provider-menu.fold";
/// The last agents each machine reported — the same cache the agent-menu
/// clone keeps ("new-menu.agents"); the panel reads icons/tints from it.
const KNOWN = "new-menu.agents";

/// shared() key for acknowledged cross-machine launch pairs ("src>dst": true;
/// the panel asks once per pair before transporting a credential).
const BORROW = "provider-menu.borrowOk";

/// OSC 7501 app names → our harness keys (the focused-agent check).
const APP_OF = { "claude-code": "claude", codex: "codex" };

/// Run fn after this render settles (cx.spawn hands the body a fresh cx, so
/// nothing retains the render's own context beyond its callback).
const later = (cx, fn) => cx.spawn(async (cx) => { await cx.sleep(0); return fn(cx); });

// One copy at a time across EVERY instance of this mod in the process
// (a layout can dock the panel twice; each instance has its own this.xfer,
// so an instance-level guard alone let two owners run the same transfer —
// measured on the user's rig as two resumed agents).
let XFER = false;

/// The panel's own place in the shown layout: the block whose content.mod is
/// this mod and whose role is not "toggle" (the toggle is a separate block).
/// Returns [parent, node], or null when the layout doesn't mount the panel.
/// Discovery instead of a contracted node id, so the close button also works
/// for the app's auto-dock (a fresh random id) and for any hand-added block.
function findPanel(root) {
  const visit = (n, parent) => {
    if (n?.content?.mod === "provider-menu" && n.content.props?.role !== "toggle")
      return [parent, n];
    for (const child of n?.children ?? []) { const hit = visit(child, n); if (hit) return hit; }
    return null;
  };
  return visit(root, null);
}

/// What a close or a toggle aims at: the block itself, or the container that
/// holds nothing but the panel (a hand-added dock column, or the auto-dock
/// wrapper). Hiding only the block inside such a column would leave the
/// column's width on screen as an empty strip.
function panelTarget() {
  const found = findPanel(layout());
  if (!found) return null;
  const [parent, node] = found;
  return parent && (parent.children ?? []).length === 1 ? parent : node;
}

/// Whether the layout also mounts a toggle block (props.role === "toggle").
/// The close button is drawn only when it does: a hidden panel with no toggle
/// anywhere has no visible way back (only `herdr-app do layout.show`), so a
/// layout without the pill keeps the panel permanently shown instead. The
/// two blocks ship as a pair in the layout and in the recipe's install.
function hasToggle() {
  const visit = (n) => {
    if (n?.content?.mod === "provider-menu" && n.content.props?.role === "toggle") return true;
    return (n?.children ?? []).some(visit);
  };
  return visit(layout());
}

export default class ProviderMenu extends View {
  init(_props, cx) {
    // Toggle mode (props.role === "toggle"): the tab-bar pill that shows or
    // hides the docked panel. It reads nothing and stays cheap; the panel's
    // own init below is skipped entirely.
    if (props()?.role === "toggle") { this.isToggle = true; return; }
    // Dialog mode: the panel opens itself as a small overlay to edit the
    // per-machine extra args (props.mode === "args", the prompt-mod pattern),
    // or to confirm a cross-machine launch (props.mode === "borrow").
    if (props()?.mode === "borrow") {
      const p = props() ?? {};
      this.dialog = true;
      this.bProvider = p.provider;
      this.bApp = p.app;
      this.bSrc = typeof p.src === "string" ? p.src : "";
      this.bDst = typeof p.dst === "string" ? p.dst : "";
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    if (props()?.mode === "windows") {
      this.dialog = true;
      this.wName = typeof (props() ?? {}).machine === "string" ? props().machine : "";
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    if (props()?.mode === "args") {
      const p = props() ?? {};
      this.dialog = true;
      this.machine = typeof p.machine === "string" ? p.machine : "";
      this.input = InputState.new({ value: String((shared(EXTRA) ?? {})[this.machine] ?? "") });
      this.input.on("change", (_e, cx2) => cx2.notify());
      this.input.on("submit", () => this.saveArgs());
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
      this.handle = cx.focus_handle();
      return;
    }
    if (props()?.mode === "mcp") {
      this.dialog = true;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    // The move confirmation (T12): the staged session + target + provider
    // arrive as props (plain JSON); the dialog runs the transfer itself and
    // stays open while it runs — its context dies with closeOverlay, so
    // nothing may await after it (the Pass-42 lesson, applied from the
    // other side: keep the dialog alive until the last await is done).
    if (props()?.mode === "move") {
      const p = props() ?? {};
      this.dialog = true;
      this.mProvider = p.provider;
      this.mApp = p.app;
      this.mMove = p.move;
      this.mStat = "";
      this.mErr = false;
      this.mBusy = false;
      // The default comes from launch()'s probes (props.prompt): the new
      // root, the platform, the regenerables left behind — context the
      // resumed agent can act on, never the herdr machine name.
      this.mInput = InputState.new({ value: p.prompt ?? "continue — now at " + (p.move?.target?.dir ?? "") });
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    // The post-move modal (T12 ④): a fork decision the person must make —
    // the source agent keeps running with the whole conversation in
    // memory; continuing it there diverges from the moved copy. No Esc
    // chip and no escape close: one of the two buttons ends it.
    if (props()?.mode === "moved") {
      const p = props() ?? {};
      this.dialog = true;
      this.dAddress = typeof p.address === "string" ? p.address : "";
      this.dName = typeof p.name === "string" ? p.name : "";
      this.dProvider = typeof p.provider === "string" ? p.provider : "";
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    // One stacked section per harness: cached rows render at once, the reads
    // re-check below. A new harness in HARNESS appears here by itself.
    this.sections = Object.fromEntries(Object.keys(HARNESS).map(app => [app, shared(cacheKey(app)) ?? []]));
    this.fold = shared(FOLD) ?? {};
    this.src = shared(SRC) ?? {};
    this.agents = shared(KNOWN)?.[""] ?? []; // section icons render at once, re-check below
    this.note = "";
    this.launchNote = "";
    // An in-flight session move (T12): staged in shared() so it survives
    // panel restarts — the flow spans space switches and minutes.
    this.move = shared(MOVE) ?? null;
    this.movePrompt = null;
    this.wasHidden = null; // tri-state: null until the first render says shown/hidden
    // The docked panel owns the transfer (T12): dialog surfaces (mode) and
    // toggle blocks (role) must never race it. A busy flag that survives a
    // restart is a run the restart killed — convert it to a note instead of
    // letting the watcher auto-restart the copy unannounced.
    this.owner = !(_props?.mode || _props?.role);
    this.xfer = false;
    this.cancel = false;
    this.xstat = "";
    if (this.owner && this.move?.busy) {
      this.move = { ...this.move, busy: false, note: "Copy interrupted by a restart — start it again from a provider." };
      setShared(MOVE, this.move);
    }
    // check runs init for real but exec would warn: read-only, still skip it.
    if (!checking()) {
      this.refresh(cx);
      cx.spawn(async cx => {
        try {
          this.agents = await knownAgents();
          setShared(KNOWN, { ...shared(KNOWN), "": this.agents });
        } catch { /* section headers fall back to text-only */ }
        cx.notify();
      });
    }
    // A tab switch does not re-render a docked mod by itself, and the move
    // card's "current tab" section must follow the person's tabs live:
    // watch the shown tab of the active space and ping while a move is
    // staged and still waiting for its target (T12).
    cx.spawn(async cx => {
      let last = undefined;
      for (;;) {
        await cx.sleep(300);
        const space = spaces().find(s => s.active);
        const tab = space ? (space.tabs.find(t => t.active)?.id ?? null) : null;
        if (tab !== last) {
          last = tab;
          if (this.move && !this.move.target) cx.notify();
        }
        // Transfer ownership (T12): the dialog's Copy hands off by flipping
        // busy; the owning panel starts the run within one tick. Esc cannot
        // reach it — a docked view has no overlay to close.
        if (this.owner && this.move?.busy && !this.xfer) this.runCopy(cx);
      }
    });
  }

  saveArgs() {
    const all = shared(EXTRA) ?? {};
    all[this.machine] = this.input.value();
    setShared(EXTRA, all);
    closeOverlay(props().overlay);
  }

  refresh(cx) {
    cx.spawn(async cx => {
      const machine = spaces().find(s => s.active)?.machine ?? null;
      try {
        const reads = await Promise.all(Object.keys(HARNESS).map(async app => {
          const rows = await readProviders(machine, app);
          setShared(cacheKey(app), rows);
          return [app, rows];
        }));
        this.sections = Object.fromEntries(reads);
        this.src = Object.fromEntries(Object.keys(HARNESS).map(app => [app, machine ?? ""]));
        setShared(SRC, this.src);
        this.note = "";
      } catch (e) {
        this.note = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  /// The refresh button's label = the machine the shown lists came from
  /// (space.machine is the hc machine name; "" is this computer) — the
  /// cross-machine borrow pattern (REVIEW Pass 33) makes the source visible.
  srcLabel() {
    const src = this.src[Object.keys(HARNESS)[0]];
    if (src === undefined) return "refresh";
    const name = src === "" ? "this machine" : src;
    return name.length > 12 ? name.slice(0, 11) + "…" : name;
  }

  /// A cross-machine launch (the shown list came from another machine than
  /// the active space — REVIEW Pass 33) only needs consent when the launch
  /// would PERSIST the credential: with the RAM handoff (Pass 37, /dev/shm)
  /// nothing lands on disk and the command line stays clean, so no dialog.
  /// Machines without /dev/shm (macOS) fall back to the inline argv — there
  /// the first launch per source>target pair asks (Pass 36).
  launch(p, cx, app) {
    // T12: an armed move reroutes the provider click — same harness, other
    // machine, and the confirm dialog runs the transfer. While a transfer
    // runs, the card owns the click: one copy at a time.
    if (this.move?.busy) {
      this.launchNote = "Copy: a transfer is running — cancel it or let it finish first.";
      cx.notify(); return;
    }
    if (this.move?.armed && this.move?.target?.gate?.ok) {
      const dst = spaces().find(s => s.active)?.machine ?? "";
      if (app !== this.move.app) {
        this.launchNote = "Copy: the staged session is " + HARNESS[this.move.app].title + " — pick a " + HARNESS[this.move.app].title + " provider.";
        cx.notify(); return;
      }
      if (dst === this.move.src) {
        this.launchNote = "Copy: still on the source machine — switch spaces first.";
        cx.notify(); return;
      }
      cx.spawn(async cx => {
        const m = this.move;
        try {
          // The copy's two ends come from the staged state, not from the
          // space the panel happens to sit in now (arming survives a space
          // switch); "" is this machine and exec wants null for it.
          const src = m.src === "" ? null : m.src;
          const dstT = m.target.machine === "" ? null : m.target.machine;
          const [platform, excluded, srcBranch, dstBranch, drift] = await Promise.all([
            targetPlatform(dstT), excludedPresent(src, m.root),
            readGitBranch(src, m.root), readGitBranch(dstT, m.target.dir),
            countDrift(dstT, m.target.dir, m.target.gate?.marker),
            // A previous run canceled mid-transfer leaves pack artifacts at
            // deterministic paths on both machines — this is the first
            // re-entry point, so sweep them before the dialog even opens.
            cleanupPacks(src, dstT, slugOf(m.root)),
          ]);
          openOverlay({ mod: "provider-menu", kind: "dialog", width: 560, height: 340,
            props: { mode: "move", provider: p, app, move: { ...m, address: m.address ?? "" },
              prompt: defaultPrompt(m.target.dir, platform, excluded),
              drift, srcBranch, dstBranch } });
        } catch (e) {
          // A dead probe must not kill the click silently — the dialog's go()
          // re-runs the gate authoritatively, these only dress it up.
          this.launchNote = "Copy: could not prepare the dialog (" + String(e?.message ?? e) + ") — try again.";
        }
        cx.notify();
      });
      return;
    }
    const src = this.src[app] ?? null;
    const dst = spaces().find(s => s.active)?.machine ?? "";
    cx.spawn(async cx => {
      // T3 gate first: a Windows target cannot take provider launches at all.
      if (await machinePlatform(dst === "" ? null : dst) === "windows") {
        openOverlay({ mod: "provider-menu", kind: "dialog", width: 520, height: 250, props: { mode: "windows", machine: dst } });
        cx.notify();
        return;
      }
      if (src !== null && src !== dst && !((shared(BORROW) ?? {})[src + ">" + dst])
        && !(await handoffAvailable(dst === "" ? null : dst))) {
        openOverlay({ mod: "provider-menu", kind: "dialog", width: 560, height: 310, props: { mode: "borrow", provider: p, app, src, dst } });
        cx.notify();
        return;
      }
      this.doLaunch(p, cx, app);
    });
  }

  doLaunch(p, cx, app) {
    this.launchNote = "";
    cx.spawn(async cx => {
      const space = spaces().find(s => s.active);
      try {
        // src = the machine the shown cards came from: the MCP set (when the
        // per-machine switch carries it) must come from the same database.
        const src = this.src[app] ?? space?.machine ?? "";
        const argv = await launchArgv(p, [], space?.machine ?? null, app, src);
        run("tab.new", { name: HARNESS[app].title + " (" + p.name + ")", space: space?.id, argv });
      } catch (e) {
        this.launchNote = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  /// One honest hint per failure mode; never a silently empty list (DESIGN.md §4.5).
  hint() {
    if (/sqlite3|not found|no such file|cannot start/i.test(this.note))
      return "sqlite3 is missing — macOS has it built in; Linux: sudo apt install sqlite3; Windows: winget install SQLite.SQLite. Then ↻";
    if (/cc-switch\.db|unable to open/i.test(this.note))
      return "cc-switch's database was not found (~/.cc-switch/cc-switch.db). Add a provider in cc-switch first, then ↻";
    return "Could not read providers: " + this.note;
  }

  /// One provider card. pl(24) aligns the card's text with its section
  /// TITLE above it: section headers are px(6) + 12px icon + gap(6).
  row(p, i, app) {
    const t = theme();
    // A card herdr cannot rebuild per-launch (claude: official OAuth, routed
    // contract; codex: official, router-only, keyless — see providers.js
    // classify): cc-switch switches it, we don't; the note says why.
    if (p.launchable === false) {
      return h_flex().id("provider-" + app + "-" + i).h(30).pl(24).pr(9).gap(8).items_center().rounded(6)
        .text_color(t.dim)
        .on_click((_e, cx) => {
          this.launchNote = cardNote(p, app);
          cx.notify();
        })
        .child(div().flex_1().child(p.name))
        .child(div().text_size(10).text_color(t.dim).child("cc-switch"));
    }
    // Inert while a transfer runs (the launch guard answers the click
    // with a sentence): dimmed, no hover — one copy at a time.
    const lock = !!this.move?.busy;
    return h_flex().id("provider-" + app + "-" + i).h(30).pl(24).pr(9).gap(8).items_center().rounded(6)
      .text_color(lock ? t.dim : t.foreground)
      .when(!lock, el => el.hover(s => s.bg(t.selected)))
      .on_click((_e, cx) => this.launch(p, cx, app))
      .child(div().flex_1().child(p.name))
      .when(p.current, el => el.child(div().text_size(10).text_color(t.dim).child("current")));
  }

  /// Fold-all / expand-all for the harness sections, right above them: two
  /// bordered chips (the Pass-21 control idiom — no native Button in the SDK).
  /// Both stay active; a no-op click is harmless and keeps each direction one
  /// click away regardless of the current fold mix.
  foldRow() {
    const t = theme();
    const chip = (id, label, act) => h_flex().id(id).h(18).px(7).items_center().rounded(6)
      .border_1().border_color(t.input).bg(t.raised).cursor_pointer()
      .hover(s => s.bg(t.selected))
      .on_click((_e, cx) => act(cx))
      .child(div().text_size(10).child(label));
    return h_flex().id("fold").h(26).px(6).gap(6).items_center()
      .child(div().text_size(10.5).text_color(t.dim).child("sections"))
      .child(div().flex_1())
      .child(chip("fold-all", "Fold all", cx => {
        this.fold = Object.fromEntries(Object.keys(HARNESS).map(a => [a, true]));
        setShared(FOLD, this.fold); cx.notify();
      }))
      .child(chip("expand-all", "Expand all", cx => {
        this.fold = {}; setShared(FOLD, this.fold); cx.notify();
      }));
  }

  /// One harness section: a clickable header (icon + title, count and a ▾/▸
  /// on the right — same arrow semantics as the agent-menu submenus — and
  /// "not installed" when knownAgents says so). Clicking folds the section
  /// away (state persists via FOLD); cards indent under the title. The
  /// chevron stays on the right so the title's x-position (and the cards'
  /// pl(24) alignment with it) never moves.
  section(app) {
    const t = theme();
    const rows = this.sections[app] ?? [];
    const folded = Boolean(this.fold[app]);
    const a = this.agents.find(x => x.key === app);
    const icon = a?.tint ? svg(a.icon).size(12).text_color(t.dim) : a ? image(a.icon).size(12) : null;
    return v_flex().id("section-" + app).pt(4)
      .child(h_flex().id("section-" + app + "-head").h(20).px(6).gap(6).items_center()
        .rounded(6).cursor_pointer().hover(s => s.bg(t.raised))
        .on_click((_e, cx) => { this.fold = { ...this.fold, [app]: !folded }; setShared(FOLD, this.fold); cx.notify(); })
        .when(icon, el => el.child(icon))
        .child(div().font_semibold().text_color(a && a.installed === false ? t.dim : t.foreground).child(HARNESS[app].title))
        .when(a && a.installed === false, el => el.child(div().text_size(10).text_color(t.dim).child("not installed")))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(t.dim).child(rows.length ? String(rows.length) : ""))
        .child(div().text_size(10).text_color(t.dim).child(folded ? "▸" : "▾")))
      .when(!folded, el => el.children(rows.length === 0
        ? [div().id("empty-" + app).pl(24).py(5).text_size(11).text_color(t.dim)
          .child("No " + HARNESS[app].title + " providers yet — add some in cc-switch.")]
        : rows.map((p, i) => this.row(p, i, app))));
  }

  /// The person's recorded extra args for this machine — always visible in
  /// the panel, one click to edit. The mod itself never adds flags (§4.1);
  /// this row is the one honest place a flag can enter a launch. The Edit
  /// chip carries the affordance: no native Button exists in the mod SDK —
  /// shipped mods hand-roll controls from flex + border + hover (platform
  /// idiom, e.g. tabs' panelButton); this follows it.
  argsRow() {
    const t = theme();
    const machine = spaces().find(s => s.active)?.machine ?? "";
    const cur = String((shared(EXTRA) ?? {})[machine] ?? "");
    return h_flex().id("args").h(26).px(6).mt(2).gap(8).items_center().rounded(6)
      .hover(s => s.bg(t.raised)).cursor_pointer()
      .on_click(() => openOverlay({ mod: "provider-menu", kind: "dialog", width: 520, height: 236, props: { mode: "args", machine } }))
      .child(div().text_size(10.5).text_color(t.dim).child("args"))
      .child(div().flex_1().text_size(10.5).text_color(t.dim)
        .child(cur ? (cur.length > 34 ? cur.slice(0, 33) + "…" : cur) : "none"))
      .child(h_flex().id("args-edit").h(18).px(7).gap(3).items_center().rounded(6)
        .border_1().border_color(t.input).bg(t.raised)
        .child(div().text_size(10).child("Edit"))
        .child(div().text_size(10).child("›")));
  }

  /// Opt-in per-machine "resolve the CLI through the shell profile" mode:
  /// the launch becomes a bash -[l]ic command string, so aliases AND
  /// functions apply (word vectors carry functions only — aliases expand
  /// just while the shell parses a string). In rc mode the profile is the
  /// trust boundary: it runs before the CLI and may export over what
  /// env -u cleaned. Off by default; DESIGN.md §4.1. The switch pill is the
  /// affordance (no native Switch in the SDK — same hand-rolled idiom):
  /// accent track with the knob right when on, bordered track left when off.
  rcRow() {
    const t = theme();
    const machine = spaces().find(s => s.active)?.machine ?? "";
    const on = Boolean((shared(RC) ?? {})[machine]);
    return h_flex().id("rc").h(26).px(6).gap(8).items_center().rounded(6)
      .hover(s => s.bg(t.raised)).cursor_pointer()
      .on_click((_e, cx) => { const all = shared(RC) ?? {}; all[machine] = !all[machine]; setShared(RC, all); cx.notify(); })
      .child(div().text_size(10.5).text_color(on ? t.foreground : t.dim).child("rc profile"))
      .child(div().flex_1())
      .child(h_flex().id("rc-track").w(26).h(15).rounded(7).items_center().px(1)
        .when(on, el => el.bg(t.accent).justify_end())
        .when(!on, el => el.border_1().border_color(t.input))
        .child(div().w(11).h(11).rounded(5)
          .when(on, el => el.bg(t.surface))
          .when(!on, el => el.bg(t.dim))));
  }

  /// Opt-in per-machine MCP carry (T11): a launch into ANOTHER machine also
  /// takes the cc-switch MCP servers enabled here for that harness — Claude
  /// and Codex each carry their own set (one shared pool, per-harness flags).
  /// Same-machine launches never carry (the live config already has the
  /// set). The row carries three controls, so — unlike rc — the row itself
  /// is not clickable: the pill toggles, "only mine" narrows to the strict
  /// form (that session uses just the carried set), "?" opens the long-form
  /// help (no tooltips in the SDK; the dialog is the established surface).
  mcpRow() {
    const t = theme();
    const machine = spaces().find(s => s.active)?.machine ?? "";
    const on = Boolean((shared(MCP) ?? {})[machine]);
    const only = Boolean((shared(MCPONLY) ?? {})[machine]);
    return h_flex().id("mcp").h(26).px(6).gap(8).items_center().rounded(6)
      .hover(s => s.bg(t.raised))
      .child(div().text_size(10.5).text_color(on ? t.foreground : t.dim).child("mcp"))
      .when(on, el => el.child(h_flex().id("mcp-only").h(20).px(3).gap(5).items_center().rounded(6)
        .cursor_pointer().hover(s => s.bg(t.selected))
        .on_click((_e, cx) => { const all = shared(MCPONLY) ?? {}; all[machine] = !all[machine]; setShared(MCPONLY, all); cx.notify(); })
        .child(h_flex().id("mcp-only-box").size(13).flex_none().rounded(3).items_center().justify_center()
          .when(only, s => s.bg(t.accent))
          .when(!only, s => s.border_1().border_color(t.input))
          .when(only, s => s.child(div().text_size(9.5).text_color(t.surface).child("✓"))))
        .child(div().text_size(10.5).text_color(only ? t.foreground : t.dim).child("only mine"))))
      .child(div().flex_1())
      .child(h_flex().id("mcp-help").h(18).px(6).items_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(t.selected))
        .on_click(() => openOverlay({ mod: "provider-menu", kind: "dialog", width: 520, height: 380, props: { mode: "mcp" } }))
        .child(div().text_size(10).text_color(t.dim).child("?")))
      .child(h_flex().id("mcp-track").w(26).h(15).rounded(7).items_center().px(1).cursor_pointer()
        .when(on, el => el.bg(t.accent).justify_end())
        .when(!on, el => el.border_1().border_color(t.input))
        .on_click((_e, cx) => { const all = shared(MCP) ?? {}; all[machine] = !all[machine]; setShared(MCP, all); cx.notify(); })
        .child(div().w(11).h(11).rounded(5)
          .when(on, el => el.bg(t.surface))
          .when(!on, el => el.bg(t.dim))));
  }

  /// The "?" help for the mcp row: what carries, what stays, what "only
  /// mine" means, and where the tokens go — the same facts DESIGN.md §T11
  /// records, in panel-sized sentences.
  mcpDialog() {
    const t = theme();
    const p = props() ?? {};
    const line = (text, pt) => div().pt(pt).text_size(11.5).text_color(t.dim).child(text);
    return v_flex().id("provider-mcp").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).gap(2).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("MCP carry-over"))
        .child(this.escChip(p)))
      .child(div().pt(8).text_size(12.3)
        .child("When on, a launch into another machine also carries the MCP servers cc-switch has enabled here for that agent. Claude and Codex keep separate sets."))
      .child(line("Launches on this machine never carry: its own cc-switch has already written them into the live config.", 8))
      .child(line("The target keeps its own MCP definitions; carried ones are added, and on the same name the carried definition wins for that session.", 8))
      .child(line("Only mine: that session uses just the carried set — the target's own MCP servers stay off for it.", 8))
      .child(line("MCP definitions can hold tokens in their env. They travel the same RAM-only handoff as credentials; where the target has no /dev/shm they ride the launch command itself, and the cross-machine dialog asks first.", 8))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(h_flex().id("pm-ok").h(30).px(12).items_center().rounded(8)
          .border_1().border_color(t.solid).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
          .on_click(() => closeOverlay(p.overlay)).child("OK")));
  }

  // -------------------------------------------------------------------------
  // Session move (T12). Flow: stage the focused agent's session → switch to
  // a space on another machine, list its shells, pick one's cwd as the
  // target (gate: empty, or our lineage marker) → arm with the checkbox →
  // a provider click moves workspace + session and resumes under that
  // identity. The staging card docks to the panel bottom; only the provider
  // list scrolls (the layout rule for this feature).

  /// "prepare to move the active session": refresh to the current machine,
  /// find the focused agent terminal, resolve its cwd, find its session,
  /// stage it. Honest sentences for every way this can come up empty.
  startMove(cx) {
    this.launchNote = "";
    this.refresh(cx);
    cx.spawn(async cx => {
      if (this.move?.busy) {
        this.launchNote = "Copy: a transfer is running — cancel it or let it finish first.";
        cx.notify(); return;
      }
      let focus = null;
      try { focus = (await agents()).find(a => a.focused) ?? null; } catch { focus = null; }
      const app = focus ? APP_OF[focus.app] : null;
      if (!app) {
        this.launchNote = "Copy: the focused terminal is not a Claude Code or Codex session.";
        cx.notify(); return;
      }
      const space = spaces().find(s => s.id === focus.space);
      const machine = space?.machine ?? null;
      // The session's folder: the core that runs it lists the terminal's
      // cwd; the space's folder is the fallback (a remote core that cannot
      // be queried still stages, with the folder it starts terminals in).
      // The session's folder: the pane list's cwd is the shell's LIVE
      // folder. A terminal spawned elsewhere and cd'd into the project must
      // stage from where the session really is — hc ls reports the SPAWN
      // folder, which pointed discovery at the wrong project dir (measured
      // on the user's rig: the wrong session, after it had worked while
      // terminals happened to spawn in-project). hc ls stays as the
      // fallback, then the space's folder.
      let cwd = panes().find(p => p.terminal === focus.address)?.cwd ?? null;
      if (!cwd) {
        try {
          const r = machine ? await exec("hc", ["ls", "--json"], { on: machine }) : await hc(["ls", "--json"]);
          const t = (JSON.parse(r.stdout ?? "{}").terminals ?? []).find(t => t.address === focus.address);
          if (t?.cwd) cwd = t.cwd;
        } catch { /* folder fallback */ }
      }
      if (!cwd) cwd = space?.folder ?? null;
      if (!cwd) {
        this.launchNote = "Copy: could not read the session's folder.";
        cx.notify(); return;
      }
      const session = app === "codex" ? await findCodexSession(machine, cwd) : await findClaudeSession(machine, cwd);
      if (!session) {
        this.launchNote = "Copy: no " + (app === "codex" ? "codex rollout" : "claude session") + " under " + cwd + ".";
        cx.notify(); return;
      }
      const marker = await readMarker(machine, cwd);
      this.move = { src: machine ?? "", app, root: cwd, session, id: marker?.id ?? null, address: focus.address ?? "", target: null, armed: false, note: "" };
      this.movePrompt = null;
      setShared(MOVE, this.move);
      cx.notify();
    });
  }

  /// Every live shell on the machine of the active space (the target
  /// candidates the "list shells" chip offers). panes() walks EVERY pane
  /// of EVERY tab of EVERY space — machines included — so it must be
  /// scoped by machine: the tabs of every space of THAT machine, or the
  /// source machine's shells leak into the list (measured on the rig:
  /// they did). A pane's cwd is where its shell really is now (hc ls's
  /// cwd is the spawn folder, so a shell that cd'd since would list the
  /// wrong directory). Panes running an agent (status reported) never
  /// qualify.
  shellTargets(cx) {
    const cur = spaces().find(s => s.active)?.machine ?? "";
    const curName = cur === "" ? "this machine" : cur;
    if (cur === this.move.src) {
      this.move = { ...this.move, shells: null, note: "This is the source machine — switch to a space on another machine" };
      setShared(MOVE, this.move); cx.notify(); return;
    }
    const tabs = new Set(spaces()
      .filter(s => (s.machine ?? "") === cur)
      .flatMap(s => s.tabs.map(t => t.id)));
    const shells = [...new Set(panes()
      .filter(p => p.terminal && p.cwd && !p.status && tabs.has(p.tab))
      .map(p => String(p.cwd)))];
    this.move = { ...this.move, shells, note: shells.length ? "" : "No shells on " + curName + " — open one and cd to a directory" };
    setShared(MOVE, this.move);
    cx.notify();
  }

  /// The way back from a picked target: the promoted line leads with an ✕
  /// — clicking it clears the pick (the candidate rows return, the shell
  /// list survives, nothing is re-staged), disarms, and works for a
  /// refused pick too, which otherwise dead-ends the card.
  repickX() {
    const t = theme();
    // The boxed ✕: the same 13px box shape as the arm checkbox so the lead
    // column's controls read as one family, red because it drops the picked
    // target. The 16px cell stays the hit area.
    const lock = !!this.move?.busy;
    return h_flex().id("move-repick").size(16).flex_none().items_start().justify_center()
      .rounded(5)
      .when(!lock, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
      .on_click((_e, cx) => {
          if (this.move?.busy) return; // a run owns the pick until it ends
          this.move = { ...this.move, target: null, armed: false, note: "", err: "" }; setShared(MOVE, this.move); cx.notify();
        })
      .child(h_flex().size(13).mt(2).rounded(3).items_center().justify_center()
        .border_1().border_color(t.blocked).text_size(9.5).text_color(t.blocked).child("✕"));
  }

  /// One candidate row: a radio dot (the candidates — current tab and
  /// listed shells — are one single-choice group; a plain "›" row reads
  /// as text until hovered) and the cwd, truncated from the left.
  shellRow(id, dir) {
    const t = theme();
    const sel = this.move?.target?.dir === dir;
    return h_flex().id(id).pt(2).pl(8).pr(3).h(20).items_center().gap(5).rounded(6)
      .cursor_pointer().hover(s => s.bg(t.selected))
      .on_click((_e, cx) => this.pickTarget(cx, dir))
      .child(h_flex().size(16).flex_none().items_center().justify_center()
        .child(h_flex().size(11).items_center().justify_center()
          .rounded_full().border_1().border_color(sel ? t.accent : t.input)
          .when(sel, s => s.child(div().size(5).rounded_full().bg(t.accent)))))
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_size(12.5).text_color(sel ? t.foreground : t.dim)
        .child(dir.length > 32 ? "…" + dir.slice(-31) : dir));
  }

  /// Pick one shell's cwd as the target: the gate runs now (empty, lineage
  /// marker, or refused with the reason).
  pickTarget(cx, dir) {
    if (this.move?.busy) return;
    cx.spawn(async cx => {
      const machine = spaces().find(s => s.active)?.machine ?? null;
      if ((machine ?? "") === this.move.src) {
        this.move = { ...this.move, target: null, note: "This is the source machine — switch to another machine's space" };
        setShared(MOVE, this.move); cx.notify(); return;
      }
      const gate = await targetGate(machine, dir, this.move.id);
      this.move = { ...this.move, target: { machine: machine ?? "", dir, gate }, note: "" };
      setShared(MOVE, this.move);
      cx.notify();
    });
  }

  clearMove() {
    if (this.move?.busy) return; // a run owns the card until it ends
    this.move = null;
    this.movePrompt = null;
    setShared(MOVE, null);
  }

  /// The transfer itself (T12), owned by the PANEL instance: a docked view
  /// survives what an overlay does not — the app's Esc closes dialogs
  /// before a mod can see the key, and a task tied to the dialog's view is
  /// stranded mid-await with nothing of ours left running. Here the run has
  /// exactly one exit, the card's Cancel button. Cancellation is
  /// cooperative: the flag is checked between steps and from inside the
  /// transfer's progress callback, and because the task stays alive the
  /// abort path sweeps the pack artifacts off both machines AT ONCE.
  runCopy(cx) {
    if (XFER) return; // another instance already owns the run
    XFER = true;
    this.xfer = true;
    this.cancel = false;
    this.xstat = "listing the workspace…";
    const m = { ...this.move };
    cx.notify();
    cx.spawn(async cx => {
      try {
        const src = m.src === "" ? null : m.src;
        const dst = m.target.machine === "" ? null : m.target.machine;
        // Any pack artifacts a strand-era run left behind: both ends,
        // deterministic paths, best effort — then this run's own packing
        // starts from clean ground.
        await cleanupPacks(src, dst, slugOf(m.root));
        const manifest = await buildManifest(src, m.root);
        if (this.cancel) throw new Error("canceled");
        const id = m.id ?? newId();
        const gate = await targetGate(dst, m.target.dir, m.id ? id : null);
        if (!gate.ok) throw new Error(gate.reason);
        const plan = transferPlan(manifest, gate.marker);
        // The plan's shape names the phase: one tarball (chunks of it) or
        // file by file — the status must say which, or a chunk count reads
        // as "still copying one file at a time".
        const packed = planWantsPack(manifest, plan);
        this.xstat = packed ? "packing the workspace…" : "copying…"; cx.notify();
        await runTransfer(src, m.root, manifest, dst, m.target.dir, plan,
          (d, n) => {
            if (this.cancel) throw new Error("canceled");
            this.xstat = packed ? "sending the pack " + d + "/" + n : "copying file " + d + "/" + n;
            cx.notify();
          });
        if (this.cancel) throw new Error("canceled");
        this.xstat = "verifying…"; cx.notify();
        await verifyCopied(dst, m.target.dir, manifest, plan);
        if (this.cancel) throw new Error("canceled");
        await writeMarker(src, m.root, { v: 1, id, at: Date.now(), manifest: markerManifest(manifest) });
        await writeMarker(dst, m.target.dir, { v: 1, id, at: Date.now(), manifest: markerManifest(manifest) });
        this.xstat = "placing the session…"; cx.notify();
        if (m.app === "codex") await placeCodexSession(src, m.session, dst, m.target.dir);
        else await placeClaudeSession(src, m.session, dst, m.target.dir);
        const space = spaces().find(s => s.active);
        const prompt = (m.prompt ?? "").trim() || "continue";
        const argv = await launchArgv(m.provider, resumeArgs(m.app, m.session.uuid ?? m.session.id, prompt), dst, m.app, src);
        run("tab.new", { name: HARNESS[m.app].title + " (" + m.provider.name + ")", space: space?.id, argv });
        setShared(MOVE, null);
        openOverlay({ mod: "provider-menu", kind: "dialog", width: 520, height: 250, props: { mode: "moved", address: m.address ?? "", name: m.src === "" ? "this machine" : m.src, provider: m.provider.name } });
      } catch (e) {
        const msg = String(e?.message ?? e);
        try { await cleanupPacks(m.src === "" ? null : m.src, m.target.machine === "" ? null : m.target.machine, slugOf(m.root)); } catch { /* best effort */ }
        setShared(MOVE, msg === "canceled"
          ? { ...m, busy: false, err: "", note: "Copy canceled — pack files were removed on both machines." }
          : { ...m, busy: false, err: "Copy failed: " + msg });
        cx.notify();
      } finally {
        XFER = false;
        this.xfer = false;
        this.xstat = "";
      }
    });
  }

  /// The docked staging card: session line, target lines (or the shell
  /// list), the arming checkbox and the prompt once a target passed the
  /// gate. Kept compact — it docks, the provider list scrolls (T12's rule).
  moveCard() {
    const t = theme();
    const m = this.move;
    if (!m) return null;
    const cur = spaces().find(s => s.active)?.machine ?? "";
    // Machine names cap at 12 chars with an ellipsis — the header chip's
    // convention — so a long name cannot narrow the path column into a
    // tall stack of wrapped slivers.
    const nm = s => s.length > 12 ? s.slice(0, 11) + "…" : s;
    const srcName = nm(m.src === "" ? "this machine" : m.src);
    const line = (id, text, pt) => div().id(id).pt(pt).text_size(12.5).text_color(t.dim).child(text);
    // A group label: one step under its rows, sitting at the margin while
    // the rows indent under it — the card's hierarchy cue.
    const label = (id, text, pt = 0) => div().id(id).pt(pt).text_size(11).text_color(t.dim).child(text);
    return v_flex().id("move-card").flex_none().mt(2).px(6).py(6).gap(2).rounded(6).bg(t.raised)
      .child(h_flex().items_center().gap(6)
        .child(div().text_size(12.5).font_semibold()
          .child((m.target?.gate?.kind === "resume" ? "Update" : "Copy") + " " + HARNESS[m.app].title + " session"))
        .child(div().flex_1())
        // Clear, not Cancel: the card's two Cancels (the run row, the
        // dialog) stop a run and KEEP the staging — this is the one control
        // that drops the whole staged card, so it gets its own word, red
        // for the warning. Hidden while a transfer runs: the run's Cancel
        // is then the only live one.
        .when(!m.busy, el => el
          .child(h_flex().id("move-cancel").h(18).px(7).items_center().rounded(6)
            .border_1().border_color(t.blocked)
            .cursor_pointer().hover(s => s.bg(t.selected))
            .on_click(() => this.clearMove())
            .child(div().text_size(11).text_color(t.blocked).child("Clear")))))
      // The staged path is the card's subject — foreground, not dim. The
      // source line carries a selected radio (its own one-item group,
      // locked: the source is fixed until the card is cleared — decorative,
      // it says "chosen") in the same lead column as the pick rows' radios,
      // and the path sits on its own line indented under the label,
      // wrapping at the panel's edge with every line at that indent.
      .child(h_flex().id("move-src").pt(2).pl(8).pr(3).min_h(20).items_start().gap(5)
        .child(h_flex().size(16).flex_none().items_start().justify_center()
          .child(h_flex().size(11).mt(2).items_center().justify_center()
            .rounded_full().border_1().border_color("#15803d")
            .child(div().size(5).rounded_full().bg("#15803d"))))
        .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.dim).child("from " + srcName + ":")))
      .child(div().id("move-src-path").pl(29).pr(3).text_size(12.5).text_color(t.foreground)
        .child(m.root))
      .when(!m.target && cur === m.src, el => el.child(line("move-hint-src",
        "Switch to a space on another machine, open a shell there, cd to an empty directory", 2)))
      .when(!m.target && cur !== m.src, el => {
        // The current tab leads: its shells are what the person is looking
        // at right now, so they show without a click (init's watcher pings
        // on tab switches — a docked mod is not re-rendered by the switch
        // itself). The "list shells" chip below is the wider choice: every
        // shell on this machine, not just this tab.
        const tabId = spaces().find(s => s.active)?.tabs.find(t => t.active)?.id ?? null;
        const now = tabId === null ? [] : [...new Set(panes()
          .filter(p => p.terminal && p.cwd && !p.status && p.tab === tabId)
          .map(p => String(p.cwd)))];
        const nowSet = new Set(now);
        return el
          .when(now.length, e => e.children([
            label("move-cur", "current tab", 4),
            ...now.map((dir, i) => this.shellRow("move-cur-" + i, dir)),
          ]))
          .when(!m.shells, e => e.child(h_flex().id("move-list").pt(2).px(7).h(18).items_center().rounded(6)
            .border_1().border_color(t.input).cursor_pointer().hover(s => s.bg(t.selected))
            .on_click((_e, cx) => this.shellTargets(cx))
            .child(div().text_size(11).child("List shells on " + (cur === "" ? "this machine" : cur)))))
          .when(m.shells, e => e.children([
            h_flex().pt(4).items_center().gap(6)
              .child(label("move-shells-label", "shells on " + (cur === "" ? "this machine" : cur)))
              .child(div().flex_1())
              .child(h_flex().id("move-relist").h(18).px(7).items_center().rounded(6)
                .border_1().border_color(t.input).bg(t.raised).cursor_pointer()
                .hover(s => s.bg(t.selected))
                .on_click((_e, cx) => this.shellTargets(cx))
                .child(div().text_size(11).child("Refresh"))),
            ...m.shells.filter(d => !nowSet.has(d)).slice(0, 4).map((dir, i) => this.shellRow("move-shell-" + i, dir)),
          ]));
      })
      .when(m.note, el => el.child(line("move-note", m.note, 2)))
      .when(m.err, el => el.child(div().id("move-err").pt(2).text_size(12.5).text_color(t.blocked).child(m.err)))

      // The refused reason and the promoted line can outrun the 280px panel:
      // min_w(0) lets flex_1 actually bound the text (a flex item's
      // min-content width otherwise stretches it past the edge), the row
      // grows with the wrap instead of a fixed h(20) clipping it.
      .when(m.target && !m.target.gate.ok, el => el.child(h_flex().pt(2).pl(8).pr(3).min_h(20).items_start().gap(5)
        .child(this.repickX())
        .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.blocked)
          .child(m.target.dir + " — " + m.target.gate.reason + ". Pick another."))))
      .when(m.target && m.target.gate.ok, el => el
        // Mirrors the from-line one-for-one: label line with the boxed ✕
        // lead, then the target directory on its own line indented under
        // the label (it is where everything lands). The (first copy |
        // update) tag rides the path string — one string is what wraps
        // as a unit here.
        .child(h_flex().pt(2).pl(8).pr(3).min_h(20).items_start().gap(5)
          .child(this.repickX())
          .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.dim)
            .child("to " + nm(m.target.machine === "" ? "this machine" : m.target.machine) + ":")))
        .child(div().pl(29).pr(3).min_w(0).text_size(12.5).text_color(t.foreground)
          .child(m.target.dir + " (" + (m.target.gate.kind === "fresh" ? "first copy" : "update") + ")"))
        // The arm checkbox joins the pick column: radio dot → ✕ → box all
        // sit in the same 16px lead, so the promoted line and this label
        // start at the same x and the hover block matches a candidate row.
        .child(h_flex().id("move-arm").pt(3).pl(8).pr(3).min_h(20).items_start().gap(5).rounded(6)
          .when(!m.busy, e1 => e1.cursor_pointer().hover(s => s.bg(t.selected)))
          .on_click((_e, cx) => {
            if (this.move?.busy) return;
            this.move = { ...this.move, armed: !this.move.armed }; setShared(MOVE, this.move); cx.notify();
          })
          .child(h_flex().size(16).flex_none().items_start().justify_center()
            .child(h_flex().size(13).mt(2).rounded(3).items_center().justify_center()
              .when(m.armed, s => s.bg(t.accent))
              .when(!m.armed, s => s.border_1().border_color(t.input))
              .when(m.armed, s => s.child(div().text_size(9.5).text_color(t.surface).child("✓")))))
          // The verb names what clicking a provider will do: a first copy
          // copies, a marker'd target updates (the gate's own word — the
          // to-line tag says update, the sentence above the button must
          // not promise the other thing).
          .child(div().flex_1().min_w(0).text_size(12.5).text_color(m.armed ? t.foreground : t.dim)
            .child((m.target?.gate?.kind === "resume" ? "Update" : "Copy") + " the session and workspace above")))
        // The guidance zone: a hairline, then EITHER the run row or the
        // tips — the pick is done once a transfer runs, so the status and
        // its Cancel chip take the tips' place exactly (the card docks at
        // the panel's bottom; appending would push past the edge —
        // measured: clipped). The tips returns when the card is free.
        .when(m.armed, e2 => e2
          .child(div().id("move-pick-rule").mt(5).h(1).bg(t.input))
          .when(m.busy, e3 => e3.child(h_flex().pt(4).pl(0).pr(3).items_center().gap(6)
            .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.accent)
              .child(this.xstat || "copying…"))
            .child(h_flex().id("move-cancel-run").h(18).px(7).flex_none().items_center().rounded(6)
              .border_1().border_color(t.input).bg(t.raised).cursor_pointer()
              .hover(s => s.bg(t.selected))
              .on_click((_e, cx) => { this.cancel = true; this.xstat = "canceling…"; cx.notify(); })
              .child(div().text_size(11).child("Cancel")))))
          .when(!m.busy, e3 => e3.child(div().id("move-pick").pt(4).text_size(12.5)
            .text_color("#a16207").child("Pick a " + HARNESS[m.app].title + " provider above to " + (m.target?.gate?.kind === "resume" ? "update" : "copy") + " and resume")))));
  }

  /// The move confirmation + transfer progress (T12). Runs the whole move:
  /// manifest → gate → transfer (both ends stamped) → session placed → the
  /// resumed launch under the picked identity → the fork modal. The dialog
  /// STAYS OPEN through the transfer (context lifetime); the launch happens
  /// after closeOverlay with no await in between.
  moveDialog() {
    const t = theme();
    const p = props() ?? {};
    const m = this.mMove ?? {};
    const go = cx => {
      // The handoff, not the run: the transfer lives in the PANEL instance
      // — a docked view Esc cannot kill (the app closes overlays before a
      // mod sees the key, and a task tied to the dialog's view dies with
      // it, mid-await, leaving none of our code running). The dialog hands
      // the run over by flipping busy and closes itself; the panel's
      // watcher starts the copy within 300ms. Cancel is therefore a real
      // button on the card, a capturable on_click — the only exit.
      const prompt = (this.mInput ? this.mInput.value() : "").trim();
      setShared(MOVE, { ...m, busy: true, prompt, provider: this.mProvider });
      closeOverlay(p.overlay);
    };
    const btn = (id, label, solid, act) => h_flex().id(id).h(30).px(12).items_center().rounded(8)
      .border_1().border_color(solid ? t.solid : t.input)
      .when(solid, el => el.bg(t.solid).text_color(t.solid_foreground))
      .cursor_pointer().hover(s => s.bg(solid ? t.solid : t.raised))
      .on_click((_e, cx) => act(cx)).child(label);
    const line = (text, pt) => div().pt(pt).text_size(11.5).text_color(t.dim).child(text);
    return v_flex().id("move-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape" && !this.mBusy) { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).gap(2).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(m.target?.gate?.kind === "resume" ? "Update session" : "Copy session"))
        .when(!this.mBusy, el => el.child(this.escChip(p))))
      .child(div().pt(8).text_size(12.3)
        .child((this.mProvider?.name ?? "This provider") + " resumes the staged " + HARNESS[m.app]?.title + " session on " + (m.target?.machine === "" ? "this machine" : m.target?.machine) + "."))
      .child(line("Workspace " + m.root + " copies to " + m.target?.dir + " — every file, including any .env or credentials it holds. The transcript lands in that machine's home.", 8))
      .child(line("Regenerables stay behind and are reinstalled there: " + EXCLUDE.slice(0, 6).join(", ") + ", …", 8))
      .when(p.drift > 0, el => el.child(line("The target drifted since the last copy: " + p.drift + " file" + (p.drift === 1 ? "" : "s") + " differ"
        + (p.srcBranch && p.dstBranch && p.srcBranch !== p.dstBranch
          ? " (source on " + p.srcBranch + ", target on " + p.dstBranch + ")" : "")
        + " — copying overwrites the target's versions.", 8)))
      .when(!this.mBusy && this.mInput, el => el.child(div().pt(10)
        .child(Input.new(this.mInput).h(32).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12))))
      .when(!this.mBusy && this.mInput, el => el.child(line("First message to the resumed session — its history mentions the old machine, a note helps.", 4)))
      // Progress and errors share a field-style box (the input row's own
      // look): while busy the line carries the accent color — activity,
      // not prose; a failure turns both the border and the text blocked.
      .when(this.mStat, el => el.child(div().pt(10).px(10).py(7).rounded(9)
        .border_1().border_color(this.mErr ? t.blocked : t.input).bg(t.background)
        .child(div().text_size(11.5)
          .text_color(this.mErr ? t.blocked : (this.mBusy ? t.accent : t.dim))
          .child(this.mStat))))
      .child(h_flex().pt(16).gap(8).justify_end()
        .when(!this.mBusy, el => el
          .child(btn("md-cancel", "Cancel", false, cx => closeOverlay(p.overlay)))
          .child(btn("md-go", m.target?.gate?.kind === "resume" ? "Update" : "Copy", true, go))));
  }

  /// The fork decision (T12 ④): the source agent still holds the whole
  /// conversation. Keeping it risks divergence; stopping it ends it. The
  /// two buttons are the honest choices; Esc lands on the conservative one
  /// (keep) — see the note at the render below.
  movedDialog() {
    const t = theme();
    const p = props() ?? {};
    const done = () => { closeOverlay(p.overlay); };
    const btn = (id, label, solid, act) => h_flex().id(id).h(30).px(12).items_center().rounded(8)
      .border_1().border_color(solid ? t.solid : t.input)
      .when(solid, el => el.bg(t.solid).text_color(t.solid_foreground))
      .cursor_pointer().hover(s => s.bg(solid ? t.solid : t.raised))
      .on_click((_e, _cx) => act()).child(label);
    // Esc: the app's built-in Overlay binding closes any dialog before a
    // mod's key handler can see the key (measured in the sandbox: the
    // handler never fires). The fork modal therefore accepts Esc as an
    // implicit "Keep it (may diverge)" — the conservative choice: stopping
    // the source agent is the destructive one. Upstream ask: an overlay
    // option that makes a required-choice dialog undismissable.
    return v_flex().id("moved-dialog").track_focus(this.handle)
      .w_full().min_h(0).p(18).gap(2).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Session copied")))
      .child(div().pt(8).text_size(12.3)
        .child("The session now runs on its new machine under " + this.dProvider + "."))
      .child(div().pt(8).text_size(12.3)
        .child("The source agent on " + this.dName + " is still live with the same conversation. Continuing it there will diverge from the new copy."))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(btn("dd-stop", "Stop the source agent", true, () => { if (this.dAddress) run("terminal.kill", { terminal: this.dAddress }); done(); }))
        .child(btn("dd-keep", "Keep it (may diverge)", false, done)));
  }

  argsDialog() {
    const t = theme();
    const p = props() ?? {};
    return v_flex().id("provider-args").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Extra launch args"))
        .child(this.escChip(p)))
      .child(div().pt(4).text_size(11.5).text_color(t.dim)
        .child(this.machine ? "appended to every launch on machine " + this.machine : "appended to every launch on this machine"))
      .child(div().pt(12).child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8)))
      .child(div().pt(6).text_size(11.5).text_color(t.dim)
        .child("Shell-style words; quotes group. Example: --allow-dangerously-skip-permissions. Empty means none. Recorded by the user; visible in the panel and in the launch argv."))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(h_flex().id("pa-cancel").h(30).px(12).items_center().rounded(8).border_1().border_color(t.input).bg(t.raised).cursor_pointer()
          .on_click(() => closeOverlay(p.overlay)).child("Cancel"))
        .child(h_flex().id("pa-save").h(30).px(12).items_center().rounded(8).border_1().border_color(t.solid).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
          .on_click(() => this.saveArgs()).child("Save")));
  }

  /// A clickable Esc chip for dialog title rows (the key handler stays for
  /// keyboards; the chip is the visible, clickable affordance).
  escChip(p) {
    const t = theme();
    return h_flex().id("esc").h(18).px(6).items_center().rounded(5)
      .text_size(11).text_color(t.dim).cursor_pointer()
      .hover(s => s.bg(t.raised))
      .on_click(() => closeOverlay(p.overlay)).child("Esc");
  }

  /// The cross-machine launch confirmation (Pass 35/36): what lands where,
  /// and the way out (launch from the target's own database). The launch
  /// happens BEFORE the overlay closes — spawning on this dialog's context
  /// after close would be torn down with it (first await never resumes;
  /// the bug behind a dead Proceed button, Pass 42).
  borrowDialog() {
    const t = theme();
    const p = props() ?? {};
    const name = m => m === "" ? "this machine" : m;
    const go = cx => {
      this.bNote = "";
      cx.spawn(async cx => {
        const space = spaces().find(s => s.active);
        try {
          const argv = await launchArgv(this.bProvider, [], space?.machine ?? null, this.bApp, this.bSrc);
          closeOverlay(p.overlay);
          run("tab.new", { name: HARNESS[this.bApp].title + " (" + this.bProvider.name + ")", space: space?.id, argv });
        } catch (e) {
          this.bNote = String(e?.message ?? e);
          cx.notify();
        }
      });
    };
    const always = cx => {
      const all = shared(BORROW) ?? {};
      all[this.bSrc + ">" + this.bDst] = true;
      setShared(BORROW, all);
      go(cx);
    };
    const btn = (id, label, solid, act) => h_flex().id(id).h(30).px(12).items_center().rounded(8)
      .border_1().border_color(solid ? t.solid : t.input)
      .when(solid, el => el.bg(t.solid).text_color(t.solid_foreground))
      .cursor_pointer().hover(s => s.bg(solid ? t.solid : t.raised))
      .on_click((_e, cx) => act(cx)).child(label);
    return v_flex().id("borrow-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).gap(2).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Cross-machine launch"))
        .child(this.escChip(p)))
      .child(div().pt(8).text_size(12.3)
        .child((this.bProvider?.name ?? "This provider") + " comes from " + name(this.bSrc) + "'s database. The launch runs on " + name(this.bDst) + "."))
      .child(div().pt(8).text_size(12.3)
        .child("The credential (and any carried MCP definitions) travels in the launch command. Herdr's core on " + name(this.bDst) + " records that command in its state file terminals.json. The record stays after the terminal closes; nothing cleans it automatically. Live sessions also show the command in /proc."))
      .child(div().pt(8).text_size(11.5).text_color(t.dim)
        .child("To keep a credential off a machine, launch from that machine's own database instead."))
      .when(this.bNote, el => el.child(div().pt(8).text_size(11.5).text_color(t.dim).child(this.bNote)))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(btn("bd-cancel", "Cancel", false, cx => closeOverlay(p.overlay)))
        .child(btn("bd-always", "Always for this pair", false, always))
        .child(btn("bd-proceed", "Proceed", true, go)));
  }

  /// The T3 gate dialog: this space's machine runs Windows; provider launches
  /// need the not-yet-built Windows recipes. Plain agent rows still work.
  windowsDialog() {
    const t = theme();
    const p = props() ?? {};
    const name = this.wName === "" ? "this machine" : this.wName;
    return v_flex().id("windows-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).gap(2).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Windows machine"))
        .child(this.escChip(p)))
      .child(div().pt(8).text_size(12.3)
        .child("This space runs on " + name + ". Provider launches use env, bash and /dev/shm — the Windows recipes are not built yet."))
      .child(div().pt(8).text_size(11.5).text_color(t.dim)
        .child("Plain agent rows still work. Reading this machine's database works too — launch from another machine's space to use its providers."))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(h_flex().id("wd-ok").h(30).px(12).items_center().rounded(8)
          .border_1().border_color(t.solid).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
          .on_click(() => closeOverlay(p.overlay)).child("OK")));
  }

  /// The stage button row (T12): one click stages the focused session.
  /// Always available — restaging just picks the session now in focus.
  moveRow() {
    const t = theme();
    // While a transfer runs the row is inert: one copy at a time, and the
    // card below is the run's whole UI.
    const lock = !!this.move?.busy;
    return h_flex().id("moverow").h(26).px(6).gap(8).items_center().rounded(6)
      .when(!lock, el => el.hover(s => s.bg(t.raised)).cursor_pointer())
      .on_click((_e, cx) => this.startMove(cx))
      // The feature's entry point: the header's own size and color, caps,
      // and a solid green Stage chip (the from-radio's green) — a meta-row
      // at 10.5 dim measured as too easy to miss.
      .child(div().text_size(12.5).child("COPY SESSION"))
      .child(div().flex_1())
      .child(h_flex().id("move-stage").h(18).px(7).items_center().rounded(6)
        .bg("#15803d")
        .child(div().text_size(11).text_color("#ffffff").child("STAGE ›")));
  }

  /// The tab-bar toggle pill: one click shows or hides the docked panel. The
  /// layout node's own hidden flag is the state — the same node the panel's
  /// close button hides — so the two controls always agree and open/closed
  /// survives restarts (the skillshare pattern; our node is discovered rather
  /// than contracted by id). Inert when the layout doesn't mount the panel.
  toggleBar() {
    const t = theme();
    const target = panelTarget();
    const on = Boolean(target && !target.hidden);
    return h_flex().size_full().pl(6).pr(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("panel-toggle").h(26).px(9).items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).cursor_pointer()
        .on_click(() => { if (target) run("layout.toggle", { id: target.id }); })
        .child("Providers"));
  }

  /// The header's close ×: hides the panel's layout node. Drawn only when a
  /// toggle block exists to bring the panel back (closable above): a layout
  /// without the pill keeps the panel permanently shown rather than closable
  /// with no visible way back.
  closeChip(t, target) {
    return h_flex().id("close").size(20).flex_none().items_center().justify_center().rounded(6)
      .text_size(11).text_color(t.dim).cursor_pointer()
      .hover(s => s.bg(t.selected))
      .on_click(() => run("layout.hide", { id: target.id }))
      .child("✕");
  }

  render(cx) {
    if (this.isToggle) return this.toggleBar();
    if (this.dialog) return props()?.mode === "windows" ? this.windowsDialog()
      : props()?.mode === "borrow" ? this.borrowDialog()
      : props()?.mode === "mcp" ? this.mcpDialog()
      : props()?.mode === "move" ? this.moveDialog()
      : props()?.mode === "moved" ? this.movedDialog()
      : this.argsDialog();
    const t = theme();
    const unix = window()?.platform !== "windows";
    // Re-read when the panel comes back from hidden (the toggle reopened it):
    // cached rows render at once either way; the reveal is the one moment a
    // stale cache would otherwise sit on screen unchallenged.
    const target = panelTarget();
    // The ✕ needs its way back: draw it only when a toggle block exists in
    // the layout to reopen the panel (see hasToggle). Target null → nothing
    // to close anyway.
    const closable = Boolean(target && hasToggle());
    const shownNow = Boolean(target && !target.hidden);
    if (shownNow && this.wasHidden === true && !checking()) later(cx, cx2 => this.refresh(cx2));
    this.wasHidden = !shownNow;
    // The copy dialog is another mod instance: when it clears the staged
    // move via setShared, only a re-read here retires this panel's card —
    // init alone would leave it armed on screen until a restart.
    this.move = shared(MOVE);
    return v_flex().id("provider-menu").size_full().bg(t.surface).p(6).gap(2).text_size(12.5)
      .child(h_flex().id("header").px(6).py(4).gap(6).items_center()
        .child(div().font_semibold().child("Providers"))
        .child(div().text_size(11).text_color(t.dim).child("cc-switch"))
        .child(div().flex_1())
        .child(h_flex().id("refresh").h(20).px(7).gap(4).items_center().rounded(6)
          .border_1().border_color(t.input).bg(t.raised).cursor_pointer()
          .hover(s => s.bg(t.selected))
          .on_click((_e, cx) => this.refresh(cx))
          .child(div().text_size(11).child("↻"))
          .child(div().text_size(10).text_color(t.dim).child(this.srcLabel())))
        .when(closable, el => el.child(this.closeChip(t, target))))
      .child(this.argsRow())
      .child(this.rcRow())
      .child(this.mcpRow())
      .child(this.foldRow())
      .when(!unix, el => el.child(div().flex_1().px(6).py(8).text_color(t.dim)
        .child("Windows lands in Phase 2 (test T3).")))
      .when(unix && this.note, el => el.child(div().flex_1().px(6).py(8).text_color(t.dim).child(this.hint())))
      .when(unix && !this.note, el => el.child(v_flex().id("list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(Object.keys(HARNESS).map(app => this.section(app)))))
      .when(this.launchNote, el => el.child(div().px(6).py(6).text_color(t.dim)
        .child("Launch failed: " + this.launchNote)))
      // The move entry rides the panel's bottom edge — it has nothing to do
      // with the args/rc/mcp rows above. A staged move's card docks below
      // it at the very bottom, pushing the row up when it appears.
      .child(this.moveRow())
      .when(this.move, el => el.child(this.moveCard()));
  }
}
