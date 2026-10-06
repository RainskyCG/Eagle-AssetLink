'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.BRIDGE_PLAYWRIGHT||'playwright');
const {createDetailsPanel}=require('../js/details-panel.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+require('path').resolve(__dirname,'../index.html').replace(/\\/g,'/')+'?demo=1');
  await page.setContent('<style>body{margin:0;background:#37383c;color:#eee;--color-background-primary:#37383c;--color-bg-hover:#414246;--color-border-secondary:#505155;--color-text-secondary:#a9aaad}#eagle-bridge-central{position:fixed;inset:0;display:flex;flex-direction:column}.toolbar{display:flex;height:48px;align-items:center;padding:0 12px;flex-shrink:0}webview{display:block;flex:1}</style><section id="eagle-bridge-central"><div class="toolbar"><button>返回 Eagle</button></div><webview id="files"></webview></section>');
  await page.evaluate(()=>{
   localStorage.clear();window.calls=[];window.reads=[];window.pending={};
   const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="751" height="412"><rect width="751" height="412" fill="#789"/></svg>');
   window.require=name=>name==='fs'?{promises:{stat:async file=>{reads.push(file);if(file.includes('slow'))await new Promise(resolve=>pending.resolve=resolve);if(file.includes('missing'))throw Error('文件不存在');return {size:4096,isFile:()=>!file.endsWith('folder'),isDirectory:()=>file.endsWith('folder'),mtime:new Date('2026-10-05'),birthtime:new Date('2026-01-01')};}}}:name==='path'?{basename:p=>p.split(/[\\/]/).pop(),extname:p=>p.includes('.')?'.'+p.split('.').pop():'',join:(...p)=>p.join('/')}:name==='url'?{pathToFileURL:file=>new URL(/\.png$/.test(file)?svg:'file:///C:/Viewer/viewer.html')}:{preview:async()=>svg};
   window.pluginModule={installedPluginMaps:{'89fb801f-7761-4de6-b7ce-3785a084edaf':{path:'C:/Viewer',manifest:{id:'89fb801f-7761-4de6-b7ce-3785a084edaf',preview:{'glb,obj':{viewer:{path:'viewer.html'}}}}}},isPluginDisabled:()=>false};
   const create=document.createElement.bind(document);
   const originalRequire=window.require;
   window.require=name=>name.endsWith('native-preview.cjs')?{
     route:file=>/\.(pdf|obj|glb)$/i.test(file)?{kind:'page',url:'file:///C:/Eagle/'+(/pdf$/i.test(file)?'pdf-viewer/web/viewer.html?path='+encodeURIComponent(file):'model-viewer/website/index.html')}:/\.(mp3|wav)$/i.test(file)?{kind:'media'}:/\.txt$/i.test(file)?{kind:'text'}:/\.(psd|raw|ttf)$/i.test(file)?{kind:'thumbnail'}:{kind:'unsupported'},
     text:async()=>'<local text>',thumbnail:async()=>({src:svg})
   }:originalRequire(name);
   document.createElement=(tag,...args)=>{const node=create(tag,...args);if(tag==='webview'){node.getWebContentsId=()=>50;node.executeJavaScript=async code=>calls.push(code);node.send=(...args)=>calls.push(args);}return node;};
  });
  await page.evaluate(`window.makeDetails=${createDetailsPanel.toString()}`);
  await page.evaluate(()=>{window.details=makeDetails({panel:document.querySelector('#eagle-bridge-central'),bar:document.querySelector('.toolbar'),webview:document.querySelector('#files'),config:{app:{theme:'gray',locale:'zh_CN'},plugin:{path:'C:/Bridge'},library:'Library',parentID:7,preload:'file:///preload.js'}});});
  const toggle=page.getByRole('button',{name:'预览与文件详情'});
  assert.equal(await page.locator('.bridge-detail-panel').isVisible(),false);
  await page.evaluate(()=>details.select(['C:/Assets/photo.png']));assert.deepEqual(await page.evaluate(()=>reads),[]);
  await toggle.click();await page.waitForSelector('.bridge-detail-media img');
  await page.waitForFunction(()=>document.querySelector('dl').textContent.includes('751 × 412'));
  assert.match(await page.locator('dl').innerText(),/4.0 KB/);
  assert.equal(await toggle.getAttribute('aria-pressed'),'true');
  const zoomed=()=>page.locator('.bridge-image-stage img').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);
  await page.locator('.bridge-image-stage').hover();await page.mouse.wheel(0,-240);
  await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.bridge-image-stage img')).transform).a>1);
  const large=await zoomed();await page.mouse.wheel(0,120);
  await page.waitForFunction(n=>new DOMMatrix(getComputedStyle(document.querySelector('.bridge-image-stage img')).transform).a<n,large);
  await page.locator('.bridge-image-stage').dblclick();assert.equal(await zoomed(),1);
  assert.equal(await toggle.evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region')),'no-drag');
  const split=page.getByRole('separator',{name:'调整预览与详情分隔'}),before=await split.boundingBox();
  await page.mouse.move(before.x+30,before.y+3);await page.mouse.down();await page.mouse.move(before.x+30,before.y-110,{steps:5});await page.mouse.up();
  assert.ok((await split.boundingBox()).y<before.y-80);
  const width=page.getByRole('separator',{name:'调整侧栏宽度'}),wb=await width.boundingBox();
  await page.mouse.move(wb.x+3,wb.y+20);await page.mouse.down();await page.mouse.move(wb.x-80,wb.y+20,{steps:5});await page.mouse.up();
  assert.ok((await page.locator('.bridge-detail-panel').boundingBox()).width>380);
  await page.screenshot({path:require('path').resolve(__dirname,'details-panel-preview.png')});
  await page.evaluate(()=>{details.select(['C:/Assets/slow.png']);});
  await page.waitForFunction(()=>!!pending.resolve);
  await page.evaluate(()=>details.select(['C:/Assets/latest.txt']));await page.waitForFunction(()=>document.querySelector('dl').textContent.includes('latest.txt'));
  await page.evaluate(()=>pending.resolve());await page.waitForTimeout(50);
  assert.equal(await page.locator('.bridge-detail-media img').count(),0);
  assert.match(await page.locator('dl').innerText(),/latest.txt/);
  await page.evaluate(()=>details.select(['C:/Assets/model.glb']));await page.waitForSelector('.bridge-detail-media webview');
  const source=new URL(await page.locator('.bridge-detail-media webview').getAttribute('src'));
  assert.equal(source.searchParams.get('path'),'C:/Assets/model.glb');assert.equal(source.searchParams.get('id'),'');assert.equal(source.searchParams.get('lang'),'zh_CN');
  await page.locator('.bridge-detail-media webview').dispatchEvent('dom-ready');
  await page.waitForFunction(()=>calls.some(c=>Array.isArray(c)&&c[0]==='plugin-create'));
  await toggle.click();assert.equal(await page.locator('.bridge-detail-media webview').count(),0);
  await toggle.click();await page.waitForSelector('.bridge-detail-media webview');
  await page.locator('.bridge-detail-media webview').dispatchEvent('did-fail-load');
  await page.waitForFunction(()=>document.querySelector('.bridge-detail-media webview')?.getAttribute('src').includes('model-viewer'));
  // Honor the viewer Eagle currently registered, including new model types.
  await page.evaluate(()=>{
    const plugin={path:'C:/ReplacementViewer',manifest:{id:'replacement',preview:{'obj, blend':{viewer:{path:'custom.html'}}}}};
    pluginModule.previewExtension={getViewerPlugin:({ext})=>['obj','blend'].includes(ext)?plugin:undefined};
    details.select(['C:/Assets/scene.blend']);
  });
  await page.waitForSelector('.bridge-detail-media webview');
  await page.locator('.bridge-detail-media webview').dispatchEvent('dom-ready');
  await page.waitForFunction(()=>calls.some(c=>Array.isArray(c)&&c[0]==='plugin-create'&&c[1].manifest.id==='replacement'));
  await page.evaluate(()=>{pluginModule.isPluginDisabled=id=>id==='replacement';details.select(['C:/Assets/disabled.obj']);});
  await page.waitForSelector('.bridge-detail-media webview');
  await page.locator('.bridge-detail-media webview').dispatchEvent('dom-ready');
  assert.equal(new URL(await page.locator('.bridge-detail-media webview').getAttribute('src')).searchParams.get('path'),'C:/Assets/disabled.obj');
  await page.evaluate(()=>{pluginModule.previewExtension={};pluginModule.isPluginDisabled=()=>false;});
  await page.evaluate(()=>{
    window.videoDisposed=0;
    customElements.define('mpv-video',class extends HTMLElement{
      constructor(){super();this.theme={apply:theme=>{this.appliedTheme=theme;}};this.plugins={get:()=>({hideButton:()=>{this.notesHidden=true;}})};this.duration=125;this.videoWidth=1920;this.videoHeight=1080;}
      pause(){this.paused=true;}destroy(){videoDisposed++;}
    });
    details.select(['C:/Assets/movie.MP4']);
  });
  await page.waitForSelector('mpv-video');
  assert.equal(await page.locator('mpv-video').evaluate(e=>e.autoplay),false);
  assert.equal(await page.locator('mpv-video').getAttribute('controls-mode'),'always');
  await page.locator('mpv-video').dispatchEvent('loadedmetadata');
  assert.match(await page.locator('dl').innerText(),/1920 × 1080/);
  assert.match(await page.locator('dl').innerText(),/2:05/);
  await toggle.click();assert.equal(await page.evaluate(()=>videoDisposed),1);
  await page.evaluate(()=>details.select(['C:/Assets/movie.mkv']));
  await page.waitForSelector('mpv-video');assert.equal(await toggle.getAttribute('aria-pressed'),'true');
  await page.locator('mpv-video').dispatchEvent('error');
  assert.match(await page.locator('.bridge-detail-media').innerText(),/原生播放器无法预览/);
  assert.equal(await page.evaluate(()=>videoDisposed),2);
  await page.evaluate(()=>{pluginModule.installedPluginMaps['b95aad2b-39e9-4dd5-860b-1c2c8ddf78f7']={path:'C:/JSONViewer',manifest:{id:'b95aad2b-39e9-4dd5-860b-1c2c8ddf78f7',preview:{json:{viewer:{path:'index.html'}}}}};details.select(['C:/Assets/test.json']);});
  await page.waitForSelector('.bridge-detail-media webview');
  assert.equal(new URL(await page.locator('.bridge-detail-media webview').getAttribute('src')).searchParams.get('path'),'C:/Assets/test.json');
  await page.locator('.bridge-detail-media webview').dispatchEvent('dom-ready');
  await page.waitForFunction(()=>calls.some(c=>Array.isArray(c)&&c[0]==='plugin-create'&&c[1].manifest.id==='b95aad2b-39e9-4dd5-860b-1c2c8ddf78f7'));
  await page.evaluate(()=>{pluginModule.installedPluginMaps={};details.select(['C:/Assets/other.obj']);});
  await page.waitForFunction(()=>document.querySelector('.bridge-detail-media webview')?.getAttribute('src').includes('model-viewer'));
  await page.evaluate(()=>details.select(['C:/Assets/book.pdf']));
  await page.waitForFunction(()=>document.querySelector('.bridge-detail-media webview')?.getAttribute('src').includes('pdf-viewer'));
  assert.equal(await page.locator('.bridge-detail-media webview').getAttribute('nodeintegration'),null);
  await page.evaluate(()=>{
    pluginModule.installedPluginMaps.replacement={path:'C:/Custom',manifest:{id:'replacement',preview:{'pdf, png, mp4':{viewer:{path:'viewer.html'}}}}};
    details.select(['C:/Assets/custom.pdf']);
  });
  await page.waitForFunction(()=>document.querySelector('.bridge-detail-media webview')?.hasAttribute('nodeintegration'));
  await page.locator('.bridge-detail-media webview').dispatchEvent('did-fail-load');
  await page.waitForFunction(()=>document.querySelector('.bridge-detail-media webview')?.getAttribute('src').includes('pdf-viewer'));
  for(const ext of ['png','mp4']){
    await page.evaluate(ext=>details.select(['C:/Assets/custom.'+ext]),ext);
    await page.waitForFunction(()=>document.querySelector('.bridge-detail-media webview')?.hasAttribute('nodeintegration'));
  }
  await page.evaluate(()=>{pluginModule.installedPluginMaps={};details.select(['C:/Assets/design.psd']);});
  await page.waitForSelector('.bridge-image-stage img');
  await page.evaluate(()=>details.select(['a','b']));assert.match(await page.locator('.bridge-detail-media').innerText(),/2 个文件/);
  await page.evaluate(()=>details.select(['C:/Assets/missing.png']));await page.waitForFunction(()=>document.querySelector('.bridge-detail-media').textContent.includes('文件不存在'));
  await page.evaluate(()=>{
   const original=window.require,svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#789"/></svg>');
   window.released=[];window.zipPending={};
   window.require=name=>name.endsWith('zip-preview.cjs')?{list:async()=>({total:4,entries:[{index:0,name:'人物/预览.png',image:true},{index:1,name:'人物/其他.jpg',image:true},{index:2,name:'book.pdf',image:false},{index:3,name:'slow.pdf',image:false}]}),image:async()=>svg,materialize:async(p,i)=>{if(i===3)await new Promise(resolve=>zipPending.resolve=resolve);return {path:'C:/Temp/'+i+'.pdf',release:async()=>released.push(i)};}}:original(name);
   details.select(['C:/Assets/archive.zip']);
  });
  await page.waitForSelector('.bridge-zip-grid');
  assert.equal(await page.locator('.bridge-detail-info .bridge-zip-tile').count(),3);
  assert.equal(await page.locator('.bridge-detail-media .bridge-zip-grid').count(),0);
  await page.getByRole('button',{name:'▰ 人物'}).click();
  await page.waitForSelector('.bridge-zip-tile img');
  assert.equal(await page.locator('.bridge-zip-tile').count(),2);
  await page.locator('.bridge-zip-tile').first().click();
  await page.waitForSelector('.bridge-detail-media .bridge-image-stage img');
  await page.locator('.bridge-detail-media').hover();await page.mouse.wheel(0,-240);
  await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.bridge-detail-media img')).transform).a>1);
  await page.locator('.bridge-zip-tile').nth(1).click();
  assert.match(await page.locator('.bridge-detail-name').innerText(),/其他.jpg/);
  await page.getByRole('button',{name:'↑',exact:true}).click();
  assert.equal(await page.locator('.bridge-zip-tile').count(),3);
  assert.equal(await page.locator('.bridge-detail-media img').count(),1,'folder navigation must preserve the upper preview');
  await page.screenshot({path:require('path').resolve(__dirname,'zip-panel-preview.png')});
  await page.getByRole('button',{name:'PDF book.pdf',exact:true}).click();
  await page.waitForSelector('.bridge-detail-media webview');
  assert.equal(await page.locator('.bridge-zip-tile').count(),3);
  await page.getByRole('button',{name:'PDF slow.pdf',exact:true}).click();
  await page.waitForFunction(()=>!!zipPending.resolve);
  assert.deepEqual(await page.evaluate(()=>released),[2]);
  await page.evaluate(()=>details.select(['C:/Assets/next.png']));
  await page.waitForSelector('.bridge-detail-media img');
  await page.evaluate(()=>zipPending.resolve());
  await page.waitForFunction(()=>released.includes(3));
  assert.equal(await page.locator('.bridge-zip-grid').count(),0);
  assert.equal(await page.locator('.bridge-detail-info h3').innerText(),'文件详情');
  await page.evaluate(()=>details.dispose());assert.equal(await toggle.count(),0);
  assert.deepEqual(errors,[]);
  console.log('Details sidebar: image zoom, PDF/native routes, plugin precedence/fallback, video lifecycle, ZIP lower browser/upper preview, stale extraction cleanup and teardown passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
