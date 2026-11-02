const os = require('node:os');
const fs = require('node:fs');
const {execFile} = require('node:child_process');
const sample = () => os.cpus().reduce((a,c) => {a.idle += c.times.idle; a.total += Object.values(c.times).reduce((s,v)=>s+v,0); return a;}, {idle:0,total:0});
const linux = process.platform === 'linux';
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
// Linux: busy time of every GPU engine as the DRM drivers count it per client in /proc/<pid>/fdinfo
// (i915, xe, amdgpu, nouveau, msm, ...). Only processes of this user are readable; the compositor may be missing.
function engines() {
  const clients = new Map();
  let names;
  try { names = fs.readdirSync('/proc'); } catch { return clients; }
  for (const pid of names) {
    if (!/^\d+$/.test(pid)) continue;
    let fds;
    try { fds = fs.readdirSync(`/proc/${pid}/fdinfo`); } catch { continue; }
    for (const fd of fds) {
      const text = read(`/proc/${pid}/fdinfo/${fd}`);
      if (!text || !text.includes('drm-engine-')) continue;
      const field = key => new RegExp(`^${key}:\\s*(\\S+)`, 'm').exec(text)?.[1];
      const id = `${field('drm-pdev') || ''}:${field('drm-client-id') || `${pid}/${fd}`}`; // one client may be open on several fds
      if (clients.has(id)) continue;
      const busy = {};
      for (const [, engine, ns] of text.matchAll(/^drm-engine-(?!capacity-)([\w-]+):\s*(\d+)\s*ns/gm)) {
        const capacity = Number(new RegExp(`^drm-engine-capacity-${engine}:\\s*(\\d+)`, 'm').exec(text)?.[1]) || 1;
        busy[engine] = {ns: Number(ns), capacity};
      }
      clients.set(id, {driver: field('drm-driver') || 'GPU', pdev: field('drm-pdev'), busy});
    }
  }
  return clients;
}
const start = Date.now(), before = sample(), drm = linux ? engines() : null;
// Linux: query nvidia-smi only when an NVIDIA display device exists and none is runtime-suspended,
// because the query would wake a sleeping hybrid-laptop dGPU (RTD3) every 3 s.
function nvidiaAwake() {
  let devices;
  try { devices = fs.readdirSync('/sys/bus/pci/devices'); } catch { return true; }
  const cards = devices.filter(d => (read(`/sys/bus/pci/devices/${d}/vendor`) || '').trim() === '0x10de' && (read(`/sys/bus/pci/devices/${d}/class`) || '').trim().startsWith('0x03'));
  return cards.length > 0 && cards.every(d => (read(`/sys/bus/pci/devices/${d}/power/runtime_status`) || '').trim() !== 'suspended');
}
// The busiest NVIDIA GPU and its name, as nvidia-smi reports them (no fixed model).
const nvidia = linux && !nvidiaAwake() ? Promise.resolve(null) : new Promise(resolve => execFile(process.platform === 'win32' ? 'C:\\Windows\\System32\\nvidia-smi.exe' : 'nvidia-smi', ['--query-gpu=name,utilization.gpu','--format=csv,noheader,nounits'], {timeout:2000,windowsHide:true}, (error,out) => {
 const rows = error ? [] : out.trim().split(/\r?\n/).map(l => { const at = l.lastIndexOf(','); return {name: l.slice(0, at).trim(), pct: Number(l.slice(at + 1)), src: 'nvidia-smi'}; }).filter(r => r.name && Number.isFinite(r.pct) && r.pct >= 0 && r.pct <= 100);
 resolve(rows.length ? rows.reduce((a, b) => b.pct > a.pct ? b : a) : null);
}));
// AMD cards report their own busy percent in sysfs.
function amd() {
  let cards;
  try { cards = fs.readdirSync('/sys/class/drm').filter(n => /^card\d+$/.test(n)); } catch { return null; }
  const rows = cards.map(card => ({card, pct: Number(read(`/sys/class/drm/${card}/device/gpu_busy_percent`))})).filter(r => read(`/sys/class/drm/${r.card}/device/gpu_busy_percent`) !== null && r.pct >= 0 && r.pct <= 100);
  return rows.length ? {...rows.reduce((a, b) => b.pct > a.pct ? b : a), name: 'AMD GPU', src: 'sysfs'} : null;
}
// Busiest engine of the busiest GPU over the sampling window, from the fdinfo counters.
function fromEngines(after, seconds) {
  const gpus = new Map();
  for (const [id, now] of after) {
    const old = drm.get(id);
    if (!old) continue;
    const gpu = gpus.get(now.pdev) || {driver: now.driver, engines: {}};
    for (const [engine, {ns, capacity}] of Object.entries(now.busy)) {
      const delta = ns - (old.busy[engine]?.ns ?? ns);
      if (delta > 0) gpu.engines[engine] = (gpu.engines[engine] || 0) + delta / 1e9 / seconds / capacity * 100;
    }
    gpus.set(now.pdev, gpu);
  }
  if (!gpus.size) return null;
  const vendor = pdev => ({'0x8086': 'Intel', '0x1002': 'AMD', '0x10de': 'NVIDIA'})[(read(`/sys/bus/pci/devices/${pdev}/vendor`) || '').trim()];
  const rows = [...gpus.entries()].map(([pdev, g]) => ({name: [vendor(pdev), `GPU (${g.driver})`].filter(Boolean).join(' '), pct: Math.min(100, Math.max(0, ...Object.values(g.engines))), src: 'fdinfo'}));
  return rows.reduce((a, b) => b.pct > a.pct ? b : a);
}
setTimeout(async () => {
 const after = sample(), delta = after.total-before.total;
 const cpu = delta>0 ? Math.max(0,Math.min(100,100*(1-(after.idle-before.idle)/delta))) : null;
 const total=os.totalmem(), used=total-os.freemem();
 const g = await nvidia || (linux ? amd() || fromEngines(engines(), (Date.now() - start) / 1000) : null);
 const how = {'nvidia-smi': 'nvidia-smi', sysfs: 'sysfs', fdinfo: 'DRM fdinfo, busiest engine'};
 console.log(JSON.stringify({cpu:cpu===null?null:{pct:cpu,tip:'CPU total utilization'},ram:{pct:100*used/total,tip:`RAM ${(used/2**30).toFixed(1)} / ${(total/2**30).toFixed(1)} GB`},gpu:g===null?null:{pct:g.pct,name:g.name,src:g.src,tip:`${g.name} utilization (${how[g.src]})`}}));
},1000);
