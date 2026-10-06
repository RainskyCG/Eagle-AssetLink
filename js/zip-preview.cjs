'use strict';
// List ZIP entries and read images in memory. Native/plugin viewers receive
// only the selected entry in a private temporary directory, never a full ZIP.
const fs=require('fs').promises,path=require('path'),{execFile}=require('child_process');
const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',avif:'image/avif',ico:'image/x-icon'};
const queue=[],cache=new Map();let active=0;
function schedule(fn){return new Promise((resolve,reject)=>{queue.push({fn,resolve,reject});pump();});}
function pump(){while(active<2&&queue.length){const job=queue.shift();active++;job.fn().then(job.resolve,job.reject).finally(()=>{active--;pump();});}}
function run(file,body){
 const encoded=Buffer.from(file,'utf8').toString('base64');
 const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$zip=[IO.Compression.ZipFile]::OpenRead($p)
try { ${body} } finally { $zip.Dispose() }`;
 return new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:24*1024*1024},(error,out,stderr)=>error?reject(Error('无法读取 ZIP：'+(error.killed?'读取超时':(stderr||error.message).trim().slice(0,500)))):resolve(out.trim())));
}
// Eagle ships yauzl. Stream local entries with its own reader when available,
// avoiding a PowerShell process and loading an entire archive into memory.
function nativeRead(reader,file,index,dest){
 return new Promise((resolve,reject)=>{
  reader.open(file,{lazyEntries:true,autoClose:true},(error,archive)=>{
   if(error){reject(error);return;}
   let done=false,count=0,inputStream,outputStream;const entries=[];
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error){inputStream?.destroy();outputStream?.destroy();}archive.close();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>finish(Error('ZIP 读取超时')),30000);
   archive.on('error',e=>finish(e));
   archive.on('end',()=>index===undefined?finish(null,{entries,total:archive.entryCount,truncated:false}):finish(Error('无效 ZIP 条目')));
   archive.on('entry',entry=>{
    const position=count++,name=entry.fileName.replace(/\\/g,'/');
    if(index===undefined){entries.push({index:position,name,size:entry.uncompressedSize,directory:name.endsWith('/')});if(count>=20000){finish(null,{entries,total:archive.entryCount,truncated:archive.entryCount>count});return;}archive.readEntry();return;}
    if(position!==index){archive.readEntry();return;}
    const type=mime[path.extname(name).slice(1).toLowerCase()];
    if(!dest&&!type){finish(Error('此条目不是支持的图片格式'));return;}
    const limit=dest?268435456:16777216;
    if(entry.uncompressedSize>limit){finish(Error(dest?'文件超过 256 MB 预览上限':'图片超过 16 MB 预览上限'));return;}
    if(entry.generalPurposeBitFlag&1){finish(Error('此图片已加密，暂不支持密码 ZIP'));return;}
    archive.openReadStream(entry,(error,stream)=>{
     if(error){finish(error);return;}if(done){stream.destroy();return;}inputStream=stream;const chunks=[];let size=0;
     if(dest){
      const output=outputStream=require('fs').createWriteStream(dest,{flags:'wx'});
      const {Transform,pipeline}=require('stream');
      pipeline(stream,new Transform({transform(chunk,encoding,done){size+=chunk.length;done(size>limit?Error('文件超过 256 MB 预览上限'):null,chunk);}}),output,error=>finish(error,dest));return;
     }
     stream.on('error',e=>finish(e));stream.on('data',chunk=>{size+=chunk.length;if(size>16777216){stream.destroy();finish(Error('图片超过 16 MB 预览上限'));}else chunks.push(chunk);});
     stream.on('end',()=>finish(null,'data:'+type+';base64,'+Buffer.concat(chunks).toString('base64')));
    });
   });archive.readEntry();
  });
 });
}
async function identity(file){if(path.extname(file).toLowerCase()!=='.zip')throw Error('仅支持 ZIP');const stat=await fs.stat(file);if(!stat.isFile())throw Error('不是文件');return path.resolve(file)+'|'+stat.size+'|'+stat.mtimeMs;}
async function list(file,reader){
 await identity(file);
 if(reader?.open){const result=await schedule(()=>nativeRead(reader,file));for(const row of result.entries)row.image=!!mime[path.extname(row.name).slice(1).toLowerCase()];return result;}
 const text=await schedule(()=>run(file,`$rows=@();$limit=[Math]::Min(20000,$zip.Entries.Count)
for($i=0;$i -lt $limit;$i++){ $e=$zip.Entries[$i];$rows+=@{index=$i;name=$e.FullName;size=$e.Length;directory=($e.Name -eq '')} }
@{entries=$rows;truncated=($zip.Entries.Count -gt $limit);total=$zip.Entries.Count} | ConvertTo-Json -Depth 4 -Compress`));
 const result=JSON.parse(text);for(const row of result.entries){row.name=row.name.replace(/\\/g,'/');row.image=!!mime[path.extname(row.name).slice(1).toLowerCase()];}return result;
}
async function image(file,index,reader){
 if(!Number.isSafeInteger(index)||index<0)throw Error('无效 ZIP 条目');
 const key=await identity(file)+'|'+index;if(cache.has(key))return cache.get(key);
 const job=schedule(async()=>{
  if(reader?.open)return nativeRead(reader,file,index);
  const output=await run(file,`if(${index} -ge $zip.Entries.Count){throw 'index'}
$e=$zip.Entries[${index}];$ext=[IO.Path]::GetExtension($e.FullName).ToLowerInvariant()
if($ext -notin @('.png','.jpg','.jpeg','.gif','.webp','.bmp','.avif','.ico')){throw 'format'}
if($e.Length -gt 16777216){throw 'size'}
$inputStream=$e.Open();$outputStream=[IO.MemoryStream]::new()
try{$buffer=New-Object byte[] 65536;while(($n=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0){if(($outputStream.Length+$n) -gt 16777216){throw 'size'};$outputStream.Write($buffer,0,$n)}
[Console]::Out.Write($ext.Substring(1)+';'+[Convert]::ToBase64String($outputStream.ToArray()))
}finally{$inputStream.Dispose();$outputStream.Dispose()}`);
  const delimiter=output.indexOf(';'),type=mime[output.slice(0,delimiter)];if(!type)throw Error('图片格式不支持');return 'data:'+type+';base64,'+output.slice(delimiter+1);
 });cache.set(key,job);while(cache.size>12)cache.delete(cache.keys().next().value);
 try{return await job;}catch(e){cache.delete(key);throw e;}
}
async function materialize(file,index,entryName,reader){
 if(!Number.isSafeInteger(index)||index<0)throw Error('无效 ZIP 条目');await identity(file);
 // Only the selected entry is decoded, to an owned temporary filename. Never
 // use archive directory names as filesystem paths or execute extracted files.
 const ext=path.extname(entryName).toLowerCase();if(!/^\.[a-z0-9]{1,12}$/.test(ext))throw Error('此条目没有可预览的扩展名');
 const dir=await fs.mkdtemp(path.join(require('os').tmpdir(),'eagle-bridge-zip-')),dest=path.join(dir,'content'+ext);
 const release=async()=>{for(let attempt=0;attempt<4;attempt++){try{await fs.unlink(dest);break;}catch(e){if(e.code==='ENOENT')break;if(!['EPERM','EBUSY','EACCES'].includes(e.code))break;await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}}await fs.rmdir(dir).catch(()=>{});};
 try{
  await schedule(async()=>{
   if(reader?.open)return nativeRead(reader,file,index,dest);
   const target=Buffer.from(dest,'utf8').toString('base64');
   await run(file,`if(${index} -ge $zip.Entries.Count){throw 'index'}
$e=$zip.Entries[${index}];if($e.Length -gt 268435456){throw '文件超过 256 MB 预览上限'}
$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${target}'))
$inputStream=$e.Open();$outputStream=[IO.File]::Open($target,[IO.FileMode]::CreateNew)
try{$buffer=New-Object byte[] 65536;$total=0;while(($n=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0){$total+=$n;if($total -gt 268435456){throw 'size'};$outputStream.Write($buffer,0,$n)}}finally{$inputStream.Dispose();$outputStream.Dispose()}`);
  });return {path:dest,release};
 }catch(e){await release();throw e;}
}
module.exports={list,image,materialize};
