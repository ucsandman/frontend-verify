(()=>{
const F=[];
const sel=e=>{if(!e||!e.tagName)return null;if(e.id)return '#'+e.id;let s=e.tagName.toLowerCase();if(e.className&&typeof e.className==='string'){const c=e.className.trim().split(/\s+/).slice(0,2).join('.');if(c)s+='.'+c}return s};
const add=(rule,el,msg,extra)=>{const r=el.getBoundingClientRect&&el.getBoundingClientRect();const rv=F.length;try{el.setAttribute('data-rv',String(rv))}catch(e){}F.push(Object.assign({rv,rule,msg,sel:sel(el),box:r?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]:null},extra||{}))};
const vis=el=>{const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
const all=[...document.querySelectorAll('body *')].filter(vis);

/* h-overflow: the page scrolls sideways. Report the right-most offender. */
if(document.documentElement.scrollWidth>document.documentElement.clientWidth+1){
  const w=document.documentElement.clientWidth;
  const worst=all.filter(e=>e.getBoundingClientRect().right>w+1)
                 .sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right)[0];
  add('h-overflow',worst||document.body,'page scrolls sideways: scrollWidth '+document.documentElement.scrollWidth+' > viewport '+w);
}

/* broken-image: finished loading with no pixels. */
for(const img of document.querySelectorAll('img')){
  const src=(img.getAttribute('src')||'').trim();
  /* no src yet: a placeholder or lazy-load stub, not a broken image */
  if(!src)continue;
  if(img.complete&&img.naturalWidth===0)
    add('broken-image',img,'img failed to load: '+src);
}

/* clipped-text: real text cut off, and the author did not opt into an ellipsis. */
for(const e of all){
  const s=getComputedStyle(e);
  const ownText=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  if((s.overflow==='hidden'||s.overflowX==='hidden')&&e.scrollWidth>e.clientWidth+1&&e.clientWidth>0&&s.textOverflow!=='ellipsis'&&ownText)
    add('clipped-text',e,'text cut off: scrollWidth '+e.scrollWidth+' > clientWidth '+e.clientWidth);
}

return {viewport:[innerWidth,innerHeight],scanned:all.length,findings:F};
})()
