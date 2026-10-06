'use strict';

// Experimental host adapter. Changes only live DOM; never patches Eagle files,
// preview registrations, or asset metadata. Keep all private API use here.
function mountInHost(config,createDetails) {
  const key = '__eagleBridgeCentral';
  if (typeof currentWindow === 'undefined' || currentWindow.webContents?.id !== config.parentID) {
    throw Error('主窗口身份已变化，请重新选择资产后重试');
  }
  if (typeof $bodyScope === 'undefined' || $bodyScope.libraryPath !== config.library) {
    throw Error('资源库已变化，请重新选择资产后重试');
  }
  const anchor = document.getElementById('list-content-panel');
  if (!anchor || anchor.getBoundingClientRect().width < 100) throw Error('当前 Eagle 中央区域不可用');
  if (typeof currentWindow === 'undefined' || !currentWindow.webContents) throw Error('当前 Eagle 不支持中央面板实验入口');
  window[key]?.close();
  // Eagle's normal content panels are above z-index 9000. Keep the browser
  // above those panels (but below Eagle dialogs), and suspend their painting
  // and input until close. Leave layout intact so resize tracking still works.
  const originals = [...new Set([anchor, document.getElementById('detail-container')?.closest('.content-panel')].filter(Boolean))];
  const suspended = originals.map(node => ({node, inert:node.inert, marker:node.getAttribute('data-eagle-bridge-suspended')}));
  const mask = document.createElement('style');
  mask.id = 'eagle-bridge-central-mask';
  mask.textContent = '[data-eagle-bridge-suspended="true"]{opacity:0!important;pointer-events:none!important}';
  const layer = Math.max(9002, ...originals.map(node => Number.parseInt(getComputedStyle(node).zIndex,10)||0)) + 1;
  const background = '#303134'; // Neutral fallback only when native tokens are unavailable.
  const panel = document.createElement('section');
  panel.id = 'eagle-bridge-central';panel.className='content-panel';
  panel.style.cssText = `position:fixed;z-index:${layer};display:flex;flex-direction:column;isolation:isolate;overflow:hidden;box-sizing:border-box;background:${background};color:#eee;`;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:relative;flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:12px 18px;border-bottom:1px solid #80808040;font:14px sans-serif;';
  const back = document.createElement('button');
  const backIcon=document.createElement('i');
  const backIconURL=new URL('assets/blender/back.svg',config.url).href;
  backIcon.style.cssText=`display:block;width:18px;height:18px;background:currentColor;mask:url("${backIconURL}") center/contain no-repeat;-webkit-mask:url("${backIconURL}") center/contain no-repeat`;
  back.append(backIcon);
  back.title = '返回 Eagle';
  back.setAttribute('aria-label','返回 Eagle');
  back.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:28px;border:0;border-radius:6px;padding:0;background:#80808020;color:inherit;cursor:pointer;position:relative;z-index:2;pointer-events:auto;-webkit-app-region:no-drag';
  bar.className='toolbar';
  bar.style.cssText='position:relative;flex:0 0 48px;display:flex;align-items:center;padding:0 12px;height:48px;min-height:48px;border-bottom:1px solid var(--color-border-secondary);-webkit-app-region:drag;';
  const nativeSlider=anchor.querySelector('.toolbar .sliders-bar .slider');
  const sliderHost=document.createElement('div');sliderHost.className='sliders-bar';
  sliderHost.style.cssText='position:absolute;top:0;height:48px;display:flex;justify-content:center;pointer-events:none;';
  const slider=document.createElement('div');slider.className='slider';slider.style.display='flex';slider.style.pointerEvents='auto';
  slider.innerHTML='<button class="ic-btn zoom-btn" aria-label="缩小缩略图">−</button><div class="range-wrap"><div class="range-progressbar"><div class="current"></div></div><input class="range" type="range" aria-label="缩略图大小" min="0" max="6" step="1" value="0"></div><button class="ic-btn zoom-btn" aria-label="放大缩略图">＋</button>';
  // Native classes reuse Eagle's track, thumb, spacing and theme rules.
  const sizeInput=slider.querySelector('input'),progress=slider.querySelector('.current');
  const paintSize=()=>{progress.style.display='none';};
  const sendSize=()=>{paintSize();webview.executeJavaScript(`window.dispatchEvent(new CustomEvent('bridge-size-change',{detail:${Number(sizeInput.value)}}))`).catch(()=>{});};
  sizeInput.oninput=sendSize;
  let zoomWheelAt=0;
  bar.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();e.stopPropagation();if(!e.deltaY||Date.now()-zoomWheelAt<80)return;zoomWheelAt=Date.now();sizeInput.value=String(Math.max(0,Math.min(6,Number(sizeInput.value)+(e.deltaY<0?1:-1))));sendSize();},{passive:false});
  slider.querySelectorAll('button').forEach((b,i)=>b.onclick=()=>{sizeInput.value=String(Math.max(0,Math.min(6,Number(sizeInput.value)+(i?1:-1))));sendSize();});
  sizeInput.style.webkitAppRegion='no-drag';
  slider.style.webkitAppRegion='no-drag';
  slider.querySelectorAll('button').forEach((button,i)=>{
    // Eagle uses div.ic-btn here; reset HTML button defaults explicitly.
    button.type='button';
    button.style.cssText='appearance:none;-webkit-appearance:none;border:0;outline:0;box-shadow:none;background:transparent;color:inherit;border-radius:0;-webkit-app-region:no-drag;flex-shrink:0';
    const nativeImage=nativeSlider?.querySelectorAll('.zoom-btn img')[i];
    if(nativeImage){const img=document.createElement('img');img.src=nativeImage.src;button.replaceChildren(img);}
  });
  sliderHost.append(slider);bar.append(sliderHost);paintSize();
  bar.append(back);
  const webview = document.createElement('webview');
  webview.style.cssText = `display:flex;flex:1;min-height:0;width:100%;background:${background}`;
  webview.setAttribute('preload', config.preload);
  webview.setAttribute('nodeintegration', '');
  webview.setAttribute('webpreferences', 'contextIsolation=false');
  webview.setAttribute('src', config.url);
  panel.append(bar, webview);
  const details=typeof createDetails==='function'?createDetails({panel,bar,webview,config}):null;
  let timer, timeout, disposed = false, rejectPending = null, previewDim=null;
  const close = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer); clearTimeout(timeout);
    window.removeEventListener('keydown', onKey, true);
    previewDim?.remove();previewDim=null;
    details?.dispose();
    panel.remove();
    mask.remove();
    for (const saved of suspended) {
      if (saved.marker === null) saved.node.removeAttribute('data-eagle-bridge-suspended');
      else saved.node.setAttribute('data-eagle-bridge-suspended', saved.marker);
      saved.node.inert = saved.inert;
    }
    if (window[key]?.close === close) delete window[key];
    if (rejectPending) { const reject = rejectPending; rejectPending = null; reject(Error('中央面板已关闭')); }
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  back.onclick = close;
  window.addEventListener('keydown', onKey, true);
  window[key] = {close};
  let guestReady=false,lastTheme='';
  const syncTheme=()=>{
    const style=getComputedStyle(document.body),colors={};
    for(const name of ['color-theme','color-background-primary','color-text-primary','color-text-secondary','color-border-secondary','color-primary','color-red','color-bg-hover','color-bg-active','color-bg-selected','scrollbar-thumb-background']){
      const value=style.getPropertyValue('--'+name).trim();if(value)colors['--'+name]=value;
    }
    const theme=document.body.getAttribute('theme')||config.app?.theme||'GRAY';
    panel.style.background=colors['--color-background-primary']||colors['--color-theme']||background;
    panel.style.color=colors['--color-text-primary']||'#eee';
    webview.style.background=panel.style.background;
    bar.style.borderColor=colors['--color-border-secondary']||'#80808040';
    back.style.background=colors['--color-bg-hover']||'#80808020';
    const payload=JSON.stringify({theme,colors});
    if(guestReady&&payload!==lastTheme){
      lastTheme=payload;
      details?.theme();
      webview.executeJavaScript(`window.dispatchEvent(new CustomEvent('bridge-theme-change',{detail:${payload}}))`).catch(()=>{lastTheme='';});
    }
    return theme;
  };
  // Read navigation identity, not asset selection or folder contents. Renames,
  // refreshes and selection changes must not dismiss the browser.
  const navigationKey=()=>JSON.stringify([
    $bodyScope.currentFolder?.id||'', $bodyScope.currentSmartFolder?.id||'',
    $bodyScope.currentTag?.id||$bodyScope.currentTag?.name||'', $bodyScope.viewMode||'',
    ($bodyScope.$root?.selectedFolders||[]).map(f=>typeof f==='string'?f:f.id).sort()
  ]);
  const openedNavigation=navigationKey();
  const place = () => {
    syncTheme();
    const nativeRect=nativeSlider?.getBoundingClientRect(),panelRect=anchor.getBoundingClientRect();
    const width=nativeRect?.width>80?nativeRect.width:200;
    const center=nativeRect?.width>80?nativeRect.left+nativeRect.width/2-panelRect.left:panelRect.width/2;
    sliderHost.style.width=width+'px';slider.style.width=width+'px';
    sliderHost.style.left=Math.max(48,Math.min(center-width/2,panelRect.width-width-52))+'px';
    if (!anchor.isConnected || $bodyScope.libraryPath !== config.library || navigationKey() !== openedNavigation) return close();
    const r = anchor.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) return close();
    Object.assign(panel.style, {left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px'});
  };
  webview.addEventListener('ipc-message', e => {
    if(e.channel==='eagle-bridge-file-selection')details?.select(e.args?.[0]);
    if(e.channel==='eagle-bridge-size-state'){sizeInput.value=String(e.args?.[0]??0);paintSize();}
    if (e.channel === 'eagle-bridge-close-central') close();
    if (e.channel === 'eagle-bridge-preview-dim') {
      previewDim?.remove();previewDim=null;
      if(e.args?.[0]){
        const r=webview.getBoundingClientRect();previewDim=document.createElement('div');
        previewDim.style.cssText=`position:fixed;pointer-events:none;z-index:${layer+1};left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-shadow:0 0 0 100vmax rgba(0,0,0,.18)`;
        document.body.append(previewDim);
      }
    }
  });
  // Deny navigation away from the local plugin page, including dragged files.
  webview.addEventListener('will-navigate', e => { e.preventDefault(); });
  document.head.append(mask);
  for (const {node} of suspended) { node.setAttribute('data-eagle-bridge-suspended','true'); node.inert = true; }
  document.body.append(panel);
  place(); timer = setInterval(place, 200);
  return new Promise((resolve, reject) => {
    rejectPending = reject;
    const fail = message => { rejectPending = null; close(); reject(Error(message)); };
    timeout = setTimeout(() => fail('中央面板加载超时，请返回侧栏重试'), 10000);
    webview.addEventListener('did-fail-load', () => fail('中央面板加载失败'));
    webview.addEventListener('dom-ready', async () => {
      if (disposed) return;
      try {
        const env = {parentID:currentWindow.webContents.id, windowID:webview.getWebContentsId(),
          library:config.library, plugin:config.plugin, initialSearch:config.initialSearch, app:{...config.app,theme:syncTheme()}};
        await webview.executeJavaScript(`(() => { const c=${JSON.stringify(env)}; window.bridgeInitialSearch=c.initialSearch;window.bridgeEmbedded=true;document.body.classList.add('embedded-central');window.parentID=c.parentID; window.windowID=c.windowID; Object.assign(window.eagle.app,c.app); window.eagle.library.path=c.library; window.eagle.plugin=c.plugin; })()`);
        if (disposed) return;
        webview.send('plugin-create', config.plugin);
        guestReady=true;syncTheme();
        clearTimeout(timeout); rejectPending = null; resolve(true);
      } catch (e) { fail('中央面板初始化失败：'+e.message); }
    }, {once:true});
  });
}

