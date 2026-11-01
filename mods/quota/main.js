// Based on the "quota" mod of github.com/Lakris2407/herdr-quota, Copyright (c) 2026 Lakris2407, MIT License (see NOTICE); modified.
function monitorVisible(node, id) {
  if (!node || node.hidden) return false;
  if (node.id === id) return true;
  return (node.children ?? []).some(child => monitorVisible(child, id));
}
// Agent quota in the status bar: one slim bar per limit window, from `quota-axi --json`.
// Click it for details and options. The same mod draws the popup (props().menu).
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme, settings, shared, setShared, props, openOverlay, knownAgents, nextCommand, layout, home, appHome, window } from "herdr";
// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);

const EVERY = 60000, STALE = 10 * 60000, TICK = 10000, FRESH = 50000, INFLIGHT = 30000;
/** A shared timestamp is trusted only when it is a number, not in the future (tampering or a clock
 *  moved back), and younger than maxAge. */
export function recent(value, now, maxAge) {
  return typeof value === "number" && value <= now + 1000 && now - value < maxAge;
}
/** How old the shown quota is (Turkish or English per ui.lang). */
export function ageText(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 10 ? tx("az önce", "just now") : s < 60 ? tx(`${s} sn önce`, `${s}s ago`) : tx(`${Math.floor(s / 60)} dk önce`, `${Math.floor(s / 60)}m ago`);
}
const DEFAULTS = { kinds: { session: true, weekly: true, monthly: true, model: false }, hidden: [], signedOut: false, names: false };
const ICONS = { claude: "claude", codex: "codex", grok: "grok", kimi: "kimi", copilot: "copilot", cursor: "cursor" };
const TINT = { claude: "#d97757", kimi: "#1783ff", copilot: "#8f6bf2" };
const KINDS = [["session", { tr: "5 saatlik limit", en: "5-hour limit" }], ["weekly", { tr: "Haftalık limit", en: "Weekly limit" }], ["monthly", { tr: "Aylık limit", en: "Monthly limit" }], ["model", { tr: "Model limitleri", en: "Model limits" }]];

// Layout props set the starting options (`{"mod": "quota", "props": {"hidden": ["cursor"]}}`); the popup's choices win.
function options() {
  const start = props()?.menu ? props().start ?? {} : props() ?? {}, saved = shared("quota.options") ?? {};
  return { ...DEFAULTS, ...start, ...saved, kinds: { ...DEFAULTS.kinds, ...(start.kinds ?? {}), ...(saved.kinds ?? {}) } };
}
const setOptions = change => setShared("quota.options", { ...options(), ...change });
const signedIn = p => p.windows.length > 0;

// Calm until it matters: green, amber from 60%, orange from 80%, red from 92%.
function level(pct) {
  const dark = settings().dark !== false;
  const scale = dark ? ["#5ed49a", "#f2c14e", "#f59152", "#f2665c"] : ["#1f9d63", "#c98a0b", "#dd6b20", "#d64545"];
  return scale[pct >= 92 ? 3 : pct >= 80 ? 2 : pct >= 60 ? 1 : 0];
}

// Two windows of one kind (Cursor's monthly ones) are told apart by their own label.
function short(w, twin) {
  if (twin) return (w.label ?? w.kind).split(" ")[0].slice(0, 6);
  if (w.kind === "session") return w.windowSeconds ? `${Math.round(w.windowSeconds / 3600)}${tx("sa", "h")}` : tx("5sa", "5h");
  if (w.kind === "weekly") return tx("hf", "wk");
  if (w.kind === "monthly") return tx("ay", "mo");
  return (w.label ?? "model").split(" ")[0].slice(0, 6);
}

// Share of the window already gone, 0..1; null without a reset time.
function elapsed(w, now) {
  if (!w.resetsAt || !w.windowSeconds) return null;
  const left = (Date.parse(w.resetsAt) - now) / 1000;
  return Math.min(1, Math.max(0, 1 - left / w.windowSeconds));
}

