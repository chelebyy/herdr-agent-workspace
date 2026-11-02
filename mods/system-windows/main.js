// Based on the "system" mod of github.com/Lakris2407/herdr-quota, Copyright (c) 2026 Lakris2407, MIT License (see NOTICE); modified.
function monitorVisible(node, id) {
  if (!node || node.hidden) return false;
  if (node.id === id) return true;
  return (node.children ?? []).some(child => monitorVisible(child, id));
}
// CPU, memory and GPU load in the status bar: a small live graph and a percent for each.
// Node OS counters; GPU from nvidia-smi, else (Linux) AMD sysfs or the DRM fdinfo engine counters. No elevation required.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, settings, props, layout, shared, setShared, appHome, window } from "herdr";
// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);

const EVERY = 3000, HISTORY = 12;
// Same scale as the quota bars: green, amber from 60%, orange from 80%, red from 92%.
function level(pct) {
  const dark = settings().dark !== false;
  const scale = dark ? ["#5ed49a", "#f2c14e", "#f59152", "#f2665c"] : ["#1f9d63", "#c98a0b", "#dd6b20", "#d64545"];
  return scale[pct >= 92 ? 3 : pct >= 80 ? 2 : pct >= 60 ? 1 : 0];
}


// Clicking the gauges opens the system's process monitor. On Linux the first installed one is started detached
// (setsid -f), so exec returns at once and its time limit cannot end the monitor.
const LINUX_MONITOR = 'for m in plasma-systemmonitor gnome-system-monitor mate-system-monitor xfce4-taskmanager lxtask; do if command -v "$m" >/dev/null 2>&1; then setsid -f "$m" >/dev/null 2>&1 </dev/null; exit 0; fi; done; exit 1';
const MONITORS = {
  windows: [["C:\\Windows\\System32\\Taskmgr.exe", []]],
  macos: [["open", ["-a", "Activity Monitor"]]],
  linux: [["sh", ["-c", LINUX_MONITOR]]],
};
async function openMonitor() {
  for (const [command, args] of MONITORS[window()?.platform] ?? []) {
    try { await exec(command, args); return; } catch { /* not installed, try the next one */ }
  }
}
const GPU_SOURCE = { "nvidia-smi": ["nvidia-smi", "nvidia-smi"], sysfs: ["sysfs", "sysfs"], fdinfo: ["DRM fdinfo, en yoğun motor", "DRM fdinfo, busiest engine"] };

async function read() {
  const r = await exec("node", [`${appHome()}/mods/system-windows/sample.cjs`]);
  if (r.code !== 0) throw new Error(r.stderr || `exit ${r.code}`);
  return JSON.parse(r.stdout);
}
// The last HISTORY reads as thin columns, newest on the right, tallest at 100%.
function graph(history, t) {
  const cols = Array.from({ length: HISTORY }, (_, i) => history[history.length - HISTORY + i]);
  return h_flex().h(12).gap(1).items_end().flex_none()
    .children(cols.map(pct => div().w(2).rounded(1)
      .h(pct === undefined ? 1 : Math.max(1, Math.round(pct / 100 * 12)))
      .bg(pct === undefined ? t.border : level(pct)).opacity(pct === undefined ? 1 : 0.85)));
}

export default class System extends View {
  init(_props, cx) {
    this.history = { cpu: [], ram: [], gpu: [] };
    this.last = null;
    this.refresh(cx);
    cx.timer.every(EVERY, cx => this.refresh(cx));
  }

  refresh(cx) {
    if (props()?.monitorSlot && !monitorVisible(layout(), props().monitorSlot)) return;
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        this.last = await read(); setShared("system-monitor.last", this.last);
        this.error = null;
        for (const key of ["cpu", "ram", "gpu"]) {
          if (!this.last[key]) continue;
          this.history[key].push(this.last[key].pct);
          if (this.history[key].length > HISTORY) this.history[key].shift();
        }
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme(), now = shared("system-monitor.last") ?? this.last;
    const TIPS = { "CPU total utilization": "CPU toplam kullanımı" };
    const metric = (key, label) => {
      const m = now?.[key];
      if (this.error) return div().text_color(t.dim).tooltip(this.error).child(`${label} –`);
      return h_flex().id(`sys-${key}`).gap(5).items_center().flex_none().tooltip(m?.tip ? tx(m.name ? `${m.name} kullanımı (${GPU_SOURCE[m.src ?? "nvidia-smi"]?.[0] ?? m.src})` : TIPS[m.tip] ?? m.tip, m.tip) : label)
        .child(div().text_size(10).text_color(t.dim).child(label))
        .child(graph(this.history[key], t))
        .child(div().min_w(26).text_size(11).text_color(m && m.pct >= 60 ? level(m.pct) : t.muted).child(m ? `${Math.round(m.pct)}%` : "–"));
    };
    return h_flex().id("system").size_full().px(12).gap(12).items_center().justify_end().when(Boolean(props()?.sidebar), el => el.justify_between()).overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer()
      .on_click(() => { openMonitor(); })
      .when(Boolean(this.error) && !now, el => el.child(div().text_color(t.dim).tooltip(this.error).child(tx("Sistem yükü okunamıyor", "System load unavailable"))))
      .when(!this.error || Boolean(now), el => el.children([metric("cpu", "CPU"), metric("ram", "RAM"), metric("gpu", "GPU")].filter(Boolean)))
      .when(!props()?.sidebar, el => el.child(div().w(1).h(12).ml(2).flex_none().bg(t.border)));
  }
}
