'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const ops=require('../js/file-operations.cjs');
test('local create and rename preserve extensions and reject protected paths, collisions and traversal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-edit-'));
 try{
  const settings={roots:[],searchRoots:[]};
  const made=await ops.createDirectory(dir,'Textures');assert.equal((await fs.stat(made)).isDirectory(),true);
  await assert.rejects(ops.createDirectory(dir,'Textures'));
  await assert.rejects(ops.createDirectory(dir,'../escape'));
  await assert.rejects(ops.createDirectory(dir,'blocked',[dir]));
  const file=path.join(dir,'old.png');await fs.writeFile(file,'original');
  const moved=await ops.renameEntry(file,'new',settings);assert.equal(moved.to,path.join(dir,'new.png'));assert.equal(await fs.readFile(moved.to,'utf8'),'original');
  await fs.writeFile(file,'other');await assert.rejects(ops.renameEntry(file,'new',settings),/已存在/);
  assert.equal(await fs.readFile(file,'utf8'),'other');
  await assert.rejects(ops.renameEntry(file,'../escape',settings));
  await assert.rejects(ops.renameEntry(file,'blocked',settings,[dir]));
  const folder=await ops.renameEntry(made,'Maps',settings);assert((await fs.stat(folder.to)).isDirectory());
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('list deletion validates the entire selection, collapses descendants and reports recycle failures',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-list-trash-')),settings={roots:[],searchRoots:[]};
 try{
  const folder=path.join(dir,'folder'),child=path.join(folder,'one.txt'),other=path.join(dir,'two.txt');
  await fs.mkdir(folder);await fs.writeFile(child,'one');await fs.writeFile(other,'two');
  const plan=await ops.prepareTrash([child,folder,folder,other],settings);
  assert.deepEqual(plan.map(row=>row.path),[folder,other]);
  const calls=[];
  await fs.writeFile(other,'changed after confirmation');
  await assert.rejects(ops.trashEntries(plan,settings,[],async p=>calls.push(p)),/文件已发生变化/);
  assert.deepEqual(calls,[],'preflight must prevent a partial batch when the selection changed');
  await assert.rejects(ops.prepareTrash([child],settings,[folder]),/不能修改/);
  await assert.rejects(ops.prepareTrash([folder],{roots:[folder],searchRoots:[]}),/不能修改/);
  const fresh=await ops.prepareTrash([folder,other],settings);
  await assert.rejects(ops.trashEntries(fresh,settings,[],async p=>{calls.push(p);if(p===other)throw Error('recycle unavailable');}),error=>{
   assert.deepEqual(error.completed,[folder]);return /recycle unavailable/.test(error.message);
  });
  assert.deepEqual(calls,[folder,other]);
  // Tests use a mock OS adapter; the operation must never unlink as a fallback.
  assert.equal(await fs.readFile(child,'utf8'),'one');assert.equal(await fs.readFile(other,'utf8'),'changed after confirmation');
  assert.deepEqual(await ops.trashEntries(fresh,settings,[],async()=>{}),[folder,other]);
 }finally{
  assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('bridge-list-trash-'));
  await fs.rm(dir,{recursive:true,force:true});
 }
});
