import {View,div} from "gpui-kit";
import {h_flex,v_flex} from "gpui-base";
import {exec,theme,notify,run,props,layout,shared,appHome} from "herdr";
// UI language (shared "ui.lang": "tr" default | "en"); see I18N.md (package root)
const tx = (tr, en) => (shared("ui.lang") === "en" ? en : tr);
async function call(action,arg){const r=await exec("node",[`${appHome()}/mods/android-devices/android.cjs`,action,...(arg?[arg]:[])]);if(r.code!==0)throw Error(r.stderr);return JSON.parse(r.stdout);}
// Fixed status hues (readable on dark and light chrome) and the panel's identity colour.
const OK="#58c98d",WAIT="#ecb95e",OFF="#e27878",ANDROID="#7fc8a9";
const STATE={device:[["Hazır","Ready"],OK],unauthorized:[["Telefonda USB hata ayıklama onayı bekliyor","Waiting for USB debugging approval on the phone"],WAIT],offline:[["Çevrimdışı","Offline"],OFF],authorizing:[["Yetkilendiriliyor…","Authorizing…"],WAIT],connecting:[["Bağlanıyor…","Connecting…"],WAIT]};
/** Physical (USB / network) devices, ready ones first; emulators are listed under their AVD instead. */
export function connected(devices){return devices.filter(d=>!d.serial.startsWith('emulator-')).sort((a,b)=>(b.state==='device')-(a.state==='device'));}
/** Status of a registered emulator from the adb list, the boot timestamp and the last error. */
export function avdStatus(name,devices,starting,error,now){
 const device=!error&&devices.find(d=>d.avd===name&&d.state==='device');
 const pending=!device&&now-(starting[name]||0)<90000;
 const unknown=Boolean(error)||(!device&&devices.some(d=>d.serial.startsWith('emulator-')&&d.state!=='device'));
 return {device,pending,unknown,label:device?tx('Çalışıyor','Running'):pending?tx('Başlatılıyor…','Starting…'):unknown?tx('Durum bekleniyor','Waiting for status'):tx('Kapalı','Stopped'),color:device?OK:unknown||pending?WAIT:OFF};
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

export default class Devices extends View {
 init(p,cx){if(p?.launcher)return;this.data={devices:[],avds:[]};this.starting={};this.refresh(cx);cx.timer.every(5000,cx=>this.refresh(cx));}
 refresh(cx){if(this.loading || layout()?.children?.find(n=>n.id==="android-panel")?.hidden)return;this.loading=true;cx.spawn(async cx=>{try{this.data=await call('list');this.error=null;}catch(e){this.error=String(e.message);}finally{this.loading=false;cx.notify();}});}
 act(action,arg,cx){if(this.busy)return;this.busy=action+':'+arg;if(action==='boot')this.starting[arg]=Date.now();cx.notify();cx.spawn(async cx=>{try{const r=await call(action,arg);notify({title:action==='shot'?tx('Ekran görüntüsü kaydedildi','Screenshot saved'):'Android',body:r.message});}catch(e){delete this.starting[arg];notify({title:tx('Android işlemi başarısız','Android action failed'),body:String(e.message),level:'error'});}finally{this.busy=false;this.refresh(cx);cx.notify();}});}
 render(cx){const t=theme();
 if(props()?.launcher){const panel=layout()?.children?.find(n=>n.id==='android-panel'),open=Boolean(panel&&!panel.hidden);return topButton('android-toggle','▯','Android',ANDROID,open,tx('Android panelini aç / kapat','Toggle the Android panel'),()=>run('layout.toggle',{id:'android-panel'}));}
 const now=Date.now(),ds=this.data.devices,phones=connected(ds);
 const iconButton=(id,label,tip,fn)=>div().id(id).w(26).h(26).flex_none().rounded(6).cursor_pointer().text_color(t.muted).flex().items_center().justify_center().hover(el=>el.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(fn).child(label);
 const action=(id,text,key,fn)=>{const running=this.busy===key,blocked=Boolean(this.busy)&&!running;
  return div().id(id).flex_none().px(10).py(5).rounded(6).border_1().border_color(t.border).bg(t.raised).text_size(11.5).text_color(blocked?t.dim:t.foreground)
   .when(!blocked,el=>el.cursor_pointer().hover(h=>h.bg(t.hover))).when(blocked,el=>el.opacity(0.6))
   .on_click(()=>{if(!this.busy)fn();}).child(running?tx('Bekleyin…','Please wait…'):text);};
 const card=(id,title,sub,label,dot,extra,act)=>h_flex().id(id).gap(10).items_stretch().pr(12).py(10).rounded(8).border_1().border_color(t.border).bg(t.surface)
  .child(div().w(3).flex_none().rounded(2).bg(dot))
  .child(v_flex().flex_1().min_w(0).gap(6)
   .child(h_flex().gap(8).items_center()
    .child(v_flex().flex_1().min_w(0).gap(1)
     .child(div().truncate().font_semibold().child(title))
     .child(div().truncate().text_size(10.5).text_color(t.dim).child(sub)))
    .when(Boolean(act),el=>el.child(act)))
   .child(h_flex().gap(6).items_center().child(div().size(6).flex_none().rounded(3).bg(dot)).child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(label)))
   .when(Boolean(extra),el=>el.child(div().truncate().text_size(10.5).text_color(t.dim).child(extra))));
 const heading=(text,count)=>h_flex().gap(6).items_center().pt(2).child(div().text_size(10).text_color(t.dim).child(text)).when(count!=null,el=>el.child(div().px(5).rounded(4).bg(t.raised).text_size(9.5).text_color(t.muted).child(String(count))));
 return v_flex().size_full().min_h(0).p(14).gap(10).bg(t.chrome).text_color(t.foreground).text_size(12)
 .child(h_flex().gap(6).items_center()
  .child(div().size(8).flex_none().rounded(4).bg(ANDROID))
  .child(v_flex().flex_1().min_w(0).gap(1)
   .child(div().font_semibold().text_size(15).child('Android'))
   .child(div().text_size(11).text_color(t.muted).child(tx('Bağlı cihazlar ve emülatörler','Connected devices and emulators'))))
  .child(iconButton('refresh',this.loading?'…':'↻',this.loading?tx('Kontrol ediliyor…','Checking…'):tx('Şimdi yenile','Refresh now'),()=>this.refresh(cx)))
  .child(iconButton('android-close','×',tx('Kapat','Close'),()=>run('layout.hide',{id:'android-panel'}))))
 .when(Boolean(this.error),el=>el.child(div().px(10).py(7).rounded(6).border_1().border_color(OFF).text_size(11.5).text_color(OFF).child(tx('adb okunamadı: ','Could not read adb: ')+(this.error||'').split('\n')[0])))
 .child(v_flex().id('android-list').flex_1().min_h(0).overflow_y_scrollbar().gap(8)
  .child(heading(tx('BAĞLI CİHAZLAR','CONNECTED DEVICES'),this.error?null:phones.length))
  .when(!phones.length,el=>el.child(div().px(2).text_size(11.5).text_color(t.muted).child(this.loading&&!ds.length?tx('Kontrol ediliyor…','Checking…'):tx('Bağlı cihaz yok. USB hata ayıklamayı açıp telefonu bağlayın.','No connected devices. Enable USB debugging and connect your phone.'))))
  .children(phones.map(d=>{const [lab,dot]=STATE[d.state]||[[d.state,d.state],WAIT],label=tx(lab[0],lab[1]),ready=d.state==='device';
   return card('device-'+d.serial,d.name.replace(/_/g,' '),tx('Cihaz · ','Device · ')+d.serial,label,dot,ready&&d.app?tx('Ön planda: ','Foreground: ')+d.app:null,
    ready?action('shot-'+d.serial,tx('Ekran görüntüsü','Screenshot'),'shot:'+d.serial,()=>this.act('shot',d.serial,cx)):null);}))
  .child(heading(tx('EMÜLATÖRLER','EMULATORS'),this.data.avds.length))
  .when(!this.data.avds.length,el=>el.child(div().px(2).text_size(11.5).text_color(t.muted).child(this.loading?tx('Kontrol ediliyor…','Checking…'):tx('Kayıtlı emülatör yok','No registered emulators'))))
  .children(this.data.avds.map(name=>{const s=avdStatus(name,ds,this.starting,this.error,now);
   const act=s.device?action('shot-'+name,tx('Ekran görüntüsü','Screenshot'),'shot:'+s.device.serial,()=>this.act('shot',s.device.serial,cx)):s.pending||s.unknown?null:action('boot-'+name,tx('Başlat','Start'),'boot:'+name,()=>this.act('boot',name,cx));
   return card('avd-'+name,name,s.device?tx('Emülatör · ','Emulator · ')+s.device.serial:tx('Android sanal cihaz','Android virtual device'),s.label,s.color,null,act);})))
 .child(div().text_size(10.5).text_color(t.dim).child(tx("Ekran görüntüleri: Resimler\\Herdr · görünürken 5 sn'de bir yenilenir","Screenshots: Pictures\\Herdr · refreshes every 5 s while visible")));
 }
}
