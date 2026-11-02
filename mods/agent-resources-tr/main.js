import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, theme, run, exec, hc, appHome, props, layout, shared, window } from "herdr";
// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);

const HISTORY = 12;
/** Agent colors shared with the Hazır görev dialog and the team panel. */
const AGENT_COLORS = { claude: "#e8916b", codex: "#5fd3ac", opencode: "#b892f5", copilot: "#6aa5ff", gemini: "#4fd0e4" };
export function agentColor(a) {
  const key = `${a.program?.key || ""} ${a.app || ""} ${a.program?.name || ""}`.toLowerCase();
  return key.includes("claude") ? AGENT_COLORS.claude : key.includes("codex") ? AGENT_COLORS.codex : key.includes("opencode") ? AGENT_COLORS.opencode : key.includes("copilot") ? AGENT_COLORS.copilot : key.includes("gemini") ? AGENT_COLORS.gemini : "#9aa8ff";
}
export function formatRam(bytes) {
  if (!(bytes >= 0)) return "—";
  const mib = bytes / 1048576;
  return mib >= 1024 ? `${(mib / 1024).toFixed(mib >= 10240 ? 0 : 1)} GiB` : `${mib.toFixed(0)} MiB`;
}
function graph(values, ceiling, color, t) {
  const cols = Array.from({ length: HISTORY }, (_, i) => values[values.length - HISTORY + i]);
  return h_flex().h(18).gap(2).items_end().flex_none().children(cols.map(value =>
    div().w(3).rounded(1).h(value == null ? 2 : Math.max(2, Math.min(18, Math.round(value / ceiling * 18))))
      .bg(value == null ? t.border : color).opacity(value == null ? 1 : 0.9)));
}

