(()=>{
/* Visibility must agree with probe.js, including the sr-only clip signature. */
const srOnly=s=>s.clip==='rect(0px, 0px, 0px, 0px)'||/inset\(\s*50%/.test(s.clipPath||'');
const vis=el=>{const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;if(srOnly(s))return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};

/* djb2. Runs of digits collapse to one # first: a clock, a countdown or a 3-of-12
   counter would otherwise change on every sample and fake a new state. One-for-one digit
   replacement is not enough, since a counter crossing 9 to 10 changes the string length. */
const hash=s=>{let h=5381;for(let i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))>>>0}return h};
const signature=()=>{
  const els=[...document.querySelectorAll('body *')].filter(vis);
  const txt=(document.body.innerText||'').replace(/[0-9]+/g,'#');
  return els.length+'|'+hash(txt);
};

/* A path must survive re-navigation, so it cannot rely on any attribute we set at runtime.
   An id is best when it is a safe identifier; otherwise walk a nth-child chain from body. */
const ID_OK=/^[A-Za-z][\w-]*$/;
const uniq=p=>{try{return document.querySelectorAll(p).length===1}catch(e){return false}};
const path=el=>{
  if(el.id&&ID_OK.test(el.id)){const p='#'+el.id;if(uniq(p))return p}
  const parts=[];let n=el;
  while(n&&n!==document.body&&n.parentElement){
    const par=n.parentElement;
    const idx=[...par.children].indexOf(n)+1;
    parts.unshift(n.tagName.toLowerCase()+':nth-child('+idx+')');
    n=par;
  }
  const p='body > '+parts.join(' > ');
  return uniq(p)?p:null;
};

const nameOf=el=>((el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||'').trim()).slice(0,40);

const candidates=[];
for(const el of [...document.querySelectorAll('[role=tab]')]){
  if(!vis(el))continue;
  const p=path(el);
  if(!p)continue;
  candidates.push({path:p,kind:'tab',label:nameOf(el),mutating:false,rank:1});
}

return {sig:signature(),candidates:candidates};
})()
