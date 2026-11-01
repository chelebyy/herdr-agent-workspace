import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, theme, props, shared, setShared, openOverlay, closeOverlay } from "herdr";
// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);

const DESIGN = "team-pulse.design";
export const DESIGNS = [{id:"mixer",label:"Sinyal mikseri",en:"Signal mixer"},{id:"control",label:"Mini kontrol merkezi",en:"Mini control center"},{id:"orbit",label:"Yörünge",en:"Orbit"},{id:"rows",label:"Nabız satırları",en:"Pulse rows"}];
const dname = d => tx(d.label, d.en);
export function selectedDesign(value) { return DESIGNS.some(d => d.id === value) ? value : "control"; }
const PAUSE = "team-pulse.paused";
const MENU = "team-pulse.menu-open";
const LABELS_T = { working: ["Çalışıyor", "Working"], blocked: ["Yanıt bekliyor", "Awaiting reply"], done: ["Tamamlandı", "Done"], idle: ["Beklemede", "Idle"], unknown: ["Durum yok", "No status"], absent: ["Açık ajan yok", "No open agents"] };
const SHORT_T = { working: ["çalışıyor", "working"], blocked: ["yanıt bekliyor", "awaiting reply"], done: ["bitti", "done"], idle: ["bekliyor", "idle"], unknown: ["durum yok", "no status"], absent: ["yok", "none"] };
// Resolved per access (render time) so a language switch applies immediately.
const LABELS = new Proxy({}, { get: (_, k) => (LABELS_T[k] ? tx(...LABELS_T[k]) : undefined) });
const SHORT = new Proxy({}, { get: (_, k) => (SHORT_T[k] ? tx(...SHORT_T[k]) : undefined) });
const KINDS = [
  { id: "codex", name: "Codex", color: "#5fd3ac" },
  { id: "claude", name: "Claude", color: "#e8916b" },
  { id: "opencode", name: "OpenCode", color: "#b892f5" },
];

export function statusOf(list) {
  if (!list.length) return "absent";
  return ["blocked", "working", "done", "idle"].find(status => list.some(a => a.status === status)) || "unknown";
}
export function summarize(list) {
  const unique = [...new Map(list.filter(a => a.address).map(a => [a.address, a])).values()];
  const buckets = new Map(KINDS.map(k => [k.id, []]));
  const other = [];
  for (const agent of unique) {
    const key = `${agent.app || ""} ${agent.program?.key || ""}`.toLowerCase();
    const kind = KINDS.find(k => key.includes(k.id));
    (kind ? buckets.get(kind.id) : other).push(agent);
  }
  const rows = KINDS.filter(kind => buckets.get(kind.id).length > 0).map(kind => ({ ...kind, agents: buckets.get(kind.id), status: statusOf(buckets.get(kind.id)) }));
  if (other.length) rows.push({ id: "other", name: tx("Diğer", "Other"), color: "#9aa8ff", agents: other, status: statusOf(other) });
  const counts = {}; for (const a of unique) counts[a.status] = (counts[a.status] || 0) + 1;
  return { rows, total: unique.length, status: statusOf(unique), counts, working: counts.working || 0, blocked: counts.blocked || 0 };
}
export function summaryText(summary) {
  if (!summary.total) return tx("Açık ajan yok", "No open agents");
  return ["working", "blocked", "idle", "done", "unknown"].filter(k => summary.counts[k]).map(k => `${summary.counts[k]} ${SHORT[k]}`).join(" · ");
}
function stateColor(status, color, t) {
  return status === "blocked" ? t.ansi3 : status === "done" ? t.ansi2 : ["absent", "unknown"].includes(status) ? t.dim : color;
}
function glow(el, status, paused) {
  if (paused || ["absent", "unknown", "done"].includes(status)) return el;
  return el.loop("opacity", { from: status === "working" ? 0.45 : 0.4, to: status === "idle" ? 0.65 : 1, period: status === "working" ? 2400 : 4400 });
}
function pulseWave(color, status, paused) {
  const wave = div().relative().w(180).h(24).flex_none()
    .child(svg("mods/team-pulse/pulse.svg").absolute().left(0).top(0).w(180).h(24).text_color(color).opacity(status === "absent" ? 0.12 : 0.25));
  if (status === "absent") return wave;
  const light = div().absolute().left(0).top(0).w(180).h(24).overflow_hidden()
    .child(svg("mods/team-pulse/pulse.svg").w(180).h(24).flex_none().text_color(color));
  wave.child(status === "working" && !paused ? light.loop("width", { from: 0, to: 180, period: 3600, easing: "linear" }) : glow(light, status, paused));
  return wave;
}