// Read-only identity probe, serialized into Eagle's owning renderer. No DOM
// changes or setting changes are made until every check has passed.
function probeInHost(expected) {
  const node = document.getElementById('list-content-panel');
  const rect = node?.getBoundingClientRect();
  return {
    marker:'eagle-bridge-central-probe-v1',
    mainPage:/\/app\/index\.html$/i.test(location.pathname),
    parentMatches:typeof currentWindow !== 'undefined' && currentWindow.webContents?.id === expected.parentID,
    libraryMatches:typeof $bodyScope !== 'undefined' && $bodyScope.libraryPath === expected.library,
    centralVisible:!!rect && rect.width >= 100 && rect.height >= 100
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_,reject) => {
    timer=setTimeout(()=>reject(Error('IPC_TIMEOUT：Eagle 未响应中央入口探测')), ms);
  })]).finally(()=>clearTimeout(timer));
}

async function probeHost(ipc, expected) {
  const result = await withTimeout(ipc.invoke('plugin.window.webContents.', {
    method:'executeJavaScript', value:`(${probeInHost.toString()})(${JSON.stringify(expected)})`
  }), 5000);
  if (!result || result.marker !== 'eagle-bridge-central-probe-v1') {
    throw Error('IPC_NO_HOST：当前 Eagle 未将侧栏 IPC 请求转交主窗口，中央展开暂不可用');
  }
  if (!result.mainPage || !result.parentMatches) throw Error('IPC_WRONG_WINDOW：返回的窗口不是当前 Eagle 主窗口，已停止展开');
  if (!result.libraryMatches) throw Error('IPC_LIBRARY_CHANGED：资源库已变化，请重新选择资产');
  if (!result.centralVisible) throw Error('IPC_NO_CENTRAL：当前中央区域不可见，请回到 Eagle 资产列表重试');
  return result;
}

