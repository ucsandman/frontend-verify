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

/* Anything whose accessible name says it changes the world. */
const DANGER=/\b(delete|remove|revoke|destroy|reset|erase|wipe|cancel|unsubscribe|downgrade|upgrade|pay|charge|purchase|buy|send|invite|publish|deploy|sign ?out|log ?out)\b/i;
const FIELD=/^(INPUT|SELECT|TEXTAREA)$/;

const mutating=el=>{
  const t=el.tagName;
  const ty=(el.getAttribute('type')||'').toLowerCase();
  if(t==='INPUT'&&ty==='submit')return true;
  if(t==='BUTTON'&&ty==='submit')return true;
  if(t==='BUTTON'&&!el.hasAttribute('type')&&el.closest('form'))return true;
  if(el.hasAttribute('formaction'))return true;
  if(DANGER.test(nameOf(el)))return true;
  if(t==='A'){
    const h=el.getAttribute('href')||'';
    if(h&&h.charAt(0)!=='#'&&h.indexOf('javascript:')!==0&&h!==location.pathname)return true;
  }
  return false;
};

/* Returns null when the element is not positively recognised. The caller treats that as
   mutating, so an unknown control is never clicked without an explicit opt-in. */
const kindOf=el=>{
  if(el.matches('[role=tab],[role=menuitem]'))return {kind:'tab',rank:1};
  if(el.tagName==='SUMMARY'||el.matches('[aria-expanded],[data-state]'))return {kind:'disclosure',rank:2};
  if(el.matches('[aria-haspopup]'))return {kind:'dialog',rank:3};
  if(el.tagName==='FORM')return {kind:'form',rank:4};
  if(FIELD.test(el.tagName))return {kind:'field',rank:5};
  if(el.tagName==='BUTTON'&&(el.getAttribute('type')||'').toLowerCase()==='button')return {kind:'control',rank:6};
  return null;
};

const SEL='a[href],button,input,select,textarea,form,summary,[role=tab],[role=menuitem],[role=button],[aria-expanded],[aria-haspopup],[data-state]';
const seen={};
const candidates=[];
for(const el of [...document.querySelectorAll(SEL)]){
  /* A form is a container: measure it by its own box only if something in it is visible. */
  if(el.tagName!=='FORM'&&!vis(el))continue;
  const p=path(el);
  if(!p||seen[p])continue;
  seen[p]=1;
  const k=kindOf(el);
  candidates.push({
    path:p,
    kind:k?k.kind:'control',
    label:nameOf(el),
    mutating:mutating(el)||!k,
    rank:k?k.rank:6
  });
}
candidates.sort((a,b)=>a.rank-b.rank);

return {sig:signature(),candidates:candidates};
})()
