const os = require('node:os');
const {execFile} = require('node:child_process');
const sample = () => os.cpus().reduce((a,c) => {a.idle += c.times.idle; a.total += Object.values(c.times).reduce((s,v)=>s+v,0); return a;}, {idle:0,total:0});
const before = sample();
// The busiest NVIDIA GPU and its name, as nvidia-smi reports them (no fixed model).
const gpu = new Promise(resolve => execFile('C:\\Windows\\System32\\nvidia-smi.exe', ['--query-gpu=name,utilization.gpu','--format=csv,noheader,nounits'], {timeout:2000,windowsHide:true}, (error,out) => {
 const rows = error ? [] : out.trim().split(/\r?\n/).map(l => { const at = l.lastIndexOf(','); return {name: l.slice(0, at).trim(), pct: Number(l.slice(at + 1))}; }).filter(r => r.name && Number.isFinite(r.pct) && r.pct >= 0 && r.pct <= 100);
 resolve(rows.length ? rows.reduce((a, b) => b.pct > a.pct ? b : a) : null);
}));
setTimeout(async () => {
 const after = sample(), delta = after.total-before.total;
 const cpu = delta>0 ? Math.max(0,Math.min(100,100*(1-(after.idle-before.idle)/delta))) : null;
 const total=os.totalmem(), used=total-os.freemem(), g=await gpu;
 console.log(JSON.stringify({cpu:cpu===null?null:{pct:cpu,tip:'CPU total utilization'},ram:{pct:100*used/total,tip:`RAM ${(used/2**30).toFixed(1)} / ${(total/2**30).toFixed(1)} GB`},gpu:g===null?null:{pct:g.pct,name:g.name,tip:`${g.name} utilization (nvidia-smi)`}}));
},1000);
