const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),C=require('../js/core.cjs');
test('Eagle fallback reads only the item info directory, including its sidecar files',async()=>{
 const library=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-library-'));
 try{const dir=path.join(library,'images','TEST.info');await fs.mkdir(dir,{recursive:true});for(const name of ['asset.png','asset_thumbnail.png','metadata.json'])await fs.writeFile(path.join(dir,name),'');
 const item={id:'TEST',name:'asset',ext:'png',filePath:path.join(dir,'asset.png')};const preview=await C.listEagleFolder(item,library);
 assert(preview.eagle);assert.equal(preview.itemPath,item.filePath);assert.equal(preview.rows.length,3);assert(preview.rows.every(r=>path.dirname(r.path)===dir));await assert.rejects(()=>C.listEagleFolder({...item,id:'../escape'},library));
 }finally{await fs.rm(library,{recursive:true,force:true});}
});
test('folder preview lists all direct children and a file previews its siblings',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-preview-'));
 try{await fs.mkdir(path.join(dir,'textures'));await fs.writeFile(path.join(dir,'model.blend'),'');await fs.writeFile(path.join(dir,'preview.png'),'');await fs.writeFile(path.join(dir,'textures','nested.png'),'');
 const a=await C.listAssetFolder({path:dir}),b=await C.listAssetFolder({path:path.join(dir,'preview.png')});assert.deepEqual(a,b);assert.deepEqual(a.rows.map(r=>r.name),['textures','model.blend','preview.png']);assert.equal(C.DEFAULTS.previewFolder,false);
 const detailed=await C.listAssetFolder({path:dir},{details:true});
 assert(detailed.rows.every(r=>Number.isFinite(r.mtime)));
 assert.equal(detailed.rows.find(r=>r.type==='folder').size,undefined);
 assert.equal(detailed.rows.find(r=>r.name==='model.blend').size,0);
 assert.equal(detailed.rows.length,3); // No recursive enumeration or folder size calculation.
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
