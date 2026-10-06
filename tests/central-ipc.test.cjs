'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {probeHost}=require('../js/central.cjs');

function ipcFor(overrides={}) {
  const context={location:{pathname:'/C:/Program%20Files/Eagle/resources/app.asar/app/index.html'},
    currentWindow:{webContents:{id:9}},$bodyScope:{libraryPath:'fixture.library'},
    document:{getElementById:id=>id==='list-content-panel'?{getBoundingClientRect:()=>({width:700,height:500})}:null},...overrides};
  return {invoke:async(channel,args)=>{
    assert.equal(channel,'plugin.window.webContents.');
    assert.equal(args.method,'executeJavaScript');
    return vm.runInNewContext(args.value,context);
  }};
}
const expected={parentID:9,library:'fixture.library'};
test('IPC probe checks identity in the owning renderer without changing DOM',async()=>{
  const result=await probeHost(ipcFor(),expected);
  assert.equal(result.parentMatches,true);assert.equal(result.libraryMatches,true);
});
test('IPC probe rejects a guest without an owning window',async()=>{
  await assert.rejects(probeHost({invoke:async()=>undefined},expected),/IPC_NO_HOST/);
});
test('IPC probe rejects a different host, plugin window and changed library',async()=>{
  await assert.rejects(probeHost(ipcFor({currentWindow:{webContents:{id:10}}}),expected),/IPC_WRONG_WINDOW/);
  await assert.rejects(probeHost(ipcFor({location:{pathname:'/plugin/index.html'}}),expected),/IPC_WRONG_WINDOW/);
  await assert.rejects(probeHost(ipcFor({$bodyScope:{libraryPath:'other'}}),expected),/IPC_LIBRARY_CHANGED/);
});
test('IPC probe rejects hidden central layout and propagates unavailable channel',async()=>{
  await assert.rejects(probeHost(ipcFor({document:{getElementById:()=>null}}),expected),/IPC_NO_CENTRAL/);
  await assert.rejects(probeHost({invoke:async()=>{throw Error('No handler registered');}},expected),/No handler/);
});
