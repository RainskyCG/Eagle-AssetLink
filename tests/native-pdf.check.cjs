'use strict';
// Load the installed Eagle PDF viewer unchanged in Chromium. Nothing from
// Eagle's installation is modified or distributed with the plugin.
const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),assert=require('assert/strict');
const {chromium}=require(process.env.BRIDGE_PLAYWRIGHT||'playwright');
const native=require('../js/native-preview.cjs');
(async()=>{
 const archive=process.env.BRIDGE_EAGLE_ASAR||'C:/Program Files/Eagle/resources/app.asar';
 const b=await fsp.readFile(archive),header=JSON.parse(b.subarray(16,16+b.readUInt32LE(12))),offset=8+b.readUInt32LE(4);
 const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'bridge-native-pdf-'));
 let browser;
 try{
  function node(p){return p.split('/').reduce((n,k)=>n.files[k],header);}
  async function copy(p,n=node(p)){
   if(n.files){for(const [k,v] of Object.entries(n.files))await copy(p+'/'+k,v);return;}
   const dest=path.join(temp,p);await fsp.mkdir(path.dirname(dest),{recursive:true});
   await fsp.writeFile(dest,n.unpacked?await fsp.readFile(archive+'.unpacked/'+p):b.subarray(offset+Number(n.offset),offset+Number(n.offset)+n.size));
  }
  for(const p of ['config.js','app/js/thumbs/thumb.js','app/pdf-viewer','app/js/vendors/jquery-1.8.0.min.js'])await copy(p);
  const config=require(path.join(temp,'config.js'));
  for(const ext of Object.keys(config.SUPPORT_FORMATS))assert.notEqual(native.route(path.join(temp,'sample.'+ext),temp).kind,'unsupported',ext);
  const file=path.join(temp,'本地 PDF #测试.pdf'),stream='BT /F1 24 Tf 40 200 Td (Eagle AssetLink local PDF) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n',positions=[0];for(let i=0;i<objects.length;i++){positions.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n`+positions.slice(1).map(p=>String(p).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fsp.writeFile(file,pdf);
  const route=native.route(file,temp);assert.equal(route.kind,'page');
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--allow-file-access-from-files']});
  const page=await browser.newPage({viewport:{width:800,height:650}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(route.url);
  await page.waitForFunction(()=>window.PDFViewerApplication?.pdfDocument?.numPages===1);
  await page.waitForSelector('.page canvas');
  const text=await page.evaluate(async()=>{const page=await PDFViewerApplication.pdfDocument.getPage(1);return (await page.getTextContent()).items.map(i=>i.str).join('');});
  assert.equal(text,'Eagle AssetLink local PDF');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(__dirname,'native-pdf-preview.png')});
  console.log('Installed Eagle PDF viewer rendered local Unicode/# filename and extracted the expected page text.');
 }finally{
  await browser?.close();
  // The only recursive cleanup target is our newly-created fixture directory.
  assert(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('bridge-native-pdf-'));
  await fsp.rm(temp,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
