const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),C=require('../js/core.cjs');
test('Windows replacement retries transient contention and commits atomically',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-replace-'));const file=path.join(dir,'state.json'),temp=path.join(dir,'pending.tmp');
 try{await fs.writeFile(file,'old');await fs.writeFile(temp,'new');let calls=0;const waits=[];
 await C.replaceState(temp,file,async(a,b)=>{assert.equal(await fs.readFile(b,'utf8'),'old');if(++calls<4)throw Object.assign(Error('busy'),{code:'EPERM'});await fs.rename(a,b);},async ms=>waits.push(ms));
 assert.equal(await fs.readFile(file,'utf8'),'new');assert.equal(calls,4);assert.deepEqual(waits,[30,60,120]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('permanent replacement failure leaves live state intact and reports recovery',async()=>{
 let calls=0;await assert.rejects(C.replaceState('temp','live',async()=>{calls++;throw Object.assign(Error('denied'),{code:'EACCES'});},async()=>{}),/原有记录未被删除/);assert.equal(calls,7);
 calls=0;await assert.rejects(C.replaceState('temp','live',async()=>{calls++;throw Object.assign(Error('disk full'),{code:'ENOSPC'});},async()=>{}),/disk full/);assert.equal(calls,1);
});
