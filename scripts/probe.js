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

/* Colour resolution. The browser parses lab()/oklch() for us; never parse them by hand. */
const cvs=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
const px=s=>{try{
  cvs.clearRect(0,0,1,1);            /* REQUIRED: without this a transparent fill reads the previous pixel */
  cvs.fillStyle='rgba(0,0,0,0)';
  cvs.fillStyle=s;
  cvs.fillRect(0,0,1,1);
  const d=cvs.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]];
}catch(e){return null}};
const lum=c=>{const a=c.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
const ratio=(f,b)=>{const L1=lum(f),L2=lum(b);return (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05)};
const bgOf=el=>{let n=el;while(n&&n.nodeType===1){const c=px(getComputedStyle(n).backgroundColor);if(c&&c[3]>200)return c;n=n.parentElement}return [255,255,255,255]};
const rgb=c=>'rgb('+c[0]+','+c[1]+','+c[2]+')';
/* aria-hidden marks decoration. WCAG 1.4.3 exempts incidental content, and a separator
   like <span aria-hidden="true">&middot;</span> is the standard way to write it. */
const ariaHidden=e=>{let n=e;while(n&&n.nodeType===1){if(n.getAttribute('aria-hidden')==='true')return true;n=n.parentElement}return false};

/* contrast: real foreground text colour vs resolved ancestor background, via canvas round-trip. */
for(const e of all){
  const hasText=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  if(!hasText)continue;
  if(ariaHidden(e))continue;
  const s=getComputedStyle(e);
  const fg=px(s.color);
  if(!fg||fg[3]<200)continue;
  const bg=bgOf(e);
  const cr=ratio(fg,bg);
  const size=parseFloat(s.fontSize),bold=+s.fontWeight>=700;
  const need=(size>=24||(size>=18.66&&bold))?3:4.5;
  if(cr<need) add('contrast',e,'contrast '+cr.toFixed(2)+':1 is below '+need+':1',{fg:rgb(fg),bg:rgb(bg),ratio:+cr.toFixed(2)});
}

const INTER='a[href],button,input,select,textarea,[role=button],[role=link],[onclick]';
/* WCAG 2.2 target-size exempts a target whose size is "constrained by the line-height of
   non-target text". That is any text link: its box is the text line, not a chosen size.
   Measured on DashClaw: 145/145 tap-target findings were such links, 99 from one nav class.
   A link with no text has no line to constrain it, so it stays a real target. */
const textLink=e=>{
  if(e.tagName!=='A')return false;
  if(!(e.textContent||'').trim())return false;
  const s=getComputedStyle(e);
  const lh=parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.2;
  return e.getBoundingClientRect().height<=lh+2;
};
const controls=all.filter(e=>e.matches(INTER));

for(const e of controls){
  if(textLink(e))continue;
  const r=e.getBoundingClientRect();
  if(r.width<24||r.height<24)
    add('tap-target',e,'tap target '+Math.round(r.width)+'x'+Math.round(r.height)+' is under 24x24');
}

for(const e of controls){
  const name=(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent||'').trim()
    ||(e.querySelector('img[alt]')&&e.querySelector('img[alt]').alt||'')
    ||(e.getAttribute('aria-labelledby')?'x':'')
    ||(e.value||'');
  if(!name) add('no-accessible-name',e,e.tagName.toLowerCase()+' has no accessible name');
}

/* UNPROVEN. Sticky headers and custom dropdowns are the expected false-positive source. */
/* Enabled only when window.__FV_OCCLUSION === true, set by verify-routes.mjs. */
if(typeof window!=='undefined'&&window.__FV_OCCLUSION===true){
  for(const e of controls){
    const r=e.getBoundingClientRect();
    const cx=r.left+r.width/2,cy=r.top+r.height/2;
    if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;
    const top=document.elementFromPoint(cx,cy);
    if(top&&top!==e&&!e.contains(top)&&!top.contains(e))
      add('occluded-control',e,'control is covered by '+sel(top)+' at its centre point');
  }
}

return {viewport:[innerWidth,innerHeight],scanned:all.length,findings:F};
})()
