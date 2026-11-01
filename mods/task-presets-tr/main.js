import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, knownAgents, theme, run, props, openOverlay, closeOverlay, shared, setShared, exec, appHome, writeTextFile, pickFolder } from "herdr";

// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);

export const PRESETS = [
  { id: "diagnose", title: "Hatayı araştır", icon: "◎", color: "#f2808f", tag: "salt okuma talimatı", hint: "Kök neden ve en küçük düzeltme", en: { title: "Investigate a bug", tag: "read-only instruction", hint: "Root cause and smallest fix" }, brief: "Belirtilen hatanın kök nedenini araştır. Önce proje talimatlarını oku; mevcut değişiklikleri koru. Bu görev salt okunur: dosya değiştirme. Kanıtları, yeniden üretme adımlarını ve önerilen en küçük düzeltmeyi Türkçe raporla." },
  { id: "review", title: "Değişikliği incele", icon: "◈", color: "#93a6ff", tag: "salt okuma talimatı", hint: "Doğruluk ve güvenlik geçişi", en: { title: "Review changes", tag: "read-only instruction", hint: "Correctness and security pass" }, brief: "Mevcut Git değişikliklerini kod doğruluğu ve güvenlik açısından iki ayrı geçişte incele. Önce proje talimatlarını oku. Salt okunur çalış; dosya değiştirme. Bulguları önem sırası, dosya/satır ve gerekçesiyle Türkçe raporla; bulgu yoksa açıkça belirt." },
  { id: "tests", title: "Testleri çalıştır", icon: "▷", color: "#6fd49b", tag: "test çalıştırır", hint: "Yerel testler ve kapsam boşlukları", en: { title: "Run tests", tag: "runs tests", hint: "Local tests and coverage gaps" }, brief: "Proje talimatlarını ve mevcut test komutlarını incele. İlgili yerel testleri çalıştır; sonuçları ve kapsam boşluklarını Türkçe raporla. Kaynak dosyalarını değiştirme; bağımlılık kurma, harici hizmetleri veya üretim verisini etkileyen testleri çalıştırma. Böyle bir gereksinim varsa önce sor." },
];

/** Display-only preset text (render time); preset.title itself stays Turkish because it names the launched tab. */
const ptitle = p => tx(p.title, p.en.title), phint = p => tx(p.hint, p.en.hint), ptag = p => tx(p.tag, p.en.tag);

/** Distinct hues tuned for the dark dialog; known agents by Herdr key or by name without spaces. */
export const AGENT_COLORS = {
  claude: "#e8916b", claudecode: "#e8916b", codex: "#5fd3ac", opencode: "#b892f5", copilot: "#6aa5ff",
  gemini: "#4fd0e4", pi: "#ecc05a", grok: "#bcc6d2", antigravity: "#f27fb2", hermes: "#a9d96f",
};
export const FALLBACK_COLORS = ["#7fb4c9", "#f0a868", "#e88a8a", "#9aa8ff", "#8fd0b8", "#d7a8e8"];

