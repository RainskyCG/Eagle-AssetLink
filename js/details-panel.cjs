'use strict';

// Serialized into the owning Eagle renderer. The file list and preview are
// sibling webviews, so model rendering cannot replace or reload the list.
function createDetailsPanel({panel,bar,webview,config}) {
  const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
  const store='eagle-bridge-details';
  let prefs={open:false,width:320,split:60};
  try{Object.assign(prefs,JSON.parse(localStorage.getItem(store)||'{}'));}catch{}
  let selection=[],revision=0,previewEpoch=0,model=null,video=null,disposed=false,dragCleanup=null,zipCleanup=null,imageCleanup=null,entryCleanup=null;
  const videoFormats=new Set('ts 3gp 360 afx vap eva mp4 mov m4v webm mkv avi wmv mpg mpeg mts flv m2ts f4v ogv'.split(' '));
  const save=()=>{try{localStorage.setItem(store,JSON.stringify(prefs));}catch{}};
  const style=document.createElement('style');
  style.textContent=`
  #eagle-bridge-central .bridge-detail-body{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
  #eagle-bridge-central .bridge-detail-body>webview{width:0!important;min-width:0}
  #eagle-bridge-central .bridge-detail-panel{display:flex;flex-direction:column;min-width:0;flex-shrink:0;background:var(--color-background-primary);font:12px/1.6 sans-serif;overflow:hidden}
  #eagle-bridge-central .bridge-detail-preview{display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative}
  #eagle-bridge-central .bridge-detail-media{display:flex;align-items:center;justify-content:center;flex:1;min-height:0;overflow:hidden;padding:12px;background:var(--color-bg-hover)}
  #eagle-bridge-central .bridge-detail-media img{max-width:100%;max-height:100%;object-fit:contain}
  #eagle-bridge-central .bridge-image-stage{width:100%;height:100%;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;cursor:grab}
  #eagle-bridge-central .bridge-image-stage:active{cursor:grabbing}
  #eagle-bridge-central .bridge-image-stage img{flex-shrink:0;user-select:none;pointer-events:none;transform-origin:center}
  #eagle-bridge-central .bridge-detail-media webview{width:100%;height:100%;flex:1}
  #eagle-bridge-central .bridge-detail-media mpv-video{display:block;width:100%;height:100%;min-height:0;flex:1}
  #eagle-bridge-central .bridge-detail-name{padding:8px 12px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}
  #eagle-bridge-central .bridge-detail-info{flex:1;min-height:0;overflow:auto;padding:12px 14px}
  #eagle-bridge-central .bridge-detail-info h3{font-size:13px;margin:0 0 12px;color:inherit}
  #eagle-bridge-central .bridge-detail-info dl{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px 10px;margin:0}
  #eagle-bridge-central .bridge-detail-info dt{color:var(--color-text-secondary)}
  #eagle-bridge-central .bridge-detail-info dd{margin:0;overflow-wrap:anywhere;user-select:text}
  #eagle-bridge-central .bridge-detail-info.archive{display:flex;flex-direction:column;overflow:hidden}
  #eagle-bridge-central .bridge-detail-info.archive>dl{display:none}
  #eagle-bridge-central .bridge-native-text{margin:0;width:100%;height:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font:13px/1.7 monospace}
  /* Match Eagle's hairline dividers; transparent hit areas remain easy to drag. */
  #eagle-bridge-central .bridge-detail-split,#eagle-bridge-central .bridge-detail-width{position:relative;z-index:2;flex-shrink:0;background:var(--color-border-secondary);touch-action:none;border:0;box-shadow:none}
  #eagle-bridge-central .bridge-detail-split{height:1px;cursor:row-resize}
  #eagle-bridge-central .bridge-detail-width{width:1px;cursor:col-resize}
  #eagle-bridge-central .bridge-detail-split::after{content:'';position:absolute;left:0;right:0;top:-4px;bottom:-4px}
  #eagle-bridge-central .bridge-detail-width::after{content:'';position:absolute;top:0;bottom:0;left:-4px;right:-4px}
  #eagle-bridge-central .bridge-detail-empty{padding:16px;text-align:center;color:var(--color-text-secondary);overflow-wrap:anywhere}
  #eagle-bridge-central .bridge-detail-toggle{margin-left:auto;position:relative;z-index:3;display:grid;place-items:center;width:30px;height:28px;padding:4px;border:0;border-radius:5px;color:inherit;background:var(--color-bg-hover);cursor:pointer;-webkit-app-region:no-drag}
  #eagle-bridge-central .bridge-detail-toggle[aria-pressed=true]{background:var(--color-bg-selected,var(--color-bg-active))}
  #eagle-bridge-central .bridge-detail-toggle svg{width:20px;height:20px}
  #eagle-bridge-central .bridge-zip{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;gap:8px}
  #eagle-bridge-central .bridge-zip-nav{display:flex;align-items:center;gap:6px;flex-shrink:0}
  #eagle-bridge-central .bridge-zip-nav span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #eagle-bridge-central .bridge-zip button{color:inherit;background:var(--color-bg-hover);border:1px solid var(--color-border-secondary);border-radius:4px;padding:5px;cursor:pointer}
  #eagle-bridge-central .bridge-zip-grid{overflow:auto;flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:7px;align-content:start}
  #eagle-bridge-central .bridge-zip-tile{display:flex;flex-direction:column;align-items:center;min-width:0;gap:5px}
  #eagle-bridge-central .bridge-zip-tile[aria-pressed=true]{background:var(--color-bg-selected,var(--color-bg-active));border-color:var(--color-text-secondary)}
  #eagle-bridge-central .bridge-zip-tile img,#eagle-bridge-central .bridge-zip-symbol{height:80px;width:100%;object-fit:contain;display:grid;place-items:center;font-size:17px}
  #eagle-bridge-central .bridge-zip-tile span:last-child{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
  #eagle-bridge-central .bridge-zip-picture{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
  `;
  const toggle=document.createElement('button');toggle.className='bridge-detail-toggle';toggle.title='预览与文件详情';toggle.setAttribute('aria-label',toggle.title);
  toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M18 8v3m0 3v2"/></svg>';
  bar.append(toggle);
  const body=document.createElement('div');body.className='bridge-detail-body';
  const widthHandle=document.createElement('div');widthHandle.className='bridge-detail-width';widthHandle.setAttribute('role','separator');widthHandle.setAttribute('aria-label','调整侧栏宽度');
  const aside=document.createElement('aside');aside.className='bridge-detail-panel';aside.setAttribute('aria-label','预览与文件详情');
  aside.innerHTML='<section class="bridge-detail-preview"><div class="bridge-detail-media"></div><div class="bridge-detail-name"></div></section><div class="bridge-detail-split" role="separator" aria-label="调整预览与详情分隔" aria-orientation="horizontal" tabindex="0"></div><section class="bridge-detail-info"><h3>文件详情</h3><dl></dl></section>';
  const upper=aside.querySelector('.bridge-detail-preview'),media=aside.querySelector('.bridge-detail-media'),name=aside.querySelector('.bridge-detail-name'),info=aside.querySelector('dl'),split=aside.querySelector('.bridge-detail-split');
  panel.append(style,body);body.append(webview,widthHandle,aside);
  const lower=aside.querySelector('.bridge-detail-info'),infoTitle=lower.querySelector('h3');
  let nativeBackend;
  function getNative(){
    if(!nativeBackend){const entry=path.join(config.plugin.path,'js','native-preview.cjs');if(require.resolve&&require.cache)delete require.cache[require.resolve(entry)];nativeBackend=require(entry);}
    return nativeBackend;
  }
  const nativeRoot=config.nativeRoot;
  const theme=()=>String(document.body.getAttribute('theme')||config.app.theme||'gray').toLowerCase();
  function nativeRoute(file){return getNative().route(file,nativeRoot,theme(),config.app.locale||'zh_CN');}
  function viewerFor(file){
    if(typeof pluginModule==='undefined')return null;
    const ext=path.extname(file).slice(1).toLowerCase(),registry=pluginModule.previewExtension;
    const accepts=plugin=>Object.entries(plugin?.manifest?.preview||{}).find(([key,value])=>key.split(',').some(v=>v.trim().toLowerCase()===ext)&&value.viewer?.path);
    const enabled=plugin=>plugin&&(!pluginModule.isPluginDisabled||!pluginModule.isPluginDisabled(plugin.manifest.id));
    const active=registry?.getViewerPlugin?.({ext})||registry?.viewerPluginMap?.[ext];
    const plugin=enabled(active)&&accepts(active)?active:Object.values(pluginModule.installedPluginMaps||{}).reverse().find(p=>enabled(p)&&accepts(p));
    if(!plugin)return null;
    const viewerPath=plugin===active&&registry?.viewerURL?.[ext]||path.join(plugin.path,accepts(plugin)[1].viewer.path);
    return {plugin,url:pathToFileURL(viewerPath)};
  }
  function clearMedia(release=true){previewEpoch++;imageCleanup?.();disposeModel();disposeVideo();if(release){entryCleanup?.();entryCleanup=null;}}
  // These modules live in Eagle's long-lived host renderer. Refresh our own
  // ZIP adapter when opening a new panel, without touching Eagle's modules.
  let zipBackend;
  function getZipBackend(){
    if(!zipBackend){const entry=path.join(config.plugin.path,'js','zip-preview.cjs');if(require.resolve&&require.cache)delete require.cache[require.resolve(entry)];zipBackend=require(entry);}
    return zipBackend;
  }
  function mountImage(image,container){
    imageCleanup?.();
    const stage=document.createElement('div');stage.className='bridge-image-stage';stage.title='滚轮缩放 · 拖动平移 · 双击复位';
    image.draggable=false;stage.append(image);container.replaceChildren(stage);
    let scale=1,x=0,y=0,drag=null;
    const paint=()=>{image.style.transform=`translate(${x}px,${y}px) scale(${scale})`;};
    const wheel=e=>{e.preventDefault();e.stopPropagation();const next=Math.max(.1,Math.min(10,scale*Math.exp(-e.deltaY*.0015)));const r=stage.getBoundingClientRect(),cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2;x=cx-(cx-x)*next/scale;y=cy-(cy-y)*next/scale;scale=next;paint();};
    stage.addEventListener('wheel',wheel,{passive:false});
    stage.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY};stage.setPointerCapture(e.pointerId);};
    stage.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;x+=e.clientX-drag.x;y+=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;paint();};
    stage.onpointerup=stage.onpointercancel=e=>{if(drag&&e.pointerId===drag.id){if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);drag=null;}};
    stage.ondblclick=e=>{e.preventDefault();scale=1;x=y=0;paint();};
    imageCleanup=()=>{stage.removeEventListener('wheel',wheel);stage.onpointerdown=stage.onpointermove=stage.onpointerup=stage.onpointercancel=stage.ondblclick=null;drag=null;imageCleanup=null;};
  }
  function disposeModel(){if(model){model.remove();model=null;}}
  function disposeVideo(){const previous=video;video=null;if(previous){try{previous.pause();}catch{}try{previous.destroy();}catch{}previous.remove();}}
  function videoTheme(){
    if(!video?.theme)return;
    const css=getComputedStyle(aside),get=(key,fallback)=>css.getPropertyValue(key).trim()||fallback;
    video.theme.apply({name:'eagle-bridge',variables:{'controls-bg':get('--color-background-primary','#37383c'),'menu-bg':get('--color-background-primary','#37383c'),'text-color':get('--color-text-primary','#eee'),'button-color':get('--color-text-secondary','#bbb'),'primary-color':get('--color-text-primary','#eee'),'border-color':get('--color-border-secondary','#555')}});
  }
  function showVideo(file,current,alive=()=>current===revision&&!disposed){
    if(!customElements.get('mpv-video')){empty('当前 Eagle 版本未提供内置 MPV 视频播放器，请更新 Eagle 后重试');return;}
    const player=document.createElement('mpv-video');video=player;
    player.setAttribute('controls','');player.setAttribute('controls-mode','always');
    player.autoplay=false;player.volume=Math.max(0,Math.min(1,Number(localStorage.getItem('eagle.videoPlayer.volume')??100)/100));
    player.addEventListener('loadedmetadata',()=>{
      if(!alive()||video!==player)return;
      videoTheme();player.plugins?.get('eagle-notes')?.hideButton();
      if(Number.isFinite(player.duration))detail('时长',Math.floor(player.duration/60)+':'+String(Math.floor(player.duration%60)).padStart(2,'0'));
      if(player.videoWidth&&player.videoHeight)detail('视频尺寸',player.videoWidth+' × '+player.videoHeight);
    },{once:true});
    player.addEventListener('error',()=>{if(alive()){disposeVideo();empty('Eagle 原生播放器无法预览此视频，文件可能损坏或编码不受支持');}});
    media.style.padding='0';media.replaceChildren(player);videoTheme();player.src=pathToFileURL(file).href;
  }
  function empty(text){media.replaceChildren();media.style.padding='12px';const note=document.createElement('div');note.className='bridge-detail-empty';note.textContent=text;media.append(note);}
  function detail(label,value){const term=document.createElement('dt'),valueNode=document.createElement('dd');term.textContent=label;valueNode.textContent=String(value);info.append(term,valueNode);}
  async function showZip(file,current){
    let reader;try{reader=require('yauzl');}catch{}
    const zip=getZipBackend(),data=await zip.list(file,reader);
    if(disposed||current!==revision)return;
    infoTitle.textContent='压缩包内容'+(data.truncated?'（前 20000 项）':'');lower.classList.add('archive');
    const container=document.createElement('div');container.className='bridge-zip';lower.append(container);
    let observer=null,view=0,request=0,selected=-1;
    zipCleanup=()=>{request++;view++;observer?.disconnect();container.remove();};
    const alive=()=>!disposed&&current===revision;
    const button=(text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=action;return b;};
    function browse(dir){
      const token=++view;observer?.disconnect();container.replaceChildren();
      const nav=document.createElement('div');nav.className='bridge-zip-nav';
      nav.append(button('↑',()=>browse(dir.split('/').slice(0,-2).join('/')+(dir.split('/').length>2?'/':''))));nav.firstChild.disabled=!dir;
      const label=document.createElement('span');label.textContent=dir||'压缩包内容';label.title=dir;nav.append(label);container.append(nav);
      const grid=document.createElement('div');grid.className='bridge-zip-grid';container.append(grid);
      observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;observer.unobserve(entry.target);const tile=entry.target,row=data.entries.find(r=>r.index===Number(tile.dataset.index));if(!row||!alive()||token!==view)continue;zip.image(file,row.index,reader).then(src=>{if(!alive()||token!==view)return;const image=document.createElement('img');image.alt=row.name;image.onerror=()=>{image.replaceWith(document.createTextNode('无法预览'));};image.src=src;tile.firstChild.replaceWith(image);}).catch(e=>{if(alive()&&token===view){tile.firstChild.textContent='无法预览';tile.title=row.name+'：'+e.message;}});}},{root:grid,rootMargin:'50px'});
      const folders=new Set();let count=0;
      for(const row of data.entries){
        if(!row.name.startsWith(dir))continue;const rest=row.name.slice(dir.length);if(!rest)continue;
        const slash=rest.indexOf('/'),folder=slash>=0?rest.slice(0,slash):null;if(folder&&folders.has(folder))continue;if(folder)folders.add(folder);
        const tile=button('',()=>folder?browse(dir+folder+'/'):picture(row));tile.className='bridge-zip-tile';tile.title=row.name;tile.dataset.index=folder?-1:row.index;tile.setAttribute('aria-pressed',String(!folder&&selected===row.index));
        const symbol=document.createElement('span');symbol.className='bridge-zip-symbol';symbol.textContent=folder?'▰':row.image?'图片':path.extname(row.name).slice(1).toUpperCase()||'文件';
        const text=document.createElement('span');text.textContent=folder||rest;tile.append(symbol,text);grid.append(tile);count++;
        if(!folder&&row.image)observer.observe(tile);
      }
      if(!count)grid.textContent='压缩包文件夹为空';
    }
    async function picture(row){
      const token=++request;clearMedia();selected=row.index;name.textContent=row.name;name.title=row.name;
      container.querySelectorAll('.bridge-zip-tile').forEach(tile=>tile.setAttribute('aria-pressed',String(Number(tile.dataset.index)===selected)));
      empty('正在读取…');const valid=()=>alive()&&token===request;
      try{
        if(row.image&&!viewerFor(row.name)){
          const src=await zip.image(file,row.index,reader);if(!valid())return;
          const image=document.createElement('img');image.alt=row.name;image.onerror=()=>{if(valid())empty('此图片无法预览');};mountImage(image,media);image.src=src;return;
        }
        if(!viewerFor(row.name)&&nativeRoute(row.name).kind==='unsupported'){empty('Eagle 暂无此格式的可用预览');return;}
        const entry=await zip.materialize(file,row.index,row.name,reader);if(!valid()){void entry.release();return;}
        try{await previewFile(entry.path,current,valid);if(valid())entryCleanup=()=>{void entry.release();};else void entry.release();}
        catch(e){void entry.release();throw e;}
      }catch(e){if(valid())empty('无法预览压缩包条目：'+e.message);}
    }
    browse('');
    const first=data.entries.find(row=>row.image&&!row.directory);
    if(first)void picture(first);else empty('在下方选择文件以预览');
  }
  async function previewFile(file,current,valid=()=>current===revision&&!disposed,skipPlugin=false){
    clearMedia(!skipPlugin);const token=previewEpoch,alive=()=>valid()&&token===previewEpoch;
    const ext=path.extname(file).slice(1).toLowerCase(),registered=skipPlugin?null:viewerFor(file);
    if(registered){
      const {plugin,url}=registered;
      url.searchParams.set('path',file);url.searchParams.set('id','');url.searchParams.set('theme',theme());url.searchParams.set('lang',config.app.locale||'zh_CN');
      const viewer=document.createElement('webview');model=viewer;
      viewer.setAttribute('preload',config.preload);viewer.setAttribute('nodeintegration','');viewer.setAttribute('webpreferences','contextIsolation=false');
      const fallback=()=>{if(alive())void previewFile(file,current,valid,true).catch(e=>{if(valid())empty(e.message);});};
      viewer.addEventListener('will-navigate',e=>e.preventDefault());viewer.addEventListener('did-fail-load',fallback);
      viewer.addEventListener('dom-ready',async()=>{
        if(!alive())return;
        try{
          const env={plugin,app:config.app,library:config.library,parentID:config.parentID,windowID:viewer.getWebContentsId()};
          await viewer.executeJavaScript(`(()=>{const env=${JSON.stringify(env)};window.parentID=env.parentID;window.windowID=env.windowID;Object.assign(eagle.app,env.app);eagle.library.path=env.library;eagle.plugin=env.plugin;global.__dirname=env.plugin.path;const style=document.createElement('style');style.textContent='.thumbnail{display:none!important}';document.head.append(style);eagle.item.getSelected=async()=>[];eagle.item.getById=async()=>null;})()`);
          if(!alive())return;viewer.send('plugin-create',plugin);viewer.send('plugin-run');
        }catch{fallback();}
      },{once:true});
      viewer.setAttribute('src',url.href);media.style.padding='0';media.replaceChildren(viewer);return;
    }
    // Browser-decodable images retain the local zoom/pan surface; other native
    // formats use Eagle's registered decoders and standalone viewer pages.
    let route;
    if(/^(png|jpe?g|webp|gif|bmp|svg|avif|ico)$/.test(ext))route={kind:'image'};
    else if(videoFormats.has(ext))route={kind:'media'};
    else route=nativeRoute(file);
    if(route.kind==='media'){showVideo(file,current,alive);return;}
    if(route.kind==='link'){route={kind:'page',url:await getNative().link(file)};if(!alive())return;}
    if(route.kind==='page'){
      const viewer=document.createElement('webview');model=viewer;
      viewer.setAttribute('webpreferences','contextIsolation=true,sandbox=true');
      viewer.addEventListener('will-navigate',e=>e.preventDefault());
      viewer.addEventListener('did-fail-load',()=>{if(alive()){disposeModel();empty('Eagle 原生查看器加载失败');}});
      viewer.setAttribute('src',route.url);media.style.padding='0';media.replaceChildren(viewer);return;
    }
    if(route.kind==='text'){const value=await getNative().text(file,nativeRoot);if(!alive())return;const pre=document.createElement('pre');pre.className='bridge-native-text';pre.textContent=value;media.replaceChildren(pre);return;}
    if(route.kind==='image'||route.kind==='thumbnail'){
      const image=document.createElement('img');image.alt=path.basename(file);
      image.onload=()=>{if(alive()&&!lower.classList.contains('archive'))detail(route.kind==='thumbnail'?'预览尺寸':'图像尺寸',image.naturalWidth+' × '+image.naturalHeight);};
      image.onerror=()=>{if(alive())empty('Eagle 暂时无法解码此图片');};
      const src=route.kind==='image'?pathToFileURL(file).href:(await getNative().thumbnail(file,nativeRoot)).src;
      if(!alive())return;mountImage(image,media);image.src=src;return;
    }
    empty('Eagle 暂无此格式的可用预览');
  }
  function layout(){
    const width=panel.getBoundingClientRect().width;
    aside.style.width=Math.min(Math.max(180,Number(prefs.width)||320),Math.max(180,width*.6))+'px';
    upper.style.flex='0 0 '+Math.max(20,Math.min(80,Number(prefs.split)||60))+'%';
    split.setAttribute('aria-valuenow',String(Math.round(Number(prefs.split)||60)));
  }
  function visibility(){aside.style.display=prefs.open?'flex':'none';widthHandle.style.display=prefs.open?'block':'none';toggle.setAttribute('aria-pressed',String(!!prefs.open));layout();}
  function drag(handle,horizontal){
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();dragCleanup?.();
      // A host shield keeps pointer events when crossing either guest surface.
      const shield=document.createElement('div');shield.style.cssText='position:fixed;inset:0;z-index:2147483647;cursor:'+(horizontal?'col-resize':'row-resize');document.body.append(shield);
      const move=e=>{const rect=body.getBoundingClientRect();if(horizontal)prefs.width=Math.max(180,Math.min(rect.width*.6,rect.right-e.clientX));else prefs.split=Math.max(20,Math.min(80,(e.clientY-rect.top)/rect.height*100));layout();};
      const end=()=>{shield.remove();window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);dragCleanup=null;save();};
      dragCleanup=end;window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);
    });
  }
  drag(widthHandle,true);drag(split,false);
  split.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();prefs.split=Math.max(20,Math.min(80,prefs.split+(e.key==='ArrowDown'?3:-3)));layout();save();});
  async function show(){
    const current=++revision;zipCleanup?.();zipCleanup=null;clearMedia();info.replaceChildren();infoTitle.textContent='文件详情';lower.classList.remove('archive');name.textContent='';
    if(!prefs.open)return;
    if(selection.length!==1){empty(selection.length?'已选择 '+selection.length+' 个文件':'选择文件以查看预览和详情');if(selection.length)detail('选择数量',selection.length);return;}
    const file=selection[0];name.textContent=path.basename(file);name.title=file;empty('正在读取…');
    try{
      const stat=await fs.promises.stat(file);if(disposed||current!==revision)return;
      const ext=path.extname(file).slice(1).toLowerCase();
      detail('名称',path.basename(file));detail('类型',stat.isDirectory()?'文件夹':(ext.toUpperCase()||'未知')+' 文件');
      if(stat.isFile()){const n=stat.size,i=Math.min(3,Math.floor(Math.log(Math.max(1,n))/Math.log(1024)));detail('大小',(i?(n/1024**i).toFixed(1)+' '+['B','KB','MB','GB'][i]:n+' B')+'（'+n.toLocaleString()+' 字节）');}
      detail('修改时间',stat.mtime.toLocaleString());detail('创建时间',stat.birthtime.toLocaleString());detail('完整路径',file);
      if(stat.isDirectory()){empty('文件夹');return;}
      if(ext==='zip'){await showZip(file,current);return;}
      await previewFile(file,current);
    }catch(error){if(current===revision&&!disposed)empty('无法读取文件：'+error.message);}
  }
  toggle.onclick=()=>{prefs.open=!prefs.open;visibility();save();void show();};
  const observer=new ResizeObserver(layout);observer.observe(panel);visibility();void show();
  return {select(paths){const next=Array.isArray(paths)?paths.filter(p=>typeof p==='string').slice(0,2000):[];if(JSON.stringify(next)===JSON.stringify(selection))return;selection=next;const ext=next.length===1?path.extname(next[0]).slice(1).toLowerCase():'';if(!prefs.open&&(ext==='zip'||videoFormats.has(ext))){prefs.open=true;visibility();save();}if(prefs.open)void show();},dispose(){disposed=true;revision++;zipCleanup?.();clearMedia();dragCleanup?.();observer.disconnect();style.remove();toggle.remove();},theme(){videoTheme();if(model&&prefs.open)void show();}};
}
module.exports={createDetailsPanel};
