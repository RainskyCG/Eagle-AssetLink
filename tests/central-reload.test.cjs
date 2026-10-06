'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');

test('reopening central preview replaces a cached old factory with the current disk module',async()=>{
 const entry=path.resolve(__dirname,'../js/central.cjs'),pluginDir=path.resolve(__dirname,'..'),local=createRequire(entry);
 const details=local.resolve('./details-panel.cjs'),previous=local.cache[details];
 let mounted='';const ipc={invoke:async(_channel,args)=>{
  if(args.value.startsWith('(function probeInHost'))return {marker:'eagle-bridge-central-probe-v1',mainPage:true,parentMatches:true,libraryMatches:true,centralVisible:true};
  mounted=args.value;return true;
 }};
 const load=name=>name==='electron'?{ipcRenderer:ipc}:local(name);load.cache=local.cache;load.resolve=local.resolve;
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),{require:load,module:mod,process:{resourcesPath:'C:/Eagle/resources'},setTimeout,clearTimeout,URL});
 try{
  for(let pass=0;pass<2;pass++){
   local.cache[details]={exports:{createDetailsPanel:function oldUnsupportedPreview(){}}};
   await mod.exports.open({host:{library:{path:'Library'},app:{}},item:{id:'asset'},pluginDir,parentID:7});
   assert.ok(!mounted.includes('oldUnsupportedPreview'));
   assert.ok(mounted.includes('function showVideo(')&&mounted.includes('function showZip(')&&mounted.includes('function mountImage('));
  }
 }finally{if(previous)local.cache[details]=previous;else delete local.cache[details];}
});
