'use strict';

// Eagle updates this webview's src for every selected item. Keep this one
// guest alive and deliver selection data instead. No Eagle files or global
// prototypes are patched; reloads and unrelated URLs keep native behavior.
function installInHost(config) {
  if (typeof currentWindow === 'undefined' || currentWindow.webContents?.id !== config.parentID) return false;
  if (typeof $bodyScope === 'undefined' || $bodyScope.libraryPath !== config.library) return false;
  const guest = [...document.querySelectorAll('webview')].find(node => {
    try { return node.getWebContentsId() === config.windowID; } catch { return false; }
  });
  if (!guest) return false;
  const entry = new URL(config.url);
  const matches = value => {
    try {
      const url = new URL(value, entry);
      return url.protocol === 'file:' && url.host === entry.host && url.pathname === entry.pathname &&
        !!url.searchParams.get('id') && [...url.searchParams.keys()].every(key => ['id','path','width','height','lang','theme'].includes(key));
    } catch { return false; }
  };
  if (guest.getAttribute('src') !== entry.href || !matches(entry.href)) return false;
  if (guest.__eagleBridgeSession) return true;
  const originalSet = guest.setAttribute;
  const ownSet = Object.getOwnPropertyDescriptor(guest, 'setAttribute');
  const ownSrc = Object.getOwnPropertyDescriptor(guest, 'src');
  let proto = guest, srcDescriptor;
  while (proto && !srcDescriptor) { srcDescriptor = Object.getOwnPropertyDescriptor(proto, 'src'); proto = Object.getPrototypeOf(proto); }
  let disposed = false, revision = 0, lastURL = entry.href, lastLibrary = config.library;
  function restore() {
    if (disposed) return;
    disposed = true;
    if (ownSet) Object.defineProperty(guest, 'setAttribute', ownSet); else delete guest.setAttribute;
    if (ownSrc) Object.defineProperty(guest, 'src', ownSrc); else delete guest.src;
    guest.removeEventListener('did-start-navigation', navigating);
    guest.removeEventListener('render-process-gone', restore);
    delete guest.__eagleBridgeSession;
  }
  function navigating(event) { if (event.isMainFrame !== false && !event.isInPlace && !event.isSameDocument) restore(); }
  function update(value) {
    if (disposed) return false;
    if (!matches(value)) { restore(); return false; }
    // Asset changes keep the frame alive, but a plugin update must reload it.
    // Otherwise old action handlers can survive indefinitely in Eagle.
    if(config.sources?.length){
      try{const fs=require('fs');if(config.sources.some(([file,stamp])=>fs.statSync(file).mtimeMs!==stamp)){restore();return false;}}catch{restore();return false;}
    }
    const url = new URL(value, entry).href, library = $bodyScope.libraryPath;
    if (url === lastURL && library === lastLibrary) return true;
    lastURL = url; lastLibrary = library;
    const version = ++revision;
    const selection = {url, library, theme:typeof preferences !== 'undefined' ? preferences.theme?.name : new URL(url).searchParams.get('theme')};
    const fallback = () => {
      if (disposed || version !== revision) return;
      restore(); originalSet.call(guest, 'src', url);
    };
    try {
      Promise.resolve(guest.executeJavaScript(`window.__eagleBridgeReceiveSelection?.(${JSON.stringify(selection)}) === true`))
        .then(accepted => { if (!accepted) fallback(); }, fallback);
    } catch { fallback(); }
    return true;
  }
  Object.defineProperty(guest, 'setAttribute', {configurable:true, writable:true, value:function(name, value) {
    if (String(name).toLowerCase() === 'src' && update(value)) return;
    return originalSet.call(this, name, value);
  }});
  if (srcDescriptor?.get && srcDescriptor?.set && ownSrc?.configurable !== false) {
    Object.defineProperty(guest, 'src', {configurable:true, get:() => srcDescriptor.get.call(guest), set:value => {
      if (!update(value)) srcDescriptor.set.call(guest, value);
    }});
  }
  guest.addEventListener('did-start-navigation', navigating);
  guest.addEventListener('render-process-gone', restore);
  guest.__eagleBridgeSession = {restore};
  return true;
}

async function install(config) {
  if (!Number.isInteger(config.parentID) || !Number.isInteger(config.windowID)) return false;
  const path=require('path'),fs=require('fs'),dir=path.dirname(require('url').fileURLToPath(config.url));
  const sources=['js/app.js','js/central.cjs','js/details-panel.cjs','js/native-preview.cjs','js/zip-preview.cjs','css/app.css','manifest.json'].map(name=>{const file=path.join(dir,name);return [file,fs.statSync(file).mtimeMs];});
  config={...config,sources};
  let timer;
  try {
    return await Promise.race([
      require('electron').ipcRenderer.invoke('plugin.window.webContents.', {
        method:'executeJavaScript', value:`(${installInHost.toString()})(${JSON.stringify(config)})`
      }),
      new Promise(resolve => { timer=setTimeout(()=>resolve(false),3000); })
    ]);
  } finally { clearTimeout(timer); }
}
module.exports = {install, installInHost};
