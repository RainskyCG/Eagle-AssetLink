/* Eagle host adapter and shared window/inspector UI. No direct metadata writes. */
(() => {
  'use strict';
  const demo = new URLSearchParams(location.search).get('demo')==='1' && !window.eagle;
  const inspector=!!document.body.dataset.inspector;
  const central=!!document.body.dataset.central;
  const command=document.body.dataset.command||'';
  const commandLabels={locate:'定位',expand:'展开',rename:'同步重命名',delete:'同步删除'};
  const root=document.getElementById('app');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let C,fs,path,store,host,item=null,library='',state,view=inspector?'asset':'settings',busy=false,notice='',isError=false,results=null,manual='',draft=null,tool=null,started=false,renameOpen=false,candidatesOpen=false;
  let folderPreview=null,previewLimit=100,choosing=false,selectedPaths=new Set(),selectionAnchor='',keywordIndex=0,draggingFile=false,refreshing=false,lastInspectorHTML='';
  let folderHistory=[],folderForward=[],browserUI=null,contextMenu=null,pendingNavigation=null;
  let pendingSelection=null,switchingSelection=false,polling=false,inspectorReady=false;
  let composingSearch=false,pathNeedsSync=false;
  let matchGroups=[],searchCompletedAt=0;
  // Called by our scoped host adapter; accepting a selection never navigates
  // the document. Serialize with user actions and coalesce rapid selections.
  window.__eagleBridgeReceiveSelection=selection=>{
    if(!inspector||central||!host||!selection?.url)return false;
    const next=new URL(selection.url),current=new URL(location.href);
    if(next.origin!==current.origin||next.pathname!==current.pathname||!next.searchParams.get('id'))return false;
    pendingSelection=selection;root.inert=true;closeImagePreview();closeFileMenu();
    void drainSelection();return true;
  };
  async function drainSelection(){
    if(!inspectorReady||!pendingSelection||busy||refreshing||polling||switchingSelection)return;
    switchingSelection=true;root.inert=true;
    try{
      while(pendingSelection){
        const next=pendingSelection;pendingSelection=null;
        history.replaceState(null,'',next.url);
        if(next.library)host.library.path=next.library;
        if(next.theme){host.app.theme=next.theme;applyTheme(next.theme);}
        try{await refresh();}catch(e){message(e.message||String(e),true);}
      }
    }finally{switchingSelection=false;render();}
  }
  function restoreExpansion(){if(central){candidatesOpen=true;return;}try{candidatesOpen=localStorage.getItem('eagle-bridge-results-open')==='true';}catch{}}
  function toggleExpansion(){candidatesOpen=!candidatesOpen;try{localStorage.setItem('eagle-bridge-results-open',String(candidatesOpen));}catch{}}
  const binding=()=>item&&state?.bindings[C.keyFor(library,item.id)];
  let draggedPriority=null,settingsTab='tools',pluginDir='';
  let tagPickerOpen=false,tagQuery='',availableTags=[],tagLoadError='',formatOpen=false;
  const directorySelection={roots:0,searchRoots:0};
  const label=x=>x==='folder'?'文件夹':x==='other'?'其他文件':x.toLowerCase();
  function icon(name){
    const shapes={expand:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M3 3l6 6m12-6-6 6m6 12-6-6M3 21l6-6"/>',folder:'<path d="M3 8V5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2"/><path d="M3 9h18l-3 11H3L1 9z"/>',rename:'<path d="m14 4 6 6M4 20l5-1L21 7a2 2 0 0 0-6-6L3 13l-1 6z"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',config:'<path d="M12 2 20.7 7v10L12 22 3.3 17V7z"/><circle cx="12" cy="12" r="3.5"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',rules:'<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11M8 3v6m6 0v6M6 15v6"/>',search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',shortcut:'<path d="M8 8H5a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H8z"/>'};
    return `<svg class="bridge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]||''}</svg>`;
  }
  function fileIcon(row){
    const ext=path.extname(row.path).slice(1).toLowerCase();
    const groups={blend:['blend','blend1','blend2'],image:['png','jpg','jpeg','webp','gif','bmp','tif','tiff','exr','hdr','svg','psd','avif','ico'],movie:['mp4','mov','avi','mkv','webm'],sound:['wav','mp3','flac','ogg','m4a'],font:['ttf','otf','woff','woff2'],text:['txt','md','json','xml','csv','srt','vtt','log','py','js'],archive:['zip','rar','7z','tar','gz'],'3d':['fbx','obj','glb','gltf','max','ma','mb','stl','usd','usdz']};
    const kind=row.type==='folder'?'folder':Object.keys(groups).find(k=>groups[k].includes(ext))||'blank';
    return '<i class="bridge-icon blender-icon icon-'+kind+'" data-icon-kind="'+kind+'" aria-hidden="true"></i>';
  }
  function applyTheme(theme){const t=String(theme||'GRAY').toLowerCase();document.body.setAttribute('theme',t);document.body.classList.toggle('light',['light','lightgray'].includes(t));}
  // The embedded central view is not a registered Eagle plugin window, so its
  // host forwards resolved native tokens as well as the current theme name.
  window.addEventListener('bridge-theme-change',e=>{
    applyTheme(e.detail.theme);
    for(const [name,value] of Object.entries(e.detail.colors||{}))
      if(name.startsWith('--'))document.body.style.setProperty(name,value);
  });
  function setBrowserLevel(value){if(!central||!browserUI)return;browserUI.setViewLevel(value);closeImagePreview();render();}
  window.addEventListener('bridge-size-change',e=>setBrowserLevel(e.detail));
  let wheelLevelAt=0;
  window.addEventListener('wheel',e=>{if(!central||!e.ctrlKey)return;e.preventDefault();if(!e.deltaY||Date.now()-wheelLevelAt<80)return;wheelLevelAt=Date.now();setBrowserLevel(browserUI.viewLevel()+(e.deltaY<0?1:-1));},{passive:false});

  function message(text,error=false){notice=text;isError=error;}
  function button(action,text,cls='',disabled=false){return `<button data-action="${action}" class="${cls}" ${disabled?'disabled':''}>${text}</button>`;}
  async function guard(fn){if(busy||switchingSelection||pendingSelection)return;busy=true;if(inspector)root.inert=true;else render();try{await fn();}catch(e){message(e.message||String(e),true);}finally{busy=false;if(pendingSelection)void drainSelection();else render();}}

  function browserSnapshot(){return {preview:folderPreview,choosing,selected:[...selectedPaths],anchor:selectionAnchor,limit:previewLimit,x:window.scrollX,y:window.scrollY};}
  function restoreBrowser(saved){closeImagePreview();closeFileMenu();browserUI?.reset();folderPreview=saved.preview;choosing=saved.choosing;selectedPaths=new Set(saved.selected);selectionAnchor=saved.anchor;previewLimit=saved.limit;pendingNavigation=saved;}
  async function browsePath(p){
    pathNeedsSync=true;
    p=p.trim().replace(/^"([\s\S]*)"$/,'$1');
    const current=await C.snapshot(p);if(current.type!=='folder')throw Error('请输入文件夹路径');
    await openListEntry(current);
  }
  function centralHTML(b){
    let rows=[];
    if(choosing)rows=(results?.rows||[]).map((r,i)=>({...r,action:'data-candidate="'+i+'"',current:b&&C.samePath(b.path,r.path)}));
    else if(folderPreview)rows=folderPreview.rows.map((r,i)=>({...r,action:'data-folder-entry="'+i+'"',current:C.samePath(r.path,folderPreview.eagle?folderPreview.itemPath||'':b?.path||results?.rows[0]?.path||'')}));
    return browserUI.render({rows,dir:choosing?'':folderPreview?.dir||'',eagle:!!folderPreview?.eagle,choosing,back:folderHistory.length>0,forward:folderForward.length>0,notice,isError,limit:previewLimit,canUp:canNavigateParent()});
  }
  function locatorHTML(b){
    let h='<div class="inspector-bar">'+button('locate',icon('folder')+'定位','inspector-button ic-btn has-bg',busy||!item);
    // Mutation buttons are intentionally hidden in the inspector; command entries remain available.
    h+='</div>'+(central?'':'<div class="inspector-bar central-launch">'+button('central-open',icon('expand')+'展开','inspector-button ic-btn has-bg',busy||!item)+'</div>')+'<div class="candidate-toggle-row">'+(central?button('central-refresh','刷新列表','quiet small'):'')+'<button data-action="candidates" class="candidate-toggle" title="展开候选结果" aria-label="展开候选结果" aria-expanded="'+candidatesOpen+'">'+(candidatesOpen?'▴':'▾')+'</button>';
    h+='</div>';
    if(notice&&(isError||!inspector))h+='<div role="status" class="notice '+(isError?'error':'')+'">'+esc(notice)+'</div>';
    if(candidatesOpen&&matchGroups.length&&!folderPreview?.browsing){
      for(const [index,group] of matchGroups.entries()){
        const locked=b?.locked&&C.samePath(b.path,group.dir);
        h+='<section class="match-group"><header title="'+esc(group.dir)+'"><span>'+esc(path.basename(group.dir)||group.dir)+'</span>'+(matchGroups.length>1?'<button data-select-group="'+index+'" '+(locked?'disabled':'')+'>'+(locked?'已关联':'选择并关联')+'</button>':'')+'</header><div class="candidate-list">';
        for(const [rowIndex,row] of group.rows.entries())h+='<button class="candidate '+(group.matches.some(m=>C.samePath(m.path,row.path))?'current':'')+'" draggable="true" data-group="'+index+'" data-group-row="'+rowIndex+'" title="'+esc(row.path)+'">'+fileIcon(row)+'<span>'+esc(path.basename(row.path))+'</span></button>';
        if(group.error)h+='<p class="help">'+esc(group.error)+'</p>';
        h+='</div></section>';
      }
      return h;
    }
    if(candidatesOpen&&(!results||results.rows.length||folderPreview?.eagle)){
      if(b?.locked)h+='<div class="folder-navigation"><span>已关联目录</span>'+button('choose-other-group','重新选择','quiet small')+'</div>';
      h+='<div class="candidate-list '+(folderPreview?.eagle?'eagle-fallback':'')+'" aria-label="候选结果">';
      if(folderPreview?.eagle)h+='<div class="library-marker" title="当前素材在 Eagle 资产库中的 .info 文件夹">Eagle库文件列表</div>';
      if(choosing)h+='<p class="help">找到多个匹配项，单击选择，双击定位。颜色标记表示上次定位。</p>';
      if(!choosing&&(central||state.settings.previewFolder||folderPreview?.eagle||folderPreview?.browsing)&&folderPreview&&!folderPreview.error){h+=folderPreviewHTML(b);}
      else if(results){
        for(let i=0;i<results.rows.length;i++){const r=results.rows[i];const current=b&&C.samePath(b.path,r.path);
          h+='<button draggable="true" class="candidate '+(current?'current':'')+'" data-candidate="'+i+'" title="'+esc(r.path)+'">'+fileIcon(r)+'<span>'+esc(path.basename(r.path))+'</span></button>';}

        if(results.issues?.length)h+='<p class="help">'+esc(results.issues.join('；'))+'</p>';
      }else h+='<p class="help">'+(busy?'正在查找…':'点击定位 定位本地资产。')+'</p>';
      if(state.settings.previewFolder&&folderPreview?.error)h+='<p class="help">'+esc(folderPreview.error)+'</p>';
      h+='</div>';
    }
    if(renameOpen&&b)h+='<div class="row rename-form"><input id="rename-name" class="grow" value="'+esc(b.type==='file'?path.parse(b.path).name:path.basename(b.path))+'" aria-label="新名称">'+button('rename-confirm','预览并确认')+'</div>';
    return h;
  }
  function folderPreviewHTML(b){
    if(b?.status==='local-trashed')b=null;
    const target=folderPreview.browsing?null:folderPreview.eagle?(folderPreview.itemPath?{path:folderPreview.itemPath}:null):b||results?.rows[0];
    const rows=(folderPreview.browsing?[]:results?.rows||[]).map((r,i)=>({...r,action:'data-candidate="'+i+'"'}));
    if(!folderPreview.eagle&&target&&!rows.some(r=>C.samePath(r.path,target.path)))rows.unshift({...target,action:'data-action="locate"'});
    folderPreview.rows.forEach((r,i)=>{if(!rows.some(v=>C.samePath(v.path,r.path)))rows.push({...r,action:'data-folder-entry="'+i+'"'});});
    let h=folderPreview.browsing?'<div class="folder-navigation">'+button('folder-back','‹ 返回','quiet small')+'<span title="'+esc(folderPreview.dir)+'">'+esc(path.basename(folderPreview.dir))+'</span></div>':'';
    if(folderPreview.browsing&&!rows.length)h+='<p class="help">文件夹为空</p>';
    for(const r of rows.slice(0,previewLimit)){const current=target&&C.samePath(target.path,r.path);h+='<button draggable="true" class="candidate '+(current?'current':'')+'" '+r.action+' title="'+esc(r.path)+'" '+(current?'aria-current="true"':'')+'>'+fileIcon(r)+'<span>'+esc(path.basename(r.path))+'</span></button>';}
    if(results?.issues?.length)h+='<p class="help">'+esc(results.issues.join('；'))+'</p>';
    if(rows.length>previewLimit)h+=button('more-folder','显示更多（剩余 '+(rows.length-previewLimit)+' 项）','quiet small');
    return h;
  }
  async function loadFolderPreview(ignoreLock=false){
    folderHistory=[];folderForward=[];
    folderPreview=null;previewLimit=100;
    matchGroups=[];
    if(results&&!results.rows.length){
      try{folderPreview=await C.listEagleFolder(item,library,{details:central});}catch{message('没有找到本地资产，且无法读取此素材的 Eagle 库内文件夹。',true);}
      return;
    }
    const locked=binding();
    if(!ignoreLock&&locked?.locked&&results?.rows.some(r=>C.samePath(r.path,locked.path)||C.samePath(r.type==='folder'?r.path:path.dirname(r.path),locked.path))&&await C.bindingValid(locked)){
      folderPreview=await C.listAssetFolder(locked,{details:central});folderPreview.browsing=true;choosing=false;return;
    }
    if(!central&&results?.rows.length>1){
      const groups=new Map();
      for(const row of results.rows){const dir=row.type==='folder'?row.path:path.dirname(row.path),key=dir.toLowerCase();if(!groups.has(key))groups.set(key,{dir,matches:[],rows:[]});groups.get(key).matches.push(row);}
      matchGroups=[...groups.values()];
      for(let offset=0;offset<matchGroups.length;offset+=4)await Promise.all(matchGroups.slice(offset,offset+4).map(async group=>{try{const listing=await C.listAssetFolder({path:group.dir,type:'folder'});group.rows=listing.rows;}catch{group.rows=group.matches;group.error='无法读取目录，显示匹配文件。';}}));
      choosing=true;return;
    }
    if(!central&&!state.settings.previewFolder)return;
    if(central&&results?.rows.length>1){choosing=true;return;}
    const target=central?results?.rows[0]:binding()||results?.rows[0];if(!target)return;
    try{folderPreview=await C.listAssetFolder(target,{details:central});}catch{folderPreview={error:'无法读取文件夹内容，请检查路径、网络连接或访问权限。'};}
  }
  let imagePreview=null,previewTimer=null,previewBackdrop=null;
  function setPreviewDim(active){
    if(demo||!pluginDir)return;
    if(central)require('electron').ipcRenderer.sendToHost('eagle-bridge-preview-dim',active);
    else if(inspector)require(path.join(pluginDir,'js','central.cjs')).dimInspector(location.href,active).catch(()=>{});
  }
  function closeImagePreview(){clearTimeout(previewTimer);previewTimer=null;if(imagePreview){imagePreview.remove();}imagePreview=null;previewBackdrop?.remove();previewBackdrop=null;setPreviewDim(false);}
  window.addEventListener('pagehide',closeImagePreview);
  let columnCanvasObserver=null;
  function decoratePreviews(){
    columnCanvasObserver?.disconnect();
    const horizontal=root.querySelector('.browser-files.view-compact');
    if(horizontal){
      const syncColumns=()=>{const width=parseFloat(getComputedStyle(horizontal).gridTemplateColumns);if(width>0)horizontal.style.setProperty('--horizontal-column-width',width+'px');};
      syncColumns();columnCanvasObserver=new ResizeObserver(syncColumns);columnCanvasObserver.observe(horizontal);
    }

    root.querySelectorAll('img[data-tiff]').forEach(img=>{if(img.dataset.loading)return;img.dataset.loading='true';require(path.join(pluginDir,'js','tiff-preview.cjs')).preview(img.dataset.tiff).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{img.remove();});});
    if(central&&!demo)require('electron').ipcRenderer.sendToHost('eagle-bridge-size-state',browserUI.viewLevel());
    const popup=root.querySelector('.browser-filters'),filterButton=root.querySelector('[data-action="browser-filter"]');
    if(popup&&filterButton){const r=filterButton.getBoundingClientRect();popup.style.top=Math.min(r.bottom+6,Math.max(4,innerHeight-popup.offsetHeight-4))+'px';popup.style.left=Math.max(4,Math.min(r.right-popup.offsetWidth,innerWidth-popup.offsetWidth-4))+'px';}

    root.querySelectorAll('.candidate').forEach(el=>{if(el.querySelector('.file-preview-trigger')||! /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)$/i.test(el.title))return;
      const trigger=el.querySelector(':scope > .bridge-icon, .browser-thumb > .bridge-icon');if(!trigger)return;
      trigger.classList.add('file-preview-trigger');trigger.tabIndex=0;trigger.setAttribute('role','button');trigger.setAttribute('aria-label','预览文件');trigger.title='预览文件';
      const show=()=>{closeImagePreview();
        previewTimer=setTimeout(()=>{
          const panel=document.createElement('div');panel.className='local-image-preview';
          const height=Math.max(60,Math.min(central?600:320,central?innerHeight*.7:innerHeight-20));
          panel.style.height=height+'px';panel.style.width=Math.max(80,Math.min(central?800:360,central?innerWidth*.7:innerWidth-48))+'px';panel.style.top=Math.max(8,Math.min(trigger.getBoundingClientRect().top-height-8,innerHeight-height-8))+'px';if(central){const rect=trigger.getBoundingClientRect(),width=parseFloat(panel.style.width);panel.style.left=Math.max(8,Math.min(rect.left-width-12,innerWidth-width-12))+'px';}
          panel.setAttribute('role','img');panel.setAttribute('aria-label',path.basename(el.title));
          const img=document.createElement('img');img.alt=path.basename(el.title);
          img.onerror=()=>{panel.textContent='此文件暂时无法预览';};
          if(!demo&&/\.tiff?$/i.test(el.title)){require(path.join(pluginDir,'js','tiff-preview.cjs')).preview(el.title).then(src=>{if(panel.isConnected)img.src=src;}).catch(()=>{if(panel.isConnected)panel.textContent='此 TIFF 暂时无法预览';});}
          else img.src=demo?'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#555"/></svg>'):require('url').pathToFileURL(el.title).href;
          panel.appendChild(img);previewBackdrop=document.createElement('div');previewBackdrop.className='preview-backdrop';document.body.append(previewBackdrop,panel);imagePreview=panel;
          setPreviewDim(true);
        },150);
      };
      trigger.addEventListener('mouseenter',show);trigger.addEventListener('focus',show);trigger.addEventListener('mouseleave',closeImagePreview);trigger.addEventListener('blur',closeImagePreview);trigger.addEventListener('click',e=>{e.stopPropagation();show();});trigger.addEventListener('dblclick',e=>e.stopPropagation());
    });
  }
  let lastDetailSelection='';
  function paintSelection(){root.querySelectorAll('.candidate').forEach(el=>{const selected=selectedPaths.has(el.title);el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});
    if(central&&!demo){const paths=[...root.querySelectorAll('.candidate')].filter(el=>selectedPaths.has(el.title)).map(el=>el.title),key=JSON.stringify(paths);if(key!==lastDetailSelection){lastDetailSelection=key;require('electron').ipcRenderer.sendToHost('eagle-bridge-file-selection',paths);}}
  }
  function render(){
    if(!state||refreshing||switchingSelection||pendingSelection||composingSearch)return;
    const b=binding();const visible=item&&C.eligible(item,b,state.settings);
    if(inspector&&!central&&!visible){root.innerHTML='';lastInspectorHTML='';try{sessionStorage.removeItem('bridge-frame');}catch{}return;}
    let html=demo?'<div class="preview-banner">界面演示 · 不会读写 Eagle 或本地资产</div>':'';
    if(central)html+=centralHTML(b);
    else if(inspector)html+=locatorHTML(b);
    else if(command){
      html+='<main class="command-shell"><h2>'+commandLabels[command]+'</h2>';
      if(choosing||folderPreview?.eagle)html+=locatorHTML(b);
      if(notice&&!folderPreview?.eagle)html+='<div role="status" class="notice '+(isError?'error':'')+'">'+esc(notice)+'</div>';
      if(renameOpen&&b)html+='<p>'+esc(item.name)+'</p><p class="path">'+esc(b.path)+'</p><label class="field"><span>新名称</span><input id="rename-name" value="'+esc(b.type==='file'?path.parse(b.path).name:path.basename(b.path))+'"></label>'+button('rename-confirm','预览并确认','primary');
      html+='</main>';
    }else html+=settingsHTML();
    if(inspector){
      if(html!==lastInspectorHTML){
        const temp=document.createElement('div');temp.innerHTML=html;
        const bars=[...root.querySelectorAll(':scope > .inspector-bar')];
        if(central&&root.querySelector('.browser-layout')){
          // Never detach the live toolbar: doing so resets selection, undo and
          // IME state, even if the same input is reinserted and focused later.
          const layout=root.querySelector('.browser-layout'),next=temp.querySelector('.browser-layout');
          layout.className=next.className;
          layout.setAttribute('style',next.getAttribute('style'));
          const stable=[...layout.children].filter(node=>node.matches('.browser-toolbar,.browser-size-bar'));
          for(const section of stable){
            const fresh=next.querySelector('.'+section.className);
            const controls=[...fresh.querySelectorAll('button,input')];
            section.querySelectorAll('button,input').forEach((control,i)=>{
              const desired=controls[i];
              control.disabled=desired.disabled;
              if(control.tagName==='INPUT'){
                control.readOnly=desired.readOnly;
                const editing=control===document.activeElement&&(control.id==='browser-search'||(control.id==='browser-path'&&!pathNeedsSync&&control.defaultValue===desired.value));
                if(!editing&&control.value!==desired.value)control.value=desired.value;
                if(control.id==='browser-path')control.defaultValue=desired.value;
                control.title=desired.title;
              }else if(desired.hasAttribute('aria-pressed'))control.setAttribute('aria-pressed',desired.getAttribute('aria-pressed'));
            });
          }
          for(const child of [...layout.children])if(!stable.includes(child))child.remove();
          let cursor=layout.firstChild;
          for(const child of [...next.children]){
            const node=stable.find(saved=>saved.className===child.className)||child;
            if(node===cursor)cursor=cursor.nextSibling;else layout.insertBefore(node,cursor);
          }
        }else if(!central&&bars.length&&temp.querySelector('.inspector-bar')){
          for(const child of [...root.children])if(!bars.includes(child))child.remove();
          let cursor=root.firstChild;
          for(const child of [...temp.children]){
            const action=child.matches('.inspector-bar')&&child.querySelector('[data-action]')?.dataset.action;
            const saved=action&&bars.find(bar=>bar.querySelector('[data-action]')?.dataset.action===action);
            const node=saved||child;
            if(node===cursor)cursor=cursor.nextSibling;else root.insertBefore(node,cursor);
          }
        }else root.innerHTML=html;
        lastInspectorHTML=html;
      }
      root.inert=busy;
    }else if(root.innerHTML!==html)root.innerHTML=html;
    root.querySelectorAll("img[data-thumbnail]").forEach(img=>{img.onerror=()=>img.remove();});
    decoratePreviews();paintSelection();
    if(inspector&&!central&&!busy)try{sessionStorage.setItem('bridge-frame',JSON.stringify({open:candidatesOpen,eagle:!!folderPreview?.eagle,theme:document.body.getAttribute('theme'),rows:[...root.querySelectorAll('.candidate')].map(el=>({name:el.querySelector('span')?.textContent||el.textContent,path:el.title,current:el.classList.contains('current'),selected:el.classList.contains('selected'),iconKind:el.querySelector('[data-icon-kind]')?.dataset.iconKind,icon:[...el.querySelectorAll('svg > *')].map(n=>({tag:n.localName,attrs:Object.fromEntries([...n.attributes].map(a=>[a.name,a.value]))}))}))}));}catch{}
    root.querySelectorAll('button').forEach(el=>{if(busy)el.disabled=true;});
    root.querySelectorAll('.inspector-bar > button').forEach(el=>el.disabled=busy||!item);
    pathNeedsSync=false;
    if(pendingNavigation){const saved=pendingNavigation;pendingNavigation=null;requestAnimationFrame(()=>{const row=[...root.querySelectorAll('.candidate')].find(el=>el.title===saved.focus);row?.focus({preventScroll:true});window.scrollTo(saved.x,saved.y);});}
  }
  function directoryHTML(key,title,help){
    const s=draft||state.settings,rows=s[key];
    directorySelection[key]=Math.max(0,Math.min(directorySelection[key],rows.length-1));
    const selected=directorySelection[key],p=rows[selected];
    let h=`<section class="settings-card"><h2>${title}</h2><p class="help">${help}</p><div class="directory-control"><div class="directory-list" role="listbox" aria-label="${title}">`;
    rows.forEach((v,i)=>h+=`<button type="button" role="option" aria-selected="${i===selected}" data-directory="${key}" data-index="${i}" class="directory-row ${i===selected?'selected':''}" title="${esc(v)}">${icon('folder')}<span>${esc(path.basename(v)||v||'新目录')}</span></button>`);
    if(!rows.length)h+='<p class="directory-empty">尚未添加目录</p>';
    h+=`</div><div class="directory-tools"><button data-directory-add="${key}" title="添加目录" aria-label="添加${title}">＋</button><button data-directory-remove="${key}" title="移除目录（不会删除文件）" aria-label="移除${title}" ${rows.length?'':'disabled'}>−</button></div></div>`;
    if(p!==undefined)h+=`<div class="field editor-field"><label for="${key}-path">路径</label><div class="path-input"><input id="${key}-path" value="${esc(p)}" placeholder="本地目录或网络共享路径"><button data-directory-pick="${key}" class="path-browse" title="选择目录" aria-label="选择${title}路径">${icon('folder')}</button></div></div>`;
    return h+'</section>';
  }
  function tagMatches(tag,q){
    const terms=[tag.name,tag.pinyin,tag.name.replace(/([a-z])([A-Z])/g,'$1 $2').split(/[\s_-]+/).map(x=>x[0]||'').join(''),String(tag.pinyin||'').split(/[\s_-]+/).map(x=>x[0]||'').join('')].map(x=>String(x||'').toLowerCase());
    return terms.some(t=>{let i=0;for(const c of t)if(c===q[i])i++;return !q||t.includes(q)||i===q.length;});
  }
  function tagResultsHTML(){
    const q=tagQuery.trim().toLowerCase(),tags=availableTags.filter(t=>tagMatches(t,q));
    let h=tags.slice(0,120).map(t=>`<button type="button" class="tag-choice" data-tag-choice="${esc(t.name)}">${esc(t.name)}</button>`).join('');
    if(tagQuery.trim()&&!availableTags.some(t=>t.name===tagQuery.trim()))h+=`<button class="tag-create" data-tag-choice="${esc(tagQuery.trim())}">＋ 使用新标签「${esc(tagQuery.trim())}」</button>`;
    if(!h)h='<p class="help">输入标签名称以添加。</p>';
    if(tagLoadError)h+='<p class="help">'+esc(tagLoadError)+'</p>';
    return h;
  }
  function tagFieldHTML(s){return `<div class="field tag-field"><span>关联标签</span><button type="button" data-action="pick-tag" class="tag-field-button" aria-label="选择关联标签" aria-expanded="${tagPickerOpen}"><span class="tag-choice">${esc(s.tag)}</span><span class="tag-plus">＋</span></button>${tagPickerOpen?`<div class="tag-popover" role="dialog" aria-label="选择关联标签"><input id="tag-search" placeholder="搜索或输入新标签…" aria-label="搜索标签" autocomplete="off" value="${esc(tagQuery)}"><div id="tag-results" class="tag-results">${tagResultsHTML()}</div><p class="help">新名称用于关联规则，不会修改当前资产的标签。</p></div>`:''}</div>`;}
  async function loadTags(){
    const lib=library;tagLoadError='';
    try{if(!host.tag?.get)throw Error('当前环境无法读取标签，可直接输入新名称。');const tags=await host.tag.get();if(lib!==library)return;availableTags=tags.map(t=>typeof t==='string'?{name:t}:t).filter(t=>t?.name);}
    catch(e){tagLoadError=e.message;}
    const results=document.getElementById('tag-results');if(results)results.innerHTML=tagResultsHTML();
  }
  function settingsHTML(){
    const s=draft||state.settings;
    const field=(id,title,val)=>`<label class="field"><span>${title}</span><input id="${id}" value="${esc(val)}"></label>`;
    const file=(id,title,val,action)=>`<div class="field"><label for="${id}">${title}</label><div class="path-input"><input id="${id}" value="${esc(val)}"><button data-action="${action}" class="path-browse" title="选择${title}" aria-label="选择${title}">${icon('folder')}</button></div></div>`;
    const check=(id,title,value)=>`<label class="check"><input id="${id}" type="checkbox" ${value?'checked':''}>${title}</label>`;
    const tabs=[['tools','配置'],['matching','定位规则'],['manager','文件管理器'],['shortcuts','快捷键']];
    let h='<main class="preferences"><aside class="preferences-nav"><h1>偏好设置</h1><p class="preferences-subtitle">Eagle AssetLink<br><span>本地资产浏览器</span></p><nav aria-label="设置分类">';
    for(const [id,title] of tabs)h+=`<button data-tab="${id}" class="nav-item ${settingsTab===id?'active':''}" aria-current="${settingsTab===id?'page':'false'}">${icon(({directories:'folder',matching:'rules',tools:'config',shortcuts:'shortcut',manager:'folder'})[id])}<span>${title}</span></button>`;
    h+='</nav></aside><div class="preferences-main">';
    h+=`<header class="preferences-heading"><h2>${tabs.find(t=>t[0]===settingsTab)[1]}</h2><button data-action="close-settings" class="preferences-close" title="关闭设置" aria-label="关闭设置">${icon('close')}</button></header><div class="preferences-content">`;
    if(settingsTab==='matching'){


      h+='<section class="settings-card"><h2 title="从左到右、从上到下依次降低，拖动排序，点 × 移除优先级。多个结果按此顺序列出，单击选择，双击定位并记录。">定位优先级</h2><div class="priority" role="group" aria-label="定位优先级" title="从左到右、从上到下排列优先级；拖动排序，点 × 移除。">';
      s.priority.forEach((p,i)=>h+=`<div class="priority-chip label-item" tabindex="0" draggable="true" data-priority="${esc(p)}" title="拖动排序；Alt + 左右方向键移动" aria-label="${esc(label(p))}，优先级 ${i+1}"><span class="label-item-name">${esc(label(p))}</span><button type="button" draggable="false" class="ic-btn label-item-remove-btn" data-remove-priority="${esc(p)}" aria-label="删除 ${esc(label(p))} 优先级" title="删除优先级">${icon('close')}</button></div>`);
      h+=`<button data-action="toggle-format" class="priority-add" title="添加扩展名" aria-label="添加扩展名" aria-expanded="${formatOpen}">＋</button></div>${formatOpen?`<div class="format-popover" role="dialog" aria-label="添加扩展名"><input id="new-format" placeholder="例如 max" aria-label="新扩展名">${button('add-format','添加','small')}${button('toggle-format','取消','quiet small')}</div>`:''}<p class="help">移除仅取消优先排序，该格式仍参与查找。</p></section>`;
      h+=`<section class="settings-card"><h2>名称清理</h2><div title="匹配时忽略下方关键词，不区分大小写，不修改真实文件名。">${check('clean-enabled','忽略关键词',s.cleanEnabled)}</div><div class="field"><div class="directory-control"><div class="keyword-list">${s.keywords.map((word,i)=>`<input data-keyword="${i}" aria-label="关键词 ${i+1}" value="${esc(word)}">`).join('')}</div><div class="keyword-actions">${button('add-keyword','＋','quiet')}${button('remove-keyword','−','quiet')}</div></div></div><label class="field"><span>匹配位置</span><select id="clean-mode"><option value="suffix" ${s.cleanMode==='suffix'?'selected':''}>仅名称末尾</option><option value="anywhere" ${s.cleanMode==='anywhere'?'selected':''}>名称任意位置</option></select></label></section>`;
    }else if(settingsTab==='manager'){
      h+=`<section class="settings-card"><h2>文件管理器</h2><label class="field"><span>双击行为</span><select id="double-click-action"><option value="default" ${s.doubleClickAction!=='reveal'?'selected':''}>默认应用打开</option><option value="reveal" ${s.doubleClickAction==='reveal'?'selected':''}>在文件资源管理器中打开</option></select></label></section>`;
    }else if(settingsTab==='tools'){
      h+=`<section class="settings-card"><div class="row spread"><h2>Everything</h2>${button('download','手动下载配置','quiet small')}</div><p class="tool-state">${tool?tool.ready?'● 已就绪 · '+esc(tool.version):'○ 查询尚未就绪':'检测本机已有工具，支持便携版。'}</p>${file('everything-path','Everything 程序',s.everythingPath,'choose-everything')}${file('es-path','es.exe 命令行工具',s.esPath,'choose-es')}<div class="row">${button('detect','检测并连接')}${(!tool?.everythingPath||!tool?.esPath)?button('setup-tools','自动配置 Everything'):''}</div></section>`;
      h+=directoryHTML('roots','资产库目录','设置本地源资产所在的目录。');
      h+=`<section class="settings-card"><h2>侧栏显示</h2><div title="展开结果时显示目标文件夹内，或目标文件所在文件夹的直接子项。">${check('preview-folder','预览资产文件夹内容',s.previewFolder)}</div>${check('hide-untagged','对未标签资产默认隐藏',s.hideUntagged)}${s.hideUntagged?tagFieldHTML(s):''}</section>`;
    }else{
      h+='<section class="settings-card"><h2>Eagle 原生快捷键</h2><p class="help">在 Eagle 偏好设置中统一录制、修改和清除快捷键。</p><div class="shortcut-list">';
      for(const [id,title] of Object.entries(commandLabels))h+=`<div class="shortcut-row"><span>${icon(id==='locate'?'folder':id==='rename'?'rename':'trash')} ${title}</span><span class="help">Eagle AssetLink · ${title}</span></div>`;
      h+=`</div><p class="help">首次使用：在「插件 → 开发者选项 → 导入本地项目」中，加载 shortcuts 内的 locate（定位）和 expand（展开），然后在 Eagle 快捷键页搜索 Eagle AssetLink 并绑定按键。rename、delete 为可选同步操作。面板内支持 Ctrl+Alt+L 定位、Ctrl+Alt+E 展开。</p><div class="row">${button('open-shortcut-folder','打开快捷键组件目录')}${button('native-shortcuts','打开 Eagle 快捷键设置')}</div></section><section class="settings-card"><h2>使用范围</h2><p class="help">这些快捷键由 Eagle 管理，在 Eagle 内作用于当前单选条目。定位会查找并打开目标；同步重命名和同步删除只操作已定位的目标，并保留路径确认。</p></section>`;
    }
    h+='</div><footer class="preferences-footer">';
    h+=`<div role="status" class="save-status ${isError?'error':''}">${esc(notice)}</div>${button('save-settings','保存设置','primary')}</footer></div></main>`;
    return h;
  }
  function capture(){
    if(inspector||command||view!=='settings'||!draft)return;
    const input=(id,fn)=>{const el=document.getElementById(id);if(el)fn(el);};
    for(const key of ['roots','searchRoots']){
      const i=directorySelection[key],old=draft[key][i];if(old===undefined)continue;
      input(key+'-path',el=>{const next=el.value;draft[key][i]=next;draft.rootLabels||={};if(next!==old){draft.rootLabels[next]=draft.rootLabels[old]||'';}});

    }
    for(const [id,key] of [['double-click-action','doubleClickAction'],['clean-mode','cleanMode'],['everything-path','everythingPath'],['es-path','esPath']])input(id,el=>draft[key]=el.value);
    for(const [id,key] of [['preview-folder','previewFolder'],['hide-untagged','hideUntagged'],['clean-enabled','cleanEnabled']])input(id,el=>draft[key]=el.checked);
    if(root.querySelector('.keyword-list'))draft.keywords=[...root.querySelectorAll('[data-keyword]')].map(el=>el.value);
  }
  async function refresh(){
    closeImagePreview();closeFileMenu();folderHistory=[];
    refreshing=true;root.inert=inspector;try{
    state=await store.read();library=await host.library.path;
    const selected=await host.item.getSelected();const id=new URLSearchParams(location.search).get('id');
    item=inspector&&id?await host.item.getById(id):selected.length===1?selected[0]:null;
    folderPreview=null;matchGroups=[];selectedPaths.clear();selectionAnchor='';manual='';results=null;choosing=false;renameOpen=false;notice='';isError=false;tagPickerOpen=false;availableTags=[];
    const initial=central&&window.bridgeInitialSearch;window.bridgeInitialSearch=null;
    if(inspector){restoreExpansion();if(candidatesOpen&&item&&state.settings.configured&&C.eligible(item,binding(),state.settings))try{
      if(initial&&initial.id===item.id&&initial.library===library&&Date.now()-initial.at<15000&&JSON.stringify(initial.settings)===JSON.stringify(state.settings)){results=initial.results;searchCompletedAt=initial.at;}else await lookup(false);
      await loadFolderPreview();
    }catch(e){message(e.message||String(e),true);}}
    }finally{refreshing=false;}
  }
  async function pick(type,title,current=''){const r=await host.dialog.showOpenDialog({title,...(current?{defaultPath:current}:{}),properties:[type==='folder'?'openDirectory':'openFile']});return !r.canceled&&r.filePaths[0];}
  async function confirm(title,detail,danger=false){const r=await host.dialog.showMessageBox({title,message:title,detail,buttons:['取消',danger?'确认移入回收站':'确认'],type:danger?'warning':'question'});return r.response===1;}
  async function currentContext(lib,id){if(await host.library.path!==lib)throw Error('Eagle 资源库已切换，请刷新后重试');const fresh=await host.item.getById(id);if(!fresh||fresh.isDeleted)throw Error('Eagle 条目已不存在或在回收站');return fresh;}
  async function connect(row,source='manual'){
    await currentContext(library,item.id);
    const now=await C.snapshot(row.path);if(row.ino!==undefined&&!C.sameSnapshot(row,now))throw Error('候选已发生变化，请重新搜索');
    const old=binding();await store.bind(library,item,{...now,identity:now,locked:source==='locked',confirmed:source==='manual'||source==='locked',match:source,history:[...new Set([...(old?.history||[]),path.basename(now.path),item.name])],manual});state=await store.read();
  }
  async function reveal(row){if(row.type==='folder'){const error=await host.shell.openPath(row.path);if(typeof error==='string'&&error)throw Error('无法打开文件夹：'+error);}else await host.shell.showItemInFolder(row.path);}
  function fileRow(el){return el.dataset.group!==undefined?matchGroups[Number(el.dataset.group)]?.rows[Number(el.dataset.groupRow)]:el.dataset.candidate!==undefined?results?.rows[Number(el.dataset.candidate)]:el.dataset.folderEntry!==undefined?folderPreview?.rows[Number(el.dataset.folderEntry)]:binding();}
  function closeFileMenu(){contextMenu?.remove();contextMenu=null;}
  async function openListEntry(row){
    if(row.link)throw Error('暂不打开符号链接项。');
    const current=await C.snapshot(row.path);
    if(current.type==='folder'){
      const next=await C.listAssetFolder(current,{details:central});
      folderHistory.push({preview:folderPreview,choosing,selected:[...selectedPaths],anchor:selectionAnchor,limit:previewLimit,x:window.scrollX,y:window.scrollY,focus:row.path});
      folderForward=[];browserUI?.reset();folderPreview={...next,browsing:true,eagle:!!library&&C.inside(library,current.path)};choosing=false;previewLimit=100;selectedPaths.clear();selectionAnchor='';candidatesOpen=true;message('');
    }else{const error=await host.shell.openPath(current.path);if(typeof error==='string'&&error)throw Error('无法打开文件：'+error);}
  }
  function navigateBack(){
    const previous=folderHistory.pop();if(!previous)return;
    if(central)folderForward.push(browserSnapshot());browserUI?.reset();
    closeImagePreview();closeFileMenu();folderPreview=previous.preview;choosing=previous.choosing;previewLimit=previous.limit;selectedPaths=new Set(previous.selected);selectionAnchor=previous.anchor;pendingNavigation=previous;
  }
  function parentTarget(){
    if(choosing){const row=results?.rows.find(r=>selectedPaths.has(r.path))||results?.rows[0];return row?path.dirname(row.path):'';}
    const dir=folderPreview?.dir;return dir&&!C.samePath(path.dirname(dir),dir)?path.dirname(dir):'';
  }
  function canNavigateParent(){return !!parentTarget();}
  async function navigateParent(){const target=parentTarget();if(target)await openListEntry({path:target,type:'folder'});}


  async function lookup(auto=false){
    if(!item)throw Error('请先在 Eagle 中选择一个条目');
    const capturedId=item.id,capturedLib=library;
    const names=C.namesFor(item,state.settings);
    if(!names.length)throw Error('没有可用的名称，请检查名称清理设置。');
    results=null;choosing=false;folderPreview=null;message('');
    const ready=await C.ensureReady(state.settings);
    results=await C.searchNames(ready,names,{exclude:[library,store.dir]});
    searchCompletedAt=Date.now();matchGroups=[];
    await currentContext(capturedLib,capturedId);if(inspector||command)view='asset';
    if(auto&&results.rows.length){
      if(results.rows.length>1||results.incomplete){
        choosing=true;candidatesOpen=true;
        try{localStorage.setItem('eagle-bridge-results-open','true');}catch{}
        await loadFolderPreview();
        return false;
      }
      await connect(results.rows[0],'first');await reveal(results.rows[0]);
      if(candidatesOpen)await loadFolderPreview();message('已定位到本地资产。');return true;
    }else if(!results.rows.length){if(auto)message('没有找到本地资产，请在设置中检查名称清理规则与查找范围。',true);if(auto)candidatesOpen=true;await loadFolderPreview();}
    return false;
  }
  async function locate(){
    if(inspector&&!central&&!demo)await require(path.join(pluginDir,'js','central.cjs')).closeFromInspector();
    state=await store.read();const b=binding();message('');renameOpen=false;
    if(b?.status==='local-trashed')throw Error('本地目标已在回收站，可点击同步删除重试 Eagle 部分。');
    if(!state.settings.configured)throw Error('请从 Eagle 插件菜单打开 Eagle AssetLink，先设置资产目录。');
    return await lookup(true);
  }
  function openSettings(){renameOpen=false;message('');draft=JSON.parse(JSON.stringify(state.settings));view='settings';}
  async function remove(){
    const b=binding();if(!b)throw Error('请先关联明确的本地目标');
    const lib=library,id=item.id,name=item.name;const originalKey=C.keyFor(lib,id);const settings=state.settings;
    if(b.status==='local-trashed'){
      if(!await confirm('仅重试 Eagle 回收站',`本地目标此前已移入回收站，不再操作本地文件。\n当前条目：${name}\n原路径：${b.path}`,true))return;
      const it=await currentContext(lib,id);if(await it.moveToTrash()===false)throw Error('Eagle 移入回收站失败');await store.unbind(lib,id);await refresh();message('Eagle 条目已移入回收站。');return;
    }
    if(!await C.bindingValid(b))throw Error('本地目标已变化，请先重新关联，再执行删除');
    const protectedPaths=[lib,store.dir,host.plugin?.path||''].filter(Boolean);
    const expected=await C.assertMutable(b.path,settings,protectedPaths);
    const related=Object.values(state.bindings).filter(x=>x.itemId!==id&&C.samePath(x.path,b.path)).length;
    const op=Date.now()+'-'+id;
    const result=await C.trashFlow({target:b.path,expected,
      validate:async p=>{await currentContext(lib,id);const latest=(await store.read()).bindings[originalKey];if(!latest||latest.updatedAt!==b.updatedAt)throw Error('关联已变化，请重新确认');return C.assertMutable(p,settings,protectedPaths);},
      confirm:()=>confirm('同步删除资产',`Eagle 条目：${name}\n目标类型：${b.type==='folder'?'整个文件夹及其全部内容':'单个文件'}\n\n本地路径：\n${b.path}\n\n本地目标将移入系统回收站，当前 Eagle 条目将移入 Eagle 回收站。${related?'\n另有 '+related+' 个关联记录可能断链；不会删除其他 Eagle 条目。':''}`,true),
      trash:p=>host.trashLocal(p),itemTrash:async()=>{const it=await currentContext(lib,id);return it.moveToTrash();},
      journal:async(status,error)=>{await store.update(d=>{d.journal.push({op,status,path:b.path,itemId:id,library:lib,time:Date.now(),error});if(status==='local-trashed'||status==='eagle-trash-failed')d.bindings[originalKey]={...b,status:'local-trashed'};if(status==='complete')delete d.bindings[originalKey];});}
    });
    state=await store.read();if(result.cancelled)message('已取消，没有删除任何资产。');else if(result.partial)message('本地已移入回收站，但 Eagle 处理失败。点击同步删除可仅重试 Eagle 部分。 '+result.message,true);else{await refresh();message('本地目标和 Eagle 条目已分别移入回收站。');}
  }
  async function rename(newName){
    const b=binding();if(!b||b.status==='local-trashed')throw Error('请先关联有效目标');const lib=library,id=item.id;
    if(!await C.bindingValid(b))throw Error('本地目标已变化，请先重新关联');
    const expected=await C.assertMutable(b.path,state.settings,[lib,store.dir,host.plugin?.path].filter(Boolean));
    const dest=C.safeRename(b.path,newName,b.type);if(C.samePath(b.path,dest))throw Error('新名称与原名称相同（暂不支持只改大小写）');
    if(fs.existsSync(dest))throw Error('目标名称已存在，不会覆盖：'+dest);
    if(!await confirm('同步重命名',`本地目标：\n${b.path}\n\n新路径：\n${dest}\n\n同时更新当前 Eagle 条目名称；其他关联卡片只更新本地路径。`))return;
    const it=await currentContext(lib,id);if(!C.sameSnapshot(expected,await C.snapshot(b.path)))throw Error('目标已变化，请重试');
    const latest=(await store.read()).bindings[C.keyFor(lib,id)];if(latest?.updatedAt!==b.updatedAt)throw Error('关联已变化，请重新确认');
    // fs.rename is only called after explicit target confirmation and collision checks.
    if(fs.existsSync(dest))throw Error('新路径已被占用');await fs.promises.rename(b.path,dest);
    try{it.name=b.type==='file'?path.parse(dest).name:path.basename(dest);if(await it.save()===false)throw Error('Eagle 返回失败');}
    catch(e){try{if(fs.existsSync(b.path))throw Error('原路径已被占用');await fs.promises.rename(dest,b.path);}catch(rollback){await store.update(d=>{d.journal.push({status:'rename-partial',from:b.path,to:dest,itemId:id,error:e.message,rollback:rollback.message});});throw Error('本地已改名，但 Eagle 更新与回滚失败。新路径：'+dest);}throw Error('Eagle 更新失败，本地改名已撤回：'+e.message);}
    const identity=await C.snapshot(dest);
    await store.update(d=>{for(const rec of Object.values(d.bindings)){
      if(C.samePath(rec.path,b.path)){rec.path=dest;rec.identity=identity;rec.history=[...new Set([...(rec.history||[]),path.basename(b.path)])];rec.updatedAt=Date.now();}
      else if(b.type==='folder'&&C.inside(b.path,rec.path)){rec.path=path.join(dest,path.relative(b.path,rec.path));rec.updatedAt=Date.now();}
    }d.journal.push({status:'renamed',from:b.path,to:dest,itemId:id,time:Date.now()});});
    item=it;state=await store.read();renameOpen=false;message('本地目标和当前 Eagle 条目已同步重命名。');
  }
  function closePluginWindow(){
    if(demo){message('界面演示不会关闭浏览器窗口。');return;}
    window.close();
  }
  async function runCommand(){
    await refresh();view='asset';
    if(!item)throw Error('请先在 Eagle 中单选一个条目，再使用此命令。');
    if(command==='locate'){if(await locate())closePluginWindow();}
    else if(command==='expand'){await actions['central-open']();closePluginWindow();}
    else if(command==='delete'){await remove();if(!isError)closePluginWindow();}
    else if(command==='rename'){
      const b=binding();if(!b||!await C.bindingValid(b))throw Error('请先定位目标，再使用同步重命名。');
      renameOpen=true;
    }
  }
  const actions={
    'close-settings':async()=>{closePluginWindow();},
    'central-open':async()=>{if(demo){message('演示环境不连接 Eagle 中央区域。');return;}const wasOpen=candidatesOpen;
      if(wasOpen)toggleExpansion();closeImagePreview();closeFileMenu();render();
      try{const entry=path.join(pluginDir,'js','central.cjs');delete require.cache[require.resolve(entry)];await require(entry).open({host,item,pluginDir,parentID:window.parentID,initialSearch:results?{id:item.id,library,at:searchCompletedAt,settings:state.settings,results}:null});}
      catch(e){if(wasOpen&&!candidatesOpen)toggleExpansion();throw e;}},
    'central-refresh':refresh,
    'browser-mkdir':()=>editLocal('mkdir'),
    'browser-home':async()=>{browserUI.reset();folderForward=[];await refresh();},
    'browser-forward':()=>{const next=folderForward.pop();if(!next)return;folderHistory.push(browserSnapshot());restoreBrowser(next);},
    'browser-up':navigateParent,
    'browser-refresh':async()=>{if(folderPreview?.dir){const next=await C.listAssetFolder({path:folderPreview.dir},{details:true});folderPreview={...folderPreview,...next};}else await refresh();},
    'browser-filter':()=>browserUI.toggleFilters(),
    'choose-other-group':()=>loadFolderPreview(true),
    'browser-settings':async()=>{
      if(demo){window.open('index.html?demo=1','eagle-bridge-settings','width=850,height=660');return;}
      await require(path.join(pluginDir,'js','central.cjs')).openSettings({parentID:window.parentID,pluginDir,id:host.plugin.manifest.id});
    },
    'more-folder':async()=>{previewLimit+=100;},
    'folder-back':navigateBack,
    locate,candidates:async()=>{if(!candidatesOpen&&inspector&&!central&&!demo)await require(path.join(pluginDir,'js','central.cjs')).closeFromInspector();toggleExpansion();if(candidatesOpen){if(!results)await lookup(false);await loadFolderPreview();}},
    'save-settings':async()=>{draft.configured=true;await store.settings(draft);state=await store.read();view=inspector?'asset':'settings';draft=JSON.parse(JSON.stringify(state.settings));results=null;candidatesOpen=false;message('设置已保存。');},
    
    rename:async()=>{renameOpen=!renameOpen;},delete:remove,
    detect:async()=>{tool=await C.detect(draft);draft={...draft,...{esPath:tool.esPath,everythingPath:tool.everythingPath}};if(!tool.ready&&tool.everythingPath){await C.startEverything(tool.everythingPath,draft.instance);await new Promise(r=>setTimeout(r,1200));tool=await C.detect(draft);}message(tool.ready?'Everything 查询已就绪。':'尚未就绪，请检查工具配置或等待首次索引完成。');},
    start:async()=>{await C.startEverything(draft.everythingPath,draft.instance);await new Promise(r=>setTimeout(r,1200));tool=await C.detect(draft);message(tool.ready?'Everything 已连接。':'客户端已启动，可能仍在建立索引，请稍后重新检测。');},
    'add-keyword':()=>{draft.keywords.push('');keywordIndex=draft.keywords.length-1;render();root.querySelector('[data-keyword="'+keywordIndex+'"]')?.focus();},
    'remove-keyword':()=>{draft.keywords.splice(keywordIndex,1);keywordIndex=Math.max(0,keywordIndex-1);},
    'setup-tools':async()=>{if(demo)throw Error('演示不下载工具');const setup=require(path.join(pluginDir,'js','setup.cjs'));const installed=await setup.configure(draft,pluginDir,C,text=>{message(text);render();});Object.assign(draft,installed);await store.settings(draft);tool=await C.detect(draft);await C.startEverything(draft.everythingPath,draft.instance);message('工具已配置并启动。首次运行请完成 Everything 的索引/服务设置，随后点击自动检测。');},
    download:()=>host.shell.openExternal('https://www.voidtools.com/downloads/'),
    'choose-everything':async()=>{const p=await pick('file','选择 Everything.exe',draft.everythingPath);if(p)draft.everythingPath=p;},
    'choose-es':async()=>{const p=await pick('file','选择 es.exe',draft.esPath);if(p)draft.esPath=p;},
    'open-shortcut-folder':()=>host.shell.openPath(path.join(pluginDir,'shortcuts')),
    'native-shortcuts':async()=>{if(!host.preferences?.show)throw Error('请手动打开 Eagle 偏好设置 → 快捷键。');await host.preferences.show({panel:'shortcuts',keyword:'Eagle AssetLink'});}
  };
  function clearDropMarks(){root.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));}
  function restorePriorityFocus(key,scrollLeft){
    const list=root.querySelector('.priority');if(list)list.scrollLeft=scrollLeft;
    const chip=[...root.querySelectorAll('[data-priority]')].find(el=>el.dataset.priority===key);
    chip?.focus({preventScroll:true});chip?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function centralContextMenu(e){
    if(busy||refreshing||root.inert||e.target.closest('input,select,textarea'))return;
    e.preventDefault();closeFileMenu();closeImagePreview();
    const el=e.target.closest('.candidate'),row=el?fileRow(el):null;
    if(el&&!selectedPaths.has(el.title)){selectedPaths=new Set([el.title]);selectionAnchor=el.title;paintSelection();}
    const menu=document.createElement('div');menu.className='file-context-menu browser-context';menu.setAttribute('role','menu');
    const add=(label,fn,disabled=false,shortcut='',parent=menu)=>{
      const b=document.createElement('button');b.type='button';b.disabled=disabled;b.setAttribute('role','menuitem');
      if(typeof label==='object'){b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(label.checked));b.innerHTML='<span class="menu-radio" aria-hidden="true"></span><span>'+esc(label.label)+'</span>';}
      else b.innerHTML='<span>'+esc(label)+'</span><small>'+esc(shortcut)+'</small>';
      b.onclick=()=>{closeFileMenu();guard(fn);};parent.appendChild(b);return b;
    };
    const sep=()=>menu.appendChild(document.createElement('hr'));
    const sub=(label,options)=>{
      const wrap=document.createElement('div');wrap.className='context-sub-wrap';menu.appendChild(wrap);
      const b=add(label,()=>{},false,'›',wrap);b.setAttribute('aria-haspopup','menu');
      const panel=document.createElement('div');panel.className='file-context-menu context-sub';panel.setAttribute('role','menu');panel.hidden=true;wrap.appendChild(panel);
      options.forEach(o=>add(o[0],o[1],!!o[2],'',panel));
      const show=()=>{menu.querySelectorAll('.context-sub').forEach(n=>n.hidden=true);panel.hidden=false;const br=b.getBoundingClientRect(),pr=panel.getBoundingClientRect();panel.style.left=Math.max(4,br.right+pr.width+8<innerWidth?br.right:br.left-pr.width)+'px';panel.style.top=Math.max(4,Math.min(br.top,innerHeight-pr.height-4))+'px';};
      wrap.onmouseenter=show;b.onfocus=show;b.onclick=event=>{event.stopPropagation();show();};
    };
    add('后退',navigateBack,!folderHistory.length,'Alt ←');add('前进',actions['browser-forward'],!folderForward.length,'Alt →');
    add('转到上一级',navigateParent,!canNavigateParent(),'Alt ↑');add('刷新',actions['browser-refresh'],false,'F5');sep();
    if(row){add('打开',()=>openListEntry(row));add('在资源管理器中定位',()=>reveal(row));}
    add('重命名',()=>editLocal('rename',row),!row||selectedPaths.size!==1||!!row.link||!!folderPreview?.eagle,'F2');
    add('删除',deleteListEntries,!listDeleteTargets().length||!!folderPreview?.eagle);
    add('新建文件夹',()=>editLocal('mkdir'),!folderPreview?.dir||choosing||!!folderPreview?.eagle,'Ctrl Shift N');sep();
    const prefs=browserUI.getPrefs(),mark=(yes,label)=>({label,checked:yes});
    sub('显示模式',[['details','详细列表'],['compact','水平列表'],['grid','缩略图']].map(([v,l])=>[mark(prefs.mode===v,l),()=>browserUI.setMode(v)]));
    sub('显示尺寸',[[80,'很小'],[112,'小'],[160,'中'],[208,'大'],[256,'超大']].map(([v,l])=>[mark(prefs.size===v,l),()=>{browserUI.setSize(v);browserUI.setMode('grid');}]));
    sub('排序',[...['name','mtime','size'].map((v,i)=>[mark(prefs.sort===v,['名称','修改日期','大小'][i]),()=>browserUI.chooseSort(v),choosing]),[mark(!prefs.reverse,'升序'),()=>browserUI.setDirection(false),choosing],[mark(prefs.reverse,'降序'),()=>browserUI.setDirection(true),choosing]]);
    document.body.appendChild(menu);contextMenu=menu;
    const rect=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(e.clientX,innerWidth-rect.width-4))+'px';menu.style.top=Math.max(4,Math.min(e.clientY,innerHeight-rect.height-4))+'px';
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function listDeleteTargets(){
    return [...root.querySelectorAll('.candidate')].filter(el=>selectedPaths.has(el.title)).map(fileRow).filter(Boolean).map(row=>row.path);
  }
  async function deleteListEntries(){
    if(folderPreview?.eagle)throw Error('Eagle 库文件列表只读');
    const targets=listDeleteTargets();if(!targets.length)return;
    if(demo)throw Error('演示环境不会修改磁盘文件');
    const lib=library,id=item.id,settings=state.settings,protectedPaths=[lib,store.dir,pluginDir];
    await currentContext(lib,id);
    const ops=require(path.join(pluginDir,'js','file-operations.cjs'));
    const plan=await ops.prepareTrash(targets,settings,protectedPaths);
    const paths=plan.map(row=>row.path).join('\n');
    if(!await confirm('删除本地文件',`将以下 ${plan.length} 项移入系统回收站：\n\n${paths}\n\n文件夹包含其全部内容。Eagle 中的资产保留。`,true))return;
    await currentContext(lib,id);
    closeImagePreview();
    if(central){require('electron').ipcRenderer.sendToHost('eagle-bridge-file-selection',[]);lastDetailSelection='';}
    let completed=[],failure;
    try{completed=await ops.trashEntries(plan,settings,protectedPaths,p=>host.trashLocal(p));}
    catch(error){completed=error.completed||[];failure=error;}
    if(completed.length){
      try{
        await store.update(d=>{for(const b of Object.values(d.bindings))if(completed.some(p=>C.inside(p,b.path)))Object.assign(b,{status:'local-trashed',updatedAt:Date.now()});d.journal.push({status:'list-trashed',paths:completed,library:lib,itemId:id,time:Date.now()});});
        state=await store.read();
      }catch(error){failure=Error('文件已移入回收站，但关联记录更新失败：'+error.message);}
      const keep=row=>!completed.some(p=>C.inside(p,row.path));
      if(results)results.rows=results.rows.filter(keep);
      if(folderPreview)folderPreview.rows=folderPreview.rows.filter(keep);
      for(const group of matchGroups){group.rows=group.rows.filter(keep);group.matches=group.matches.filter(keep);}
      selectedPaths.clear();selectionAnchor='';folderHistory=[];folderForward=[];
      try{if(folderPreview?.dir)await actions['browser-refresh']();else await loadFolderPreview();}catch{}
    }
    message(failure?(completed.length?`已将 ${completed.length} 项移入回收站。`:'')+failure.message:`已将 ${completed.length} 项移入回收站。`,!!failure);
  }
  function editLocal(kind,row){
    if(folderPreview?.eagle)throw Error('Eagle 库文件列表只读');
    const dir=folderPreview?.dir;if(kind==='mkdir'&&(!dir||choosing))return;
    const overlay=document.createElement('div');overlay.className='browser-edit-overlay';
    overlay.innerHTML='<form class="browser-edit-dialog"><strong>'+ (kind==='mkdir'?'新建文件夹':'重命名本地文件')+'</strong><p class="help">'+esc(kind==='mkdir'?dir:row.path)+'</p><input aria-label="名称" value="'+esc(kind==='mkdir'?'新建文件夹':path.basename(row.path))+'" required><p class="edit-error" role="status"></p><div class="row"><button type="button" data-cancel>取消</button><button type="submit" class="primary">确定</button></div></form>';
    document.body.appendChild(overlay);renameOpen=true;
    const input=overlay.querySelector('input'),error=overlay.querySelector('.edit-error');input.focus();input.select();
    const close=()=>{renameOpen=false;overlay.remove();};
    overlay.querySelector('[data-cancel]').onclick=close;
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}});
    overlay.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const submit=overlay.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;error.textContent='';
      try{
        if(demo)throw Error('演示环境不会修改磁盘文件');
        await currentContext(library,item.id);
        const ops=require(path.join(pluginDir,'js','file-operations.cjs')),protectedPaths=[library,store.dir,pluginDir];
        if(kind==='mkdir')await ops.createDirectory(dir,input.value,protectedPaths);
        else{
          const moved=await ops.renameEntry(row.path,input.value,state.settings,protectedPaths);
          // Keep plugin links consistent without renaming any Eagle card.
          try{await store.update(async d=>{for(const b of Object.values(d.bindings)){if(C.inside(moved.from,b.path)){const dest=path.join(moved.to,path.relative(moved.from,b.path));const snap=await C.snapshot(dest);Object.assign(b,snap,{identity:snap,updatedAt:Date.now()});}}});state=await store.read();}
          catch(err){throw Error('本地已重命名，但关联记录更新失败：'+err.message);}
          selectedPaths.clear();folderHistory=[];folderForward=[];
        }
        close();await guard(async()=>{if(choosing)await refresh();else await actions['browser-refresh']();});
      }catch(err){error.textContent=err.message;submit.disabled=false;}
    };
  }
  root.addEventListener('contextmenu',e=>{
    if(central){centralContextMenu(e);return;}
    const el=e.target.closest('.candidate');if(!el||busy||refreshing||root.inert)return;
    e.preventDefault();closeFileMenu();const row=fileRow(el);if(!row)return;
    if(!selectedPaths.has(el.title)){selectedPaths=new Set([el.title]);selectionAnchor=el.title;paintSelection();}
    const menu=document.createElement('div');menu.className='file-context-menu';menu.setAttribute('role','menu');
    const open=document.createElement('button');open.type='button';open.textContent='打开';open.setAttribute('role','menuitem');
    open.addEventListener('click',event=>{event.stopPropagation();closeFileMenu();guard(()=>openListEntry(row));});
    menu.appendChild(open);
    const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.setAttribute('role','menuitem');remove.disabled=!!folderPreview?.eagle||!listDeleteTargets().length;
    remove.onclick=event=>{event.stopPropagation();closeFileMenu();guard(deleteListEntries);};menu.appendChild(remove);
    if(central){const locate=document.createElement('button');locate.textContent='在资源管理器中定位';locate.setAttribute('role','menuitem');locate.onclick=()=>{closeFileMenu();guard(()=>reveal(row));};menu.appendChild(locate);}
    document.body.appendChild(menu);contextMenu=menu;const rect=menu.getBoundingClientRect();menu.style.left=Math.max(2,Math.min(e.clientX,innerWidth-rect.width-2))+'px';menu.style.top=Math.max(2,Math.min(e.clientY,innerHeight-rect.height-2))+'px';open.focus({preventScroll:true});
  });
  document.addEventListener('pointerdown',e=>{if(contextMenu&&!contextMenu.contains(e.target))closeFileMenu();});
  root.addEventListener('dragstart',e=>{
    closeFileMenu();
    const file=e.target.closest('.candidate');if(file){e.preventDefault();if(busy||refreshing||root.inert)return;if(!host.drag?.startDrag){message('当前 Eagle 环境不支持原生文件拖拽。',true);render();return;}draggingFile=true;file.classList.add('file-dragging');host.drag.startDrag(selectedPaths.has(file.title)?[...selectedPaths]:[file.title]).catch(error=>{message(error.message,true);}).finally(()=>{draggingFile=false;file.classList.remove('file-dragging');});return;}
    const chip=e.target.closest('[data-priority]');
    if(e.target.closest('[data-remove-priority]')){e.preventDefault();return;}
    if(!chip||busy||view!=='settings')return;
    capture();draggedPriority=chip.dataset.priority;
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedPriority);
    chip.classList.add('dragging');
  });
  root.addEventListener('dragover',e=>{
    const list=e.target.closest('.priority');if(!list||draggedPriority===null||busy)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';clearDropMarks();
    const chip=e.target.closest('[data-priority]');
    if(chip&&chip.dataset.priority!==draggedPriority){const r=chip.getBoundingClientRect();chip.classList.add(e.clientX<r.left+r.width/2?'drop-before':'drop-after');}
    const r=list.getBoundingClientRect();if(e.clientX>r.right-28)list.scrollLeft+=12;else if(e.clientX<r.left+28)list.scrollLeft-=12;
  });
  root.addEventListener('drop',e=>{
    const list=e.target.closest('.priority');if(!list||draggedPriority===null||busy)return;
    e.preventDefault();const key=draggedPriority,chip=e.target.closest('[data-priority]'),scrollLeft=list.scrollLeft;
    if(chip&&chip.dataset.priority!==key){
      const r=chip.getBoundingClientRect(),after=e.clientX>=r.left+r.width/2;
      const next=draft.priority.filter(p=>p!==key),index=next.indexOf(chip.dataset.priority);
      if(index>=0){next.splice(index+(after?1:0),0,key);draft.priority=next;}
    }else if(!chip){draft.priority=draft.priority.filter(p=>p!==key).concat(key);}
    draggedPriority=null;render();restorePriorityFocus(key,scrollLeft);
  });
  root.addEventListener('dragend',()=>{draggedPriority=null;clearDropMarks();root.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));});
  document.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.ctrlKey&&e.altKey&&!e.target.closest?.('input,textarea,select,[contenteditable="true"]')&&['l','e'].includes(e.key.toLowerCase())){e.preventDefault();guard(actions[e.key.toLowerCase()==='l'?'locate':'central-open']);return;}
    if(central&&e.ctrlKey&&['l','f'].includes(e.key.toLowerCase())){e.preventDefault();const input=root.querySelector(e.key.toLowerCase()==='l'?'#browser-path':'#browser-search');input?.focus();input?.select();return;}
    if(central&&e.key==='F2'&&!e.target.closest('input,textarea,select')){e.preventDefault();const row=[...root.querySelectorAll('.candidate')].find(n=>selectedPaths.has(n.title));if(row&&selectedPaths.size===1&&!folderPreview?.eagle)editLocal('rename',fileRow(row));return;}
    if(central&&e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='n'){e.preventDefault();if(folderPreview?.dir&&!folderPreview.eagle&&!choosing)editLocal('mkdir');return;}
    if(central&&e.key==='F5'){e.preventDefault();guard(actions['browser-refresh']);return;}
    if(central&&e.altKey&&e.key==='ArrowRight'){e.preventDefault();guard(actions['browser-forward']);return;}
    if(central&&e.altKey&&e.key==='ArrowUp'){e.preventDefault();guard(navigateParent);return;}
    if(e.key==='Escape'&&central&&root.querySelector('.browser-filters')){e.preventDefault();browserUI.closeFilters();root.querySelector('.browser-filters').remove();return;}
    if(e.key==='Escape'&&(imagePreview||previewTimer||contextMenu)){e.preventDefault();closeImagePreview();closeFileMenu();return;}
    if(central&&e.key==='Escape'){e.preventDefault();if(!demo)require(path.join(pluginDir,'js','central.cjs')).close();return;}
    if(e.target.closest?.('input,textarea,select,[contenteditable="true"]')||busy||refreshing||root.inert)return;
    if((inspector||command==='locate')&&((e.altKey&&e.key==='ArrowLeft')||e.key==='Backspace')){
      e.preventDefault();if(e.altKey){if(folderHistory.length)guard(navigateBack);}else guard(navigateParent);
    }
  });
  root.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-resize-column]');if(!central||!handle)return;
    e.preventDefault();e.stopPropagation();const key=handle.dataset.resizeColumn,start=e.clientX,width=handle.parentElement.getBoundingClientRect().width,layout=root.querySelector('.browser-layout');
    handle.setPointerCapture(e.pointerId);
    const move=event=>{const next=Math.max(70,Math.min(320,width+start-event.clientX));layout.style.setProperty(key==='mtime'?'--date-width':'--size-width',next+'px');browserUI.setColumn(key,next);};
    const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  });
  root.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'&&contextMenu){closeFileMenu();return;}
    if(e.key==='Escape'&&(tagPickerOpen||formatOpen)){tagPickerOpen=false;formatOpen=false;render();return;}
    if(central&&e.key==='Enter'&&e.target.closest('.candidate')){e.preventDefault();e.target.closest('.candidate').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return;}
    if(central&&e.key==='Enter'&&e.target.id==='browser-path'){e.preventDefault();const p=e.target.value.trim();if(p)guard(()=>browsePath(p));return;}
    if(e.key==='Enter'&&e.target.id==='new-format'){e.preventDefault();root.querySelector('[data-action="add-format"]')?.click();return;}
    if(e.key==='Enter'&&e.target.id==='tag-search'){e.preventDefault();root.querySelector('[data-tag-choice]')?.click();return;}
    const chip=e.target.closest('[data-priority]');if(!chip||busy||!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();capture();const key=chip.dataset.priority,i=draft.priority.indexOf(key),j=i+(e.key==='ArrowLeft'?-1:1);
    if(j<0||j>=draft.priority.length)return;
    const scrollLeft=chip.parentElement.scrollLeft;[draft.priority[i],draft.priority[j]]=[draft.priority[j],draft.priority[i]];render();restorePriorityFocus(key,scrollLeft);
  });
  function updateBrowserSearch(input){browserUI.setQuery(input.value);selectedPaths.clear();selectionAnchor='';previewLimit=100;render();}
  root.addEventListener('compositionstart',e=>{if(central&&e.target.id==='browser-search')composingSearch=true;});
  root.addEventListener('compositionend',e=>{if(central&&e.target.id==='browser-search'){composingSearch=false;updateBrowserSearch(e.target);}});
  root.addEventListener('input',e=>{if(central&&e.target.id==='browser-size'){setBrowserLevel(e.target.value);return;}if(central&&e.target.id==='browser-search'){if(!e.isComposing&&!composingSearch)updateBrowserSearch(e.target);return;}if(e.target.id==='tag-search'){tagQuery=e.target.value;document.getElementById('tag-results').innerHTML=tagResultsHTML();return;}if(view==='settings'){capture();for(const key of ['roots','searchRoots']){const p=draft[key][directorySelection[key]],row=root.querySelector('[data-directory="'+key+'"][aria-selected="true"] span');if(row)row.textContent=path.basename(p)||p||'新目录';}const preview=document.getElementById('clean-preview');if(preview&&item)preview.textContent=C.namesFor(item,draft).join(' → ');}});
  root.addEventListener('focusin',e=>{if(e.target.dataset.keyword!==undefined)keywordIndex=Number(e.target.dataset.keyword);});
  root.addEventListener('change',e=>{if(central&&(e.target.dataset.filterType||e.target.id==='browser-hidden')){if(e.target.id==='browser-hidden')browserUI.setHidden(e.target.checked);else browserUI.toggleType(e.target.dataset.filterType);selectedPaths.clear();selectionAnchor='';previewLimit=100;render();return;}if(central&&e.target.id==='browser-size'){setBrowserLevel(e.target.value);return;}if(e.target.id==='hide-untagged'){capture();render();}});
  document.addEventListener('pointerdown',e=>{if(central&&root.querySelector('.browser-filters')&&!e.target.closest('.browser-filters,[data-action="browser-filter"]')){browserUI.closeFilters();root.querySelector('.browser-filters')?.remove();}});
  root.addEventListener('pointerdown',e=>{
    if(!central||e.button!==0||!e.target.closest('.browser-files')||e.target.closest('.candidate,button,input')||busy)return;
    closeImagePreview();const x=e.clientX,y=e.clientY,original=new Set(selectedPaths),add=e.ctrlKey||e.metaKey||e.shiftKey;
    const box=document.createElement('div');box.className='file-selection-box';document.body.append(box);
    const move=ev=>{const left=Math.min(x,ev.clientX),top=Math.min(y,ev.clientY),right=Math.max(x,ev.clientX),bottom=Math.max(y,ev.clientY);
      Object.assign(box.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
      selectedPaths=add?new Set(original):new Set();root.querySelectorAll('.candidate').forEach(row=>{const r=row.getBoundingClientRect();if(r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom)selectedPaths.add(row.title);});paintSelection();};
    const end=()=>{box.remove();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);e.preventDefault();
  });
  root.addEventListener('dblclick',e=>{const el=e.target.closest('.candidate');if(!el||el.disabled||busy||refreshing||root.inert)return;
    const candidate=el.dataset.candidate!==undefined,row=fileRow(el);
    if(!row)return;if(central){guard(async()=>{if(candidate&&choosing){if(row.link)throw Error('暂不打开符号链接项。');await connect(row);await browsePath(row.type==='folder'?row.path:path.dirname(row.path));}else if(row.type==='file'&&state.settings.doubleClickAction==='reveal')await reveal(row);else await openListEntry(row);});return;}guard(async()=>{if(row.link)throw Error('暂不打开符号链接项。');if(candidate)await connect(row);const current=await C.snapshot(row.path);if(current.type==='file'&&state.settings.doubleClickAction!=='reveal')await openListEntry(current);else await reveal(current);choosing=false;if(candidate)await loadFolderPreview();message('已定位。');if(command==='locate')closePluginWindow();});
  });
  root.addEventListener('click',e=>{const el=e.target.closest('button');if(!el||el.disabled||refreshing||root.inert)return;
    const newName=document.getElementById('rename-name')?.value;const newFormat=document.getElementById('new-format')?.value;
    if(e.target.closest('[data-resize-column]'))return;
    if(el.dataset.selectGroup!==undefined){const group=matchGroups[Number(el.dataset.selectGroup)];return guard(async()=>{await connect({path:group.dir,type:'folder'},'locked');folderPreview=await C.listAssetFolder({path:group.dir,type:'folder'});folderPreview.browsing=true;matchGroups=[];choosing=false;});}
    if(central&&el.dataset.browserMode){browserUI.setMode(el.dataset.browserMode);render();return;}
    if(central&&el.dataset.browserSort){browserUI.setSort(el.dataset.browserSort);render();return;}
    if(view==='settings')capture();
    if(el.dataset.tab){settingsTab=el.dataset.tab;tagPickerOpen=false;formatOpen=false;notice='';render();return;}
    if(el.dataset.directory){directorySelection[el.dataset.directory]=Number(el.dataset.index);render();return;}
    if(el.dataset.directoryAdd){const key=el.dataset.directoryAdd;return guard(async()=>{if(draft[key].length>=64)throw Error('目录列表最多支持 64 项');const p=await pick('folder','选择资产目录');if(p){let i=draft[key].findIndex(v=>C.samePath(v,p));if(i<0){i=draft[key].length;draft[key].push(p);}directorySelection[key]=i;}});}

    if(el.dataset.directoryRemove){const key=el.dataset.directoryRemove;draft[key].splice(directorySelection[key],1);render();return;}
    if(el.dataset.directoryPick){const key=el.dataset.directoryPick;return guard(async()=>{const p=await pick('folder','选择目录',draft[key][directorySelection[key]]);if(p){const i=directorySelection[key],old=draft[key][i];draft.rootLabels||={};draft.rootLabels[p]=draft.rootLabels[old]||'';draft[key][i]=p;}});}
    if(el.dataset.removePriority!==undefined){draft.priority=draft.priority.filter(p=>p!==el.dataset.removePriority);render();return;}
    if(el.classList.contains('candidate')){
      const rows=[...root.querySelectorAll('.candidate')],paths=rows.map(n=>n.title),i=paths.indexOf(el.title),anchor=paths.indexOf(selectionAnchor);
      if(e.shiftKey&&anchor>=0){if(!e.ctrlKey&&!e.metaKey)selectedPaths.clear();for(const p of paths.slice(Math.min(anchor,i),Math.max(anchor,i)+1))selectedPaths.add(p);}
      else if(e.ctrlKey||e.metaKey){if(selectedPaths.has(el.title))selectedPaths.delete(el.title);else selectedPaths.add(el.title);selectionAnchor=el.title;}
      else{selectedPaths=new Set([el.title]);selectionAnchor=el.title;}
      paintSelection();return;
    }
    if(el.dataset.action==='toggle-format'){formatOpen=!formatOpen;render();document.getElementById('new-format')?.focus();return;}
    if(el.dataset.action==='add-format'){const text=(newFormat||'').trim().toLowerCase().replace(/^\./,''),v=({'文件夹':'folder','其他文件':'other'})[text]||text;if(!/^[a-z0-9]+$/.test(v)){message('请输入有效扩展名，例如 max',true);render();return;}if(!draft.priority.includes(v))draft.priority.push(v);formatOpen=false;message('');render();return;}
    if(el.dataset.tagChoice!==undefined){draft.tag=el.dataset.tagChoice;tagPickerOpen=false;render();return;}
    if(el.dataset.action==='pick-tag'){tagPickerOpen=!tagPickerOpen;tagQuery='';render();if(tagPickerOpen){document.getElementById('tag-search')?.focus();loadTags();}return;}

    if(el.dataset.action==='rename-confirm')return guard(async()=>{await rename(newName||'');if(command&&!renameOpen)closePluginWindow();});
    if(actions[el.dataset.action])guard(actions[el.dataset.action]);
  });
  async function init(){if(started)return;started=true;
    try{
      if(demo){const env=window.bridgeDemo();({C,fs,path,host,store}=env);}
      else {fs=require('fs');path=require('path');host=window.eagle;pluginDir=command?path.resolve(host.plugin.path,'../..'):host.plugin.path;C=require(path.join(pluginDir,'js','core.cjs'));
        if(!host.app.userDataPath)throw Error('Eagle 未提供用户数据目录，请从插件菜单重新打开');
        store=new C.Store(path.join(host.app.userDataPath,'EagleBridge'));
        host.trashLocal=require(path.join(pluginDir,'js','desktop.cjs')).trashLocal;
      }
      if(central)browserUI=window.createBridgeBrowser({esc,path,fileIcon,demo});
      const theme=await host.app.theme;applyTheme(theme);
      if(!demo)try{const native=require(path.join(pluginDir,'js','native-style.cjs'));const style=document.createElement('style');style.id='eagle-native-style';style.textContent=native.load(process.resourcesPath);document.head.appendChild(style);document.getElementById('bridge-cached-style')?.remove();try{sessionStorage.setItem('bridge-native-style',style.textContent);}catch{}}catch(e){console.info('Eagle native styles unavailable; using fallback.',e.message);}
      if(inspector&&!central&&!demo)try{
        library=await host.library.path;
        const installed=await require(path.join(pluginDir,'js','inspector-session.cjs')).install({parentID:window.parentID,windowID:window.windowID,library,url:location.href});
        if(!installed)console.info('Eagle AssetLink: persistent inspector unavailable; using native reload.');
      }catch(e){console.info('Eagle AssetLink: persistent inspector unavailable; using native reload.',e.message);}
      await refresh();inspectorReady=true;
      if(!inspector&&!command){openSettings();tool=await C.detect(draft);draft.esPath=tool.esPath;draft.everythingPath=tool.everythingPath;}
      if(pendingSelection)await drainSelection();else render();host.onLibraryChanged?.(()=>guard(async()=>{await refresh();message('资源库已切换。');}));host.onThemeChanged?.(applyTheme);
      host.onPluginRun?.(()=>{if(inspector)return;if(!busy)guard(command?runCommand:refresh);});
      if(command)await guard(runCommand);
      setInterval(async()=>{if((central&&root.contains(document.activeElement)&&document.activeElement.matches('input,select'))||busy||refreshing||switchingSelection||pendingSelection||polling||imagePreview||contextMenu||draggingFile||renameOpen||view==='settings'||!inspector)return;polling=true;try{const previousPreview=state.settings.previewFolder;state=await store.read();if(!central&&previousPreview!==state.settings.previewFolder){if(candidatesOpen&&state.settings.previewFolder){busy=true;try{await loadFolderPreview();}finally{busy=false;}}else if(!folderPreview?.eagle)folderPreview=null;}const it=item&&await host.item.getById(item.id);item=it||null;render();}catch{}finally{polling=false;if(pendingSelection)void drainSelection();}},1800);
    }catch(e){root.innerHTML=`<div class="notice error">${esc(e.message)}<p>请在 Eagle 插件开发菜单中加载此目录，再打开 Eagle AssetLink。</p></div>`;}
  }
  if(demo)init();else if(window.eagle)window.eagle.onPluginCreate(init);else root.innerHTML='<div class="loading">此页面需要 Eagle 插件环境。<a href="?demo=1">打开只读界面演示</a></div>';
})();
