'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.BRIDGE_PLAYWRIGHT||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--allow-file-access-from-files']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:760}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   let factory;Object.defineProperty(window,'bridgeDemo',{set(v){factory=v;},get(){return()=>{
    const env=factory();window.fixture=env;window.searches=0;window.opened=[];
    const root='D:\\Assets\\Chair';
    env.C.searchNames=async()=>{searches++;return {rows:[{path:root,type:'folder'}],issues:[]};};
    env.C.snapshot=async p=>({path:p,type:/\.[a-z]+$/i.test(p)?'file':'folder'});
    env.C.listAssetFolder=async target=>({dir:target.path,rows:target.path===root?[
      {path:root+'\\textures',type:'folder'},
      {path:root+'\\render2.png',type:'file',size:4000,mtime:1700000000000},
      {path:root+'\\render10.png',type:'file',size:2000,mtime:1710000000000},
      {path:root+'\\chair.blend',type:'file',size:9999,mtime:1720000000000}
    ]:[{path:target.path+'\\wood.png',type:'file',size:4500,mtime:1700000000000}]});
    env.host.shell.openPath=async p=>{opened.push(p);};
    if(location.search.includes('warm=1')){const read=env.store.read;env.store.read=async()=>{const data=await read();if(!window.warmSet){window.warmSet=true;window.bridgeInitialSearch={id:'DEMO',library:'DEMO',at:Date.now(),settings:data.settings,results:{rows:[{path:root,type:'folder'}],issues:[]}};}return data;};}
    return env;
   };}});
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../central.html')).href+'?demo=1');
  await page.waitForSelector('.candidate');
  assert.equal(await page.locator('.candidate').count(),4);
  assert.equal(await page.locator('.candidate').filter({hasText:'textures'}).locator('.browser-size').innerText(),'');
  const canvas=await page.locator('.browser-files').evaluate(el=>({background:getComputedStyle(el).backgroundImage,bottom:el.getBoundingClientRect().bottom,last:el.querySelector('.candidate:last-of-type').getBoundingClientRect().bottom}));
  assert.match(canvas.background,/repeating-linear-gradient/);
  assert.ok(canvas.bottom>=748);assert.ok(canvas.bottom-canvas.last>300);

  const firstRow=await page.locator('.candidate').first().boundingBox();
  await page.mouse.move(firstRow.x+100,firstRow.y+240);await page.mouse.down();
  await page.mouse.move(firstRow.x+5,firstRow.y+5,{steps:4});
  assert.equal(await page.locator('.file-selection-box').count(),1);
  assert.ok(await page.locator('.candidate.selected').count()>=2);
  await page.mouse.up();assert.equal(await page.locator('.file-selection-box').count(),0);
  await page.locator('[data-browser-sort="name"]').click();
  await page.locator('[data-browser-sort="name"]').click();
  assert.match(await page.locator('.candidate').filter({hasText:'render2.png'}).locator('.browser-size').innerText(),/KB$/);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('bridge-size-change',{detail:6})));
  assert.equal(await page.locator('.view-grid').count(),1);
  assert.equal(await page.locator('.browser-files').evaluate(e=>e.style.getPropertyValue('--thumb-size')),'256px');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('bridge-size-change',{detail:1})));
  assert.equal(await page.locator('.view-compact').count(),1);
  const columnCanvas=await page.locator('.view-compact').evaluate(e=>({image:getComputedStyle(e).backgroundImage,width:parseFloat(e.style.getPropertyValue('--horizontal-column-width')),bottom:e.getBoundingClientRect().bottom}));
  assert.match(columnCanvas.image,/to right/);assert.ok(columnCanvas.width>=300);assert.ok(columnCanvas.bottom>=748);

  await page.evaluate(()=>window.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:100,cancelable:true})));
  assert.equal(await page.locator('.view-details').count(),1);
  // Blank-space context menu stays outside the layout, with submenus.
  const height=await page.evaluate(()=>document.body.scrollHeight);
  await page.locator('#app').click({button:'right',position:{x:400,y:430}});
  assert.equal(await page.getByRole('menuitem',{name:'新建文件夹',exact:false}).count(),1);
  assert.equal(await page.getByRole('menuitem',{name:'重命名',exact:false}).isDisabled(),true);
  assert.equal(await page.getByRole('menuitem',{name:'删除',exact:true}).isEnabled(),true,'blank menu preserves the existing marquee selection');
  await page.getByRole('menuitem',{name:'显示模式',exact:false}).hover();
  await page.getByRole('menuitemradio',{name:'水平列表',exact:true}).click();
  assert.equal(await page.locator('.view-compact').count(),1);
  assert.equal(await page.evaluate(()=>document.body.scrollHeight),height);
  await page.locator('[data-browser-mode="details"]').click();
  await page.locator('.candidate').first().click();
  await page.locator('.candidate').first().click({button:'right'});
  assert.equal(await page.getByRole('menuitem',{name:'删除',exact:true}).isEnabled(),true);
  await page.getByRole('menuitem',{name:'重命名',exact:false}).click();
  await page.waitForSelector('.browser-edit-dialog');
  assert.equal(await page.getByRole('textbox',{name:'名称',exact:true}).inputValue(),'textures');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.browser-edit-dialog').count(),0);
  const names=()=>page.locator('.browser-name').allTextContents();
  assert.deepEqual(await names(),['textures','chair.blend','render2.png','render10.png']);
  await page.locator('[data-browser-sort="size"]').click();
  assert.deepEqual(await names(),['textures','render10.png','render2.png','chair.blend']);
  // Real keystrokes, middle edits and IME must keep the same connected input.
  const search=page.locator('#browser-search');
  await search.focus();await page.evaluate(()=>window.searchNode=document.activeElement);
  await search.pressSequentially('render10',{delay:12});
  assert.equal(await search.inputValue(),'render10');
  assert.equal(await search.evaluate(el=>el.selectionStart),8);
  assert.deepEqual(await names(),['render10.png']);
  await search.press('Home');await search.pressSequentially('X');await search.press('Backspace');
  assert.equal(await search.inputValue(),'render10');
  await search.press('Delete');assert.equal(await search.inputValue(),'ender10');
  await search.evaluate(el=>el.setSelectionRange(0,5));await search.pressSequentially('render');
  assert.equal(await search.inputValue(),'render10');
  await search.press('Control+A');await search.press('Backspace');
  assert.equal(await search.inputValue(),'');assert.equal(await page.locator('.candidate').count(),4);
  const ime=await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition',{text:'材质',selectionStart:2,selectionEnd:2});
  assert.equal(await page.locator('.candidate').count(),4,'composition must not filter intermediate text');
  await ime.send('Input.insertText',{text:'材质'});
  assert.equal(await search.inputValue(),'材质');
  assert.equal(await page.locator('.candidate').count(),0);
  await search.press('Backspace');assert.equal(await search.inputValue(),'材');
  assert(await search.evaluate(el=>el===window.searchNode&&el===document.activeElement));
  await search.press('Control+A');await search.press('Backspace');
  await ime.detach();
  await page.locator('#browser-search').fill('render*png');
  assert.equal(await page.locator('.candidate').count(),2);
  assert.equal(await page.evaluate(()=>searches),1);
  await page.locator('#browser-search').fill('no matches');
  assert.equal(await page.locator('.candidate').count(),0);
  await page.locator('#browser-search').fill('');
  await page.locator('[data-browser-mode="grid"]').click();
  assert.equal(await page.locator('img[data-thumbnail]').count(),2);
  assert.equal(await page.locator('.browser-files').evaluate(e=>getComputedStyle(e).backgroundImage),'none');
  assert.equal(await page.locator('#browser-size').isVisible(),true);
  const iconSize=()=>page.locator('.browser-type-thumb .icon-folder').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('bridge-size-change',{detail:2})));
  const smallIcon=await iconSize();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('bridge-size-change',{detail:6})));
  const largeIcon=await iconSize();
  assert.ok(largeIcon.width>smallIcon.width*2&&largeIcon.height>smallIcon.height*2);
  assert.ok(largeIcon.height>150,'folder should occupy most of its thumbnail');
  // Current target marker belongs to the bottom of a grid cell, including selection.
  await page.locator('.candidate').first().evaluate(el=>el.classList.add('current','selected'));
  assert.match(await page.locator('.candidate.current').evaluate(el=>getComputedStyle(el).boxShadow),/0px -2px 0px 0px inset/);
  await page.screenshot({path:path.resolve(__dirname,'browser-grid-preview.png')});
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'插件设置',exact:true}).click();
  const popup=await popupPromise;await popup.waitForSelector('.preferences');
  assert.equal(await popup.locator('[data-tab]').count(),4);
  await popup.close();
  assert.equal(await page.locator('.view-grid').count(),1);
  await page.locator('[data-action="browser-filter"]').click();
  await page.locator('[data-filter-type=blend]').check();
  assert.deepEqual(await names(),['chair.blend']);
  await page.locator('[data-filter-type=blend]').uncheck();
  await page.locator('[data-browser-mode="compact"]').click();
  assert.equal(await page.locator('.view-compact').count(),1);
  await page.locator('[data-browser-mode="details"]').click();
  await page.locator('.candidate').filter({hasText:'textures'}).dblclick();
  await page.waitForFunction(()=>document.querySelector('#browser-path').value.endsWith('textures'));
  assert.deepEqual(await names(),['wood.png']);
  await page.locator('[data-action="browser-up"]').click();
  assert.equal(await page.locator('.candidate').count(),4);
  await page.locator('[data-action="folder-back"]').click();
  assert.deepEqual(await names(),['wood.png']);
  await page.locator('.candidate').dblclick();
  assert.equal(await page.evaluate(()=>opened.length),1);
  assert.equal(await page.evaluate(async()=>Object.keys((await fixture.store.read()).bindings).length),0);
  await page.locator('.candidate').hover();await page.locator('.file-preview-trigger').hover();
  await page.waitForSelector('.local-image-preview');
  assert.equal(await page.locator('.preview-trigger').count(),0);
  assert.equal(await page.locator('.file-preview-trigger.blender-icon').count(),1);
  assert.equal(await page.locator('.preview-backdrop').count(),1);
  assert.equal(await page.locator('.local-image-preview').evaluate(e=>getComputedStyle(e).boxShadow),'none');
  assert.ok((await page.locator('.local-image-preview').boundingBox()).width>360);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.local-image-preview').count(),0);
  assert.equal(await page.locator('.preview-backdrop').count(),0);
  await page.locator('#browser-path').fill('E:\\Other');await page.locator('#browser-path').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#browser-path').value==='E:\\Other');
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.action='central-refresh';document.getElementById('app').append(b);b.click();});
  await page.waitForFunction(()=>!document.getElementById('app').inert);
  assert.equal(await page.locator('.candidate').count(),4);
  assert.equal(await page.evaluate(async()=>Object.keys((await fixture.store.read()).bindings).length),0);
  const handle=page.locator('[data-resize-column="mtime"]');
  const box=await handle.boundingBox();
  await page.mouse.move(box.x+3,box.y+5);await page.mouse.down();await page.mouse.move(box.x-35,box.y+5);await page.mouse.up();
  assert.ok(await page.locator('.browser-layout').evaluate(el=>parseInt(el.style.getPropertyValue('--date-width'))>170));
  await page.screenshot({path:path.resolve(__dirname,'browser-preview.png')});
  await page.setViewportSize({width:520,height:760});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Confirming a candidate is distinct from browsing an ordinary file.
  await page.evaluate(()=>{fixture.C.searchNames=async()=>({rows:[{path:'D:\\Assets\\Chair',type:'folder'},{path:'E:\\Other\\chair.blend',type:'file'}],issues:[]});});
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.action='central-refresh';document.getElementById('app').append(b);b.click();});
  await page.waitForFunction(()=>!document.getElementById('app').inert);
  assert.equal(await page.locator('#browser-path').inputValue(),'');
  assert.equal(await page.locator('.candidate').count(),2);
  await page.locator('.candidate').first().dblclick();
  assert.equal(await page.locator('#browser-path').inputValue(),'D:\\Assets\\Chair');
  assert.equal(await page.evaluate(async()=>Object.keys((await fixture.store.read()).bindings).length),1);
  // Unknown path: preserve the directory and show the error instead of losing it.
  await page.evaluate(()=>{const original=fixture.C.snapshot;fixture.C.snapshot=async p=>{if(p==='Z:\\missing')throw Error('路径不存在');return original(p);};});
  await page.locator('#browser-path').fill('Z:\\missing');await page.locator('#browser-path').press('Enter');
  assert.equal(await page.locator('#browser-path').inputValue(),'D:\\Assets\\Chair');
  assert.match(await page.locator('.notice').innerText(),/路径不存在/);
  // The Eagle fallback is browsable too; address entry must not silently ignore Enter.
  await page.evaluate(()=>{
    fixture.C.searchNames=async()=>({rows:[],issues:[]});
    fixture.C.listEagleFolder=async()=>({dir:'D:\\Library\\images\\DEMO.info',eagle:true,rows:[]});
    const b=document.createElement('button');b.dataset.action='central-refresh';document.getElementById('app').append(b);b.click();
  });
  await page.waitForFunction(()=>!document.getElementById('app').inert);
  assert.equal(await page.locator('#browser-path').inputValue(),'D:\\Library\\images\\DEMO.info');
  assert.equal(await page.locator('#browser-path').isEditable(),true);
  await page.keyboard.press('Control+l');
  assert.ok(await page.locator('#browser-path').evaluate(el=>el===document.activeElement&&el.selectionStart===0&&el.selectionEnd===el.value.length));
  await page.keyboard.insertText('"E:\\Other"');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.getElementById('app').inert);
  assert.equal(await page.locator('#browser-path').inputValue(),'E:\\Other');
  assert.deepEqual(await names(),['wood.png']);
  await page.locator('[data-action="folder-back"]').click();
  assert.equal(await page.locator('#browser-path').inputValue(),'D:\\Library\\images\\DEMO.info');
  assert.deepEqual(errors,[]);
  // Long lists must scroll in every mode, despite sharing inspector styles.
  await page.evaluate(()=>{
    fixture.C.listAssetFolder=async target=>({dir:target.path,rows:Array.from({length:90},(_,i)=>({path:target.path+'\\item'+i+'.txt',type:'file'}))});
  });
  await page.locator('#browser-path').fill('E:\\Many');await page.locator('#browser-path').press('Enter');
  await page.waitForFunction(()=>!document.getElementById('app').inert);
  for(const mode of ['details','compact','grid']){
    await page.locator('[data-browser-mode="'+mode+'"]').click();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowY),'auto');
    assert.notEqual(await page.evaluate(()=>getComputedStyle(document.documentElement,'::-webkit-scrollbar').display),'none');
    await page.mouse.move(300,500);await page.mouse.wheel(0,600);
    await page.waitForFunction(()=>scrollY>100);
    await page.evaluate(()=>scrollTo(0,0));
  }
  // Opening from a recent sidebar search reuses results, but explicit refresh
  // still performs a fresh Everything query.
  await page.goto(pathToFileURL(path.resolve(__dirname,'../central.html')).href+'?demo=1&warm=1');
  await page.waitForSelector('.candidate');assert.equal(await page.evaluate(()=>searches),0);
  await page.evaluate(()=>{const button=document.createElement('button');button.dataset.action='central-refresh';document.getElementById('app').append(button);button.click();});
  await page.waitForFunction(()=>searches===1&&!document.getElementById('app').inert);
  console.log('Browser navigation, local search, sort, view modes, filters, preview, default open and narrow layout passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
