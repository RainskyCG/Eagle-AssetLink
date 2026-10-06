/* Deliberately isolated visual fixture. Activated only by ?demo=1 outside Eagle. */
window.bridgeDemo=()=>{
  const sample={id:'DEMO',name:'Oak Chair_preview',ext:'jpg',tags:['EagleBridge']};
  const settings={configured:true,roots:['D:\\Assets'],searchRoots:['D:\\Assets','E:\\Archive'],tag:'EagleBridge',hideUntagged:false,cleanEnabled:true,keywords:['_preview','_thumb'],cleanMode:'suffix',priority:['folder','blend','fbx','glb','gltf','obj','jpg','png','other'],esPath:'D:\\Tools\\Everything\\es.exe',everythingPath:'D:\\Tools\\Everything\\Everything.exe',instance:''};
  const data={schema:1,settings,bindings:{},journal:[]};
  const path={dirname:p=>p.slice(0,p.lastIndexOf('\\')),basename:p=>p.split(/[\\/]/).pop(),extname:p=>{const b=p.split(/[\\/]/).pop();return b.includes('.')?'.'+b.split('.').pop():'';},parse:p=>({name:p.split(/[\\/]/).pop().replace(/\.[^.]+$/,'')})};
  const rows=[{path:'D:\\Assets\\Furniture\\Oak Chair',type:'folder',mtime:Date.now(),size:0},{path:'E:\\Archive\\Living Room\\Oak Chair',type:'folder',mtime:Date.now()-86400000,size:0}];
  const clean=(n,s)=>{if(!s.cleanEnabled)return n;for(const word of s.keywords.filter(Boolean))if(n.toLowerCase().endsWith(word.toLowerCase()))n=n.slice(0,-word.length);return n;};
  const blocked=async()=>{throw Error('这是只读界面演示，请在 Eagle 中测试实际功能');};
  const C={keyFor:(_lib,id)=>id,cleanName:clean,namesFor:(it,s,m)=>m?[m]:[...new Set([it.name,clean(it.name,s)])],eligible:(it,b,s)=>!s.hideUntagged||it.tags.includes(s.tag),
    listAssetFolder:async target=>({dir:target.path,rows:[{name:'textures',path:target.path+'\\textures',type:'folder'},{name:'model.blend',path:target.path+'\\model.blend',type:'file'}]}),ensureReady:async s=>s,searchNames:async()=>({rows,issues:[],incomplete:false}),search:async()=>({rows,issues:[],incomplete:false}),detect:async()=>({ready:true,version:'1.4.1.1030',esPath:settings.esPath,everythingPath:settings.everythingPath}),startEverything:blocked,bindingValid:async()=>true,snapshot:async p=>rows.find(x=>x.path===p)||rows[0],sameSnapshot:()=>true,inside:()=>false,samePath:(a,b)=>a===b,assertMutable:blocked};
  const store={dir:'DEMO',read:async()=>data,settings:async s=>{data.settings={...s};},bind:async(lib,it,b)=>{data.bindings[it.id]={...b,updatedAt:Date.now()};},unbind:async(lib,id)=>{delete data.bindings[id];},update:async fn=>fn(data)};
  const host={library:{path:'DEMO'},app:{theme:'GRAY'},item:{getSelected:async()=>[sample],getById:async()=>sample},dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]}),showMessageBox:async()=>({response:0})},shell:{openPath:blocked,showItemInFolder:blocked,openExternal:blocked}};
  return {C,path,store,host,fs:{existsSync:()=>false}};
};
