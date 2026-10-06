// Restore a passive last frame synchronously while Eagle reloads the webview.
// Text is rebuilt with DOM APIs; cached rows never have action handlers.
(()=>{
  const root=document.getElementById('app');root.inert=true;
  try{
    const css=sessionStorage.getItem('bridge-native-style');
    if(css){const style=document.createElement('style');style.id='bridge-cached-style';style.textContent=css;document.head.appendChild(style);}
    const frame=JSON.parse(sessionStorage.getItem('bridge-frame')||'null');if(!frame)return;
    if(['gray','light','lightgray','dark','black','blue','purple'].includes(frame.theme))document.body.setAttribute('theme',frame.theme);
    document.body.classList.toggle('light',['light','lightgray'].includes(frame.theme));
    const toggle=document.createElement('div');toggle.className='candidate-toggle-row';const arrow=document.createElement('button');arrow.className='candidate-toggle';arrow.textContent=frame.open?'▴':'▾';toggle.appendChild(arrow);root.appendChild(toggle);
    if(frame.open&&Array.isArray(frame.rows)&&frame.rows.length){
      const list=document.createElement('div');list.className='candidate-list'+(frame.eagle?' eagle-fallback':'');if(frame.eagle){const mark=document.createElement('div');mark.className='library-marker';mark.textContent='Eagle库文件列表';list.appendChild(mark);}
      for(const row of frame.rows.slice(0,2000)){
        const el=document.createElement('button');el.className='candidate'+(row.current?' current':'')+(row.selected?' selected':'');el.tabIndex=-1;
        const ns='http://www.w3.org/2000/svg',glyph=document.createElementNS(ns,'svg');
        for(const [key,value] of Object.entries({class:'bridge-icon',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linejoin':'round'}))glyph.setAttribute(key,value);
        for(const shape of (Array.isArray(row.icon)?row.icon:[])){
          if(!['path','circle','rect','ellipse','line','polyline','polygon'].includes(shape.tag))continue;
          const node=document.createElementNS(ns,shape.tag);
          for(const [key,value] of Object.entries(shape.attrs||{}))if(['d','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','points'].includes(key))node.setAttribute(key,String(value));
          glyph.appendChild(node);
        }
        const name=document.createElement('span');name.textContent=String(row.name||'');if(['folder','blank','blend','image','movie','sound','font','text','archive','3d'].includes(row.iconKind)){const official=document.createElement('i');official.className='bridge-icon blender-icon icon-'+row.iconKind;el.append(official,name);}else el.append(glyph,name);list.appendChild(el);
      }
      root.appendChild(list);
    }
  }catch{}
})();
