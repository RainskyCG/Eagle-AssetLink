'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const DEFAULTS = Object.freeze({configured:false, roots:[], searchRoots:[], rootLabels:{}, tag:'EagleBridge', hideUntagged:false, previewFolder:false, doubleClickAction:'default',
  cleanEnabled:true, keywords:['_preview','-preview',' preview','_thumbnail','-thumbnail',' thumbnail','_thumb','-thumb',' thumb','_render','-render',' render','_screenshot','-screenshot',' screenshot','_预览图','_预览','_缩略图','_缩略','_效果图'], cleanMode:'suffix',
  priority:['folder','blend','fbx','glb','gltf','obj','jpg','png','other'], esPath:'', everythingPath:'', instance:''});
const fresh = () => ({schema:1, settings:JSON.parse(JSON.stringify(DEFAULTS)), bindings:{}, journal:[]});
const keyFor = (lib,id) => crypto.createHash('sha256').update(`${path.resolve(lib).toLowerCase()}\0${id}`).digest('hex');
const samePath = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function inside(root,target) {
  const relative = path.relative(path.resolve(root).toLowerCase(), path.resolve(target).toLowerCase());
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..'+path.sep));
}
function stripExt(name, ext) {
  const suffix = ext ? '.'+ext.replace(/^\./,'') : '';
  return suffix && name.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0,-suffix.length) : name;
}
function cleanName(name, settings) {
  let result = name.trim();
  if (!settings.cleanEnabled) return result;
  const terms = [...new Set(settings.keywords.map(x=>x.trim()).filter(Boolean))].sort((a,b)=>b.length-a.length);
  if (settings.cleanMode === 'anywhere') {
    for (const word of terms) result = result.replace(new RegExp(escapeRegex(word),'gi'),'');
  } else {
    let changed = true;
    while (changed && result) {
      changed = false;
      for (const word of terms) if (result.toLowerCase().endsWith(word.toLowerCase())) {
        result = result.slice(0,-word.length).trim(); changed=true; break;
      }
    }
  }
  return result.trim();
}
function namesFor(item, settings, manual='', history=[]) {
  if (manual.trim()) return [manual.trim()];
  const original = stripExt(item.name || '',item.ext).trim();
  return [...new Set([original,cleanName(original,settings),...history].filter(x=>typeof x==='string'&&x.trim()))];
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function localNamePattern(term,settings) {
  const exact=escapeRegex(term);
  if(!settings.cleanEnabled)return '^'+exact+'(?:\\.[^.]+)?$';
  const cleaned=cleanName(term,settings);
  if(!settings.keywords.length||!cleaned)return '^'+exact+'(?:\\.[^.]+)?$';
  // ES passes search syntax through Everything: alternation bars can become OR.
  // Request a bounded superset, then validate each result with the exact cleaner.
  return settings.cleanMode==='anywhere'
    ? '^.*'+[...cleaned].map(escapeRegex).join('.*')+'.*$'
    : '^'+escapeRegex(cleaned)+'.*$';
}
function localNameMatches(base,type,term,settings){
  const stem=type==='file'?path.parse(base).name:base;
  if([base,stem].some(n=>n.toLowerCase()===term.toLowerCase()))return true;
  const cleaned=cleanName(term,settings).toLowerCase();
  return settings.cleanEnabled&&!!cleaned&&cleanName(stem,settings).toLowerCase()===cleaned;
}
function sortCandidates(rows,priority) {
  const rank = x => { const type = x.type==='folder'?'folder':path.extname(x.path).slice(1).toLowerCase();
    let n=priority.indexOf(type); if(n<0)n=priority.indexOf('other');return n<0?999:n; };
  return [...rows].sort((a,b)=>rank(a)-rank(b)||a.path.localeCompare(b.path,'zh-CN'));
}
function eligible(item,binding,settings) { return !settings.hideUntagged || (item.tags||[]).includes(settings.tag); }
function validateSettings(raw) {
  const s={...DEFAULTS,...raw};
  for(const field of ['roots','searchRoots']) {
    if(!Array.isArray(s[field])||s[field].length>64)throw Error('目录列表最多支持 64 项');
    if(s[field].some(p=>typeof p!=='string'||!p.trim()))throw Error('请填写空白目录的路径，或先移除该项');
    s[field]=[...new Set(s[field].map(p=>p.trim()))];
    for(const p of s[field])if(!path.isAbsolute(p))throw Error('请使用绝对目录路径：'+p);
  }
  s.roots=[...new Map([...s.roots,...s.searchRoots].map(p=>[path.resolve(p).toLowerCase(),p])).values()];s.searchRoots=[];
  s.rootLabels=Object.fromEntries([...s.roots,...s.searchRoots].map(p=>[p,String(s.rootLabels?.[p]||'').trim()]).filter(([,name])=>name));
  s.tag=String(s.tag||'').trim();if(!s.tag)throw Error('请填写关联标签');
  s.keywords=(s.keywords||[]).map(x=>String(x).trim()).filter(Boolean);
  s.priority=[...new Set((s.priority||[]).map(x=>x.toLowerCase().trim()).filter(Boolean))];
  if(!['suffix','anywhere'].includes(s.cleanMode))throw Error('名称清理方式无效');
  if(!['default','reveal'].includes(s.doubleClickAction))s.doubleClickAction='default';
  return s;
}
// Windows can briefly deny replacement while another inspector or a scanner
// has the destination open. Retry the atomic rename; never unlink the live file.
async function replaceState(temp,file,rename=fsp.rename,wait=ms=>new Promise(r=>setTimeout(r,ms))){
  const delays=[30,60,120,240,480,800];
  for(let attempt=0;;attempt++){
    try{await rename(temp,file);return;}
    catch(e){
      if(!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;
      if(attempt===delays.length){const error=Error('无法保存定位记录：插件数据文件暂时被占用或没有替换权限。请关闭其他 Eagle AssetLink 设置窗口后重试；若仍失败，请重启 Eagle。原有记录未被删除。');error.code=e.code;error.cause=e;throw error;}
      await wait(delays[attempt]);
    }
  }
}
class Store {
  constructor(dir){this.dir=dir;this.file=path.join(dir,'state.json');this.lock=path.join(dir,'state.lock');}
  async read(){
    try {const d=JSON.parse(await fsp.readFile(this.file,'utf8'));if(d.schema!==1||!d.bindings||!d.settings)throw Error('数据结构无效');d.settings={...DEFAULTS,...d.settings};d.settings.roots=[...new Map([...d.settings.roots,...d.settings.searchRoots].map(p=>[path.resolve(p).toLowerCase(),p])).values()];d.settings.searchRoots=[];if(JSON.stringify(d.settings.keywords)===JSON.stringify(['_preview','_thumb']))d.settings.keywords=[...DEFAULTS.keywords];return d;}
    catch(e){if(e.code==='ENOENT')return fresh();throw Error('关联数据无法读取，请保留文件并从备份恢复：'+e.message);}
  }
  async update(fn){
    await fsp.mkdir(this.dir,{recursive:true});let handle;
    for(let i=0;i<60;i++){try{handle=await fsp.open(this.lock,'wx');break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,50));}}
    if(!handle)throw Error('数据正在被另一窗口使用；若上次异常退出，请关闭插件后检查 state.lock');
    let temp;
    try {const data=await this.read();await fn(data);data.journal=data.journal.slice(-100);
      temp=this.file+'.'+crypto.randomUUID()+'.tmp';await fsp.writeFile(temp,JSON.stringify(data,null,2),'utf8');
      if(fs.existsSync(this.file))await fsp.copyFile(this.file,this.file+'.bak');
      await replaceState(temp,this.file);return data;
    } finally {if(temp)await fsp.unlink(temp).catch(()=>{});await handle.close();await fsp.unlink(this.lock);}
  }
  async settings(s){return this.update(d=>{d.settings=validateSettings(s);});}
  async bind(lib,item,record){return this.update(d=>{d.bindings[keyFor(lib,item.id)]={...record,library:lib,itemId:item.id,itemName:item.name,updatedAt:Date.now()};});}
  async unbind(lib,id){return this.update(d=>{delete d.bindings[keyFor(lib,id)];});}
}
function run(file,args,options={}){
  return new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:8000,maxBuffer:1024*1024,...options},(err,stdout,stderr)=>{
    if(err){const e=Error((stderr||stdout||err.message).toString().trim());e.code=err.code;reject(e);}else resolve(stdout.toString().trim());
  }));
}
async function listAssetFolder(target,options={}){
  const current=await snapshot(target.path);
  const dir=current.type==='folder'?current.path:path.dirname(current.path);
  const entries=await fsp.readdir(dir,{withFileTypes:true});
  const rows=entries.map(e=>({path:path.join(dir,e.name),name:e.name,type:e.isDirectory()?'folder':'file',link:e.isSymbolicLink()}));
  if(options.details){
    let index=0;
    await Promise.all(Array.from({length:Math.min(8,rows.length)},async()=>{
      while(index<rows.length){const row=rows[index++];try{const stat=await fsp.lstat(row.path);row.mtime=stat.mtimeMs;if(row.type==='file')row.size=stat.size;}catch{}}
    }));
  }
  rows.sort((a,b)=>(a.type==='folder'?0:1)-(b.type==='folder'?0:1)||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  return {dir,rows};
}
async function listEagleFolder(item,library,options={}){
  if(!item||!library||!String(item.id||'').match(/^[a-z0-9_-]+$/i))throw Error('无效的 Eagle 条目');
  const dir=path.join(library,'images',item.id+'.info');
  const real=await fsp.realpath(dir),realLibrary=await fsp.realpath(library);
  if(!inside(realLibrary,real))throw Error('Eagle 条目路径位于库外');
  const preview=await listAssetFolder({path:dir},options);
  const itemPath=item.filePath||path.join(dir,item.name+'.'+item.ext);
  return {...preview,eagle:true,itemPath:inside(dir,itemPath)?itemPath:''};
}
async function snapshot(p){
  const stat=await fsp.lstat(p);if(stat.isSymbolicLink())throw Error('原型暂不支持符号链接或联接目录，请选择真实目标');
  if(!stat.isDirectory()&&!stat.isFile())throw Error('请选择普通文件或文件夹');
  return {path:path.resolve(p),type:stat.isDirectory()?'folder':'file',size:stat.size,mtime:stat.mtimeMs,birth:stat.birthtimeMs,ino:stat.ino,dev:stat.dev};
}
function sameSnapshot(a,b){return a.type===b.type&&a.size===b.size&&a.mtime===b.mtime&&a.birth===b.birth&&a.ino===b.ino&&a.dev===b.dev;}
async function bindingValid(record){
  if(!record || record.status==='local-trashed')return false;
  try{const s=await snapshot(record.path);return s.type===record.type&&(!record.identity||s.ino===record.identity.ino&&s.dev===record.identity.dev&&s.birth===record.identity.birth);}catch{return false;}
}
async function detect(settings={}){
  const candidates=[settings.everythingPath];
  try {const out=await run('reg.exe',['query','HKLM\\SYSTEM\\CurrentControlSet\\Services\\Everything','/v','ImagePath']);
    const match=out.match(/REG_\w+\s+(?:"([^"]+\.exe)"|(.+?\.exe))/i);if(match)candidates.push(match[1]||match[2]);}catch{}
  for(const env of ['ProgramFiles','ProgramFiles(x86)','LOCALAPPDATA'])if(process.env[env])candidates.push(path.join(process.env[env],'Everything','Everything.exe'));
  try{candidates.push(...(await run('where.exe',['Everything.exe'])).split(/\r?\n/));}catch{}
  const everythingPath=candidates.find(p=>p&&fs.existsSync(p))||'';
  const esCandidates=[settings.esPath,everythingPath&&path.join(path.dirname(everythingPath),'es.exe')];
  try{esCandidates.push(...(await run('where.exe',['es.exe'])).split(/\r?\n/));}catch{}
  const esPath=esCandidates.find(p=>p&&fs.existsSync(p))||'';
  let ready=false,version='',error='';
  if(esPath)try{version=await run(esPath,[...(settings.instance?['-instance',settings.instance]:[]),'-get-everything-version']);ready=true;}catch(e){error=e.message;}
  return {everythingPath,esPath,ready,version,error};
}
function startEverything(exe,instance=''){
  if(!exe||!fs.existsSync(exe))throw Error('未找到 Everything，请先选择程序');
  return new Promise((resolve,reject)=>{const child=spawn(exe,['-startup',...(instance?['-instance',instance]:[])],{windowsHide:true,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}
function searchError(error){
  const raw=String(error?.message||error);
  if(/IPC window not found|Error 8:/i.test(raw))return Error('Everything 客户端尚未连接，请在设置中启动并连接。');
  if(error?.code==='ENOENT')return Error('找不到 es.exe，请在设置中重新检测工具。');
  if(error?.killed||/timed? ?out|timeout/i.test(raw))return Error('本地查询超时，请等待 Everything 完成索引后重试。');
  return Error('本地查询失败，请检查 Everything 是否就绪，以及查找目录是否可访问。');
}
async function ensureReady(settings){
  let found=await detect(settings);
  if(!found.esPath)throw Error('未找到 es.exe，请在设置中检测或选择命令行工具。');
  if(!found.ready&&found.everythingPath){
    try{await startEverything(found.everythingPath,settings.instance);}catch{throw Error('无法启动 Everything，请在设置中检查程序路径。');}
    for(let i=0;i<8&&!found.ready;i++){
      await new Promise(r=>setTimeout(r,300));found=await detect({...settings,...found});
    }
  }
  if(!found.ready)throw Error('Everything 客户端尚未就绪，请在设置中启动并连接，或等待首次索引完成。');
  return {...settings,esPath:found.esPath,everythingPath:found.everythingPath};
}
async function searchNames(settings,names,options={},searchFn=search){
  const rows=new Map(),issues=[];let incomplete=false;
  for(const term of [...new Set(names)]){
    const found=await searchFn(settings,term,options);
    incomplete ||= found.incomplete;issues.push(...found.issues);
    for(const row of found.rows)rows.set(path.resolve(row.path).toLowerCase(),row);
  }
  // Only broaden matching when the exact/cleaned search produced no candidates.
  let fallback=false;
  if(!rows.size&&!options.fuzzy){
    fallback=true;
    for(const term of [...new Set(names)]){
      const found=await searchFn(settings,term,{...options,fuzzy:true});
      incomplete ||= found.incomplete;issues.push(...found.issues);
      for(const row of found.rows)rows.set(path.resolve(row.path).toLowerCase(),row);
    }
  }
  return {rows:sortCandidates([...rows.values()],settings.priority),incomplete,issues:[...new Set(issues)],fallback};
}
async function search(settings,term,{fuzzy=false,exclude=[]}={}){
  if(!term.trim())throw Error('定位名称不能为空');
  const roots=settings.roots;
  if(!roots.length)throw Error('请先设置迁移查找范围或资产目录');
  if(!settings.esPath)throw Error('请先检测 Everything 命令行工具');
  const rows=new Map();let incomplete=false;const issues=[];
  const regex=fuzzy?escapeRegex(term):localNamePattern(term,settings);
  for(const root of roots){
    let realRoot;try{realRoot=await fsp.realpath(root);}catch{issues.push('目录不可访问：'+root);incomplete=true;continue;}
    const output=path.join(os.tmpdir(),'eagle-bridge-'+crypto.randomUUID()+'.txt');
    try {
      await run(settings.esPath,[...(settings.instance?['-instance',settings.instance]:[]),'-timeout','4000','-n','201','-path',root,'-r',regex,'-export-txt',output,'-utf8-bom']);
      const paths=(await fsp.readFile(output,'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      if(paths.length>=201){incomplete=true;issues.push('结果较多，请缩小范围或补全名称');}
      for(const p of paths.slice(0,200))try{
        if(!path.isAbsolute(p)||!inside(root,p))continue;
        const real=await fsp.realpath(p);if(!inside(realRoot,real)||exclude.some(x=>inside(x,real))||/[\\/]\$recycle\.bin[\\/]/i.test(real))continue;
        const row=await snapshot(p);const base=path.basename(p);const stem=row.type==='file'?path.parse(p).name:base;
        if(!fuzzy&&!localNameMatches(base,row.type,term,settings))continue;
        if(fuzzy&&!base.toLowerCase().includes(term.toLowerCase()))continue;
        rows.set(real.toLowerCase(),row);
      }catch{incomplete=true;}
    } catch(e){throw searchError(e);} finally {await fsp.unlink(output).catch(()=>{});}
  }
  return {rows:sortCandidates([...rows.values()],settings.priority),incomplete,issues,term,fuzzy};
}
async function assertMutable(target,settings,protectedPaths=[]){
  const s=await snapshot(target);const real=await fsp.realpath(target);
  if(!samePath(real,target))throw Error('目标路径经过符号链接或联接，原型禁止同步修改');
  const forbidden=[path.parse(real).root,os.homedir(),process.env.WINDIR,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],...settings.roots,...settings.searchRoots,...protectedPaths].filter(Boolean);
  if(forbidden.some(p=>samePath(real,p)||(protectedPaths.includes(p)&&inside(real,p))))throw Error('不能修改磁盘根目录、配置根目录或应用数据目录');
  if(protectedPaths.some(p=>inside(p,real)))throw Error('不能修改 Eagle 资源库或插件数据');
  if(/[\\/]\$recycle\.bin(?:[\\/]|$)/i.test(real))throw Error('不能修改回收站中的目标');
  return s;
}
function safeRename(target,name,type){
  name=name.trim();if(!name||name==='.'||name==='..'||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('名称包含无效字符或保留名称');
  const ext=type==='file'?path.extname(target):'';if(ext&&name.toLowerCase().endsWith(ext.toLowerCase()))name=name.slice(0,-ext.length);
  if(!name)throw Error('名称不能为空');return path.join(path.dirname(target),name+ext);
}
async function trashFlow({target,expected,validate,confirm,trash,itemTrash,journal}){
  const current=await validate(target);if(expected&&!sameSnapshot(current,expected))throw Error('目标已变化，请重新检查');
  if(!await confirm(current))return {cancelled:true};
  const after=await validate(target);if(!sameSnapshot(current,after))throw Error('确认期间目标发生变化，已取消删除');
  await journal('prepared');
  await trash(target);
  await journal('local-trashed');
  try{const result=await itemTrash();if(result===false)throw Error('Eagle 返回失败');}
  catch(e){await journal('eagle-trash-failed',e.message);return {partial:true,message:e.message};}
  await journal('complete');return {complete:true};
}
module.exports={DEFAULTS,Store,replaceState,listAssetFolder,listEagleFolder,keyFor,inside,samePath,stripExt,cleanName,namesFor,escapeRegex,localNamePattern,localNameMatches,sortCandidates,eligible,validateSettings,run,snapshot,sameSnapshot,bindingValid,detect,startEverything,ensureReady,searchNames,searchError,search,assertMutable,safeRename,trashFlow};
