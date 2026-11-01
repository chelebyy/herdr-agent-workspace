import {View,div} from "gpui-kit";
import {h_flex,v_flex} from "gpui-base";
import {theme,props,shared,layout,run,openOverlay,closeOverlay,notify,nextCommand,setShared} from "herdr";
// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);
function find(node,id){if(node?.id===id)return node;for(const child of node?.children??[]){const found=find(child,id);if(found)return found;}return null;}
function selectPosition(name){
 const sidebar=name==='main-monitor-sidebar';
 for(const id of ['sidebar-system','sidebar-quota'])run(sidebar?'layout.show':'layout.hide',{id});
 for(const id of ['status-system','status-quota'])run(sidebar?'layout.hide':'layout.show',{id});
 run('layout.resize',{id:'sidebar',px:sidebar?360:268});
 setShared('monitor.position',sidebar?'sidebar':'bottom');
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

const GAUGE='#ecc05a';
const choices=[{name:'main-monitor-sidebar',place:'sidebar',label:'Sol üst',detail:'Proje listesinin üstünde',en:['Top left','Above the project list']},{name:'main-android',place:'bottom',label:'Alt çubuk',detail:'Alt durum çubuğunda',en:['Bottom bar','In the bottom status bar']}];
/** A tiny window sketch that highlights where the gauges will sit. */
function sketch(place,active,t){
 const mark=active?GAUGE:t.muted;
 return div().relative().w(46).h(32).flex_none().rounded(5).border_1().border_color(active?GAUGE:t.border).bg(t.background).overflow_hidden()
  .child(div().absolute().left(0).top(0).w(13).h(32).bg(t.raised))
  .child(div().absolute().left(13).top(0).w(33).h(5).bg(t.raised))
  .when(place==='sidebar',el=>el.child(div().absolute().left(2).top(3).w(9).h(8).rounded(2).bg(mark)))
  .when(place==='bottom',el=>el.child(div().absolute().left(15).top(27).w(29).h(3).rounded(1).bg(mark)));
}
export default class Position extends View {
 init(_p,cx){const p=props();if(p?.menu||p?.overlay){this.overlayId=p.overlay;if(this.overlayId)setShared('monitor-position.open',this.overlayId);return;}setShared('monitor-position.open',null);cx.spawn(async cx=>{for(;;){const command=await nextCommand();if(command==='sidebar'||command==='bottom'){selectPosition(command==='sidebar'?'main-monitor-sidebar':'main-android');cx.notify();}}});}
 close(){if(this.overlayId&&shared('monitor-position.open')===this.overlayId)setShared('monitor-position.open',null);}
 render(){const t=theme(),current=find(layout(),'sidebar-quota')?.hidden?'main-android':'main-monitor-sidebar';
 const open=Boolean(shared('monitor-position.open'));
 if(!props()?.menu&&!props()?.overlay)return topButton('monitor-position-open','◔',tx('Göstergeler ▾','Gauges ▾'),'#ecc05a',open,tx('CPU ve kota göstergelerinin konumu','Position of the CPU and quota gauges'),()=>{const existing=shared('monitor-position.open');if(existing){closeOverlay(existing);return;}openOverlay({mod:'monitor-position',kind:'popup',width:286,height:212,props:{menu:true}});});
 return v_flex().size_full().p(10).gap(8).bg(t.popover).text_color(t.foreground).text_size(12)
 .child(h_flex().gap(8).items_center().px(4).pt(2)
  .child(div().flex_none().text_size(13).text_color(GAUGE).child('◔'))
  .child(v_flex().flex_1().min_w(0).gap(1)
   .child(div().font_semibold().child(tx('Göstergeler','Gauges')))
   .child(div().truncate().text_size(10.5).text_color(t.muted).child(tx('CPU, RAM, GPU ve kota nerede görünsün?','Where should CPU, RAM, GPU and quota appear?')))))
 .children(choices.map(c=>{const active=current===c.name;return h_flex().id('position-'+c.name).gap(10).items_center().px(10).py(9).rounded(8).border_1()
 .border_color(active?GAUGE:t.border).bg(active?t.selected:t.popover).hover(s=>s.bg(t.hover)).cursor_pointer()
 .on_click(async()=>{
   if(current===c.name){closeOverlay(props().overlay);return;}
   try{selectPosition(c.name);closeOverlay(props().overlay);}
   catch(e){notify({title:tx('Yerleşim değiştirilemedi','Could not change layout'),body:String(e),level:'error'});}
 })
 .child(sketch(c.place,active,t))
 .child(v_flex().flex_1().min_w(0).gap(2)
  .child(div().font_semibold().child(tx(c.label,c.en[0])))
  .child(div().truncate().text_size(10.5).text_color(t.muted).child(tx(c.detail,c.en[1]))))
 .child(div().w(14).flex_none().text_color(GAUGE).child(active?'✓':''));}));
 }
}
