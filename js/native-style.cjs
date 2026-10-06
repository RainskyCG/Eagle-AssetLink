'use strict';
// Reuse installed Eagle CSS, without loading its Angular components or global layout.
// Internal resource paths may change; the plugin keeps a small fallback stylesheet.
const fs=require('fs');
const path=require('path');
function extract(base,app){
  const out=[];
  for(const [css,kind] of [[base,'base'],[app,'app']]){
    for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      let selector=match[1].trim().replace(/^\uFEFF/,'');const body=match[2];
      if(kind==='base'&&/^(?:\:root|body\[theme=)/.test(selector)&&!selector.includes('.')){
        const vars=body.split(';').filter(x=>x.trim().startsWith('--')).join(';');
        if(vars)out.push(`${selector}{${vars}}`);
      }
      const selectors=selector.split(',').map(x=>x.trim()).filter(x=>{
        if(kind==='base')return /^(?:body\[theme=[a-z]+\] )?\.ic-btn(?:\.has-bg)?(?::hover|:active)?$/.test(x);
        return (x.includes('.inspector .inspector-content .label-container .label-item')&&!x.includes('.color-'))||x.includes('.inspector .inspector-content .export-container .export-btn');
      }).map(x=>x.replace('.inspector .inspector-content .label-container','.priority').replace('.inspector .inspector-content .export-container .export-btn','.inspector-bar .inspector-button'));
      if(selectors.length)out.push(`${selectors.join(',')}{${body}}`);
    }
  }
  return out.join('\n');
}
function load(resourcesPath){
  const dir=path.join(resourcesPath,'app.asar','app','css');
  return extract(fs.readFileSync(path.join(dir,'base.css'),'utf8'),fs.readFileSync(path.join(dir,'app.css'),'utf8'));
}
module.exports={extract,load};
