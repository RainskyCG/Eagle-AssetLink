'use strict';
// Windows WIC decodes the first TIFF frame in a separate, hidden process.
// No source writes, imports, persistent thumbnails or extra installed tools.
const fs=require('fs').promises;
const path=require('path');
const {execFile}=require('child_process');
const cache=new Map(),queue=[];let active=0;
function schedule(task){return new Promise((resolve,reject)=>{queue.push({task,resolve,reject});pump();});}
function pump(){while(active<2&&queue.length){const job=queue.shift();active++;job.task().then(job.resolve,job.reject).finally(()=>{active--;pump();});}}
function decode(file){
  const encoded=Buffer.from(file,'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationCore
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$stream=[IO.File]::OpenRead($p)
try {
 $decoder=[Windows.Media.Imaging.TiffBitmapDecoder]::new($stream,[Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,[Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
 $frame=$decoder.Frames[0]
 $scale=[Math]::Min(1.0,1024.0/[Math]::Max($frame.PixelWidth,$frame.PixelHeight))
 $small=[Windows.Media.Imaging.TransformedBitmap]::new($frame,[Windows.Media.ScaleTransform]::new($scale,$scale))
 $encoder=[Windows.Media.Imaging.PngBitmapEncoder]::new()
 $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($small))
 $out=[IO.MemoryStream]::new()
 try {$encoder.Save($out);[Console]::Out.Write([Convert]::ToBase64String($out.ToArray()))} finally {$out.Dispose()}
} finally {$stream.Dispose()}`;
  return new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:16*1024*1024},(error,stdout)=>{
    if(error)return reject(Error('TIFF 解码失败'));
    const value=stdout.trim();if(!value.startsWith('iVBORw0KGgo'))return reject(Error('TIFF 预览输出无效'));
    resolve('data:image/png;base64,'+value);
  }));
}
async function preview(file){
  if(!/\.tiff?$/i.test(file))throw Error('仅支持 TIFF');
  const stat=await fs.stat(file);if(!stat.isFile())throw Error('不是文件');
  const key=path.resolve(file)+'|'+stat.size+'|'+stat.mtimeMs;
  if(cache.has(key))return cache.get(key);
  const job=schedule(()=>decode(file));cache.set(key,job);
  while(cache.size>24)cache.delete(cache.keys().next().value);
  try{return await job;}catch(e){cache.delete(key);throw e;}
}
module.exports={preview};
