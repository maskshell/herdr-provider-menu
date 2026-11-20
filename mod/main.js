// herdr-provider-menu — Phase 0 (DESIGN.md §5.1): a docked picker proving
// read → merge → launch. Phase 1 moves this into the cloned new-menu as
// per-agent submenus; providers.js carries over unchanged.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, spaces, run, shared, setShared, window, checking, props, openOverlay, closeOverlay, knownAgents } from "herdr";
import { readProviders, launchArgv, handoffAvailable, machinePlatform, EXTRA, RC, HARNESS, cardNote } from "./providers.js";

/// shared() key for the last good read of one harness (instant open, re-check).
const cacheKey = app => "provider-menu." + app;
/// shared() key for the folded-away harness sections ({app: true}; persists).
const FOLD = "provider-menu.fold";
/// shared() key for the machine each harness list was last read from
/// ({app: name | ""} — "" is this computer; the refresh button shows it).
const SRC = "provider-menu.src";
/// The last agents each machine reported — the same cache the agent-menu
/// clone keeps ("new-menu.agents"); the panel reads icons/tints from it.
const KNOWN = "new-menu.agents";

/// shared() key for acknowledged cross-machine launch pairs ("src>dst": true;
/// the panel asks once per pair before transporting a credential).
const BORROW = "provider-menu.borrowOk";

export default class ProviderMenu extends View {
  init(_props, cx) {
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
    // One stacked section per harness: cached rows render at once, the reads
    // re-check below. A new harness in HARNESS appears here by itself.
    this.sections = Object.fromEntries(Object.keys(HARNESS).map(app => [app, shared(cacheKey(app)) ?? []]));
    this.fold = shared(FOLD) ?? {};
    this.src = shared(SRC) ?? {};
    this.agents = shared(KNOWN)?.[""] ?? []; // section icons render at once, re-check below
    this.note = "";
    this.launchNote = "";
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
        const argv = await launchArgv(p, [], space?.machine ?? null, app);
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
    return h_flex().id("provider-" + app + "-" + i).h(30).pl(24).pr(9).gap(8).items_center().rounded(6)
      .text_color(t.foreground).hover(s => s.bg(t.selected))
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
        .child(div().text_size(11.5).font_semibold().text_color(a && a.installed === false ? t.dim : t.foreground).child(HARNESS[app].title))
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
          const argv = await launchArgv(this.bProvider, [], space?.machine ?? null, this.bApp);
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
        .child("The credential travels in the launch command. Herdr's core on " + name(this.bDst) + " records that command in its state file terminals.json. The record stays after the terminal closes; nothing cleans it automatically. Live sessions also show the command in /proc."))
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

  render() {
    if (this.dialog) return props()?.mode === "windows" ? this.windowsDialog() : props()?.mode === "borrow" ? this.borrowDialog() : this.argsDialog();
    const t = theme();
    const unix = window()?.platform !== "windows";
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
          .child(div().text_size(10).text_color(t.dim).child(this.srcLabel()))))
      .child(this.argsRow())
      .child(this.rcRow())
      .child(this.foldRow())
      .when(!unix, el => el.child(div().px(6).py(8).text_color(t.dim)
        .child("Windows lands in Phase 2 (test T3).")))
      .when(unix && this.note, el => el.child(div().px(6).py(8).text_color(t.dim).child(this.hint())))
      .when(unix && !this.note, el => el.child(v_flex().id("list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(Object.keys(HARNESS).map(app => this.section(app)))))
      .when(this.launchNote, el => el.child(div().px(6).py(6).text_color(t.dim)
        .child("Launch failed: " + this.launchNote)));
  }
}