function line(parent,x,y,w,h,color) {
  parent.child(div().absolute().left(x).top(y).w(Math.max(1,w)).h(Math.max(1,h)).bg(color).opacity(0.35));
}
function hub(parent,x,y,color,t,label="H") {
  parent.child(h_flex().id("team-hub").absolute().left(x-17).top(y-17).w(34).h(34).items_center().justify_center()
    .rounded(8).border_1().border_color(color).bg(t.raised).text_color(color).font_semibold().text_size(17).child(label));
}
export function streamPoints(vertices) {
  const points=[];
  for(let i=1;i<vertices.length;i++){
    const [x,y]=vertices[i-1],[endX,endY]=vertices[i];
    const steps=Math.max(1,Math.ceil(Math.hypot(endX-x,endY-y)/4));
    for(let j=0;j<steps;j++)points.push([x+(endX-x)*j/steps,y+(endY-y)*j/steps]);
  }
  points.push(vertices[vertices.length-1]);return points;
}
export function streamFrames(index) {
  return Array.from({length:8},(_,phase)=>phase===index%8?"●":" ");
}
function packetStream(parent,id,vertices,color,paused,status) {
  if(paused||status!=="working")return;
  const stream=div().id(id).absolute().left(0).top(0).w_full().h(136);
  streamPoints(vertices).forEach(([x,y],i)=>stream.child(div().id(id+"-"+i).absolute().left(x-3).top(y-5).w(8).h(10)
    .text_size(8).text_color(color).frames(streamFrames(i),85)));
  parent.child(stream);
}
function chipHub(diagram,cx,cy,summary,t,paused,ringId) {
  const hc=stateColor(summary.status,t.ansi6,t);
  for(let i=0;i<4;i++){const a=cx-12+i*8;line(diagram,a,cy-22,2,5,hc);line(diagram,a,cy+17,2,5,hc);line(diagram,cx-22,cy-12+i*8,5,2,hc);line(diagram,cx+17,cy-12+i*8,5,2,hc);}
  const halo=svg("mods/team-pulse/circuit-ring.svg").id(ringId).absolute().left(cx-26).top(cy-26).w(52).h(52).text_color(hc);
  const moving=!paused&&["working","idle","blocked"].includes(summary.status);
  diagram.child(moving?halo.spin(summary.status==="working"?4200:12000):halo.opacity(0.4));
  hub(diagram,cx,cy,hc,t);
}

