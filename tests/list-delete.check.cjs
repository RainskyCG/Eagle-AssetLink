'use strict';
// Actual app menus/selection/confirmation with a mock Eagle host and recycle
// adapter. Filesystem validation is separately exercised by file-operations.
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.BRIDGE_PLAYWRIGHT||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(const surface of ['central','inspector']){
   const page=await browser.newPage({viewport:{width:1100,height:780}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    localStorage.setItem('eagle-bridge-results-open','true');
    let demoFactory;
    Object.defineProperty(window,'bridgeDemo',{get:()=>demoFactory,set:factory=>{
     demoFactory=factory;const env=factory();window.fixture=env;
     const root='D:\\Assets\\Chair',a=root+'\\a.txt',b=root+'\\b.txt';
     window.rows=[a,b].map(path=>({path,type:'file',size:1,mtime:1}));
     window.calls=[];window.dialogs=[];window.reply=0;window.failPath='';window.ipc=[];
     Object.assign(env.path,{join:(...parts)=>parts.join('\\'),resolve:(...parts)=>parts.join('\\')});
     env.C.inside=(parent,child)=>child===parent||child.startsWith(parent+'\\');
     env.C.searchNames=async()=>({rows:[{path:root,type:'folder'}],issues:[]});
     env.C.listAssetFolder=async()=>({dir:root,rows:[...rows]});
     env.C.Store=class{constructor(){return env.store;}};
     env.store.read().then(d=>{d.settings.previewFolder=true;d.bindings.DEMO={path:a,type:'file',itemId:'DEMO'};});
     Object.assign(env.host,{plugin:{path:'D:\\Bridge'},onPluginCreate:fn=>fn()});
     Object.assign(env.host.app,{userDataPath:'D:\\Data'});
     env.host.dialog.showMessageBox=async options=>{dialogs.push(options);return {response:reply};};
     const ops={prepareTrash:async targets=>targets.map(path=>({path})),trashEntries:async(plan,settings,protectedPaths,trash)=>{const completed=[];try{for(const row of plan){await trash(row.path);completed.push(row.path);}return completed;}catch(error){error.completed=completed;throw error;}}};
     window.eagle=env.host;window.process={resourcesPath:'D:\\Eagle'};
     window.require=name=>{
      if(name==='fs')return env.fs;if(name==='path')return env.path;
      if(name==='electron')return {ipcRenderer:{sendToHost:(...args)=>ipc.push(args)}};
      if(name.endsWith('core.cjs'))return env.C;
      if(name.endsWith('file-operations.cjs'))return ops;
      if(name.endsWith('desktop.cjs'))return {trashLocal:async p=>{calls.push(p);if(p===failPath)throw Error('回收站不可用');rows=rows.filter(row=>row.path!==p);}};
      if(name.endsWith('native-style.cjs'))return {load:()=>''};
      if(name.endsWith('inspector-session.cjs'))return {install:async()=>true};
      if(name.endsWith('central.cjs'))return {dimInspector:async()=>{}};
      throw Error('Unexpected module '+name);
     };
    }});
   });
   await page.goto(pathToFileURL(path.join(__dirname,'..',surface+'.html')).href+'?id=DEMO');
   await page.waitForSelector('.candidate');
   const files=page.locator('.candidate[title$=".txt"]');
   assert.equal(await files.count(),2);
   await files.first().click();await files.nth(1).click({modifiers:['Control']});
   await files.first().click({button:'right'});
   await page.getByRole('menuitem',{name:'删除',exact:true}).click();
   await page.waitForFunction(()=>dialogs.length===1&&!document.getElementById('app').inert);
   assert.deepEqual(await page.evaluate(()=>calls),[]);
   const detail=await page.evaluate(()=>dialogs[0].detail);assert(detail.includes('a.txt')&&detail.includes('b.txt')&&detail.includes('Eagle 中的资产保留'));
   await page.evaluate(()=>{reply=1;failPath=rows[1].path;});
   await files.first().click({button:'right'});await page.getByRole('menuitem',{name:'删除',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.candidate[title$=".txt"]').length===1&&!document.getElementById('app').inert);
   assert.match(await files.innerText(),/b.txt/);
   assert.match(await page.locator('.notice').innerText(),/1 项.*回收站不可用/);
   assert.equal(await page.evaluate(async()=>(await fixture.store.read()).bindings.DEMO.status),'local-trashed');
   await page.evaluate(()=>{failPath='';});
   await files.click({button:'right'});await page.getByRole('menuitem',{name:'删除',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.candidate[title$=".txt"]').length===0&&!document.getElementById('app').inert);
   assert.equal(await page.evaluate(()=>calls.length),3);assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('Central/sidebar delete: Ctrl multiselect, exact-path confirmation, cancellation, partial recycle failure, binding update and list refresh passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
