'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.BRIDGE_PLAYWRIGHT || 'playwright');
const {mountInHost,openSettingsInHost} = require('../js/central.cjs');
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1000,height:700}});
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.setContent('<div id="sidebar" style="position:fixed;left:0;width:190px">Sidebar</div><div id="list-content-panel" class="content-panel" style="position:fixed;z-index:9002;opacity:.87;left:200px;right:240px;top:60px;bottom:20px"><button id="original-item" style="position:absolute;inset:0">Original Eagle content</button></div><div class="content-panel detail-mode" style="position:fixed;z-index:9003;visibility:hidden" inert><div id="detail-container"></div></div>');
    const originalStyle=await page.locator('#list-content-panel').getAttribute('style');
    await page.evaluate(() => {
      window.$bodyScope={libraryPath:'fixture-library'};
      window.currentWindow={webContents:{id:7}};
      const create=document.createElement.bind(document);
      document.createElement=(tag,...args)=>{
        const el=create(tag,...args);
        if(tag==='webview'){
          el.getWebContentsId=()=>8;
          el.executeJavaScript=async code=>{window.injected=code;};
          el.send=(...args)=>{window.sent=args;};
        }return el;
      };
    });
    await page.evaluate(`window.mountBridge=${mountInHost.toString()}`);
    const config={parentID:7,library:'fixture-library',name:'Test <asset>',plugin:{path:'fixture'},app:{},preload:'file:///fixture/preload.js',url:'file:///fixture/central.html'};
    await page.evaluate(c=>{window.ready=mountBridge(c);},config);
    assert.equal(await page.locator('#eagle-bridge-central').count(),1);
    const bounds=await page.locator('#eagle-bridge-central').boundingBox();
    assert.equal(bounds.x,200);assert.equal(bounds.width,560);
    assert.equal(await page.locator('#list-content-panel').evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await page.locator('#list-content-panel').evaluate(el=>el.inert),true);
    assert.equal(await page.locator('#sidebar').evaluate(el=>el.inert),false);
    assert.equal(await page.locator('#eagle-bridge-central').evaluate(el=>getComputedStyle(el).zIndex),'9004');
    assert.equal(await page.evaluate(()=>!!document.elementFromPoint(250,80).closest('#eagle-bridge-central')),true);
    assert.notEqual(await page.locator('#eagle-bridge-central').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.evaluate(()=>document.querySelector('webview').dispatchEvent(new Event('dom-ready')));
    assert.equal(await page.evaluate(()=>ready),true);
    await page.evaluate(`window.openBridgeSettings=${openSettingsInHost.toString()}`);
    await page.evaluate(()=>{window.pluginModule={installedPluginMaps:{bridge:{path:'D:\\Plugins\\Bridge',manifest:{id:'bridge'}}},open:plugin=>{window.openedSettings=plugin.manifest.id;}};});
    assert.equal(await page.evaluate(()=>openBridgeSettings({parentID:7,id:'bridge',pluginDir:'D:/Plugins/Bridge'})),true);
    assert.equal(await page.evaluate(()=>openedSettings),'bridge');
    assert.equal(await page.locator('#eagle-bridge-central').count(),1,'settings must leave the central list intact');
    await assert.rejects(page.evaluate(()=>openBridgeSettings({parentID:99,id:'bridge',pluginDir:'D:/Plugins/Bridge'})),/主窗口/);
    await assert.rejects(page.evaluate(()=>openBridgeSettings({parentID:7,id:'bridge',pluginDir:'D:/Wrong'})),/设置入口/);
    assert.equal(await page.evaluate(()=>sent[0]),'plugin-create');
    await page.addStyleTag({content:'.content-panel .toolbar{-webkit-app-region:drag}button{border:2px solid black;box-shadow:0 0 0 1px black}'});
    assert.equal(await page.getByRole('button',{name:'返回 Eagle'}).evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-app-region')),'no-drag');
    assert.equal(await page.locator('#eagle-bridge-central > .toolbar').evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-app-region')),'drag');
    const zoom=page.getByRole('button',{name:'放大缩略图'});
    assert.equal(await zoom.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
    assert.equal(await zoom.evaluate(e=>getComputedStyle(e).boxShadow),'none');
    const slider=page.getByRole('slider',{name:'缩略图大小'});
    assert.equal(await slider.count(),1);
    const sr=await slider.boundingBox(),br=await page.getByRole('button',{name:'返回 Eagle'}).boundingBox();
    assert.ok(Math.abs(sr.y+sr.height/2-br.y-br.height/2)<20);
    await slider.fill('4');await slider.dispatchEvent('input');
    assert.match(await page.evaluate(()=>injected),/bridge-size-change/);
    await page.getByRole('button',{name:'放大缩略图'}).click();
    assert.equal(await slider.inputValue(),'5');
    await page.evaluate(()=>{const e=new Event('ipc-message');e.channel='eagle-bridge-size-state';e.args=[2];document.querySelector('webview').dispatchEvent(e);});
    assert.equal(await slider.inputValue(),'2');

    await page.evaluate(()=>{document.body.setAttribute('theme','light');document.body.style.setProperty('--color-background-primary','#fafafa');document.body.style.setProperty('--color-text-primary','#202020');});
    await page.waitForFunction(()=>document.querySelector('#eagle-bridge-central').style.background==='rgb(250, 250, 250)');
    assert.match(await page.evaluate(()=>injected),/bridge-theme-change/);
    assert.match(await page.evaluate(()=>injected),/light/);
    await page.getByRole('button',{name:'返回 Eagle'}).click();
    assert.equal(await page.locator('#eagle-bridge-central').count(),0);
    assert.equal(await page.locator('#list-content-panel').innerText(),'Original Eagle content');
    assert.equal(await page.locator('#list-content-panel').getAttribute('style'),originalStyle);
    assert.equal(await page.locator('#list-content-panel').evaluate(el=>el.inert),false);
    assert.equal(await page.locator('#list-content-panel').evaluate(el=>getComputedStyle(el).opacity),'0.87');
    assert.equal(await page.locator('.detail-mode').evaluate(el=>el.inert),true);
    assert.equal(await page.locator('#eagle-bridge-central-mask').count(),0);
    await page.evaluate(c=>{window.ready=mountBridge(c);},config);
    await page.evaluate(()=>document.querySelector('webview').dispatchEvent(new Event('dom-ready')));
    await page.evaluate(()=>ready);
    await page.evaluate(()=>{$bodyScope.libraryPath='other-library';});
    await page.waitForFunction(()=>!document.getElementById('eagle-bridge-central'));
    assert.equal(await page.locator('#list-content-panel').evaluate(el=>el.inert),false);
    // Folder and smart-folder navigation restore native Eagle; metadata changes do not.
    for(const field of ['currentFolder','currentSmartFolder']){
      await page.evaluate(({c,field})=>{$bodyScope.libraryPath=c.library;$bodyScope[field]={id:'first',name:'Original'};window.ready=mountBridge(c);},{c:config,field});
      await page.evaluate(()=>document.querySelector('webview').dispatchEvent(new Event('dom-ready')));await page.evaluate(()=>ready);
      await page.evaluate(field=>{$bodyScope[field].name='Renamed';},field);
      await page.waitForTimeout(250);assert.equal(await page.locator('#eagle-bridge-central').count(),1);
      await page.evaluate(field=>{$bodyScope[field]={id:'second'};},field);
      await page.waitForFunction(()=>!document.getElementById('eagle-bridge-central'));
      assert.equal(await page.locator('#list-content-panel').evaluate(el=>el.inert),false);
    }
    // A failed renderer load must reveal the original UI, too.
    await page.evaluate(c=>{$bodyScope.libraryPath=c.library;window.failed=mountBridge(c).catch(e=>e.message);},config);
    await page.evaluate(()=>document.querySelector('webview').dispatchEvent(new Event('did-fail-load')));
    assert.match(await page.evaluate(()=>failed),/加载失败/);
    assert.equal(await page.locator('#eagle-bridge-central').count(),0);
    assert.equal(await page.locator('#list-content-panel').evaluate(el=>el.inert),false);
    assert.equal(await page.locator('#eagle-bridge-central-mask').count(),0);
    await page.goto(pathToFileURL(path.resolve(__dirname,'../central.html')).href+'?demo=1');
    await page.waitForSelector('.candidate');
    assert.equal(await page.locator('[data-action="central-open"]').count(),0);
    assert.equal(await page.locator('[data-action="browser-refresh"]').count(),1);
    assert.equal(await page.locator('.candidate-toggle').count(),0);
    assert.notEqual(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Central layer overlap, opaque background, input suspension, restore, load failure, library cleanup and shared list checks passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