function meter(parent,row,x,y,w,h,t,paused,key) {
  const color=stateColor(row.status,row.color,t);
  const bars=Math.max(3,Math.min(6,Math.floor(w/8))),shape=[0.55,0.85,0.65,1,0.75,0.9];
  for(let j=0;j<bars;j++){
    const full=h*shape[j%shape.length];
    const height=row.status==="idle"?Math.max(3,full*0.22):row.status==="blocked"?full*0.5:full;
    const bar=div().id(`${key}-${row.id}-${j}`).absolute().left(x+j*(w/bars)).bottom(136-y-h).w(Math.max(3,w/bars-3)).h(height).rounded(1).bg(color)
      .opacity(row.status==="idle"?0.45:row.status==="done"?0.7:0.85);
    if(paused||row.status==="idle"||row.status==="done"||row.status==="unknown")parent.child(bar);
    else if(row.status==="blocked")parent.child(bar.loop("opacity",{from:0.25,to:0.9,period:900}));
    else parent.child(bar.loop("height",{from:Math.max(3,height*.25),to:height,period:1500+j*260}));
  }
}
function mixerDiagram(diagram,summary,width,t,paused) {
  const lane=(width-64)/Math.max(1,summary.rows.length);
  summary.rows.forEach((row,i)=>{
    const x=i*lane,c=stateColor(row.status,row.color,t);
    diagram.child(div().absolute().left(x).top(0).w(lane-4).text_size(10.5).truncate().text_color(t.foreground).child(row.name));
    diagram.child(div().absolute().left(x).top(18).w(lane-6).h(76).rounded(5).bg(t.background).border_1().border_color(row.color+"40"));
    meter(diagram,row,x+5,24,lane-16,64,t,paused,"mixer-bar");
    diagram.child(div().id("mixer-state-"+row.id).absolute().left(x).top(100).w(lane-4).text_size(10).truncate().text_color(c).child(`${row.agents.length} · ${SHORT[row.status]}`));
    diagram.child(div().absolute().left(x).top(0).w(lane-4).h(135).tooltip(`${row.name}: ${row.agents.length} ${tx("oturum","sessions")} · ${LABELS[row.status]}`));
  });
  line(diagram,width-61,18,1,94,t.muted);chipHub(diagram,width-28,60,summary,t,paused,"mixer-motion-ring");
}
const DEMO_CODE=["let run=()=>{"," let n=1;"," let out=[];"," if(n>0){","  n+=1;","  out.push(n)"," }"," for(let x of","     out){","  log(x);"," }"," return n;","};","let v=run();","let ok=v>0;","if(ok){"," save(v);"," log('done');","}"];
const CODE_LINES=6;
export function makeCodeFrames() {
  const frames=[],history=[];
  for(const code of DEMO_CODE){
    for(let n=0;n<=code.length;n++){
      const visible=[...history.slice(-(CODE_LINES-1)),code.slice(0,n)+"▏"];
      while(visible.length<CODE_LINES)visible.push("");
      frames.push(visible);
    }
    history.push(code);
    const hold=history.slice(-CODE_LINES);while(hold.length<CODE_LINES)hold.push("");
    frames.push([...hold],[...hold],[...hold]);
  }
  return frames;
}
const CODE_FRAMES=makeCodeFrames();
// Clipped slices carry cloth and emblem together. Native oscillations
// change the folds without JavaScript timers or per-frame rerenders.
function wavingFlag(id,x,y,width,paused) {
  const w=Math.min(30,width),h=w*2/3,slices=15,step=w/slices;
  const flag=div().id("control-flag-"+id).absolute().left(x+(width-w)/2).top(y+1).w(w).h(h)
    .tooltip(tx("Türk bayrağı","Turkish flag"));
  for(let i=0;i<slices;i++){
    const u=i/(slices-1),a=1.3*u*Math.sin(u*Math.PI*2),b=0.65*u*Math.cos(u*Math.PI*2);
    const strip=div().id("flag-strip-"+id+"-"+i).absolute().left(i*step).top(0).w(step).h(h).overflow_hidden().bg("#E30A17")
      .child(svg("mods/team-pulse/turkish-flag-mark.svg").absolute().left(-i*step).top(0).w(w).h(h).text_color("#FFFFFF"));
    const shade=div().absolute().left(0).top(0).w(step).h(h).bg("#000000");
    strip.child(paused?shade.opacity(0):shade.loop("opacity",{from:0.02+0.12*(1+Math.sin(u*Math.PI*2))/2,to:0.02+0.12*(1-Math.sin(u*Math.PI*2))/2,period:2400}));
    const fold=div().absolute().left(0).top(0).w(w).h(h)
      .child(paused||i===0?strip:strip.loop("top",{from:-a,to:a,period:2400}));
    flag.child(paused||i===0?fold:fold.loop("top",{from:-b,to:b,period:1800}));
  }
  return flag;
}