async function open({host, item, pluginDir, parentID, initialSearch=null}) {
  const path = require('path');
  const {pathToFileURL} = require('url');
  if (!Number.isInteger(parentID) || !item?.id) throw Error('当前 Eagle 未提供中央面板入口');
  const ipc = require('electron').ipcRenderer;
  const library = await host.library.path;
  const detailsEntry=path.join(pluginDir,'js','details-panel.cjs');
  delete require.cache[require.resolve(detailsEntry)];
  const detailsFactory=require(detailsEntry).createDetailsPanel;
  const diagnostic={version:'1.0.0',pluginDir,previewBuild:require('crypto').createHash('sha256').update(detailsFactory.toString()).digest('hex').slice(0,12),at:new Date().toISOString(),stage:'probe'};
  const saveDiagnostic=async()=>{
    if (!host.app.userDataPath) return;
    try {
      const fs=require('fs').promises;
      const dir=path.join(host.app.userDataPath,'EagleBridge');
      await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,'central-diagnostic.json'),JSON.stringify(diagnostic,null,2),'utf8');
    } catch {} // Diagnostics must never block the user action.
  };
  try {
  diagnostic.probe=await probeHost(ipc,{parentID,library});
  diagnostic.stage='mount';
  const url = pathToFileURL(path.join(pluginDir, 'central.html'));
  url.searchParams.set('id', item.id);
  url.searchParams.set('theme', host.app.theme || 'GRAY');
  const config = {parentID,name:item.name, library, initialSearch, url:url.href,
    nativeRoot:path.join(process.resourcesPath,'app.asar'),
    preload:pathToFileURL(path.join(process.resourcesPath, 'app.asar', 'app/js/plugin/api-format-extension.js')).href,
    plugin:{path:pluginDir,manifest:require(path.join(pluginDir,'manifest.json'))},
    app:{theme:host.app.theme,version:host.app.version,build:host.app.build,locale:host.app.locale,userDataPath:host.app.userDataPath}};
  const mounted=await ipc.invoke('plugin.window.webContents.',{
    method:'executeJavaScript',value:`(${mountInHost.toString()})(${JSON.stringify(config)},${detailsFactory.toString()})`
  });
  if (mounted !== true) throw Error('IPC_MOUNT_FAILED：中央列表未能挂载');
  diagnostic.stage='mounted';
  await saveDiagnostic();
  return true;
  } catch (error) {
    diagnostic.error=error.message;
    await saveDiagnostic();
    throw error;
  }
}

