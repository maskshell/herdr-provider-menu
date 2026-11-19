// herdr-provider-menu — Phase 0 (DESIGN.md §5.1): a docked picker proving
// read → merge → launch. Phase 1 moves this into the cloned new-menu as
// per-agent submenus; providers.js carries over unchanged.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, spaces, run, shared, setShared, window, checking, props, openOverlay, closeOverlay } from "herdr";
import { readProviders, launchArgv, CACHE, EXTRA, RC } from "./providers.js";

export default class ProviderMenu extends View {
  init(_props, cx) {
    // Dialog mode: the panel opens itself as a small overlay to edit the
    // per-machine extra args (props.mode === "args", the prompt-mod pattern).
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
    this.rows = shared(CACHE) ?? [];
    this.note = "";
    this.launchNote = "";
    // check runs init for real but exec would warn: read-only, still skip it.
    if (!checking()) this.refresh(cx);
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
        this.rows = await readProviders(machine);
        setShared(CACHE, this.rows);
        this.note = "";
      } catch (e) {
        this.note = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  launch(p, cx) {
    this.launchNote = "";
    cx.spawn(async cx => {
      const space = spaces().find(s => s.active);
      try {
        const argv = await launchArgv(p, [], space?.machine ?? null);
        run("tab.new", { name: "Claude (" + p.name + ")", space: space?.id, argv });
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

  row(p, i) {
    const t = theme();
    // Not an env-form API card (official OAuth, routed contract, malformed):
    // herdr cannot rebuild it per-launch; cc-switch switches it, we don't.
    if (p.launchable === false) {
      return h_flex().id("provider-" + i).h(30).px(9).gap(8).items_center().rounded(6)
        .text_color(t.dim)
        .on_click((_e, cx) => {
          this.launchNote = p.name + " is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.";
          cx.notify();
        })
        .child(div().flex_1().child(p.name))
        .child(div().text_size(10).text_color(t.dim).child("cc-switch"));
    }
    return h_flex().id("provider-" + i).h(30).px(9).gap(8).items_center().rounded(6)
      .text_color(t.foreground).hover(s => s.bg(t.selected))
      .on_click((_e, cx) => this.launch(p, cx))
      .child(div().flex_1().child(p.name))
      .when(p.current, el => el.child(div().text_size(10).text_color(t.dim).child("current")));
  }

  /// The person's recorded extra args for this machine — always visible in
  /// the panel, one click to edit. The mod itself never adds flags (§4.1);
  /// this row is the one honest place a flag can enter a launch.
  argsRow() {
    const t = theme();
    const machine = spaces().find(s => s.active)?.machine ?? "";
    const cur = String((shared(EXTRA) ?? {})[machine] ?? "");
    return h_flex().id("args").h(22).px(6).mt(2).gap(6).items_center().rounded(6)
      .hover(s => s.bg(t.raised)).cursor_pointer()
      .on_click(() => openOverlay({ mod: "provider-menu", kind: "dialog", width: 520, height: 236, props: { mode: "args", machine } }))
      .child(div().text_size(10.5).text_color(t.dim).child("args"))
      .child(div().flex_1().text_size(10.5).text_color(t.dim)
        .child(cur ? (cur.length > 40 ? cur.slice(0, 39) + "…" : cur) : "none"))
      .child(div().text_size(10.5).text_color(t.dim).child("edit"));
  }

  /// Opt-in per-machine "resolve claude through the shell profile" mode:
  /// the launch becomes a bash -[l]ic command string, so aliases AND
  /// functions apply (word vectors carry functions only — aliases expand
  /// just while the shell parses a string). In rc mode the profile is the
  /// trust boundary: it runs before claude and may export over what
  /// env -u cleaned. Off by default; DESIGN.md §4.1.
  rcRow() {
    const t = theme();
    const machine = spaces().find(s => s.active)?.machine ?? "";
    const on = Boolean((shared(RC) ?? {})[machine]);
    return h_flex().id("rc").h(22).px(6).gap(6).items_center().rounded(6)
      .hover(s => s.bg(t.raised)).cursor_pointer()
      .on_click((_e, cx) => { const all = shared(RC) ?? {}; all[machine] = !all[machine]; setShared(RC, all); cx.notify(); })
      .child(div().text_size(10.5).text_color(t.dim).child("rc profile"))
      .child(div().flex_1())
      .child(div().text_size(10.5).text_color(on ? t.accent : t.dim).child(on ? "on" : "off"));
  }

  argsDialog() {
    const t = theme();
    const p = props() ?? {};
    return v_flex().id("provider-args").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Extra launch args"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(4).text_size(11.5).text_color(t.dim)
        .child(this.machine ? "appended to every claude launch on machine " + this.machine : "appended to every claude launch on this machine"))
      .child(div().pt(12).child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8)))
      .child(div().pt(6).text_size(11.5).text_color(t.dim)
        .child("Shell-style words; quotes group. Example: --allow-dangerously-skip-permissions. Empty means none. Recorded by the user; visible in the panel and in the launch argv."))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(h_flex().id("pa-cancel").h(30).px(12).items_center().rounded(8).border_1().border_color(t.input).bg(t.raised).cursor_pointer()
          .on_click(() => closeOverlay(p.overlay)).child("Cancel"))
        .child(h_flex().id("pa-save").h(30).px(12).items_center().rounded(8).border_1().border_color(t.solid).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
          .on_click(() => this.saveArgs()).child("Save")));
  }

  render() {
    if (this.dialog) return this.argsDialog();
    const t = theme();
    const unix = window()?.platform !== "windows";
    return v_flex().id("provider-menu").size_full().bg(t.surface).p(6).gap(2).text_size(12.5)
      .child(h_flex().id("header").px(6).py(4).gap(6).items_center()
        .child(div().font_semibold().child("Claude providers"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("cc-switch"))
        .child(h_flex().id("refresh").px(5).rounded(4).hover(s => s.bg(t.raised))
          .on_click((_e, cx) => this.refresh(cx))
          .child(div().text_size(12).text_color(t.dim).child("↻"))))
      .child(this.argsRow())
      .child(this.rcRow())
      .when(!unix, el => el.child(div().px(6).py(8).text_color(t.dim)
        .child("Windows lands in Phase 2 (test T3).")))
      .when(unix && this.note, el => el.child(div().px(6).py(8).text_color(t.dim).child(this.hint())))
      .when(unix && !this.note, el => el.child(v_flex().id("list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(this.rows.length === 0
          ? [div().px(6).py(6).text_color(t.dim).child("No providers yet. Add some in cc-switch, then ↻.")]
          : this.rows.map((p, i) => this.row(p, i)))))
      .when(this.launchNote, el => el.child(div().px(6).py(6).text_color(t.dim)
        .child("Launch failed: " + this.launchNote)));
  }
}
