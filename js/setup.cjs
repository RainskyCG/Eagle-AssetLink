'use strict';
const fs=require('fs/promises'),path=require('path'),https=require('https'),os=require('os');
const {execFile}=require('child_process');
function validateOfficial(url,redirects=0){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||!['www.voidtools.com','voidtools.com'].includes(u.hostname)||redirects>4)throw Error('下载地址不是官方 HTTPS 地址');
  return u;
}
function fetchNode(url,redirects=0){
  const u=validateOfficial(url,redirects);
  return new Promise((resolve,reject)=>{const req=https.get(u,res=>{
    if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();try{resolve(fetchNode(new URL(res.headers.location,u).href,redirects+1));}catch(e){reject(e);}return;}
    if(res.statusCode!==200){res.resume();reject(Error('官方下载失败：HTTP '+res.statusCode));return;}
    const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>30*1024*1024){req.destroy(Error('下载文件超出大小限制'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks)));
  });req.setTimeout(12000,()=>req.destroy(Error('官方下载超时，请重试')));req.on('error',reject);});
}
// A separate Windows networking process avoids Electron/plugin global agents.
// It uses the system proxy and keeps normal TLS certificate verification enabled.
async function fetchWindows(url){
  validateOfficial(url);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eagle-bridge-download-')),output=path.join(dir,'download.bin');
  const script=`$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $url=${quote(url)}; for($i=0;$i -le 4;$i++){ $u=[uri]$url; if($u.Scheme -ne 'https' -or $u.Host -notin @('www.voidtools.com','voidtools.com') -or $u.Port -ne 443 -or $u.UserInfo){throw 'Invalid official URL'}; $req=[Net.HttpWebRequest]::Create($u); $req.AllowAutoRedirect=$false; $req.Timeout=15000; $req.ReadWriteTimeout=15000; $req.Proxy=[Net.WebRequest]::GetSystemWebProxy(); $req.Proxy.Credentials=[Net.CredentialCache]::DefaultNetworkCredentials; $response=$req.GetResponse(); try { if([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400){ $url=([uri]::new($u,$response.Headers['Location'])).AbsoluteUri; continue }; $stream=$response.GetResponseStream(); $file=[IO.File]::Create(${quote(output)}); try { $buffer=New-Object byte[] 65536; $total=0; while(($n=$stream.Read($buffer,0,$buffer.Length)) -gt 0){ $total+=$n; if($total -gt 31457280){throw 'Download exceeds size limit'}; $file.Write($buffer,0,$n) } } finally { $file.Dispose(); $stream.Dispose() }; exit 0 } finally { $response.Dispose() } }; throw 'Too many redirects'`;
  try{
    await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:60000,maxBuffer:65536},e=>e?reject(Error('Windows 下载通道失败')):resolve()));
    return await fs.readFile(output);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function fetchOfficial(url){
  validateOfficial(url);
  try{return await fetchNode(url);}catch(first){
    if(process.platform==='win32')try{return await fetchWindows(url);}catch{}
    // A second attempt also covers transient connection failures.
    try{return await fetchNode(url);}catch{
      throw Error('无法连接 voidtools 官方下载站。已重试独立下载通道，请检查此电脑的网络、代理或防火墙，或使用右上角“手动下载配置”。'+(/127\.0\.0\.1|::1/.test(first.message)?' 当前连接被指向本机，可能有代理或网络软件拦截。':'') );
    }
  }
}
function packageURL(html,kind,arch){
  const pattern=new RegExp('href=["\']([^"\']*'+kind+'-[0-9.]+\\.'+arch+'\\.zip)["\']','i');
  const match=html.match(pattern);if(!match)throw Error('未找到官方稳定版下载，请使用手动下载配置');
  return new URL(match[1],'https://www.voidtools.com/downloads/').href;
}
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
function extract(zip,dest,names){
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead(${quote(zip)}); try { foreach($name in @(${names.map(quote).join(',')})) { $entry=$z.Entries | Where-Object { $_.FullName -ieq $name } | Select-Object -First 1; if($entry) { $target=Join-Path ${quote(dest)} $name; if(!(Test-Path -LiteralPath $target)) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false) } } } } finally { $z.Dispose() }`;
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000},e=>e?reject(Error('无法写入工具目录，请检查目录权限；可使用手动下载配置。')):resolve()));
}
async function configure(settings,pluginDir,C,progress=()=>{}){
  if(process.platform!=='win32')throw Error('自动配置目前仅支持 Windows');
  const found=await C.detect(settings),dest=found.everythingPath?path.dirname(found.everythingPath):path.join(pluginDir,'tools','Everything');
  await fs.mkdir(dest,{recursive:true});await fs.access(dest,require('fs').constants.W_OK);
  progress('正在读取官方下载信息…');
  const html=(await fetchOfficial('https://www.voidtools.com/downloads/')).toString('utf8');
  const arch=process.arch==='arm64'?'ARM64':process.arch==='ia32'?'x86':'x64';
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'eagle-bridge-setup-'));
  try{
    for(const [kind,needed,names] of [['Everything',!found.everythingPath,['Everything.exe','Everything.lng']],['ES',!found.esPath,['es.exe']]]){
      if(!needed)continue;progress('正在下载并配置 '+kind+'…');
      const data=await fetchOfficial(packageURL(html,kind,arch)),zip=path.join(stage,kind+'.zip');await fs.writeFile(zip,data);await extract(zip,dest,names);await fs.access(path.join(dest,names[0]));
    }
    return {everythingPath:found.everythingPath||path.join(dest,'Everything.exe'),esPath:found.esPath||path.join(dest,'es.exe')};
  }finally{await fs.rm(stage,{recursive:true,force:true});}
}
module.exports={configure,packageURL,validateOfficial,fetchOfficial,fetchWindows};
