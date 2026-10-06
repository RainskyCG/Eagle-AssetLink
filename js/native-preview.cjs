'use strict';
// Use the installed Eagle's format registry and decoders, without importing assets.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {pathToFileURL,fileURLToPath}=require('url');
const registries=new Map(),jobs=new Map();
function registry(root){
 if(!registries.has(root)){
  const config=require(path.join(root,'config.js'));
  const source=fs.readFileSync(path.join(root,'app/js/thumbs/thumb.js'),'utf8'),decoders={};
  for(const match of source.matchAll(/'([a-z0-9]+)'\s*:\s*init\('([a-z0-9]+\.js)'\)/g))decoders[match[1]]=match[2];
  registries.set(root,{config,decoders});
 }
 return registries.get(root);
}
function route(file,root,theme='gray',locale='zh_CN'){
 const ext=path.extname(file).slice(1).toLowerCase(),{config,decoders}=registry(root);
 const page=name=>pathToFileURL(path.join(root,'app',name));
 if(ext==='pdf'){const url=page('pdf-viewer/web/viewer.html');url.searchParams.set('path',pathToFileURL(file).href);url.searchParams.set('locale',locale.replace('_','-'));url.searchParams.set('theme',theme);return {kind:'page',url:url.href};}
 if((config.VIDEO_FORMATS||[]).includes(ext)||(config.AUDIO_FORMATS||[]).includes(ext))return {kind:'media'};
 if((config.MODEL_FORMATS||[]).includes(ext)){const url=page('model-viewer/website/index.html');url.hash='model='+pathToFileURL(file).href.replace(/,/g,'%2C');return {kind:'page',url:url.href};}
 if(['html','mhtml'].includes(ext))return {kind:'page',url:pathToFileURL(file).href};
 if(ext==='txt')return {kind:'text'};
 if(ext==='url')return {kind:'link'};
 if(/^(png|jpe?g|jfif|jpe|webp|gif|bmp|svg|avif|ico|insp)$/.test(ext))return {kind:'image'};
 if(config.SUPPORT_FORMATS?.[ext])return {kind:'thumbnail',decoder:decoders[ext]||'native.js'};
 return {kind:'unsupported'};
}
async function thumbnail(file,root){
 const stat=await fs.promises.stat(file),ext=path.extname(file).slice(1).toLowerCase(),{config,decoders}=registry(root);
 if(!config.SUPPORT_FORMATS?.[ext])throw Error('Eagle 没有此格式的原生解码器');
 const key=crypto.createHash('sha256').update(root+'|'+file+'|'+stat.size+'|'+stat.mtimeMs).digest('hex');
 if(jobs.has(key))return jobs.get(key);
 const task=(async()=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'eagle-bridge-preview-')),dest=path.join(dir,'preview.png');
  try{
   const item={id:'bridge-'+key,ext,name:path.basename(file,path.extname(file)),size:stat.size,tags:[]};
   // Eagle's font importer may normalize/rename its input. Give that decoder
   // a private copy so preview never renames a local source asset.
   const decoder=decoders[ext]||'native.js';let src=file;
   if(decoder==='font.js'){src=path.join(dir,'source.'+ext);await fs.promises.copyFile(file,src);}
   try{
    // Eagle's import decoders use globals (EdgeJS, preferences, font queues)
    // initialized only in its background renderer. Run in that existing
    // context, without touching its import queue or any library metadata.
    const target=path.resolve(root,'app/background.html').toLowerCase();
    const remote=require(path.join(root,'node_modules/@electron/remote'));
    const background=remote.webContents.getAllWebContents().find(contents=>{
     try{return path.resolve(fileURLToPath(contents.getURL().split('?')[0])).toLowerCase()===target;}catch{return false;}
    });
    if(!background)throw Error('Eagle 原生解码服务未就绪');
    const options={src,dest,item};
    const result=await background.executeJavaScript(`require(${JSON.stringify(path.join(root,'app/js/thumbs',decoder))})(${JSON.stringify(options)})`);
    Object.assign(item,result||{});
   }
   catch(error){
    await require(path.join(root,'app/js/thumbs/native.js'))({src:file,dest,item});
   }
   const buffer=await fs.promises.readFile(dest);
   const type=buffer[0]===0xff&&buffer[1]===0xd8?'image/jpeg':buffer.toString('ascii',0,3)==='GIF'?'image/gif':buffer.toString('ascii',8,12)==='WEBP'?'image/webp':'image/png';
   return {src:'data:'+type+';base64,'+buffer.toString('base64'),width:item.width,height:item.height};
  }finally{for(const name of await fs.promises.readdir(dir).catch(()=>[]))await fs.promises.unlink(path.join(dir,name)).catch(()=>{});await fs.promises.rmdir(dir).catch(()=>{});}
 })();
 // A stalled native decoder must not leave the preview indefinitely loading.
 // Its own task still owns cleanup when it settles, including after timeout.
 let timer;const bounded=Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Eagle 原生解码超时')),30000);})]).finally(()=>clearTimeout(timer));
 jobs.set(key,bounded);while(jobs.size>12)jobs.delete(jobs.keys().next().value);
 try{return await bounded;}catch(error){jobs.delete(key);throw error;}
}
async function text(file,root){return (await require(path.join(root,'app/js/thumbs/txt.js'))({src:file,item:{ext:'txt'}})).text;}
async function link(file){const contents=await fs.promises.readFile(file,'utf8'),url=contents.match(/^URL\s*=\s*(.+)$/mi)?.[1]?.trim();if(!url||!/^https?:\/\//i.test(url))throw Error('此快捷方式不是可预览的网页链接');return url;}
module.exports={route,thumbnail,text,link};
