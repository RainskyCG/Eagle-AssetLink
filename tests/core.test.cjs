const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs').promises;
const path=require('path');
const os=require('os');
const C=require('../js/core.cjs');
const settings=()=>JSON.parse(JSON.stringify(C.DEFAULTS));
test('suffix cleaning preserves source and handles repeated overlapping tokens',()=>{
  const s=settings();assert.equal(C.cleanName('Chair_preview_thumb',s),'Chair');
  assert.equal(C.cleanName('preview_Chair',s),'preview_Chair');
  assert.equal(C.cleanName('Chair_PREVIEW',s),'Chair');
  s.keywords=['','_preview','preview'];assert.equal(C.cleanName('Chair_preview',s),'Chair');
  assert.equal(C.cleanName('_preview',s),'');
});
test('literal keywords do not act as regex; manual name bypasses cleaner',()=>{
  const s=settings();s.cleanMode='anywhere';s.keywords=['[x]'];assert.equal(C.cleanName('a[x]b',s),'ab');
  assert.deepEqual(C.namesFor({name:'Chair_preview',ext:'jpg'},s,'Exact_preview'),['Exact_preview']);
});
test('extension stripping only removes known Eagle extension',()=>{
  assert.equal(C.stripExt('wood.v2','jpg'),'wood.v2');
  assert.deepEqual(C.namesFor({name:'Chair_preview.JPG',ext:'jpg'},settings()),['Chair_preview','Chair']);
});
test('directory boundary excludes siblings and parent traversal',()=>{
  const root=path.resolve('assets');assert.equal(C.inside(root,path.join(root,'sub','x')),true);
  assert.equal(C.inside(root,root+'2'),false);assert.equal(C.inside(root,path.join(root,'..','outside')),false);
});
test('candidate priority never removes duplicate targets',()=>{
  const rows=[{path:path.resolve('one','chair.blend'),type:'file'},{path:path.resolve('two','chair'),type:'folder'},{path:path.resolve('three','chair'),type:'folder'}];
  const sorted=C.sortCandidates(rows,['folder','blend','other']);assert.equal(sorted.length,3);assert.equal(sorted[0].type,'folder');
});
test('original preview and cleaned name results are merged before priority selection',async()=>{
  const s=settings();const preview={path:path.resolve('Chair_preview.png'),type:'file'};
  const folder={path:path.resolve('Chair'),type:'folder'};
  const result=await C.searchNames(s,['Chair_preview','Chair'],{},async(_s,term)=>({rows:term==='Chair'?[folder,preview]:[preview],issues:[],incomplete:term==='Chair'}));
  assert.equal(result.rows.length,2);assert.equal(result.rows[0],folder);assert.equal(result.incomplete,true);
  s.priority=['png','folder','other'];const reversed=await C.searchNames(s,['Chair'],{},async()=>({rows:[folder,preview],issues:[],incomplete:false}));
  assert.equal(reversed.rows[0],preview);
});
test('search errors show a recovery action without leaking the command line',()=>{
  const ipc=C.searchError(Error('Error 8: Everything IPC window not found.'));
  assert.match(ipc.message,/设置/);assert.doesNotMatch(ipc.message,/Error 8/);
  const timeout=C.searchError({message:'Command failed: es.exe -r private-name',killed:true});
  assert.match(timeout.message,/超时/);assert.doesNotMatch(timeout.message,/private-name|es.exe/);
});
test('visibility defaults to all and opt-in hiding requires the exact tag',()=>{
  const s=settings();assert.equal(C.eligible({tags:[]},null,s),true);s.hideUntagged=true;assert.equal(C.eligible({tags:['xEagleBridge']},null,s),false);assert.equal(C.eligible({tags:['EagleBridge']},null,s),true);
  assert.equal(C.eligible({tags:[]},{path:'missing'},s),false);s.hideUntagged=false;assert.equal(C.eligible({tags:[]},null,s),true);
});
test('removed priority labels remain removed when settings are saved',()=>{
  const s=settings();s.priority=['fbx','blend'];
  assert.deepEqual(C.validateSettings(s).priority,['fbx','blend']);
  s.priority=[];assert.deepEqual(C.validateSettings(s).priority,[]);
});
test('rename rejects traversal and reserved Windows names',()=>{
  const p=path.resolve('a','old.blend');for(const n of ['../x','CON','x/abc','abc.',''])assert.throws(()=>C.safeRename(p,n,'file'));
  assert.equal(C.safeRename(p,'new.blend','file'),path.resolve('a','new.blend'));
});
test('store serializes concurrent writers and does not overwrite malformed state',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-test-'));try{
    const a=new C.Store(dir),b=new C.Store(dir);await Promise.all([a.update(d=>{d.bindings.a={path:'a'};}),b.update(d=>{d.bindings.b={path:'b'};})]);
    assert.equal(Object.keys((await a.read()).bindings).length,2);await fs.writeFile(a.file,'broken');await assert.rejects(a.update(()=>{}),/无法读取/);assert.equal(await fs.readFile(a.file,'utf8'),'broken');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
const snap={type:'file',size:1,mtime:1,birth:1,ino:1,dev:1};
test('cancel delete never invokes either trash operation',async()=>{
  let calls=0;const result=await C.trashFlow({target:'x',validate:async()=>snap,confirm:async()=>false,trash:async()=>calls++,itemTrash:async()=>calls++,journal:async()=>{}});
  assert.equal(result.cancelled,true);assert.equal(calls,0);
});
test('changed target during dialog aborts without trash',async()=>{
  let validates=0,calls=0;await assert.rejects(C.trashFlow({target:'x',validate:async()=>({...snap,ino:++validates}),confirm:async()=>true,trash:async()=>calls++,itemTrash:async()=>calls++,journal:async()=>{}}),/确认期间/);assert.equal(calls,0);
});
test('local trash failure never trashes Eagle',async()=>{
  let eagleCalls=0;await assert.rejects(C.trashFlow({target:'x',validate:async()=>snap,confirm:async()=>true,trash:async()=>{throw Error('disk');},itemTrash:async()=>eagleCalls++,journal:async()=>{}}),/disk/);assert.equal(eagleCalls,0);
});
test('partial deletion is journaled and reported honestly',async()=>{
  const log=[];const result=await C.trashFlow({target:'x',validate:async()=>snap,confirm:async()=>true,trash:async()=>{},itemTrash:async()=>false,journal:async s=>log.push(s)});
  assert.equal(result.partial,true);assert.deepEqual(log,['prepared','local-trashed','eagle-trash-failed']);
});
test('successful deletion commits in local then Eagle order',async()=>{
  const log=[];await C.trashFlow({target:'x',validate:async()=>snap,confirm:async()=>true,trash:async()=>log.push('local'),itemTrash:async()=>log.push('eagle'),journal:async s=>log.push(s)});
  assert.deepEqual(log,['prepared','local','local-trashed','eagle','complete']);
});
test('mutation protection prevents deleting a configured root or Eagle ancestor',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-test-'));try{const s=settings();s.roots=[dir];await assert.rejects(C.assertMutable(dir,s),/根目录/);
    s.roots=[];await assert.rejects(C.assertMutable(dir,s,[path.join(dir,'library')]),/应用数据目录/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