function until(iso, now) {
  const min = Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
  const [mu, hu, du] = tx(["dk", "sa", "g"], ["m", "h", "d"]);
  if (min < 60) return `${min}${mu}`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}${hu} ${min % 60}${mu}` : `${Math.floor(h / 24)}${du} ${h % 24}${hu}`;
}

function ago(at, now) {
  const min = Math.round((now - at) / 60000);
  return min < 1 ? tx("az önce", "just now") : tx(`${min} dk önce`, `${min}m ago`);
}

function pace(w, now) {
  const e = elapsed(w, now);
  if (e === null || e < 0.03) return null;
  const diff = Math.round(w.percentUsed - e * 100);
  return { diff, ahead: diff >= 10 && w.percentUsed >= 20 };
}

function bar(w, width, height, now, t) {
  const e = elapsed(w, now), pct = Math.min(100, Math.max(0, w.percentUsed));
  return div().relative().w(width).h(height).flex_none().rounded(height / 2).bg(t.border)
    .child(div().absolute().left(0).top(0).h(height).w(Math.max(pct > 0 ? height : 0, width * pct / 100)).rounded(height / 2).bg(level(pct)))
    .when(e !== null, el => el.child(div().absolute().top(-2).h(height + 4).w(1).left(Math.round(width * e)).bg(t.foreground).opacity(0.45)));
}

/** Runs quota-axi. The next way is tried only when one could not start; a run that started and failed reports its own error. */
export async function load() {
  const args = ["--json", "--no-credential-refresh"];
  // Herdr's own folder as the working directory: cmd.exe looks for a bare command there first, and quota-axi
  // itself runs bare helpers (sqlite3), so nothing from whatever folder Herdr was started in gets picked up.
  const safe = { cwd: appHome() };
  const windows = window()?.platform === "windows";
  const started = p => p.then(r => r, () => null);
  let r = null;
  // npm's global install, run by node directly so --use-system-ca applies (Windows only).
  if (windows) {
    r = await started(exec("node", ["--use-system-ca", `${home()}/AppData/Roaming/npm/node_modules/quota-axi/dist/bin/quota-axi.js`, ...args], safe));
    if (r && r.code !== 0 && /Cannot find module|MODULE_NOT_FOUND|bad option/i.test(r.stderr || "")) r = null;
  }
  if (!r) r = await started(exec("quota-axi", args, safe));
  // Its Windows .cmd shim, or the login shell's PATH elsewhere; fixed command text, nothing interpolated.
  if (!r) r = await exec(...(windows
    ? ["cmd.exe", ["/d", "/s", "/c", "quota-axi --json --no-credential-refresh"]]
    : ["sh", ["-c", 'exec "${SHELL:-/bin/sh}" -lic "quota-axi --json --no-credential-refresh" </dev/null']]), safe)
    .catch(e => ({ code: -1, stderr: String(e) }));
  if (r.code !== 0) throw new Error(`quota-axi failed: ${(r.stderr || "").trim().split("\n").pop() || `exit ${r.code}`}`);
  // An interactive shell can print a banner first; the report starts at the first brace.
  const data = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  return {
    at: Date.now(),
    providers: (data.providers ?? []).map(p => ({
      id: p.provider, label: p.label ?? p.provider, plan: p.plan ?? null, status: p.state?.status ?? null,
      windows: (p.windows ?? []).map(w => ({ ...w, percentUsed: typeof w.percentUsed === "number" ? w.percentUsed : typeof w.percentRemaining === "number" ? 100 - w.percentRemaining : null })).filter(w => typeof w.percentUsed === "number")
        .map(w => ({ id: w.id, label: w.label, kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null, windowSeconds: w.windowSeconds ?? null })),
    })),
  };
}

export default class Quota extends View {
  init(_props, cx) {
    // The app's program table knows each agent's icon and whether it is a one-color glyph.
    this.programs = {};
    cx.spawn(async cx => {
      const list = await knownAgents().catch(() => []);
      for (const a of list) this.programs[a.key] = a;
      cx.notify();
    });
    if (props()?.menu) return;
    this.asked = shared("quota.refresh") ?? 0;
    this.refresh(cx);
    cx.timer.every(EVERY, cx => this.refresh(cx));
    // Re-render the age label while visible; no data is fetched here.
    cx.timer.every(TICK, cx => { if (props()?.monitorSlot && !monitorVisible(layout(), props().monitorSlot)) return; cx.notify(); });
    // Key commands: "quota:menu" opens the popup, "quota:refresh" reads the quota now.
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "menu") this.openMenu();
        if (c === "refresh") this.refresh(cx, { force: true });
      }
    });
  }

  glyph(p, size, t) {
    const program = this.programs[p.id], icon = program?.icon ?? (ICONS[p.id] ? `icons/${ICONS[p.id]}.svg` : null);
    if (!icon) return div().size(6).rounded(3).flex_none().bg(t.dim);
    const el = TINT[p.id] || !program || program.tint
      ? svg(icon).size(size).flex_none().text_color(TINT[p.id] ?? program?.color ?? t.foreground)
      : image(icon).size(size).flex_none().rounded(3);
    return signedIn(p) ? el : el.opacity(0.35);
  }

  /** Shared cache: every visible quota view reuses one reading.
   *  - timer: skipped while the shared data is younger than FRESH or another view is fetching;
   *  - menu "Yenile" (since = the ask time, broadcast to every view): skipped when a fetch started
   *    or a reading arrived after the ask, so one click runs one query;
   *  - key command (force): always fetches. */
  refresh(cx, { force = false, since = null } = {}) {
    if (props()?.monitorSlot && !monitorVisible(layout(), props().monitorSlot)) return;
    if (this.loading) return;
    const now = Date.now(), data = shared("quota.data"), inflight = shared("quota.inflight");
    if (!force && recent(inflight, now, INFLIGHT) && (since == null || inflight >= since)) return;
    if (!force && since == null && recent(data?.at, now, FRESH)) return;
    if (!force && since != null && typeof data?.at === "number" && data.at >= since && data.at <= now + 1000) return;
    this.loading = true;
    const mine = now;
    setShared("quota.inflight", mine);
    cx.spawn(async cx => {
      try { setShared("quota.data", await load()); setShared("quota.error", null); }
      catch (e) { setShared("quota.error", String(e.message ?? e)); }
      finally {
        this.loading = false;
        if (shared("quota.inflight") === mine) setShared("quota.inflight", null);
        cx.notify();
      }
    });
  }



  openMenu() {
    const data = shared("quota.data"), o = options();
    const all = data?.providers ?? [], shown = all.filter(p => !o.hidden.includes(p.id) && (signedIn(p) || o.signedOut));
    const details = shown.reduce((n, p) => n + 30 + p.windows.length * 42, 0);
    const toggles = (KINDS.length + all.length + 2) * 28;
    openOverlay({ mod: "quota", kind: "popup", width: 300, height: Math.min(720, 44 + details + 40 + toggles + 12), props: { menu: true, start: props() ?? {} } });
  }

  render(cx) {
    const t = theme();
    if (props()?.menu) return this.menu(t);
    const ask = shared("quota.refresh") ?? 0;
    if (ask !== this.asked) { this.asked = ask; this.refresh(cx, { since: typeof ask === "number" ? ask : Date.now() }); }
    const data = shared("quota.data"), error = shared("quota.error"), o = options(), now = Date.now();
    const stale = !data || now - data.at > STALE;
    const fetching = this.loading || recent(shared("quota.inflight"), now, INFLIGHT);
    const list = (data?.providers ?? []).filter(p => (!props()?.providers || props().providers.includes(p.id)) && !o.hidden.includes(p.id) && (signedIn(p) || o.signedOut));
    if (props()?.sidebar) {
      return v_flex().id('quota-sidebar').size_full().px(14).py(8).gap(9).bg(t.chrome).text_size(12).text_color(t.foreground).overflow_y_scrollbar().cursor_pointer()
        .on_click(() => this.openMenu())
        .child(h_flex().justify_between().items_center().tooltip(tx("Kota 60 sn'de bir yenilenir. Tıkla: menü", "Quota refreshes every 60 s. Click: menu"))
          .child(div().text_size(10).text_color(t.dim).child(tx('KOTA KULLANIMI', 'QUOTA USAGE')))
          .child(div().id('quota-age').text_size(10).text_color(stale ? level(80) : t.dim).child(fetching ? tx('güncelleniyor…', 'updating…') : data ? tx(`güncellendi ${ageText(data.at, now)}`, `updated ${ageText(data.at, now)}`) : '')))
        .when(stale, el => el.opacity(0.6))
        .when(!list.length, el => el.child(error || tx('Kota yükleniyor…', 'Loading quota…')))
        .children(list.flatMap(p => p.windows.filter(w => o.kinds[w.kind] ?? false).map(w =>
          h_flex().gap(8).items_center().h(27).flex_none()
            .tooltip(tx(`${p.label} · ${w.label} · kullanılan %${Math.round(w.percentUsed)}`, `${p.label} · ${w.label} · ${Math.round(w.percentUsed)}% used`))
            .child(div().w(90).flex_none().text_color(t.foreground).child(`${p.id === 'claude' ? 'Claude' : p.id === 'codex' ? 'Codex' : p.label} ${w.kind === 'session' ? tx('5 sa', '5 h') : w.kind === 'weekly' ? tx('7 gün', '7 days') : w.label}`))
            .child(bar(w, 108, 6, now, t))
            .child(div().w(36).flex_none().text_right().text_color(level(w.percentUsed)).child(`${Math.round(w.percentUsed)}%`))
            .child(div().flex_1().text_right().text_size(10).text_color(t.dim).child(w.resetsAt ? until(w.resetsAt, now) : ''))
        )));
    }
    const parts = [];
    list.forEach((p, i) => {
      if (i > 0) parts.push(div().w(1).h(12).flex_none().bg(t.border));
      const windows = p.windows.filter(w => o.kinds[w.kind] ?? false);
      parts.push(h_flex().id(`q-${p.id}`).gap(9).items_center().flex_none()
        .tooltip(windows.map(w => tx(`${p.label} ${w.label}: %${w.percentUsed} kullanıldı${w.resetsAt && Date.parse(w.resetsAt) > now ? `, ${until(w.resetsAt, now)} sonra sıfırlanır` : ""}`, `${p.label} ${w.label}: ${w.percentUsed}% used${w.resetsAt && Date.parse(w.resetsAt) > now ? `, resets in ${until(w.resetsAt, now)}` : ""}`)).join("\n") || tx(`${p.label}: oturum açılmamış`, `${p.label}: not signed in`))
        .child(h_flex().gap(5).items_center()
          .child(this.glyph(p, 12, t))
          .when(props()?.names || o.names || !ICONS[p.id], el => el.child(div().text_color(signedIn(p) ? t.muted : t.dim).child(p.label))))
        .when(!signedIn(p), el => el.child(div().size(6).rounded(3).border_1().border_color(t.dim)))
        .children(windows.map(w => {
          const pc = pace(w, now);
          return h_flex().gap(5).items_center()
            .child(div().text_size(10).text_color(t.dim).child(short(w, windows.filter(x => x.kind === w.kind).length > 1)))
            .child(bar(w, 34, 4, now, t))
            .child(div().min_w(24).text_size(11).text_color(w.percentUsed >= 60 ? level(w.percentUsed) : t.muted).child(`${Math.round(w.percentUsed)}%`))
            .when(Boolean(pc?.ahead), el => el.child(div().ml(-3).text_size(8).text_color(level(Math.max(60, w.percentUsed))).child("▲")));
        })));
    });
    return h_flex().id("quota").size_full().px(12).gap(11).items_center().justify_end().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer()
      .when(stale, el => el.opacity(0.6))
      .on_click(() => this.openMenu())
      .on_mouse_down("right", () => this.openMenu())
      .when(parts.length === 0, el => el.child(div().text_color(t.dim).child(error ? tx("Kota kullanılamıyor", "Quota unavailable") : data ? tx("Gösterilecek kota yok", "No quota to show") : tx("Kota…", "Quota…"))))
      .children(parts)
      .when(Boolean(data), el => el.child(div().id("quota-age").flex_none().text_size(10).text_color(t.dim).child(fetching ? tx("güncelleniyor…", "updating…") : ageText(data.at, now))));
  }

  menu(t) {
    const data = shared("quota.data"), error = shared("quota.error"), o = options(), now = Date.now();
    const all = data?.providers ?? [];
    const toggle = (label, on, act, id) => h_flex().id(id).h(28).px(8).gap(9).rounded(6).items_center().cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(act)
      .child(div().size(14).flex_none().rounded(4).border_1().border_color(on ? level(0) : t.input).bg(on ? level(0) : t.popover)
        .when(on, el => el.child(div().size_full().flex().items_center().justify_center().text_size(10).text_color(t.popover).child("✓"))))
      .child(div().flex_1().text_color(t.foreground).child(label));
    const heading = text => div().px(8).pt(10).pb(4).text_size(10.5).text_color(t.dim).child(text);
    const details = all.filter(p => !o.hidden.includes(p.id) && (signedIn(p) || o.signedOut)).map(p => v_flex().px(8).py(4).gap(4)
      .child(h_flex().gap(6).items_center()
        .child(this.glyph(p, 13, t))
        .child(div().font_semibold().text_color(t.foreground).child(p.label))
        .child(div().text_size(10.5).text_color(t.dim).child(signedIn(p) ? (p.plan ?? "") : tx("oturum açılmamış", "not signed in"))))
      .children(p.windows.map(w => {
        const pc = pace(w, now);
        return v_flex().gap(3)
          .child(h_flex().gap(8).items_center()
            .child(div().w(62).flex_none().truncate().text_size(11.5).text_color(t.muted).child(w.kind === "session" ? tx("5 saat", "5 hours") : w.kind === "weekly" ? tx("Hafta", "Week") : w.label))
            .child(bar(w, 120, 5, now, t))
            .child(div().flex_1().text_right().text_size(11.5).text_color(w.percentUsed >= 60 ? level(w.percentUsed) : t.foreground).child(`${Math.round(w.percentUsed)}%`)))
          .child(div().pl(70).text_size(10.5).text_color(t.dim).child([
            w.resetsAt && Date.parse(w.resetsAt) > now ? tx(`${until(w.resetsAt, now)} sonra sıfırlanır`, `resets in ${until(w.resetsAt, now)}`) : null,
            pc ? (Math.abs(pc.diff) < 5 ? tx("tempoda", "on pace") : pc.diff > 0 ? tx(`temponun %${pc.diff} önünde`, `${pc.diff}% ahead of pace`) : tx(`temponun %${-pc.diff} altında`, `${-pc.diff}% under pace`)) : null,
          ].filter(Boolean).join(" · ")));
      })));
    return v_flex().id("quota-menu").w_full().p(5).bg(t.popover).text_size(12.5).overflow_y_scrollbar()
      .child(h_flex().px(8).pt(4).pb(2).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child(data ? tx(`Ajan kotası · güncellendi ${ago(data.at, now)}`, `Agent quota · updated ${ago(data.at, now)}`) : tx("Ajan kotası", "Agent quota")))
        .child(div().id("quota-refresh").px(6).rounded(5).cursor_pointer().text_size(11).text_color(t.muted).hover(s => s.bg(t.hover))
          .on_click(() => setShared("quota.refresh", Date.now())).child(tx("Yenile", "Refresh"))))
      .when(Boolean(error), el => el.child(div().px(8).py(4).text_size(11).text_color(level(95)).child(error)))
      .children(details)
      .child(div().mx(8).my(6).h(1).bg(t.border))
      .child(heading(tx("Durum çubuğunda göster", "Show in the status bar")))
      .children(KINDS.map(([kind, label]) => toggle(tx(label.tr, label.en), o.kinds[kind], () => setOptions({ kinds: { ...o.kinds, [kind]: !o.kinds[kind] } }), `kind-${kind}`)))
      .children(all.map(p => toggle(p.label, !o.hidden.includes(p.id),
        () => setOptions({ hidden: o.hidden.includes(p.id) ? o.hidden.filter(x => x !== p.id) : [...o.hidden, p.id] }), `prov-${p.id}`)))
      .child(toggle(tx("Oturumu kapalı sağlayıcılar", "Signed-out providers"), o.signedOut, () => setOptions({ signedOut: !o.signedOut }), "signed-out"))
      .child(toggle(tx("Sağlayıcı adları", "Provider names"), o.names, () => setOptions({ names: !o.names }), "names"));
  }
}
