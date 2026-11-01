// Modified copy of Herdr's shipped "workspace-chrome" mod (Apache-2.0, see NOTICE): Turkish/English UI and changes listed in the repo history.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      // Personal footer: Turkish labels, two equal pills, version line. Upstream: stock workspace-chrome (see cloned_from in mod.json).
      const u = updates(), ready = u.app.ready;
      // Each button has its own hue (7-digit hex, so alpha suffixes stay valid): tinted fill, border and icon.
      const pill = (id, icon, label, tip, action, badge, color) => h_flex().id(id).flex_1().min_w(0).h(collapsed ? 26 : 30).px(collapsed ? 0 : 10).gap(7).items_center()
        .when(collapsed, el => el.flex_none().justify_center()).rounded(7).border_1().border_color(color + "59").bg(color + "14")
        .text_color(t.foreground).hover(s => s.bg(color + "29").border_color(color + "99")).cursor_pointer().tooltip(tip).on_click(action)
        .child(svg(`mods/workspace-chrome-tr/${icon}.svg`).size(14).flex_none().text_color(color))
        .when(!collapsed, el => el.child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().child(label)))
        .when(Boolean(badge), el => el.child(div().size(7).flex_none().rounded_full().bg("#ecc05a")));
      const version = ready ? `Herdr ${u.app.version} · ${tx("güncelleme hazır", "update ready")}: ${ready}` : `Herdr ${u.app.version}${u.checking ? tx(" · denetleniyor…", " · checking…") : u.app.updates && u.checked ? tx(" · güncel", " · up to date") : ""}`;
      const lang = shared("ui.lang") === "en" ? "en" : "tr";
      const langChip = (code) => div().id("lang-" + code).flex_none().px(5).rounded(4).text_size(10).font_medium().cursor_pointer()
        .bg(lang === code ? t.selected : t.chrome).text_color(lang === code ? t.foreground : t.dim).hover(s => s.text_color(t.foreground))
        .tooltip(code === "tr" ? "Türkçe" : "English").on_click(() => { if (lang !== code) setShared("ui.lang", code); }).child(code.toUpperCase());
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(collapsed ? 6 : 10).pt(collapsed ? 4 : 8).pb(collapsed ? 4 : 6).gap(5)
        .child((collapsed ? v_flex() : h_flex()).gap(collapsed ? 4 : 6)
          .child(pill("settings", "settings", tx("Ayarlar", "Settings"), ready ? tx("Ayarlar · güncelleme hazır", "Settings · update ready") : tx("Ayarlar", "Settings"), () => run("app.settings"), Boolean(ready), "#9aa8ff"))
          .child(pill("machine", "plus", tx("Makine ekle", "Add machine"), tx("Uzak makine ekle", "Add a remote machine"), () => run("mod.open", { name: "machine-add" }), false, "#f0a868")))
        .when(!collapsed, el => el.child(h_flex().gap(6).items_center()
          .child(div().id("app-version").flex_1().min_w(0).truncate().text_size(10.5).text_color(ready ? "#ecc05a" : t.dim).cursor_pointer()
            .hover(s => s.text_color(t.foreground)).tooltip(tx("Yenilikler", "What's new")).on_click(() => run("app.whats_new")).child(version))
          .child(h_flex().id("lang-switch").flex_none().p(1).gap(1).rounded(5).border_1().border_color(t.border).child(langChip("tr")).child(langChip("en")))));
    }
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/workspace-chrome-tr/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/workspace-chrome-tr/sidebar.svg").size(15), toggleSidebar)));
  }
}
