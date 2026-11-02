const {execFile,spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
// ANDROID_HOME / ANDROID_SDK_ROOT, else Android Studio's default SDK folder for this platform.
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'Android/Sdk'):process.platform==='darwin'?path.join(os.homedir(),'Library/Android/sdk'):path.join(os.homedir(),'Android/Sdk'));
const exe=process.platform==='win32'?'.exe':'';
// The SDK's tool when it is there, else the one on PATH (Linux packages such as android-tools put adb in /usr/bin).
const tool=(rel,name)=>{const file=path.join(sdk,rel+exe);return fs.existsSync(file)?file:name+exe;};
const adb=tool('platform-tools/adb','adb'),emu=tool('emulator/emulator','emulator');
// Without the emulator package the panel still lists devices, with no registered emulators.
const avds=()=>run(emu,['-list-avds']).catch(e=>{if(e.code==='ENOENT')return '';throw e;});
const run=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:12000,maxBuffer:16*1024*1024},(e,out)=>e?reject(Object.assign(new Error(e.message),{code:e.code})):resolve(out.trim())));
async function devices(){const raw=await run(adb,['devices','-l']);return raw.split(/\r?\n/).slice(1).filter(l=>l.trim()).map(l=>{const [serial,state]=l.trim().split(/\s+/);return {serial,state,name:l.match(/model:(\S+)/)?.[1]||serial};});}
async function main(){
 const [action,arg]=process.argv.slice(2);
 if(action==='list'){
  const [ds,names]=await Promise.all([devices(),avds()]);
  for(const d of ds){if(d.state!=='device')continue;
   if(d.serial.startsWith('emulator-'))d.avd=(await run(adb,['-s',d.serial,'emu','avd','name'])).split(/\r?\n/)[0].trim();
   const dump=await run(adb,['-s',d.serial,'shell','dumpsys','activity','activities']).catch(()=>'');
   d.app=dump.match(/(?:mResumedActivity|topResumedActivity)[^\n]*?\s([\w.]+)\//)?.[1]||null;
  }
  return {devices:ds,avds:names.split(/\r?\n/).filter(Boolean)};
 }
 if(action==='boot'){
  const names=(await run(emu,['-list-avds'])).split(/\r?\n/);
  if(!names.includes(arg))throw Error('Unknown AVD');
  const connected=await devices();
  if(connected.some(d=>d.serial.startsWith('emulator-')&&d.state!=='device'))throw Error('An emulator is still starting or offline; wait before starting another.');
  for(const d of connected){if(d.state==='device'&&d.serial.startsWith('emulator-')&&(await run(adb,['-s',d.serial,'emu','avd','name'])).split(/\r?\n/)[0].trim()===arg)return {message:'Already running'};}
  const logs=path.join(process.env.HERDR_APP_HOME||path.join(os.homedir(),'.config/herdr-app'),'data/android-devices');fs.mkdirSync(logs,{recursive:true});
  const log=fs.openSync(path.join(logs,'emulator-'+Date.now()+'.log'),'a');
  const child=spawn(emu,['-avd',arg],{detached:true,windowsHide:true,stdio:['ignore',log,log]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();fs.closeSync(log);return {message:arg+' başlatılıyor'};
 }
 if(action==='shot'){
  if(!(await devices()).some(d=>d.serial===arg&&d.state==='device'))throw Error('Device not ready');
  const outDir=path.join(os.homedir(),'Pictures/Herdr');fs.mkdirSync(outDir,{recursive:true});
  const output=path.join(outDir,'android-'+Date.now()+'.png');
  const bytes=await new Promise((resolve,reject)=>execFile(adb,['-s',arg,'exec-out','screencap','-p'],{windowsHide:true,timeout:12000,encoding:'buffer',maxBuffer:32*1024*1024},(e,b)=>e?reject(e):resolve(b)));
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid screenshot');
  fs.writeFileSync(output,bytes,{flag:'wx'});return {message:output};
 }
 throw Error('Unknown action');
}
main().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1});