const LAST_KEY = "task-presets-tr.last";
/** The last successful choice ({ preset, agent, team }), persisted through Herdr's shared store. */
export function lastChoice() {
  try {
    const v = shared(LAST_KEY);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function launchArgs(space, agent, preset, detail, folder) {
  if (!space?.id || !(folder || space.folder)?.trim() || !agent?.installed || !Array.isArray(agent.run) || !agent.run.length || !PRESETS.includes(preset)) throw new Error(tx("Proje, çalışma klasörü ve kurulu ajan seçilmeli.", "Select a project, a working folder and an installed agent."));
  if (preset.id === "diagnose" && !detail.trim()) throw new Error(tx("Araştırılacak hatayı yazın.", "Describe the bug to investigate."));
  return { name: preset.title, space: space.id, folder: folder || space.folder, argv: [...agent.run], task: taskParts(preset, detail).join("\n\n") };
}

export const NO_PUSH_RULE = "Bu görev commit, push, PR açma, merge veya dağıtım yetkisi vermez.";
/** The single-agent task as [brief, user detail block, rule]; launchArgs joins exactly these, the preview colors them. */
export function taskParts(preset, detail) {
  return [preset.brief, `Kullanıcının ek açıklaması:\n${detail.trim() || "Ek açıklama yok; seçili projenin mevcut durumunu incele."}`, NO_PUSH_RULE];
}
/** The team's main task as team-runner receives it in config.task. */
export function teamTask(preset, detail) {
  return `${preset.brief}\n\n${detail}`;
}

/** Shared top-bar launcher look (same in monitor-position, android-devices, task-presets-tr, agent-resources-tr). */
function topButton(id, icon, label, color, open, tip, onClick) {
  const t = theme();
  return h_flex().size_full().items_center().justify_center().child(
    h_flex().id(id).h(28).px(10).gap(6).items_center().rounded(7).border_1().cursor_pointer()
      .border_color(open ? color : t.border).bg(open ? t.selected : t.raised).hover(el => el.bg(t.hover))
      .tooltip(tip).on_click(onClick)
      .child(div().flex_none().text_size(12).text_color(color).child(icon))
      .child(div().flex_none().text_size(12).font_medium().text_color(open ? t.foreground : t.muted).child(label)));
}

export default class TaskPresets extends View {
  init(_p, cx) {
    if (props()?.launcher) { setShared("task-presets-tr.open", null); return; }
    this.overlayId = props()?.overlay;
    if (this.overlayId) setShared("task-presets-tr.open", this.overlayId);
    this.target = spaces().find(s => s.id === props()?.space) || (!props()?.space ? spaces().find(s => s.active) : null);
    const activePane = panes().find(p => p.pane === focused()?.pane && this.target?.tabs.some(tab => tab.id === p.tab));
    this.folder = props()?.folder || activePane?.cwd || this.target?.folder || "";
    this.folderInput = InputState.new({ value: this.folder });
    this.folderInput.on("change", (_e, cx) => cx.notify());
    this.folderInput.on("focus", () => { this.userFocused = true; });
    this.last = lastChoice();
    this.rootFocus = cx.focus_handle();
    this.preset = PRESETS.find(p => p.id === this.last.preset) || PRESETS[0]; this.choices = []; this.loading = true; this.started = false;
    this.teamMode = props()?.team != null ? Boolean(props().team) : this.last.team === true && !this.target?.machine; this.mode = "coordinated"; this.catalog = []; this.catalogErrors = []; this.roles = [];
    this.selectedRole = -1; this.reviewer = false; this.modelPage = 0;
    this.search = InputState.new({ value: "", placeholder: tx("Model ara…", "Search models…") });
    this.search.on("change", (_e, cx) => { this.modelPage = 0; cx.notify(); });
    this.search.on("focus", () => { this.userFocused = true; });
    this.input = InputState.new({ value: "", placeholder: tx("Hata mesajı veya görevin kapsamı…", "Error message or task scope…") });
    this.input.on("change", (_e, cx) => cx.notify());
    try { this.input.focus(); } catch { /* focus is a convenience */ }
    cx.spawn(async cx => {
      try {
        this.choices = (await knownAgents({ on: this.target?.machine })).filter(a => a.installed && a.agent);
        this.agent = this.choices.find(a => a.key === this.last.agent) || this.choices[0];
      } catch { this.error = tx("Kurulu ajanlar okunamadı.", "Could not read installed agents."); }
      this.loading = false;
      if (!this.closed && !this.userFocused) { try { this.input.focus(); } catch { /* focus is a convenience */ } }
      cx.notify();
    });
    if (this.teamMode) this.loadCatalog(cx);
  }
  close() {
    this.closed = true;
    if (this.overlayId && shared("task-presets-tr.open") === this.overlayId) setShared("task-presets-tr.open", null);
  }
  button(id, text, active, action) {
    const t = theme();
    return div().id(id).px(11).py(7).rounded(7).border_1().cursor_pointer()
      .border_color(active ? t.accent + "99" : t.border).bg(active ? t.accent + "24" : t.raised)
      .text_color(active ? t.foreground : t.muted).when(active, el => el.font_medium())
      .hover(el => el.bg(active ? t.accent + "33" : t.hover).text_color(t.foreground)).on_click(action).child(text);
  }
  label(text, note, noteColor) {
    const t = theme();
    return h_flex().gap(6).items_center().child(div().text_size(11.5).font_medium().child(text))
      .when(Boolean(note), el => el.child(div().text_size(11).text_color(noteColor || t.dim).child(note)));
  }
  formRow(title, content) {
    const t = theme();
    return h_flex().gap(12).items_start()
      .child(div().w(78).flex_none().pt(7).text_size(11).text_color(t.dim).child(title))
      .child(content.flex_1().min_w_0());
  }
  agentColor(a) {
    const name = (a.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""), key = (a.key || "").toLowerCase();
    const pick = k => Object.hasOwn(AGENT_COLORS, k) ? AGENT_COLORS[k] : null;
    const known = pick(key) || pick(name);
    if (known) return known;
    const seed = `${key} ${name}`;
    return FALLBACK_COLORS[[...seed].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % FALLBACK_COLORS.length];
  }
  agentTile(a) {
    const t = theme(), active = this.agent === a, color = this.agentColor(a);
    const initials = (a.name || "?").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
    return h_flex().id(`agent-${a.key}`).w(146).gap(8).items_center().px(8).py(6).rounded(7).border_1().cursor_pointer()
      .border_color(active ? color + "b3" : t.border).bg(active ? color + "1a" : t.raised).hover(el => el.bg(active ? color + "24" : t.hover).border_color(color + (active ? "d9" : "66")))
      .on_click((_e, cx) => { this.agent = a; cx.notify(); })
      .child(div().size(22).flex_none().rounded(6).border_1().border_color(color + (active ? "99" : "4d")).bg(color + (active ? "33" : "1f")).text_color(color).text_size(10).font_semibold().flex().items_center().justify_center().child(initials))
      .child(div().flex_1().min_w_0().truncate().text_color(active ? t.foreground : t.muted).when(active, el => el.font_medium()).child(a.name))
      .when(active, el => el.child(div().flex_none().text_size(11).text_color(color).child("✓")));
  }
  remember() {
    try {
      setShared(LAST_KEY, { preset: this.preset.id, agent: this.agent?.key || this.last?.agent || null, team: this.teamMode });
    } catch { /* remembering is a convenience; never block a launch on it */ }
  }
  pickFolder(cx) {
    if (this.picking || this.target?.machine) return;
    this.picking = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const folder = await pickFolder({ prompt: tx("Bu klasörü seç", "Choose this folder") });
        if (folder) { this.folderInput.set_value(folder); this.error = null; }
      } catch { this.error = tx("Klasör seçici açılamadı; yolu elle yazabilirsiniz.", "Could not open the folder picker; you can type the path instead."); }
      this.picking = false; cx.notify();
    });
  }
  folderField() {
    const t = theme(), remote = Boolean(this.target?.machine);
    return h_flex().gap(6).items_center()
      .child(div().flex_1().min_w_0().child(this.field(this.folderInput)))
      .when(!remote, el => el.child(div().id("pick-folder").flex_none().h(32).px(12).rounded(6).border_1().border_color(t.border).bg(t.raised).cursor_pointer()
        .flex().items_center().text_size(11.5).text_color(this.picking ? t.dim : t.foreground).hover(h => h.bg(t.hover))
        .on_click((_e, cx) => this.pickFolder(cx)).child(this.picking ? tx("Seçiliyor…", "Choosing…") : tx("Gözat…", "Browse…"))));
  }
  presetIcon(p, active, size) {
    const color = p.color || theme().accent;
    return div().size(size).flex_none().rounded(8).border_1().border_color(color + (active ? "99" : "4d")).bg(color + (active ? "33" : "1a"))
      .text_color(color).flex().items_center().justify_center().text_size(13).child(p.icon);
  }
  presetItem(p) {
    const t = theme(), active = this.preset === p, color = p.color || t.accent;
    return h_flex().id(`preset-${p.id}`).w_full().gap(9).items_center().px(8).py(9).rounded(8).border_1().cursor_pointer()
      .border_color(active ? color + "80" : t.chrome).bg(active ? color + "17" : t.chrome)
      .hover(el => el.bg(active ? color + "21" : t.hover))
      .on_click((_e, cx) => { this.preset = p; this.error = null; cx.notify(); })
      .child(this.presetIcon(p, active, 26))
      .child(v_flex().flex_1().min_w_0().gap(2)
        .child(div().truncate().text_color(active ? t.foreground : t.muted).when(active, el => el.font_medium()).child(ptitle(p)))
        .child(div().truncate().text_size(11).text_color(t.dim).child(phint(p)))
        .when(Boolean(p.tag), el => el.child(div().self_start().mt(2).px(6).rounded(4).text_size(10).text_color(active ? color : t.dim).bg(active ? color + "1f" : t.background).child(ptag(p)))));
  }
  summary() {
    if (this.teamMode) {
      const n = this.roles.length - (this.reviewer ? 0 : 1);
      const count = this.roles.length ? tx(`${n} üyeli ekip`, `${n}-member team`) : tx("ekip", "team");
      return `${ptitle(this.preset)} · ${count} · ${this.mode === "parallel" ? tx("paralel inceleme", "parallel review") : tx("koordinatörlü", "coordinated")}`;
    }
    return `${ptitle(this.preset)} · ${this.agent?.name || tx("ajan seçilmedi", "no agent selected")} · ${tx("yeni sekmede başlar", "starts in a new tab")}`;
  }
  header() {
    const t = theme(), color = this.preset.color || t.accent;
    return h_flex().flex_none().gap(12).items_center().pl(20).pr(14).py(13).border_b_1().border_color(t.border)
      .child(div().size(32).flex_none().rounded(9).bg(t.accent + "26").border_1().border_color(t.accent + "59").text_color(t.accent).text_size(15).flex().items_center().justify_center().child("✦"))
      .child(v_flex().flex_1().min_w_0().gap(2)
        .child(div().text_size(15.5).font_semibold().child(tx("Hazır görev başlat", "Start preset task")))
        .child(h_flex().gap(6).items_center().min_w_0()
          .child(div().size(6).flex_none().rounded(3).bg(color))
          .child(div().flex_1().min_w_0().truncate().text_size(11.5).text_color(t.muted).child(this.summary()))))
      .child(h_flex().flex_none().max_w(230).gap(6).items_center().px(10).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised)
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(tx("PROJE", "PROJECT")))
        .child(div().min_w_0().truncate().text_size(11.5).font_medium().text_color(this.target ? t.foreground : t.blocked).child(this.target?.name || tx("Seçilemedi", "Not found"))))
      .child(div().id("close").size(28).flex_none().rounded(7).cursor_pointer().text_color(t.dim).flex().items_center().justify_center()
        .hover(el => el.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("✕"));
  }
  /** Display-only hint of what still blocks a start; start()/teamConfig()/launchArgs remain the real checks. */
  missing() {
    if (!this.target) return tx("proje seçilemedi", "project not found");
    if (!this.folderInput.value().trim()) return tx("çalışma klasörünü yazın", "enter the working folder");
    if (this.preset.id === "diagnose" && !this.input.value().trim()) return tx("hata açıklamasını yazın", "describe the bug");
    if (this.teamMode) {
      if (this.target.machine) return tx("ekip modu yalnız yerel projelerde kullanılabilir", "team mode works only on local projects");
      if (this.catalogLoading) return tx("model listesi yükleniyor", "loading the model list");
      if (!this.roles.length) return tx("model listesi yok; yenileyin", "no model list; refresh it");
      if (this.mode === "parallel" && this.roles.length < 4) return tx("paralel inceleme için en az iki üye ekleyin", "add at least two members for parallel review");
      return null;
    }
    if (this.loading) return tx("ajanlar kontrol ediliyor", "checking agents");
    if (!this.agent) return tx("kurulu bir ajan seçin", "select an installed agent");
    return null;
  }
  footer(startLabel) {
    const t = theme(), missing = this.missing();
    const note = this.teamMode
      ? tx("Ekip yeni sekmede · üyeler salt okunur modda başlatılır (proje izinleri geçerli) · çağrı başına 20 dk", "Team in a new tab · members start in read-only mode (project permissions apply) · 20 min per call")
      : tx(`Yeni sekmede · commit, push ve dağıtım yok${this.preset.id === "tests" ? " · test çıktıları oluşabilir" : ""}`, `In a new tab · no commit, push or deploy${this.preset.id === "tests" ? " · may produce test output" : ""}`);
    return v_flex().flex_none().gap(8).pl(20).pr(14).py(12).border_t_1().border_color(t.border).bg(t.chrome)
      .when(Boolean(this.error), el => el.child(h_flex().gap(8).items_center().px(10).py(7).rounded(6).border_1().border_color(t.blocked + "80").bg(t.blocked + "1a")
        .child(div().flex_none().text_color(t.blocked).child("!")).child(div().flex_1().min_w_0().text_size(11.5).text_color(t.blocked).child(this.error))))
      .child(h_flex().gap(10).items_center()
        .child(h_flex().flex_1().min_w_0().gap(7).items_center()
          .child(div().size(7).flex_none().rounded(4).bg(missing ? t.ansi3 : t.done))
          .child(div().flex_1().min_w_0().truncate().text_size(11).text_color(missing ? t.ansi3 : t.dim).child(missing ? `${tx("Eksik", "Missing")}: ${missing}` : note)))
        .child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.dim).child("Ctrl+Enter"))
        .child(div().id("cancel").flex_none().px(12).py(7).rounded(7).cursor_pointer().text_color(t.muted).hover(el => el.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props().overlay)).child(tx("Vazgeç", "Cancel")))
        .child(h_flex().id("start").flex_none().gap(8).items_center().px(16).py(7).rounded(7).cursor_pointer().font_semibold().bg(t.solid).text_color(t.solid_foreground)
          .when(this.started || Boolean(missing), el => el.opacity(0.55)).hover(el => el.opacity(this.started || missing ? 0.65 : 0.88))
          .on_click((_e, cx) => this.start(cx)).child(startLabel).when(!this.started, el => el.child(div().child("→")))));
  }
  preview() {
    const t = theme(), open = shared("task-presets-tr.preview") === true;
    const parts = this.teamMode ? [teamTask(this.preset, this.input.value())] : taskParts(this.preset, this.input.value());
    const text = parts.join("\n\n"), copied = this.copiedText === text;
    const whoColor = this.teamMode ? (this.roles[0] ? this.toolColor(this.roles[0].tool) : t.accent) : this.agent ? this.agentColor(this.agent) : t.dim;
    const who = this.teamMode ? `${tx("Ekip", "Team")} · ${this.roles[0]?.name || tx("koordinatör", "coordinator")}` : this.agent?.name || tx("Ajan seçilmedi", "No agent selected");
    const command = this.teamMode ? tx("ekip modu · koordinatöre ana görev", "team mode · main task to the coordinator") : (this.agent?.run || []).join(" ") || "—";
    const lines = (value, color) => value.split("\n").map(line => div().min_h(16).font_family("Consolas").text_color(color).child(line || " "));
    const emptyDetail = !this.input.value().trim();
    const sections = this.teamMode
      ? [[tx("ANA GÖREV", "MAIN TASK"), parts[0], this.preset.color || t.accent, t.foreground]]
      : [[tx("GÖREV", "TASK"), parts[0], this.preset.color || t.accent, t.foreground],
         [tx("EK AÇIKLAMA", "DETAILS"), parts[1], t.accent, emptyDetail ? t.dim : t.foreground],
         [tx("KURAL", "RULE"), parts[2], t.ansi3, t.ansi3]];
    const section = ([label, value, bar, color]) => h_flex().gap(10).items_stretch()
      .child(div().w(2).flex_none().rounded(1).bg(bar + "b3"))
      .child(v_flex().flex_1().min_w_0().gap(3)
        .child(div().text_size(9.5).text_color(t.dim).child(label))
        .children(lines(value, color)));
    return v_flex().flex_none().rounded(8).border_1().border_color(t.border).bg(t.background).overflow_hidden()
      .child(h_flex().gap(8).items_center().pl(6).pr(8).py(6)
        .child(h_flex().id("preview-toggle").flex_1().min_w_0().gap(8).items_center().px(6).py(3).rounded(6).cursor_pointer().hover(el => el.bg(t.hover))
          .on_click(() => setShared("task-presets-tr.preview", !open))
          .child(div().size(18).flex_none().rounded(4).bg(t.raised).text_size(9).text_color(t.muted).flex().items_center().justify_center().child(open ? "▾" : "▸"))
          .child(div().flex_none().text_size(12).font_medium().text_color(open ? t.foreground : t.muted).child(tx("Ajana gidecek talimat", "Instructions sent to the agent")))
          .child(h_flex().flex_1().min_w_0().gap(6).items_center().justify_end()
            .child(div().size(6).flex_none().rounded(3).bg(whoColor))
            .child(div().min_w_0().truncate().text_size(11).text_color(t.muted).child(who))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(`· ${text.length} ${tx("karakter", "characters")}`))))
        .child(div().id("preview-copy").flex_none().px(9).py(4).rounded(6).border_1().cursor_pointer().text_size(11)
          .border_color(copied ? t.done + "88" : t.border).bg(copied ? t.done + "1f" : t.raised).text_color(copied ? t.done : t.muted)
          .hover(el => el.text_color(t.foreground).bg(t.hover))
          .on_click((_e, cx) => { cx.write_to_clipboard(text); this.copiedText = text; cx.notify(); })
          .child(copied ? tx("Kopyalandı ✓", "Copied ✓") : tx("Kopyala", "Copy"))))
      .when(open, el => el.child(v_flex().id("preview-body").max_h(240).overflow_y_scrollbar().px(14).py(12).gap(12).border_t_1().border_color(t.border).text_size(11.5)
        .child(v_flex().gap(1)
          .child(h_flex().gap(8).font_family("Consolas").child(div().flex_none().text_color(t.ansi2).child("$")).child(div().flex_1().min_w_0().text_color(t.ansi2).child(command)))
          .child(h_flex().gap(8).font_family("Consolas").child(div().flex_none().text_color(t.dim).child("#")).child(div().flex_1().min_w_0().truncate().text_color(t.dim).child(this.folderInput.value().trim() || tx("klasör yazılmadı", "no folder entered")))))
        .children(sections.map(section))
        .when(this.teamMode, el => el.child(div().font_family("Consolas").text_color(t.dim).child(tx("# Ekip çalıştırıcısı her role kendi sınır ve rol talimatlarını ayrıca ekler.", "# The team runner adds its own limits and role instructions to each role."))))));
  }
  segmented(options, value, onPick, opts = {}) {
    const t = theme(), prefix = opts.prefix || "seg";
    return h_flex().p(3).gap(2).rounded(8).bg(t.background).border_1().border_color(t.border)
      .when(opts.fill, el => el.w_full()).when(!opts.fill, el => el.self_start()).when(opts.wrap, el => el.flex_wrap())
      .children(options.map(([id, label]) => div().id(`${prefix}-${id}`).px(opts.fill ? 6 : 12).py(6).rounded(6).cursor_pointer().text_center().truncate()
        .when(opts.fill, el => el.flex_1().min_w_0())
        .bg(value === id ? t.selected : t.background).text_color(value === id ? t.foreground : t.muted).when(value === id, el => el.font_medium())
        .hover(el => el.text_color(t.foreground)).on_click((_e, cx) => onPick(id, cx)).child(label)));
  }

  loadCatalog(cx) {
    if (this.catalogLoading) return;
    if (this.target?.machine) { this.error = tx("Ekip modu bu bilgisayardaki yerel projelerde kullanılabilir.", "Team mode is available for local projects on this computer only."); cx.notify(); return; }
    this.catalogLoading = true; this.error = null;
    cx.spawn(async cx => {
      try {
        const r = await exec("node", [`${appHome()}/mods/task-presets-tr/team-runner.cjs`, "catalog"]);
        if (r.code !== 0) throw new Error(tx("Model listesi okunamadı.", "Could not read the model list."));
        const data = JSON.parse(r.stdout);
        this.catalog = data.rows; this.catalogErrors = data.errors;
        if (!this.roles.length && this.catalog.length) {
          const first = this.catalog.find(m => m.tool === "codex") || this.catalog[0];
          this.roles = ["Koordinatör", "Araştırmacı", "İncelemeci", "Son denetleyici"].map(role => this.makeRole(first, role));
        }
      } catch (e) { this.error = String(e.message || e); }
      this.catalogLoading = false; cx.notify();
    });
  }
  makeRole(model, label) {
    const role = { ...model, effort: "", label, input: InputState.new({ value: label, placeholder: tx("Bu üyenin sorumluluğu…", "This member's responsibility…") }) };
    role.input.on("change", (_e, cx) => cx.notify());
    role.input.on("focus", () => { this.userFocused = true; });
    return role;
  }
  selectModel(role, model) {
    Object.assign(role, {tool:model.tool, provider:model.provider, model:model.model, name:model.name, efforts:model.efforts, effort:""});
  }
  teamConfig() {
    if (!this.roles.length || this.catalogLoading) throw new Error(tx("Önce model listesinin yüklenmesini bekleyin.", "Wait for the model list to load first."));
    if (this.mode === "parallel" && this.roles.length < 4) throw new Error(tx("Paralel inceleme için en az iki üye ekleyin.", "Add at least two members for parallel review."));
    const serialize = r => ({tool:r.tool,provider:r.provider,model:r.model,effort:r.effort,role:r.input.value()});
    const selected = this.reviewer ? this.roles : this.roles.slice(0,-1);
    for (const r of selected) if (!this.catalog.some(m => m.tool === r.tool && m.provider === r.provider && m.model === r.model && (!r.effort || m.efforts.includes(r.effort)))) throw new Error(tx("Model seçimi güncel listede yok; ilgili rolü yeniden seçin.", "The selected model is not in the current list; pick the role again."));
    if (this.preset.id === "diagnose" && !this.input.value().trim()) throw new Error(tx("Araştırılacak hatayı yazın.", "Describe the bug to investigate."));
    if (this.input.value().length > 16000) throw new Error(tx("Ek açıklama en fazla 16000 karakter olabilir.", "Details can be at most 16000 characters."));
    return {mode:this.mode,folder:this.folderInput.value().trim(),task:teamTask(this.preset,this.input.value()),coordinator:serialize(this.roles[0]),workers:this.roles.slice(1,-1).map(serialize),reviewer:this.reviewer ? serialize(this.roles[this.roles.length-1]) : null};
  }
  startTeam(cx, current) {
    if (current.machine) throw new Error(tx("Ekip modu yalnız yerel projelerde kullanılabilir.", "Team mode works only on local projects."));
    const config = this.teamConfig();
    this.started = true; this.error = null;
    cx.spawn(async cx => {
      try {
        const file = `${appHome()}/data/team-request-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
        await writeTextFile(file, JSON.stringify(config), null);
        const latest = spaces().find(s => s.id === current.id);
        if (!latest || latest.machine) throw new Error(tx("Hedef proje değişti; tekrar açın.", "The target project changed; open it again."));
        run("tab.new", {name:`Ekip · ${this.preset.title}`,space:current.id,folder:config.folder,argv:["node",`${appHome()}/mods/task-presets-tr/team-runner.cjs`,"run",file]});
        closeOverlay(this.overlayId);
        this.remember();
      } catch (e) { this.started = false; this.error = String(e.message || e); cx.notify(); }
    });
  }
  field(state) {
    const t = theme();
    return Input.new(state).h(32).px(10).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground);
  }
  chip(id, text, active, action) {
    const t = theme();
    return div().id(id).px(9).py(5).rounded(6).border_1().cursor_pointer().text_size(11.5)
      .border_color(active ? t.accent + "99" : t.border).bg(active ? t.accent + "24" : t.raised)
      .text_color(active ? t.foreground : t.muted).when(active, el => el.font_medium())
      .hover(el => el.bg(active ? t.accent + "33" : t.hover).text_color(t.foreground)).on_click(action).child(text);
  }
  toolColor(tool) {
    return Object.hasOwn(AGENT_COLORS, tool || "") ? AGENT_COLORS[tool] : FALLBACK_COLORS[0];
  }
  pickRole(i, cx) {
    this.selectedRole = this.selectedRole === i ? -1 : i; this.modelPage = 0; this.search.set_value(""); cx.notify();
  }
  memberRow(r, i) {
    const t = theme(), last = i === this.roles.length - 1, off = last && !this.reviewer, open = this.selectedRole === i, color = this.toolColor(r.tool);
    const detail = `${r.tool} · ${r.name || r.model} · ${r.effort || tx("varsayılan efor", "default effort")}`;
    return h_flex().items_center().gap(8).pr(10).when(i > 0, el => el.border_t_1()).border_color(t.border).bg(open ? t.accent + "14" : t.raised)
      .child(h_flex().id(`role-${i}`).flex_1().min_w_0().gap(10).items_center().pl(12).py(9).cursor_pointer().when(off, el => el.opacity(0.5))
        .on_click((_e, cx) => this.pickRole(i, cx))
        .child(div().size(26).flex_none().rounded(13).bg(color + "2e").border_1().border_color(color + "88").text_color(color).text_size(11).font_semibold().flex().items_center().justify_center().child(i === 0 ? "K" : last ? "D" : String(i)))
        .child(v_flex().flex_1().min_w_0().gap(1)
          .child(div().truncate().font_medium().child(r.input.value().trim() || r.label))
          .child(div().truncate().text_size(11).text_color(t.dim).child(off ? tx("kapalı · sonucu denetlemez", "off · does not verify the result") : detail)))
        .child(div().flex_none().text_color(t.dim).child(open ? "▾" : "▸")))
      .when(last, el => el.child(div().id("reviewer-toggle").flex_none().px(9).py(4).rounded(10).cursor_pointer().text_size(11)
        .bg(this.reviewer ? t.done + "26" : t.background).border_1().border_color(this.reviewer ? t.done + "88" : t.border).text_color(this.reviewer ? t.done : t.muted)
        .on_click((_e, cx) => { this.reviewer = !this.reviewer; cx.notify(); }).child(this.reviewer ? tx("Açık", "On") : tx("Kapalı", "Off"))));
  }
  memberEditor(role) {
    const t = theme(), color = this.toolColor(role.tool);
    const tools = [...new Set(this.catalog.map(m => m.tool))];
    const providers = [...new Set(this.catalog.filter(m => m.tool === role.tool).map(m => m.provider))];
    const providerName = p => p === "configured" ? tx("Claude hesabı / CLI ayarı", "Claude account / CLI setting") : p;
    const query = this.search.value().trim().toLowerCase();
    const matches = query ? this.catalog.filter(m => m.tool === role.tool && m.provider === role.provider && `${m.name} ${m.model}`.toLowerCase().includes(query)) : [];
    const pages = Math.max(1, Math.ceil(matches.length / 6)), page = Math.min(this.modelPage, pages - 1);
    const removable = this.selectedRole > 0 && this.selectedRole < this.roles.length - 1 && this.roles.length > 3;
    const pickTool = (tool, cx) => { this.selectModel(role, this.catalog.find(m => m.tool === tool)); this.modelPage = 0; this.search.set_value(""); cx.notify(); };
    const pickProvider = (provider, cx) => { this.selectModel(role, this.catalog.find(m => m.tool === role.tool && m.provider === provider)); this.modelPage = 0; this.search.set_value(""); cx.notify(); };
    const row = (title, content) => h_flex().gap(12).items_start()
      .child(div().w(70).flex_none().pt(6).text_size(11).text_color(t.dim).child(title))
      .child(content.flex_1().min_w_0());
    return v_flex().gap(12).px(14).py(14).border_t_1().border_color(t.border).bg(t.background)
      .child(row(tx("Görev", "Role"), v_flex().child(this.field(role.input))))
      .child(row(tx("Araç", "Tool"), h_flex().gap(12).items_center().flex_wrap()
        .child(this.segmented(tools.map(tool => [tool, tool]), role.tool, pickTool, { prefix: "tool" }))
        .when(providers.length === 1, el => el.child(div().text_size(11.5).text_color(t.dim).child(`${tx("Sağlayıcı", "Provider")} · ${providerName(providers[0] || "—")}`)))))
      .when(providers.length > 1, el => el.child(row(tx("Sağlayıcı", "Provider"), this.segmented(providers.map(p => [p, providerName(p)]), role.provider, pickProvider, { prefix: "provider", wrap: true }))))
      .child(row("Model", v_flex().gap(6)
        .child(h_flex().gap(10).items_center().px(10).py(7).rounded(6).border_1().border_color(color + "66").bg(color + "14")
          .child(div().size(8).flex_none().rounded(4).bg(color))
          .child(div().flex_none().font_medium().child(role.name || role.model))
          .child(div().flex_1().min_w_0().truncate().text_size(11).text_color(t.dim).child(role.model)))
        .child(this.field(this.search))
        .when(Boolean(query), el => el.child(v_flex().rounded(6).border_1().border_color(t.border).overflow_hidden()
          .when(!matches.length, el => el.child(div().px(10).py(8).text_size(11.5).text_color(t.dim).child(tx("Eşleşen model yok.", "No matching model."))))
          .children(matches.slice(page * 6, page * 6 + 6).map((m, i) => h_flex().id(`model-${i}`).gap(10).items_center().px(10).py(6).cursor_pointer()
            .when(i > 0, el => el.border_t_1()).border_color(t.border).bg(role.model === m.model ? t.accent + "1f" : t.raised).hover(el => el.bg(t.hover))
            .on_click((_e, cx) => { this.selectModel(role, m); this.search.set_value(""); this.modelPage = 0; cx.notify(); })
            .child(div().flex_none().child(m.name))
            .child(div().flex_1().min_w_0().truncate().text_size(11).text_color(t.dim).child(m.model))
            .when(role.model === m.model, el => el.child(div().flex_none().text_color(t.accent).child("✓")))))
          .when(pages > 1, el => el.child(h_flex().gap(8).items_center().justify_end().px(10).py(5).border_t_1().border_color(t.border).bg(t.chrome)
            .child(div().text_size(11).text_color(t.dim).child(`${matches.length} ${tx("sonuç", "results")} · ${page + 1}/${pages}`))
            .child(this.chip("models-prev", "‹", false, (_e, cx) => { this.modelPage = Math.max(0, page - 1); cx.notify(); }))
            .child(this.chip("models-next", "›", false, (_e, cx) => { this.modelPage = Math.min(pages - 1, page + 1); cx.notify(); }))))))))
      .child(row(tx("Efor", "Effort"), this.segmented(["", ...role.efforts].map(e => [e || "__default", e || tx("Varsayılan", "Default")]), role.effort || "__default", (id, cx) => { role.effort = id === "__default" ? "" : id; cx.notify(); }, { prefix: "effort", wrap: true })))
      .when(removable, el => el.child(h_flex().justify_end().child(div().id("remove-member").px(9).py(5).rounded(6).cursor_pointer().text_size(11.5).text_color(t.blocked).hover(h => h.bg(t.blocked + "1f"))
        .on_click((_e, cx) => { this.roles.splice(this.selectedRole, 1); this.selectedRole = -1; cx.notify(); }).child(tx("Üyeyi çıkar", "Remove member")))));
  }
  teamEditor() {
    const t = theme(), role = this.roles[this.selectedRole];
    const template = role || this.roles[0];
    return v_flex().gap(10)
      .child(h_flex().gap(10).items_center()
        .child(this.segmented([["parallel", tx("Paralel inceleme", "Parallel review")], ["coordinated", tx("Koordinatörlü", "Coordinated")]], this.mode, (id, cx) => { this.mode = id; cx.notify(); }))
        .child(div().flex_1())
        .child(div().id("refresh-models").flex_none().text_size(11.5).text_color(t.muted).cursor_pointer().hover(el => el.text_color(t.foreground)).on_click((_e, cx) => this.loadCatalog(cx)).child(this.catalogLoading ? tx("Yükleniyor…", "Loading…") : tx("↻ Modelleri yenile", "↻ Refresh models"))))
      .child(div().text_size(11.5).text_color(t.muted).child(this.mode === "parallel" ? tx("Üyeler bağımsız çalışır; koordinatör sonuçları karşılaştırır.", "Members work independently; the coordinator compares the results.") : tx("Koordinatör işi dağıtır, üyeler paralel çalışır, koordinatör ortak raporu yazar.", "The coordinator delegates, members work in parallel, and the coordinator writes the joint report.")))
      .when(!this.roles.length, el => el.child(div().px(12).py(14).rounded(8).border_1().border_color(t.border).text_color(t.dim).child(this.catalogLoading ? tx("Model listesi yükleniyor…", "Loading the model list…") : tx("Model listesi yok; yenilemeyi deneyin.", "No model list; try refreshing."))))
      .when(this.roles.length > 0, el => el.child(v_flex().rounded(8).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().items_center().px(12).py(7).border_b_1().border_color(t.border).bg(t.chrome)
          .child(div().flex_1().text_size(11).text_color(t.dim).child(tx(`EKİP · ${this.roles.length - (this.reviewer ? 0 : 1)} ETKİN ÜYE`, `TEAM · ${this.roles.length - (this.reviewer ? 0 : 1)} ACTIVE MEMBERS`)))
          .when(this.roles.length < 8, el => el.child(div().id("add-member").text_size(11.5).text_color(t.accent).cursor_pointer().hover(h => h.text_color(t.foreground))
            .on_click((_e, cx) => { if (this.roles.length >= 8 || !template) return; this.roles.splice(this.roles.length - 1, 0, this.makeRole(template, `Üye ${this.roles.length - 1}`)); this.selectedRole = this.roles.length - 2; this.modelPage = 0; this.search.set_value(""); cx.notify(); }).child(tx("+ Üye ekle", "+ Add member")))))
        .children(this.roles.map((r, i) => v_flex().child(this.memberRow(r, i)).when(this.selectedRole === i, el => el.child(this.memberEditor(r)))))))
      .child(div().text_size(11).text_color(t.dim).child(tx("Model listesi erişim garantisi değildir. Claude seçenekleri CLI takma adlarıdır; efor desteği modele bağlıdır. Her çağrı kendi hesabının kotasını kullanır. Rol başına 20 dk sınır vardır.", "The model list does not guarantee access. Claude options are CLI aliases; effort support depends on the model. Each call uses its own account's quota. There is a 20 min limit per role.")))
      .children(this.catalogErrors.map(message => div().text_size(11.5).text_color(t.blocked).child(message)));
  }
  start(cx) {
    if (this.started) return;
    try {
      const current = spaces().find(s => s.id === this.target?.id);
      if (!current || current.machine !== this.target.machine) throw new Error(tx("Proje artık mevcut değil; pencereyi yeniden açın.", "The project no longer exists; reopen the window."));
      if (!this.folderInput.value().trim()) throw new Error(tx("Çalışma klasörünü yazın.", "Enter the working folder."));
      if (this.teamMode) { this.startTeam(cx,current); return; }
      const args = launchArgs(current, this.agent, this.preset, this.input.value(), this.folderInput.value().trim());
      this.started = true;
      run("tab.new", args);
      closeOverlay(props().overlay);
      this.remember();
    } catch (e) { this.started = false; this.error = String(e.message || e); cx.notify(); }
  }
  render() {
    const t = theme();
    const open = Boolean(shared("task-presets-tr.open"));
    if (props()?.launcher) return topButton("open-presets", "✦", tx("Hazır görev", "Task presets"), "#6aa8f0", open, tx("Hazır görev başlat (Ctrl+Enter ile başlatılır)", "Start a preset task (Ctrl+Enter to start)"), () => {
        const existing = shared("task-presets-tr.open");
        if (existing) { closeOverlay(existing); return; }
        const s = spaces().find(s => s.id === focused()?.space) || spaces().find(s => s.active);
        if (!s) return;
        const folder = panes().find(p => p.pane === focused()?.pane)?.cwd || s.folder;
        openOverlay({ mod: "task-presets-tr", kind: "dialog", width: 900, height: 820, props: { space: s.id, folder } });
      });
    const needsDetail = this.preset.id === "diagnose";
    const detailLabel = this.label(tx("Ek açıklama", "Details"), needsDetail ? tx("zorunlu", "required") : tx("isteğe bağlı", "optional"), needsDetail ? t.blocked : null);
    const detailInput = Input.new(this.input).h(32).px(10).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground);
    const startLabel = this.started ? tx("Başlatılıyor…", "Starting…") : this.teamMode ? tx("Ekibi başlat", "Start team") : tx("Görevi başlat", "Start task");
    return v_flex().id("task-form").size_full().track_focus(this.rootFocus).on_key_down((event, cx) => { if (event.keystroke === "cmd-enter" || event.keystroke === "ctrl-enter") { cx.stop_propagation(); this.start(cx); } }).bg(t.popover).text_size(12.5).text_color(t.foreground)
      .child(this.header())
      .child(h_flex().flex_1().min_h_0().items_stretch()
        .child(v_flex().w(250).flex_none().gap(4).px(10).py(14).border_r_1().border_color(t.border).bg(t.chrome)
          .child(div().px(8).pb(4).text_size(10.5).text_color(t.dim).child(tx("GÖREV TÜRÜ", "TASK TYPE")))
          .children(PRESETS.map(p => this.presetItem(p)))
          .child(div().flex_1())
          .child(div().p(6).child(this.segmented([["single", tx("Tek ajan", "Single agent")], ["team", tx("Ekip modu", "Team mode")]], this.teamMode ? "team" : "single", (id, cx) => { this.teamMode = id === "team"; if (this.teamMode && !this.catalog.length) this.loadCatalog(cx); cx.notify(); }, { fill: true }))))
        .child(v_flex().id("task-form-body").flex_1().min_w_0().overflow_y_scrollbar().px(22).py(18).gap(12)
          .when(!this.teamMode, el => el
            .child(h_flex().gap(10).items_center().min_w_0().child(this.presetIcon(this.preset, true, 28))
              .child(v_flex().min_w_0().gap(1).child(div().text_size(15).font_semibold().child(ptitle(this.preset))).child(div().truncate().text_size(11).text_color(t.dim).child(phint(this.preset)))))
            .child(div().pl(12).py(8).pr(10).rounded(6).border_l_2().border_color((this.preset.color || t.accent) + "99").bg(t.raised).text_size(11.5).text_color(t.muted).child(this.preset.brief))
            .child(v_flex().gap(14).px(14).py(14).rounded(8).border_1().border_color(t.border).bg(t.background)
              .child(this.formRow(tx("Klasör", "Folder"), v_flex().gap(4).child(this.folderField()).child(div().text_size(10.5).text_color(t.dim).child(this.target?.machine ? tx("Ajan bu klasörde çalışır; uzak projede yolu elle yazın.", "The agent runs in this folder; type the path for a remote project.") : tx("Ajan bu klasörde çalışır; Gözat… ile seçebilirsiniz.", "The agent runs in this folder; use Browse… to pick one.")))))
              .child(this.formRow(needsDetail ? tx("Açıklama *", "Details *") : tx("Açıklama", "Details"), v_flex().gap(4).child(detailInput)
                .child(div().text_size(10.5).text_color(needsDetail && !this.input.value().trim() ? t.blocked : t.dim).child(needsDetail ? tx("Zorunlu: hata mesajını veya belirtiyi yazın.", "Required: enter the error message or symptom.") : tx("İsteğe bağlı: kapsamı daraltmak için kısa bir not.", "Optional: a short note to narrow the scope.")))))
              .child(this.formRow(tx("Ajan", "Agent"), v_flex().gap(6)
                .child(h_flex().flex_wrap().gap(6).children(this.choices.map(a => this.agentTile(a))))
                .when(this.loading || !this.choices.length, el => el.child(div().py(4).text_color(t.dim).child(this.loading ? tx("Ajanlar kontrol ediliyor…", "Checking agents…") : tx("Kurulu ajan bulunamadı.", "No installed agent found."))))))))
          .when(this.teamMode, el => el
            .child(h_flex().gap(8).items_center().min_w_0().child(this.presetIcon(this.preset, true, 22)).child(div().flex_none().font_semibold().child(ptitle(this.preset)))
              .child(div().flex_1().min_w_0().truncate().text_size(11).text_color(t.dim).child(phint(this.preset) + tx(" · tam talimat önizlemede", " · full instructions in the preview"))))
            .child(h_flex().gap(10).items_start()
              .child(v_flex().flex_1().min_w_0().gap(5).child(this.label(tx("Çalışma klasörü", "Working folder"))).child(this.folderField()))
              .child(v_flex().flex_1().min_w_0().gap(5).child(detailLabel).child(detailInput))))
          .when(this.teamMode, el => el.child(v_flex().gap(6).child(this.label(tx("Ekip", "Team"))).child(this.teamEditor())))
          .child(this.preview())))
      .child(this.footer(startLabel));
  }
}