function codeScreen(parent,row,index,x,y,width,t,paused) {
  const color=stateColor(row.status,row.color,t),working=row.status==="working";
  if(!working){
    if(row.status==="idle"){
      parent.child(wavingFlag(row.id,x,y,width,paused));

    }
    if(row.status==="done"){
      [tx("> işlem tamam","> task complete"),tx("> çıktı hazır","> output ready")].forEach((text,i)=>parent.child(
        div().id("control-done-"+row.id+"-"+i).absolute().left(x).top(y+2+i*10).w(width).h(10)
          .font_family("Consolas").text_size(Math.min(7.5,width/(13*0.61))).text_color(color).opacity(0.65).truncate().child(text)));
    }
    const label=row.status==="idle"?"> ready ▏":row.status==="done"?tx("✓ Bitti","✓ Done"):row.status==="blocked"?LABELS.blocked:LABELS.unknown;
    const state=div().id("control-state-"+row.id).absolute().left(x).top(y+25).w(width).h(12).font_family("Consolas").text_center().text_size(Math.min(8,width/5.5)).text_color(color).truncate();
    parent.child(row.status==="idle"&&!paused?state.frames(["> ready ▏","> ready  "],650):state.child(label));
    return;
  }
  const fontSize=Math.min(6.5,Math.max(4,width/(14*0.61)));
  for(let line=0;line<CODE_LINES;line++){
    const el=div().id(`control-code-${row.id}-${line}`).absolute().left(x).top(y+line*6.5).w(Math.max(1,width)).h(7)
      .overflow_hidden().font_family("Consolas").text_size(fontSize).text_color(line%3===0?t.ansi5:line%3===2?t.ansi3:color);
    if(!paused){
      const offset=index*13;
      parent.child(el.frames(CODE_FRAMES.map((_,frame)=>CODE_FRAMES[(frame+offset)%CODE_FRAMES.length][line]),120));
    }else parent.child(el.child(DEMO_CODE[line]));
  }
}

function controlDiagram(diagram,summary,width,t,paused) {
  const lane=width/Math.max(1,summary.rows.length),cx=width/2;
  summary.rows.forEach((row,i)=>{
    const x=i*lane,c=stateColor(row.status,row.color,t),sw=lane-8;
    diagram.child(div().absolute().left(x).top(0).w(sw).h(76).rounded(5).border_1().border_color(row.color+"90").bg(t.background)
      .tooltip(`${row.name}: ${row.agents.filter(a=>a.status==="working").length} ${tx("çalışan","working")} / ${row.agents.length} ${tx("açık oturum","open sessions")} · ${LABELS[row.status]}`));
    // Keep the same native motion identity while working, then fade once on done.
    // The working surface is transparent; initial done renders start at zero.
    const flash=div().id("control-completion-"+row.id).absolute().left(x+1).top(1).w(sw-2).h(74).rounded(4)
      .bg(row.status==="done"?c:"#00000000").opacity(row.status==="working"&&!paused?0.18:0);
    diagram.child(!paused?flash.transition("opacity",{duration:700,easing:"ease-out"}):flash);
    diagram.child(h_flex().id("control-head-"+row.id).absolute().left(x+6).top(4).w(sw-12).h(14).gap(4).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).font_semibold().text_color(row.color).child(row.name))
      .child(div().flex_none().px(4).rounded(4).bg(row.color+"26").text_size(9.5).font_semibold().text_color(row.color).child(String(row.agents.length))));
    diagram.child(div().id("control-status-"+row.id).absolute().left(x+6).top(18).w(sw-12).truncate().text_size(9.5).text_color(c).child("● "+SHORT[row.status]));
    codeScreen(diagram,row,i,x+5,33,sw-10,t,paused);
    const center=x+sw/2;
    line(diagram,center,77,1,5,c);line(diagram,Math.min(center,cx),82,Math.abs(center-cx),1,c);line(diagram,cx,82,1,11,c);
    packetStream(diagram,"control-packet-"+row.id,[[center,77],[center,82],[cx,82],[cx,93]],c,paused,row.status);
  });
  chipHub(diagram,cx,110,summary,t,paused,"control-motion-ring");
}

