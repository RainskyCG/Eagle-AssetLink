'use strict';
const fs=require('fs').promises,path=require('path'),C=require('./core.cjs');
async function checkDirectory(dir,protectedPaths){
  const real=await fs.realpath(dir);
  if(!C.samePath(real,dir))throw Error('暂不修改符号链接或联接目录');
  if(protectedPaths.some(p=>p&&C.inside(p,real)))throw Error('Eagle 库文件及插件目录只读');
  if(!(await fs.stat(real)).isDirectory())throw Error('当前路径不是文件夹');
}
async function createDirectory(dir,name,protectedPaths=[]){
  await checkDirectory(dir,protectedPaths);
  const dest=C.safeRename(path.join(dir,'placeholder'),name,'folder');
  await fs.mkdir(dest); // No recursive flag: an existing name must fail.
  return dest;
}
async function renameEntry(target,name,settings,protectedPaths=[]){
  const before=await C.assertMutable(target,settings,protectedPaths);
  const dest=C.safeRename(target,name,before.type);
  if(C.samePath(target,dest))throw Error('新名称与原名称相同，暂不支持仅修改大小写');
  try{await fs.lstat(dest);throw Error('该名称已存在，不会覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!C.sameSnapshot(before,await C.snapshot(target)))throw Error('文件已发生变化，请重新选择');
  await fs.rename(target,dest);
  return {from:target,to:dest};
}
async function prepareTrash(targets,settings,protectedPaths=[]){
  const unique=[...new Set(targets.map(p=>path.resolve(p)))];
  // A selected parent already includes its children. Recycle it only once.
  const roots=unique.filter(p=>!unique.some(other=>!C.samePath(other,p)&&C.inside(other,p)));
  const plan=[];
  for(const target of roots){if(plan.some(s=>C.samePath(s.path,target)))continue;plan.push(await C.assertMutable(target,settings,protectedPaths));}
  return plan;
}
async function trashEntries(plan,settings,protectedPaths,trash){
  if(typeof trash!=='function')throw Error('当前环境不支持系统回收站');
  const completed=[];
  const validate=async expected=>{if(!C.sameSnapshot(expected,await C.assertMutable(expected.path,settings,protectedPaths)))throw Error('文件已发生变化，请重新选择：'+expected.path);};
  try{
    // Validate the full batch before recycling the first file, then check each
    // target again immediately before the OS operation.
    for(const expected of plan)await validate(expected);
    for(const expected of plan){await validate(expected);await trash(expected.path);completed.push(expected.path);}
    return completed;
  }catch(error){error.completed=completed;throw error;}
}
module.exports={createDirectory,renameEntry,prepareTrash,trashEntries};
