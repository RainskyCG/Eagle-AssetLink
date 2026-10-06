/* Central file browser presentation. No disk writes or Eagle mutations. */
window.createBridgeBrowser = ({esc,path,fileIcon,demo}) => {
  const prefs={mode:'details',sort:'name',reverse:false,size:128,dateWidth:170,sizeWidth:90};
  try { const p=JSON.parse(localStorage.getItem('bridge-browser-view')||'{}');
    if(['details','compact','grid'].includes(p.mode))prefs.mode=p.mode;
    if(['name','mtime','size'].includes(p.sort))prefs.sort=p.sort;
    prefs.reverse=!!p.reverse;for(const k of ['dateWidth','sizeWidth'])if(Number.isFinite(p[k]))prefs[k]=Math.max(70,Math.min(320,p[k]));if(Number.isFinite(p.size))prefs.size=Math.max(80,Math.min(256,p.size));
  } catch {}
  let query='',types=new Set(),filters=false,showHidden=false;
  const save=()=>{try{localStorage.setItem('bridge-browser-view',JSON.stringify(prefs));}catch{}};
  const levels=[80,112,160,208,256];
  function viewLevel(){return prefs.mode==='details'?0:prefs.mode==='compact'?1:2+levels.reduce((best,n,i)=>Math.abs(n-prefs.size)<Math.abs(levels[best]-prefs.size)?i:best,0);}
  function setViewLevel(value){const level=Math.max(0,Math.min(6,Math.round(Number(value)||0)));prefs.mode=level===0?'details':level===1?'compact':'grid';if(level>=2)prefs.size=levels[level-2];save();}
  const imageFile=p=>/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)$/i.test(p);
  const group=r=>r.type==='folder'?'folder':/\.blend$/i.test(r.path)?'blend':/\.blend\d+$/i.test(r.path)?'backup':/\.(py|js|sh|bat|ps1)$/i.test(r.path)?'script':/\.(ttf|otf|woff2?)$/i.test(r.path)?'font':/\.(txt|md|json|xml|csv|srt|vtt)$/i.test(r.path)?'text':/\.(vdb|abc)$/i.test(r.path)?'volume':/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?|exr|hdr|psd|psb|heic|raw|dng)$/i.test(r.path)?'image':/\.(blend\d*|fbx|obj|glb|gltf|stl|usd[z]?|max)$/i.test(r.path)?'model':/\.(mp4|mov|mkv|webm|avi)$/i.test(r.path)?'video':/\.(mp3|wav|flac|ogg|m4a)$/i.test(r.path)?'audio':/\.(zip|rar|7z|gz|tar)$/i.test(r.path)?'archive':'other';
  const source=p=>demo?'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#697681"/></svg>'):require('url').pathToFileURL(p).href;
  const bytes=n=>{if(!Number.isFinite(n))return '—';if(n<1024)return n+' B';const i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));return (n/1024**i).toFixed(1)+' '+['B','KB','MB','GB'][i];};
  const glyph=name=>`<i class="bridge-icon blender-icon ui-${name}" aria-hidden="true"></i>`;
  const btn=(action,label,title,disabled=false)=>`<button data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}" ${disabled?'disabled':''}>${label}</button>`;
  function render({rows,dir,eagle,choosing,back,forward,notice,isError,limit,canUp}) {
    const parts=query.toLowerCase().split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    const match=new RegExp(parts.join('.*'),'i');
    let shown=rows.filter(r=>match.test(path.basename(r.path))&&(!types.size||types.has(group(r)))&&(showHidden||!path.basename(r.path).startsWith('.')));
    if(!choosing)shown=shown.slice().sort((a,b)=>{
      const folders=(a.type==='folder'?0:1)-(b.type==='folder'?0:1);if(folders)return folders;
      const compare=prefs.sort==='name'?path.basename(a.path).localeCompare(path.basename(b.path),'zh-CN',{numeric:true}):(a[prefs.sort]||0)-(b[prefs.sort]||0);
      return (prefs.reverse?-1:1)*compare;
    });
    let h=`<div class="browser-size-bar"><span>−</span><input id="browser-size" aria-label="缩略图大小" type="range" min="0" max="6" step="1" value="${viewLevel()}"><span>＋</span></div>`+'<div class="browser-toolbar"><div class="browser-nav">'+btn('folder-back',glyph('back'),'后退 · Alt+←',!back)+btn('browser-forward',glyph('forward'),'前进 · Alt+→',!forward)+btn('browser-up',glyph('up'),'上一级 · Alt+↑',!canUp)+btn('browser-refresh',glyph('refresh'),'刷新 · F5')+'</div>'+btn('browser-mkdir',glyph('newfolder'),'新建文件夹',!dir||eagle||choosing)+
      `<input id="browser-path" aria-label="当前路径" title="${esc(dir||'')}" value="${esc(dir||'')}" placeholder=""><input id="browser-search" type="search" aria-label="搜索" placeholder="搜索" value="${esc(query)}">`+
      '<div class="browser-modes">'+['details','compact','grid'].map((m,i)=>`<button data-browser-mode="${m}" aria-label="${['详细列表','水平列表','缩略图'][i]}" aria-pressed="${prefs.mode===m}" title="${['详细列表','水平列表','缩略图'][i]}">${glyph(m)}</button>`).join('')+'</div>'+btn('browser-filter',glyph('filter'),'筛选与显示设置')+btn('browser-settings',glyph('settings'),'插件设置')+'</div>';
    if(filters)h+=`<div class="browser-filters" role="dialog" aria-label="筛选文件">${Object.entries({folder:'文件夹',blend:'.blend 文件',backup:'备份 .blend 文件',script:'脚本文件',font:'字体文件',text:'文本文件',volume:'体积文件',image:'图像文件',model:'模型文件',video:'影片文件',audio:'音频文件',archive:'压缩文件',other:'其他文件'}).map(([v,l])=>`<label><i class="bridge-icon blender-icon icon-${({folder:'folder',blend:'blend',backup:'blend',script:'text',font:'font',text:'text',volume:'3d',image:'image',video:'movie',audio:'sound',model:'3d',archive:'archive'})[v]||'blank'}"></i><input type="checkbox" data-filter-type="${v}" ${types.has(v)?'checked':''}>${l}</label>`).join('')}<hr><label><input type="checkbox" id="browser-hidden" ${showHidden?'checked':''}>显示隐藏项</label><small>未勾选类型时显示全部</small></div>`;
    if(eagle)h+='<div class="library-marker">Eagle库文件列表</div>';
    if(choosing)h+='<div class="browser-hint">双击候选项确认关联并浏览所在文件夹</div>';
    if(notice)h+=`<div class="notice ${isError?'error':''}">${esc(notice)}</div>`;
    if(prefs.mode==='details')h+='<div class="browser-columns">'+[['name','名称'],['mtime','修改日期'],['size','大小']].map(([v,l])=>`<button data-browser-sort="${v}" ${choosing?'disabled':''}>${l}${!choosing&&prefs.sort===v?(prefs.reverse?' ▾':' ▴'):''}${v!=='name'?`<i class="column-resize" data-resize-column="${v}" title="拖动调整列宽"></i>`:''}</button>`).join('')+'</div>';
    h+=`<div class="candidate-list browser-files view-${prefs.mode}" style="--thumb-size:${prefs.size}px" aria-label="文件列表">`;
    for(const r of shown.slice(0,limit)){
      const name=path.basename(r.path);
      h+=`<button class="candidate ${r.current?'current':''}" draggable="true" ${r.action} title="${esc(r.path)}">`;
      if(prefs.mode==='grid'&&imageFile(r.path))h+=`<span class="browser-thumb">${fileIcon(r)}<img loading="lazy" decoding="async" data-thumbnail ${/\.tiff?$/i.test(r.path)&&!demo?`data-tiff="${esc(r.path)}"`:`src="${esc(source(r.path))}"`} alt=""></span>`;
      else if(prefs.mode==='grid')h+=`<span class="browser-thumb browser-type-thumb">${fileIcon(r)}</span>`;
      else h+=fileIcon(r);
      h+=`<span class="browser-name">${esc(name)}</span><span class="browser-date">${r.mtime?esc(new Date(r.mtime).toLocaleString('zh-CN',{hour12:false})):'—'}</span><span class="browser-size">${r.type==='folder'?'':bytes(r.size)}</span></button>`;
    }
    if(!shown.length)h+='<div class="empty">'+(rows.length?'没有符合筛选条件的文件':'文件夹为空')+'</div>';
    if(shown.length>limit)h+=btn('more-folder','显示更多','继续加载文件');
    return `<div class="browser-layout${eagle?' eagle-fallback':''}" style="--date-width:${prefs.dateWidth}px;--size-width:${prefs.sizeWidth}px">`+h+'</div></div>';
  }
  return {render,source,viewLevel,setViewLevel,getPrefs:()=>({...prefs}),setDirection(v){prefs.reverse=v;save();},chooseSort(v){prefs.sort=v;save();},reset(){query='';types.clear();},setColumn(key,width){prefs[key==='mtime'?'dateWidth':'sizeWidth']=Math.max(70,Math.min(320,width));save();},setQuery(v){query=v;},setType(v){types=v==='all'?new Set():new Set([v]);},toggleType(v){types.has(v)?types.delete(v):types.add(v);},setHidden(v){showHidden=v;},closeFilters(){filters=false;},toggleFilters(){filters=!filters;},setMode(v){if(['details','compact','grid'].includes(v)){prefs.mode=v;save();}},setSort(v){if(['name','mtime','size'].includes(v)){prefs.reverse=prefs.sort===v?!prefs.reverse:false;prefs.sort=v;save();}},setSize(v){prefs.size=Math.max(80,Math.min(256,Number(v)||128));save();}};
};