function orbitDiagram(diagram,summary,width,t,paused) {
  const rows=summary.rows.slice(0,4),rmax=34+(rows.length-1)*10,lx=2*rmax+12,legend=width-lx>=60,ox=legend?rmax+2:width/2,oy=68;
  rows.forEach((row,i)=>{
    const r=34+i*10,c=stateColor(row.status,row.color,t),n=Math.max(1,Math.min(4,row.agents.length));
    diagram.child(svg("mods/team-pulse/orbit-ring.svg").absolute().left(ox-r).top(oy-r).w(r*2).h(r*2).text_color(row.color).opacity(0.35));
    const dots=svg(`mods/team-pulse/orbit-dots-${n}.svg`).id("orbit-dots-"+row.id).absolute().left(ox-r).top(oy-r).w(r*2).h(r*2).text_color(c)
      .tooltip(`${row.name}: ${row.agents.length} ${tx("oturum","sessions")} · ${LABELS[row.status]}`);
    if(paused||row.status==="done"||row.status==="unknown")diagram.child(dots.opacity(row.status==="done"?0.55:0.85));
    else if(row.status==="blocked")diagram.child(dots.loop("opacity",{from:0.2,to:1,period:900}));
    else diagram.child(dots.spin(row.status==="working"?3200+i*700:8000+i*600));
  });
  chipHub(diagram,ox,oy,summary,t,paused,"orbit-motion-ring");
  if(!legend)return;
  const item=28,gap=rows.length>3?2:5,total=rows.length*item+(rows.length-1)*gap,top=oy-total/2,lw=width-lx;
  rows.forEach((row,i)=>{
    const c=stateColor(row.status,row.color,t);
    diagram.child(h_flex().id("orbit-legend-"+row.id).absolute().left(lx).top(top+i*(item+gap)).w(lw).h(item).gap(7).items_center()
      .tooltip(`${row.name}: ${row.agents.length} ${tx("oturum","sessions")} · ${LABELS[row.status]}`)
      .child(div().w(3).h(item-6).flex_none().rounded(2).bg(row.color))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(5).items_center().min_w(0)
          .child(div().min_w(0).truncate().text_size(11).font_medium().text_color(t.foreground).child(row.name))
          .child(div().flex_none().px(4).rounded(4).bg(row.color+"26").text_size(9).font_semibold().text_color(row.color).child(String(row.agents.length))))
        .child(div().truncate().text_size(9.5).text_color(row.status==="idle"?t.muted:c).child(SHORT[row.status]))));
  });
}

function heartbeat(row,x,y,w,c,paused) {
  const box=div().id("rows-beat-"+row.id).absolute().left(x).top(y).w(w).h(14).overflow_hidden();
  if(row.status==="idle"||row.status==="done"||row.status==="unknown")
    return box.child(div().absolute().left(0).top(7).w(w).h(1).bg(c).opacity(row.status==="idle"?0.6:0.35));
  box.child(svg("mods/team-pulse/pulse.svg").absolute().left(0).top(0).w(w).h(14).text_color(c).opacity(0.25));
  const light=div().id("rows-light-"+row.id).absolute().left(0).top(0).w(w).h(14).overflow_hidden()
    .child(svg("mods/team-pulse/pulse.svg").w(w).h(14).flex_none().text_color(c));
  if(paused)return box.child(light);
  return box.child(row.status==="working"?light.loop("width",{from:0,to:w,period:1800,easing:"linear"}):light.loop("opacity",{from:0.2,to:1,period:1400}));
}
function rowsDiagram(diagram,summary,width,t,paused) {
  const area=width-64,n=summary.rows.length,h=Math.min(40,(136-(n-1)*4)/n),y0=(136-(n*h+(n-1)*4))/2;
  summary.rows.forEach((row,i)=>{
    const y=y0+i*(h+4),c=stateColor(row.status,row.color,t),inner=area-6-30-6;
    const words=row.name.split(" ").filter(Boolean),initials=words.length>1?words.map(w=>w[0]).join("").toUpperCase():row.name.slice(0,2);
    diagram.child(div().id("rows-row-"+row.id).absolute().left(0).top(y).w(area-6).h(h).rounded(6).bg(t.background).border_1().border_color(row.color+"40")
      .tooltip(`${row.name}: ${row.agents.length} ${tx("oturum","sessions")} · ${LABELS[row.status]}`));
    diagram.child(div().absolute().left(6).top(y+(h-20)/2).w(20).h(20).rounded(5).bg(row.color+"26").text_color(row.color).text_size(9).font_semibold().flex().items_center().justify_center().child(initials.slice(0,2)));
    const textTop=y+Math.max(2,(h-30)/2);
    diagram.child(h_flex().absolute().left(30).top(textTop).w(inner).h(14).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).font_semibold().text_color(t.foreground).child(`${row.name} · ${row.agents.length}`))
      .when(inner>=110,el=>el.child(div().flex_none().text_size(9.5).text_color(c).child(SHORT[row.status]))));
    diagram.child(heartbeat(row,30,textTop+15,inner,c,paused));
  });
  line(diagram,width-61,8,1,120,t.muted);chipHub(diagram,width-28,68,summary,t,paused,"rows-motion-ring");
}

