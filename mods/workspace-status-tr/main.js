// Modified copy of Herdr's shipped "workspace-status" mod (Apache-2.0, see NOTICE): Turkish/English UI and changes listed in the repo history.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, shared } from "herdr";

// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);
// A working agent shows a still green light (same green in the agents list, tabs and status bar).
const WORKING_GREEN = "#22c55e";

// Fixed identity hues (7-digit hex, so alpha suffixes stay valid): local machine matches the Settings
// button, remote machine matches "Add machine", branch matches the opencode/purple accent.
const LOCAL = "#9aa8ff", REMOTE = "#f0a868", BRANCH = "#b892f5";
// Most urgent first, same names as the agents list sections.
const STATES = [
  { status: "blocked", tr: "sizi bekliyor", en: "needs you" },
  { status: "working", tr: "çalışıyor", en: "working" },
  { status: "done", tr: "tamamlandı", en: "done" },
  { status: "idle", tr: "beklemede", en: "idle" },
];

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  paletteKeys() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl", ctrl: mac ? "⌃" : "Ctrl", shift: mac ? "⇧" : "Shift", alt: mac ? "⌥" : "Alt", option: mac ? "⌥" : "Alt" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    return (parts ?? []).filter(Boolean).map((p) => mod[p.toLowerCase()] ?? p.toUpperCase());
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const pill = (id, icon, text, color, tip) => h_flex().id(id).flex_none().h(20).px(7).gap(5).items_center().rounded(6)
      .border_1().border_color(color + "40").bg(color + "12").tooltip(tip)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12).flex_none().text_color(color))
      .child(div().max_w(160).truncate().text_size(11).font_medium().text_color(t.foreground).child(text));
    const counts = STATES.map(s => ({ ...s, n: list.filter(a => a.status === s.status).length })).filter(s => s.n > 0);
    const color = { blocked: t.blocked, working: WORKING_GREEN, done: t.done, idle: t.idle }; // working: green, as in the agents list and tabs
    const keycap = (k, i) => div().id("key-" + i).flex_none().h(16).px(4).flex().items_center().rounded(4).border_1().border_color(t.border)
      .bg(t.raised).text_size(10).font_medium().text_color(t.muted).child(k);
    const caps = this.paletteKeys();
    return h_flex().size_full().px(10).gap(8).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
      .child(space?.machine
        ? pill("machine", "server", space.machine, REMOTE, tx("Uzak makine", "Remote machine"))
        : pill("machine", "monitor", tx("Bu bilgisayar", "This computer"), LOCAL, tx("Yerel makine", "Local machine")))
      .when(Boolean(space?.branch), el => el.child(pill("branch", "git-branch", space.branch, BRANCH, tx("Git dalı", "Git branch"))))
      .child(div().w(1).h(14).flex_none().bg(t.border))
      // The summary is the one part that may give up width (clipped), so the palette button always stays visible.
      .child(h_flex().id("agent-summary").min_w(0).overflow_hidden().gap(10).items_center()
        .tooltip(tx("Tüm ajanların durumu", "Status of all agents"))
        .child(div().flex_none().font_medium().text_color(t.foreground).child(`${list.length} ${tx("ajan", "agents")}`))
        .children(counts.map(s => h_flex().id("agents-" + s.status).flex_none().gap(5).items_center()
          .child(div().size(6).flex_none().rounded(3).bg(color[s.status]))
          .child(div().text_color(s.status === "blocked" ? t.blocked : t.muted).when(s.status === "blocked", el => el.font_medium()).child(`${s.n} ${tx(s.tr, s.en)}`)))))
      .child(div().flex_1())
      .child(h_flex().id("palette").flex_none().gap(3).items_center().px(5).h(20).rounded(6).cursor_pointer().text_color(t.dim)
        .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tx("Komut paletini aç", "Open the command palette")).on_click(() => run("app.palette"))
        .children(caps.map(keycap))
        .child(div().pl(caps.length ? 3 : 0).child(tx("komutlar", "commands"))));
  }
}