export function visible(node, id) {
  if (!node || node.hidden) return false;
  if (node.id === id) return true;
  return (node.children || []).some(child => visible(child, id));
}
export function metrics(current, previous, root, created) {
  const all = current.processes || [], base = all.find(p => p.pid === root);
  if (!base || (created && base.started < created - 5000)) return null;
  const selected = new Set([root]);
  let changed;
  do { changed = false; for (const p of all) if (selected.has(p.parent) && !selected.has(p.pid)) { selected.add(p.pid); changed = true; } } while (changed);
  const rows = all.filter(p => selected.has(p.pid));
  const dt = previous ? (current.at - previous.at) / 1000 : 0;
  const before = new Map((previous?.processes || []).map(p => [`${p.pid}:${p.started}`, p]));
  let seconds = 0;
  for (const p of rows) {
    const old = before.get(`${p.pid}:${p.started}`);
    if (old) seconds += Math.max(0, p.cpu - old.cpu);
    else if (previous && p.started >= previous.at) seconds += p.cpu;
  }
  const comparable = before.has(`${base.pid}:${base.started}`);
  return { count: rows.length, ram: rows.reduce((n, p) => n + p.ram, 0), cpu: dt > 0 && dt < 45 && comparable ? Math.min(100, seconds / dt / current.cores * 100) : null };
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

export default class Resources extends View {
  init(_p, cx) {
    if (props()?.launcher) return;
    this.current = null; this.previous = null;
    this.history = new Map();
    this.refresh(cx);
    cx.timer.every(15000, cx => this.refresh(cx));
  }
  refresh(cx) {
    if (!visible(layout(), "agent-resources-panel") || this.loading) return;
    const local = agents().filter(a => !a.address.includes("/")).slice(0, 32);
    if (!local.length) { this.current = null; this.previous = null; this.history.clear(); return; }
    this.loading = true;
    this.attempted = new Set(local.map(a => a.address));
    cx.spawn(async cx => {
      try {
        const resolved = [];
        // Resolve core-owned root PIDs explicitly; the UI terminal summary omits them.
        for (const a of local) {
          if (!visible(layout(), "agent-resources-panel")) return;
          try {
            const r = await hc(["get", a.address, "--json"]);
            if (r.code !== 0) continue;
            const term = JSON.parse(r.stdout);
            if (term.state === "live" && Number.isSafeInteger(term.pid) && term.pid > 0) resolved.push(term);
          } catch { /* An exited/unavailable terminal is shown as unknown. */ }
        }
        if (!visible(layout(), "agent-resources-panel")) return;
        const roots = resolved.map(term => term.pid);
        if (!roots.length) throw new Error(tx("Yerel terminal süreçleri bulunamadı.", "No local terminal processes found."));
        const ids = [...new Set(roots)].join(","), platform = window()?.platform;
        if (platform === "macos") throw new Error(tx("macOS'ta kaynak ölçümü henüz desteklenmiyor.", "Resource measurement is not supported on macOS yet."));
        // Windows: PowerShell 7 and the CIM process table; Linux: Node reading /proc.
        const result = platform === "windows"
          ? await exec("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", `${appHome()}/mods/agent-resources-tr/sample.ps1`, "-RootIds", ids])
          : await exec("node", [`${appHome()}/mods/agent-resources-tr/sample.cjs`, ids]);
        if (result.code !== 0) throw new Error(tx("Süreç ölçümü alınamadı.", "Process measurement failed."));
        const next = JSON.parse(result.stdout);
        if (!Array.isArray(next.processes) || !Number.isFinite(next.at) || !(next.cores > 0)) throw new Error(tx("Ölçüm biçimi geçersiz.", "Invalid measurement format."));
        this.previous = this.current; this.current = next; this.roots = new Map(resolved.map(term => [term.address, term])); this.error = null;
        const history = new Map();
        for (const term of resolved) {
          const m = metrics(next, this.previous, term.pid, term.created_ms);
          if (!m) continue;
          const identity = `${term.pid}:${term.created_ms}`;
          const old = this.history.get(term.address);
          const prior = old?.identity === identity && next.at - old.at < 45000 ? old : { cpu: [], ram: [] };
          history.set(term.address, { identity, at: next.at, cpu: [...prior.cpu, m.cpu].slice(-HISTORY), ram: [...prior.ram, m.ram].slice(-HISTORY) });
        }
        this.history = history;
      } catch (e) { this.error = String(e.message || e); }
      finally {
        this.loading = false;
        if (visible(layout(), "agent-resources-panel")) cx.notify();
      }
    });
  }
  /** Why a card has no numbers; only claims "not found" for an address that was actually queried. */
  reason(a, remote, localCount) {
    if (remote) return tx("Uzak makine · kaynak ölçümü desteklenmiyor", "Remote machine · resource measurement not supported");
    if (this.error) return tx("Ölçüm alınamadı", "Measurement failed");
    if (this.loading && !this.roots?.has(a.address)) return tx("Ölçülüyor…", "Measuring…");
    if (!this.attempted?.has(a.address)) return localCount > 32 ? tx("Bu yenilemede ölçülmedi (ilk 32 yerel ajan)", "Not measured in this refresh (first 32 local agents)") : tx("Henüz ölçülmedi; sonraki yenilemede ölçülecek", "Not measured yet; will be measured on the next refresh");
    return tx("Süreç bulunamadı; terminal kapanmış olabilir", "Process not found; the terminal may have closed");
  }
  render() {
    const t = theme();
    const open = visible(layout(), "agent-resources-panel"), accent = t.ansi6;
    if (props()?.launcher) return topButton("resource-toggle", "≡", tx("Ajan kaynakları", "Agent resources"), "#5fb3d9", open, tx("Ajan kaynaklarını aç / kapat", "Toggle agent resources"), () => run("layout.toggle", { id: "agent-resources-panel" }));
    const list = agents(), localCount = list.filter(a => !a.address.includes("/")).length;
    const STATE = { working: [tx("Çalışıyor", "Working"), t.working], blocked: [tx("Yanıt bekliyor", "Awaiting reply"), t.blocked], done: [tx("Tamamlandı", "Done"), t.done], idle: [tx("Beklemede", "Idle"), t.idle] };
    const cards = list.map(a => {
      const remote = a.address.includes("/"), term = this.roots?.get(a.address);
      const m = !remote && this.current && !this.error ? metrics(this.current, this.previous, term?.pid, term?.created_ms) : null;
      return { a, remote, m, history: this.history?.get(a.address) || { cpu: [], ram: [] } };
    }).sort((x, y) => (y.m ? 1 : 0) - (x.m ? 1 : 0) || (y.m?.cpu ?? -1) - (x.m?.cpu ?? -1) || (y.m?.ram ?? 0) - (x.m?.ram ?? 0));
    const measured = cards.filter(c => c.m);
    const cpuKnown = measured.filter(c => c.m.cpu != null);
    const totals = [
      ["CPU", cpuKnown.length ? `${cpuKnown.reduce((n, c) => n + c.m.cpu, 0).toFixed(1)}%` : "—", tx("Ölçülen ajanların toplam işlemci kullanımı (tüm çekirdeklerin yüzdesi).", "Total CPU usage of the measured agents (percent of all cores).")],
      ["RAM", measured.length ? formatRam(measured.reduce((n, c) => n + c.m.ram, 0)) : "—", tx("Çalışma kümesi toplamı; paylaşılan sayfalar birden fazla sayılabilir.", "Working-set total; shared pages may be counted more than once.")],
      [tx("Süreç", "Processes"), measured.length ? String(measured.reduce((n, c) => n + c.m.count, 0)) : "—", tx("Terminal kökü ve tüm alt süreçleri (shell ve yardımcı araçlar dahil).", "Terminal root and all child processes (including the shell and helper tools).")],
    ];
    const iconButton = (id, label, tip, action) => div().id(id).w(26).h(26).flex_none().rounded(6).cursor_pointer().text_color(t.muted)
      .flex().items_center().justify_center().hover(el => el.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(label);
    const card = ({ a, remote, m, history }) => {
      const color = agentColor(a), [stateName, stateColor] = STATE[a.status] || [tx("Bilinmiyor", "Unknown"), t.unknown];
      const cpuColor = m?.cpu == null ? t.muted : m.cpu >= 60 ? t.blocked : m.cpu >= 25 ? t.working : t.foreground;
      const ramCeiling = Math.max(1048576, ...history.ram);
      const metric = (label, value, valueColor, chart, tip) => v_flex().flex_1().min_w(0).gap(4).tooltip(tip)
        .child(h_flex().justify_between().items_center()
          .child(div().text_size(10).text_color(t.dim).child(label))
          .child(div().text_size(12.5).font_semibold().text_color(valueColor).child(value)))
        .child(chart);
      return h_flex().id(`resource-${a.address}`).gap(10).items_stretch().pl(0).pr(12).py(10).rounded(8).border_1().border_color(t.border).bg(t.surface)
        .child(div().w(3).flex_none().rounded(2).bg(color))
        .child(v_flex().flex_1().min_w(0).gap(8)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(a.space_name || a.address))
            .child(h_flex().flex_none().gap(5).items_center()
              .child(div().size(6).rounded(3).bg(stateColor))
              .child(div().text_size(10.5).text_color(stateColor).child(stateName))))
          .child(div().truncate().text_size(10.5).text_color(t.dim).child(`${a.program?.name || tx("Ajan", "Agent")} · ${a.address}${m ? ` · ${m.count} ${tx("süreç", "processes")}` : ""}`))
          .when(!m, el => el.child(div().text_size(11).text_color(t.muted).child(this.reason(a, remote, localCount))))
          .when(Boolean(m), el => el.child(h_flex().gap(14)
            .child(metric("CPU", m?.cpu == null ? "—" : `${m.cpu.toFixed(1)}%`, cpuColor, graph(history.cpu, 100, cpuColor, t), tx("CPU · son 12 ölçüm · sabit %0–100 ölçeği", "CPU · last 12 measurements · fixed 0–100% scale")))
            .child(metric("RAM", formatRam(m?.ram), color, graph(history.ram, ramCeiling, color, t), tx("RAM · son 12 ölçüm · kendi en yüksek değerine göre ölçeklenir", "RAM · last 12 measurements · scaled to its own peak"))))));
    };
    return v_flex().size_full().min_h(0).p(14).gap(12).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(h_flex().gap(6).items_center()
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().font_semibold().text_size(15).child(tx("Ajan kaynakları", "Agent resources")))
          .child(div().text_size(11).text_color(t.muted).child(tx("Yerel terminaller ve alt süreçleri", "Local terminals and their child processes"))))
        .child(iconButton("resource-refresh", this.loading ? "…" : "↻", this.loading ? tx("Ölçülüyor…", "Measuring…") : tx("Şimdi yenile", "Refresh now"), (_e, cx) => this.refresh(cx)))
        .child(iconButton("resource-close", "×", tx("Kapat", "Close"), () => run("layout.hide", { id: "agent-resources-panel" }))))
      .child(h_flex().gap(8).children(totals.map(([label, value, tip]) => v_flex().flex_1().min_w(0).gap(2).px(10).py(8).rounded(8).bg(t.surface).border_1().border_color(t.border).tooltip(tip)
        .child(div().text_size(10).text_color(t.dim).child(label))
        .child(div().truncate().text_size(14).font_semibold().child(value)))))
      .when(Boolean(this.error), el => el.child(div().px(10).py(7).rounded(6).border_1().border_color(t.blocked).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("resource-list").flex_1().min_h(0).overflow_y_scrollbar().gap(8)
        .when(!list.length, el => el.child(div().py(12).text_center().text_color(t.dim).child(tx("Açık ajan yok.", "No open agents."))))
        .children(cards.map(card)))
      .child(v_flex().gap(2)
        .child(div().text_size(10.5).text_color(t.dim).child(this.current ? tx(`Son ölçüm ${new Date(this.current.at).toLocaleTimeString()} · görünürken 15 sn'de bir`, `Last measured ${new Date(this.current.at).toLocaleTimeString()} · every 15 s while visible`) : tx("Görünürken 15 sn'de bir yenilenir", "Refreshes every 15 s while visible")))
        .when(localCount > 32, el => el.child(div().text_size(10.5).text_color(t.dim).child(tx("Bir yenilemede ilk 32 yerel ajan ölçülür.", "Only the first 32 local agents are measured per refresh.")))));
  }
}
