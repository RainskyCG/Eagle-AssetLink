'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../js/core.cjs');
const code=fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8');

// Simulate Eagle's command window, exercising the same UI dispatch and trashFlow
// used at runtime. OS operations are recorded; no real files are modified.
async function launch(action,{type='folder',response=0,selectedCount=1,bound=true,localError=false,openError='',matches=1}={}){
  const plugin=path.resolve(__dirname,'..'),library=path.resolve('fixture-library');
  const target=path.resolve('fixture-assets',type==='folder'?'Chair':'Chair.blend');
  const snap={path:target,type,size:12,mtime:1,birth:1,ino:1,dev:1};
  const it={id:'fixture',name:'Chair_preview',ext:'jpg',tags:[],isDeleted:false,moveToTrash:async()=>{calls.push(['eagle']);return true;}};
  const key=Core.keyFor(library,it.id),record={...snap,identity:snap,itemId:it.id,updatedAt:1};
  const data={settings:{...Core.DEFAULTS,configured:true,roots:[path.dirname(target)]},bindings:bound?{[key]:record}:{},journal:[]};
  const calls=[],dialogs=[];
  class Store{constructor(dir){this.dir=dir;}async read(){return data;}async update(fn){fn(data);}async bind(lib,item,b){data.bindings[key]=b;}async unbind(){delete data.bindings[key];}}
  const C={...Core,Store,bindingValid:async b=>!!b,assertMutable:async()=>snap,snapshot:async()=>snap,ensureReady:async s=>s,searchNames:async()=>{calls.push(['search']);return {rows:Array.from({length:matches},(_,i)=>({...snap,path:i?target+'-other':target})),issues:[],incomplete:false};}};
  const root={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}};
  let created;
  const eagle={plugin:{path:path.join(plugin,'shortcuts',action)},library:{path:library},app:{theme:'GRAY',userDataPath:path.resolve('fixture-data')},
    item:{getSelected:async()=>Array.from({length:selectedCount},()=>it),getById:async()=>it},
    shell:{openPath:async p=>{calls.push(['open',p]);return openError;},showItemInFolder:async p=>calls.push(['reveal',p])},
    window:{},
    dialog:{showMessageBox:async options=>{dialogs.push(options);return {response};}},
    onPluginCreate:fn=>{created=fn();}};
  const requireMock=name=>{
    if(name.endsWith('core.cjs'))return C;
    if(name.endsWith('desktop.cjs'))return {trashLocal:async p=>{calls.push(['trash',p]);if(localError)throw Error('recycle unavailable');}};
    if(name.endsWith('native-style.cjs'))return {load:()=>''};
    return require(name);
  };
  vm.runInNewContext(code,{window:{eagle,addEventListener:()=>{},close:()=>calls.push(['close'])},document:{addEventListener:()=>{},body:{dataset:{command:action},setAttribute:()=>{},classList:{toggle:()=>{}}},getElementById:id=>id==='app'?root:null,createElement:()=>({}),head:{appendChild:()=>{}}},location:{search:''},URLSearchParams,require:requireMock,process,console,setInterval:()=>{},setTimeout,clearTimeout});
  await created;
  return {calls,dialogs,data,html:root.innerHTML,target};
}
test('locate command queries Everything even when a valid record exists',async()=>{
  for(const type of ['folder','file']){const r=await launch('locate',{type});assert.deepEqual(r.calls,[['search'],[type==='folder'?'open':'reveal',r.target],['close']]);}
});
test('multiple matches require selection and never auto-open the saved target',async()=>{
  const r=await launch('locate',{matches:2});assert.deepEqual(r.calls,[['search']]);assert.match(r.html,/data-select-group="1"/);assert.match(r.html,/选择并关联/);
});
test('no matches leaves locate command open without using the old record',async()=>{
  const r=await launch('locate',{matches:0});assert.deepEqual(r.calls,[['search']]);assert.match(r.html,/没有找到/);
});
test('delete command shows the exact folder and cancellation never trashes anything',async()=>{
  const r=await launch('delete');assert.equal(r.dialogs.length,1);assert(r.dialogs[0].detail.includes(r.target));assert.match(r.dialogs[0].detail,/整个文件夹及其全部内容/);assert.deepEqual(r.calls,[['close']]);
});
test('locate does not report success or close when Explorer cannot open the folder',async()=>{
  const r=await launch('locate',{openError:'network unavailable'});assert.deepEqual(r.calls,[['search'],['open',r.target]]);assert.match(r.html,/network unavailable/);
});
test('delete command keeps file target distinct from its containing directory',async()=>{
  const r=await launch('delete',{type:'file',response:1});assert.match(r.dialogs[0].detail,/单个文件/);assert.deepEqual(r.calls,[['trash',r.target],['eagle'],['close']]);assert.equal(Object.keys(r.data.bindings).length,0);
});
test('delete command stops when local recycling fails',async()=>{
  const r=await launch('delete',{response:1,localError:true});assert.deepEqual(r.calls,[['trash',r.target]]);assert.match(r.html,/recycle unavailable/);assert.equal(Object.keys(r.data.bindings).length,1);
});
test('rename command opens a form without changing assets',async()=>{
  const r=await launch('rename');assert.match(r.html,/rename-name/);assert.match(r.html,/Chair/);assert.equal(r.calls.length,0);assert.equal(r.dialogs.length,0);
});
test('mutation shortcuts reject unbound and multi-selected items without side effects',async()=>{
  for(const action of ['rename','delete'])for(const options of [{bound:false},{selectedCount:2}]){const r=await launch(action,options);assert.match(r.html,/notice error/);assert.equal(r.calls.length,0);assert.equal(r.dialogs.length,0);}
});
