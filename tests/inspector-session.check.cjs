'use strict';
// Actual inspector UI + Eagle's src-update lifecycle, with isolated fake assets.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.BRIDGE_PLAYWRIGHT||'playwright');
const {installInHost}=require('../js/inspector-session.cjs');
const fs=require('node:fs');
const archive=fs.readFileSync(process.env.EAGLE_ASAR||'C:/Program Files/Eagle/resources/app.asar');
const header=JSON.parse(archive.subarray(16,16+archive.readUInt32LE(12)));
function readNative(file){let node=header;for(const part of file.split('/'))node=node.files[part];const start=8+archive.readUInt32LE(4)+Number(node.offset);return archive.subarray(start,start+node.size).toString();}
const nativeCSS=require('../js/native-style.cjs').extract(readNative('app/css/base.css'),readNative('app/css/app.css'));
const entry=pathToFileURL(path.resolve(__dirname,'../inspector.html')).href;
const url=id=>entry+'?id='+id+'&path=E%3A%5CAsset%5C'+id+'.png&width=800&height=600&lang=zh-CN&theme=gray';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const guest=await browser.newPage({viewport:{width:480,height:720}}),errors=[];
    guest.on('pageerror',e=>errors.push(e.message));
    await guest.addInitScript(()=>{
      let factory;
      Object.defineProperty(window,'bridgeDemo',{set:f=>factory=f,get:()=>()=>{
        const env=factory();window.fixture=env;window.queries=[];window.releases={};
        env.host.item.getById=async id=>({id,name:id,ext:'png',tags:['EagleBridge']});
        env.C.searchNames=async(_settings,names)=>{
          queries.push(names[0]);
          if(window.delayQueries)await new Promise(resolve=>releases[names[0]]=resolve);
          return {rows:[{path:'E:\\Assets\\'+names[0]+'.png',type:'file'}],issues:[]};
        };
        return env;
      }});
    });
    await guest.goto(entry+'?demo=1&id=A');
    await guest.waitForFunction(()=>!document.getElementById('app').inert);
    await guest.addStyleTag({content:nativeCSS});
    await guest.evaluate(()=>{
      window.bars=[...document.querySelectorAll('.inspector-bar')];
      window.buttons=bars.map(bar=>bar.firstElementChild);
      window.paints=[];window.watchPaint=true;
      function frame(){if(!watchPaint)return;paints.push(buttons.map(button=>({connected:button.isConnected,opacity:getComputedStyle(button).opacity,height:button.getBoundingClientRect().height})));requestAnimationFrame(frame);}frame();
    });
    const host=await browser.newPage();
    await host.exposeFunction('deliver',code=>guest.evaluate(code));
    await host.setContent('<webview id="bridge"></webview><webview id="other"></webview>');
    await host.evaluate(({source,initial})=>{
      window.currentWindow={webContents:{id:7}};window.$bodyScope={libraryPath:'DEMO'};
      window.preferences={theme:{name:'GRAY'}};window.nativeNavigations=[];
      window.view=document.getElementById('bridge');
      const set=view.setAttribute;
      view.setAttribute=function(name,value){if(name==='src')nativeNavigations.push(value);return set.call(this,name,value);};
      Object.defineProperty(view,'src',{configurable:true,get(){return this.getAttribute('src');},set(value){set.call(this,'src',value);nativeNavigations.push(value);}});
      view.setAttribute('src',initial);nativeNavigations.length=0;
      view.getWebContentsId=()=>8;view.executeJavaScript=code=>window.deliver(code);
      window.install=(0,eval)('('+source+')');
    },{source:installInHost.toString(),initial:url('A')});
    const config={url:url('A'),library:'DEMO',parentID:7,windowID:8};
    assert.equal(await host.evaluate(c=>install({...c,parentID:99}),config),false);
    assert.equal(await host.evaluate(c=>install(c),config),true);
    assert.equal(await host.evaluate(c=>install(c),config),true);
    // Exactly Eagle's jQuery attr('src', ...) path, plus the property setter.
    await host.evaluate(next=>view.setAttribute('src',next),url('B'));
    await guest.waitForFunction(()=>location.search.includes('id=B')&&!document.getElementById('app').inert);
    await host.evaluate(next=>view.src=next,url('C'));
    await guest.waitForFunction(()=>location.search.includes('id=C')&&!document.getElementById('app').inert);
    assert.deepEqual(await guest.evaluate(()=>queries),[],'collapsed selection must not query Everything');
    await guest.locator('[data-action="candidates"]').click();
    await guest.waitForSelector('.candidate');
    assert.match(await guest.locator('.candidate').innerText(),/C\.png/);
    await guest.evaluate(()=>window.delayQueries=true);
    await host.evaluate(next=>view.setAttribute('src',next),url('D'));
    await guest.waitForFunction(()=>!!releases.D);
    assert.match(await guest.locator('.candidate').innerText(),/C\.png/,'keep last list while querying');
    await host.evaluate(next=>view.setAttribute('src',next),url('E'));
    await host.evaluate(next=>view.setAttribute('src',next),url('F'));
    await guest.waitForTimeout(50);
    await guest.evaluate(()=>releases.D());
    await guest.waitForFunction(()=>!!releases.F);
    assert.match(await guest.locator('.candidate').innerText(),/C\.png/,'never paint superseded D/E results');
    await guest.evaluate(()=>{delayQueries=false;releases.F();});
    await guest.waitForFunction(()=>!document.getElementById('app').inert);
    assert.match(await guest.locator('.candidate').innerText(),/F\.png/);
    assert.deepEqual(await guest.evaluate(()=>queries),['C','D','F']);
    // Repeated URL notifications do not search or reload again.
    await host.evaluate(next=>view.setAttribute('src',next),url('F'));
    await guest.waitForTimeout(80);
    assert.deepEqual(await guest.evaluate(()=>queries),['C','D','F']);
    assert.deepEqual(await host.evaluate(()=>nativeNavigations),[]);
    assert(await guest.evaluate(()=>buttons.every((button,i)=>button===document.querySelectorAll('.inspector-bar > button')[i])));
    assert(await guest.evaluate(()=>{watchPaint=false;return paints.length>3&&paints.every(frame=>frame.every(p=>p.connected&&p.opacity==='1'&&p.height>0));}));
    // Disabled bootstrap / action controls cannot animate or dim under Eagle CSS.
    assert.equal(await guest.locator('.inspector-button').first().evaluate(button=>{button.disabled=true;return getComputedStyle(button).opacity;}),'1');
    // Other webviews and deliberate reloads remain native.
    await host.evaluate(()=>document.getElementById('other').setAttribute('src','other.html'));
    assert.equal(await host.locator('#other').getAttribute('src'),'other.html');
    await host.evaluate(()=>view.dispatchEvent(new Event('did-start-navigation')));
    assert.equal(await host.evaluate(()=>!!view.__eagleBridgeSession),false);
    await host.evaluate(next=>view.src=next,url('G'));
    assert.deepEqual(await host.evaluate(()=>nativeNavigations),[url('G')]);
    // Unsupported URLs and failed IPC fall back to normal loading.
    for(const failure of ['url','delivery']){
      const start=url('G');
      assert.equal(await host.evaluate(c=>install(c),{...config,url:start}),true);
      const target=failure==='url'?entry+'?id=H&unknown=1':url('H');
      await host.evaluate(({target,failure})=>{if(failure==='delivery')view.executeJavaScript=async()=>false;view.setAttribute('src',target);},{target,failure});
      await host.waitForFunction(()=>!view.__eagleBridgeSession);
      assert.equal(await host.locator('#bridge').getAttribute('src'),target);
      await host.evaluate(start=>view.setAttribute('src',start),start);
    }
    // A code update must escape the persistent-frame optimization exactly once.
    await host.evaluate(()=>{window.codeStamp=10;window.require=()=>({statSync:()=>({mtimeMs:codeStamp})});view.executeJavaScript=async()=>true;});
    assert.equal(await host.evaluate(c=>install(c),{...config,url:url('G'),sources:[['fixture/app.js',10]]}),true);
    await host.evaluate(next=>view.setAttribute('src',next),url('I'));
    assert.equal(await host.evaluate(()=>!!view.__eagleBridgeSession),true);
    await host.evaluate(next=>{codeStamp=11;view.setAttribute('src',next);},url('J'));
    assert.equal(await host.evaluate(()=>!!view.__eagleBridgeSession),false);
    assert.equal(await host.locator('#bridge').getAttribute('src'),url('J'));
    assert.deepEqual(errors,[]);
    console.log('Persistent inspector: zero reloads, stable buttons, atomic list swap, coalescing, collapsed queries and native fallbacks passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