function close() { require('electron').ipcRenderer.sendToHost('eagle-bridge-close-central'); }
// Dim outside the inspector webview; the guest dims its own contents so the
// preview stays bright. Only live DOM is touched; never block host input.
function dimInspectorInHost(url,active){
  window.__eagleBridgePreviewDim?.remove();window.__eagleBridgePreviewDim=null;
  if(!active)return;
  const normalize=s=>{try{return decodeURIComponent(new URL(s).pathname).toLowerCase();}catch{return '';}};
  const target=normalize(url);if(!target)return;
  const guest=[...document.querySelectorAll('webview')].find(v=>normalize(v.getAttribute('src'))===target);
  if(!guest)return;
  const r=guest.getBoundingClientRect();if(!r.width||!r.height)return;
  const dim=document.createElement('div');
  dim.style.cssText=`position:fixed;pointer-events:none;z-index:10000;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-shadow:0 0 0 100vmax rgba(0,0,0,.18)`;
  document.body.append(dim);window.__eagleBridgePreviewDim=dim;
}
async function dimInspector(url,active){
  await require('electron').ipcRenderer.invoke('plugin.window.webContents.',{method:'executeJavaScript',value:`(${dimInspectorInHost.toString()})(${JSON.stringify(url)},${!!active})`});
}
async function closeFromInspector(){
  await require('electron').ipcRenderer.invoke('plugin.window.webContents.',{
    method:'executeJavaScript',value:'window.__eagleBridgeCentral?.close(); true'
  });
}
function openSettingsInHost(config){
  if(typeof currentWindow==='undefined'||currentWindow.webContents?.id!==config.parentID)throw Error('无法识别 Eagle 主窗口，请重新展开后重试');
  const plugin=typeof pluginModule!=='undefined'&&pluginModule.installedPluginMaps?.[config.id];
  const normalize=value=>String(value||'').replace(/\\/g,'/').replace(/\/$/,'').toLowerCase();
  if(!plugin||normalize(plugin.path)!==normalize(config.pluginDir))throw Error('插件设置入口不可用，请从 Eagle 插件菜单打开');
  pluginModule.open(plugin);return true;
}
async function openSettings(config){
  const opened=await require('electron').ipcRenderer.invoke('plugin.window.webContents.',{
    method:'executeJavaScript',value:`(${openSettingsInHost.toString()})(${JSON.stringify(config)})`
  });
  if(opened!==true)throw Error('无法打开插件设置，请从 Eagle 插件菜单打开');
}
module.exports = {open, close, dimInspector, closeFromInspector, mountInHost, probeInHost, probeHost, openSettings, openSettingsInHost};

