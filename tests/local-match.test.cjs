const test=require('node:test'),assert=require('node:assert/strict'),C=require('../js/core.cjs');
test('contains fallback runs only after every precise name has no matches',async()=>{
 const calls=[],row={path:require('node:path').resolve('Asset_Chair_4K.blend'),type:'file'};
 const result=await C.searchNames({...C.DEFAULTS},['Chair_preview','Chair'],{},async(s,n,o)=>{calls.push([n,!!o.fuzzy]);return {rows:o.fuzzy?[row]:[],issues:[],incomplete:false};});
 assert.deepEqual(calls,[['Chair_preview',false],['Chair',false],['Chair_preview',true],['Chair',true]]);
 assert.equal(result.rows.length,1);assert.equal(result.fallback,true);
 calls.length=0;
 const exact=await C.searchNames({...C.DEFAULTS},['Chair'],{},async(s,n,o)=>{calls.push(!!o.fuzzy);return {rows:[row],issues:[],incomplete:false};});
 assert.deepEqual(calls,[false]);assert.equal(exact.fallback,false);
});
test('local preview suffix matches cleaned Eagle name without relaxing asset ID',()=>{
 const s={...C.DEFAULTS},file='Construction_Plaster_pjBnR20_Preview.png';
 for(const name of ['Construction_Plaster_pjBnR20','Construction_Plaster_pjBnR0']){
  const expected=name.endsWith('R20');
  if(expected)assert(new RegExp(C.localNamePattern(name,s),'i').test(file));
  assert.equal(C.localNameMatches(file,'file',name,s),expected);
 }
 assert.equal(C.localNameMatches(file,'file','Construction_Plaster_pjBnR20',{...s,cleanEnabled:false}),false);
 assert.equal(C.localNameMatches('A_preview_thumb.png','file','A',s),true);
});
test('local cleaner honors literal and anywhere rules',()=>{
 const s={...C.DEFAULTS,keywords:['[preview]'],cleanMode:'anywhere'};
 assert(new RegExp(C.localNamePattern('Chair',s),'i').test('Ch[preview]air.png'));
 assert(C.localNameMatches('Ch[preview]air.png','file','Chair',s));
 assert(!C.localNameMatches('Chair2.png','file','Chair',s));
});
