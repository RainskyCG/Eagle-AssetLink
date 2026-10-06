'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
test('native adapters use Eagle background decoders, isolate font inputs and fall back without source changes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-native-adapter-'));
 try{
  const thumbs=path.join(dir,'app/js/thumbs');await fs.mkdir(thumbs,{recursive:true});
  await fs.writeFile(path.join(dir,'config.js'),"module.exports={SUPPORT_FORMATS:{psd:true,ttf:true,raw:true},VIDEO_FORMATS:['mkv'],AUDIO_FORMATS:['flac'],MODEL_FORMATS:['obj']};");
  await fs.writeFile(path.join(thumbs,'thumb.js'),"const registry={'psd':init('psd.js'),'ttf':init('font.js'),'raw':init('raw.js')};");
  const image="require('fs').writeFileSync(dest,Buffer.from([255,216,255,224]));return {width:64,height:32};";
  await fs.writeFile(path.join(thumbs,'psd.js'),"module.exports=async({dest})=>{"+image+"};");
  await fs.writeFile(path.join(thumbs,'font.js'),"module.exports=async({src,dest})=>{require('fs').renameSync(src,src+'-normalized');"+image+"};");
  await fs.writeFile(path.join(thumbs,'raw.js'),"module.exports=async()=>{throw Error('decoder failed');};");
  await fs.writeFile(path.join(thumbs,'native.js'),"module.exports=async({dest})=>{"+image+"};");
  let available=true;const calls=[];
  const remote={webContents:{getAllWebContents:()=>available?[{getURL:()=>pathToFileURL(path.join(dir,'app/index.html')).href},{getURL:()=>pathToFileURL(path.join(dir,'app/background.html')).href,executeJavaScript:code=>{calls.push(code);return vm.runInNewContext(code,{require});}}]:[]}};
  const sandbox={module:{exports:{}},require:name=>name===path.join(dir,'node_modules/@electron/remote')?remote:require(name),Buffer,setTimeout,clearTimeout};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../js/native-preview.cjs'),'utf8'),sandbox);
  const native=sandbox.module.exports;
  for(const ext of ['psd','ttf','raw']){
   const src=path.join(dir,'original.'+ext);await fs.writeFile(src,'unchanged');
   const result=await native.thumbnail(src,dir);assert.match(result.src,/^data:image\/jpeg;base64,/);
   assert.equal(await fs.readFile(src,'utf8'),'unchanged');
  }
  assert.equal(calls.length,3);
  const copied=JSON.parse(calls[1].slice(calls[1].indexOf(')(')+2,-1)).src;
  assert.notEqual(copied,path.join(dir,'original.ttf'));await assert.rejects(fs.stat(path.dirname(copied)),{code:'ENOENT'});
  available=false;
  const fallback=path.join(dir,'fallback.psd');await fs.writeFile(fallback,'unchanged');
  assert.match((await native.thumbnail(fallback,dir)).src,/^data:image\/jpeg;base64,/);
  assert.equal(native.route('file.mkv',dir).kind,'media');assert.equal(native.route('file.flac',dir).kind,'media');
  assert.equal(native.route('file.exe',dir).kind,'unsupported');
  const pdf=new URL(native.route(path.join(dir,'中文 #file.pdf'),dir).url);assert.equal(pdf.searchParams.get('path'),pathToFileURL(path.join(dir,'中文 #file.pdf')).href);
 }finally{
  assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('bridge-native-adapter-'));
  await fs.rm(dir,{recursive:true,force:true});
 }
});