export default class TeamPulse extends View {
  init() {
    this.width = 280; this.menuOpen = false;
    // Popup bookkeeping (same pattern as the other launchers): a second ▾ click closes it.
    const p = props();
    if (p?.menu) { this.overlayId = p.overlay; if (this.overlayId) setShared(MENU, this.overlayId); }
    else if (!p?.strip && shared(MENU)) setShared(MENU, null);
  }
  close() { if (this.overlayId && shared(MENU) === this.overlayId) setShared(MENU, null); }
  render() {
    const t=theme(),viewProps=props();
    const design=selectedDesign(shared(DESIGN));
    // Popup copy of the design menu, used from the collapsed rail where the inline menu cannot fit.
    if(viewProps?.menu){
      return v_flex().id("team-pulse-menu").size_full().p(8).gap(4).bg(t.popover).text_color(t.foreground).text_size(12)
        .child(div().px(6).py(4).text_size(11).text_color(t.dim).child(tx("Bağlantı tasarımı","Connection design")))
        .children(DESIGNS.map(d=>h_flex().id("design-"+d.id).h(32).flex_none().px(8).gap(8).items_center().rounded(6)
          .bg(design===d.id?t.selected:t.popover).hover(s=>s.bg(t.hover)).cursor_pointer()
          .on_click(()=>{if(selectedDesign(shared(DESIGN))!==d.id)setShared(DESIGN,d.id);closeOverlay(viewProps.overlay);})
          .child(div().flex_1().min_w(0).truncate().child(dname(d)))
          .child(div().w(12).flex_none().text_color(t.accent).child(design===d.id?"✓":""))));
    }
    if(this.menuOpen&&!viewProps?.strip){
      return v_flex().id("team-pulse-panel").size_full().px(12).py(9).gap(4).bg(t.chrome).text_color(t.foreground).text_size(12)
        .on_size_change((size)=>{this.width=size.width;})
        .child(h_flex().h(26).flex_none().items_center().justify_between()
          .child(div().text_color(t.muted).child(tx("Tasarım seç","Choose design")))
          .child(div().id("design-menu-close").px(8).py(4).cursor_pointer().tooltip(tx("Seçmeden geri dön","Go back without choosing"))
            .on_click((_,cx)=>{this.menuOpen=false;cx.notify();}).child("×")))
        .children(DESIGNS.map(d=>div().id("design-"+d.id).h(34).flex_none().px(8).py(8).rounded(6).truncate()
          .bg(design===d.id?t.selected:t.chrome).hover(s=>s.bg(t.hover)).cursor_pointer().tooltip(dname(d))
          .on_click((_,cx)=>{
            const changed=selectedDesign(shared(DESIGN))!==d.id;
            this.menuOpen=false;
            if(changed)setShared(DESIGN,d.id);else cx.notify();
          }).child((design===d.id?"✓ ":"")+dname(d))));
    }
    const summary=summarize(agents()),paused=Boolean(shared(PAUSE));
    const toggle = () => setShared(PAUSE, !shared(PAUSE));
    if (props()?.strip) {
      return h_flex().id("team-pulse-strip").size_full().items_center().px(12).bg(t.chrome).cursor_pointer()
        .tooltip(tx(`Ekip nabzı · ${summary.working} çalışıyor · ${summary.blocked} yanıt bekliyor. Durum animasyonudur, performans ölçümü değildir. Tıkla: ${paused ? "hareketi aç" : "duraklat"}.`,
          `Team pulse · ${summary.working} working · ${summary.blocked} awaiting reply. This is a status animation, not a performance measurement. Click to ${paused ? "resume motion" : "pause"}.`))
        .on_click(toggle)
        .when(!summary.rows.length, el => el.child(div().flex_1().h(1).bg(t.border)))
        .children(summary.rows.map(row => {
          const color = stateColor(row.status, row.color, t);
          return h_flex().id(`pulse-${row.id}`).flex_1().min_w(0).h(24).items_center().overflow_hidden()
            .child(div().flex_1().h(1).bg(color).opacity(0.25))
            .child(pulseWave(color, row.status, paused))
            .child(div().flex_1().h(1).bg(color).opacity(0.25));
        }));
    }
    const narrow = this.width < 190;
    const choose=(_,cx)=>{
      if(this.width<110){const existing=shared(MENU);if(existing){closeOverlay(existing);return;}openOverlay({mod:"team-pulse",kind:"popup",width:200,height:44+DESIGNS.length*36,props:{menu:true}});return;}
      this.menuOpen=true;cx.notify();
    };
    // Rail (collapsed sidebar): icon-only buttons stacked; medium widths: the label shrinks to "▾".
    const tiny=this.width<110,designTip=`${tx("Bağlantı tasarımı","Connection design")}: ${dname(DESIGNS.find(d=>d.id===design))}`,summaryTip=`${summary.total} ${tx("ajan","agents")} · ${summaryText(summary)}`;
    const designButton=div().id("team-pulse-design").px(6).py(4).rounded(4).text_size(11).text_color(t.muted).hover(s=>s.bg(t.hover)).cursor_pointer()
      .tooltip(tiny?`${summaryTip}
${designTip}`:designTip).on_click(choose).child(narrow?"▾":tx("Tasarım ▾","Design ▾"));
    const pauseButton=div().id("team-pulse-pause").px(6).py(4).rounded(4).text_size(11).text_color(t.muted).hover(s=>s.bg(t.hover)).cursor_pointer()
      .tooltip(paused?tx("Animasyonları aç","Resume animations"):tx("Animasyonları duraklat","Pause animations")).on_click(toggle).child(paused?"▶":"Ⅱ");
    const footer=tiny
      ? v_flex().id("team-pulse-footer").flex_none().items_center().gap(2).child(designButton).child(pauseButton)
      : h_flex().id("team-pulse-footer").h(26).flex_none().items_center().gap(5)
        .child(div().flex_1().min_w(0).text_size(11).truncate().tooltip(summaryTip).child(summaryText(summary)))
        .child(designButton).child(pauseButton);
    const panel=v_flex().id("team-pulse-panel").size_full().px(this.width<110?4:12).py(9).gap(5).bg(t.chrome).text_size(13).text_color(t.muted)
      .on_size_change((size,cx)=>{if(this.width!==size.width){this.width=size.width;cx.notify();}});
    if(narrow)return panel.when(this.width<110,el=>el.items_center()).children(summary.rows.map(row=>glow(div().id("compact-"+row.id).w(10).h(10).rounded(5).bg(stateColor(row.status,row.color,t)).tooltip(`${row.name}: ${row.agents.length} · ${LABELS[row.status]}`),row.status,paused))).child(div().flex_1()).child(footer);
    const width=Math.max(166,this.width-24);
    const diagram=div().relative().w_full().h(136).flex_none().tooltip(tx("Tüm projelerdeki açık ajanların durumu. Animasyonlar görseldir; gerçek mesaj trafiği veya performans ölçümü değildir.","Status of open agents across all projects. Animations are visual only; they do not show real message traffic or performance."));
    if(!summary.rows.length){
      hub(diagram,width/2,42,t.dim,t);
      diagram.child(div().absolute().left(0).right(0).top(78).text_center().text_size(12).child(tx("Açık ajan yok","No open agents")));
    }else if(design==="mixer")mixerDiagram(diagram,summary,width,t,paused);
    else if(design==="orbit")orbitDiagram(diagram,summary,width,t,paused);
    else if(design==="rows")rowsDiagram(diagram,summary,width,t,paused);
    else controlDiagram(diagram,summary,width,t,paused);
    return panel.child(div().flex_1()).child(diagram).child(div().flex_1()).child(footer);
  }
}
