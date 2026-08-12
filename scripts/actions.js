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

/* Names are compared UNTRUNCATED and whitespace-normalised. A confirm button reads
   'Yes, I understand this is permanent, delete it' and the dangerous word sits past
   character 40, so truncating before the test loses it. NBSP counts as whitespace. */
const norm=s=>(s||'').replace(/[\s\u00a0]+/g,' ').trim();
/* textContent fuses adjacent nodes with no separator: two option elements reading Choose
   and Delete selected rows come out as ChooseDelete selected rows, and a word-boundary
   match can no longer see the verb. React and minified HTML emit exactly that shape, so
   every name is built by joining descendant text nodes with a space instead.
   Joining with a space fixes that shape but breaks the opposite one: an accesskey
   underline writes <u>D</u>elete account, which space-joins to D elete account and loses
   the same boundary. So the joiner is a parameter and the danger test reads the name BOTH
   ways, spaced and fused. A word only has to look dangerous in one of them. */
const textOf=(el,j)=>{
  let s='';
  const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null);
  while(w.nextNode())s+=j+w.currentNode.nodeValue;
  return s;
};
const labelsFor=(el,j)=>{
  let s='';
  if(el.id)for(const l of [...document.querySelectorAll('label[for]')])if(l.getAttribute('for')===el.id)s+=j+textOf(l,j);
  const w=el.closest&&el.closest('label');
  if(w)s+=j+textOf(w,j);
  return s;
};
/* An input has no textContent, so without value, placeholder and its label an input
   named Delete account would score as the empty string and always look safe. */
const fullName=(el,j)=>norm(
  (el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')+' '+
  (el.getAttribute('value')||'')+' '+(el.getAttribute('placeholder')||'')+' '+
  labelsFor(el,j)+' '+textOf(el,j)
);
/* Reads dangerous under either reading of the text nodes. */
const danger=el=>DANGER.test(fullName(el,' '))||DANGER.test(fullName(el,''));
const nameOf=el=>fullName(el,' ').slice(0,40);

const DANGER=/\b(delete|remove|revoke|destroy|reset|erase|wipe|purge|drop|terminate|deactivate|suspend|cancel|unsubscribe|downgrade|upgrade|pay|charge|purchase|buy|send|invite|publish|deploy|save|create|update|apply|submit|confirm|approve|reject|disable|transfer|archive|nuke|shut ?down|factory|sign ?out|log ?out)\b/i;
const FIELD=/^(INPUT|SELECT|TEXTAREA)$/;
const BTN_TYPE=/^(submit|image|button|reset)$/;
/* Empty string included: an input with no type attribute defaults to text. */
const TYPED=/^(|text|email|password|search|tel|url|number|date|datetime-local|month|week|time)$/;
const TOGGLE=/^(checkbox|radio)$/;

const mutating=el=>{
  const t=el.tagName;
  const ty=(el.getAttribute('type')||'').toLowerCase();
  /* input type=image IS a submit button per the HTML spec. */
  if(t==='INPUT'&&(ty==='submit'||ty==='image'))return true;
  if(t==='BUTTON'&&ty==='submit')return true;
  if(t==='BUTTON'&&!el.hasAttribute('type')&&el.closest('form'))return true;
  if(el.hasAttribute('formaction'))return true;
  /* A form is FILLED, never submitted, so its descendant text is irrelevant: almost every
     real form contains a Save or Create button and testing the whole subtree would skip
     every form on earth. The action attribute is the only signal about what a submit would
     do, so judge the form on that alone. */
  if(t==='FORM')return DANGER.test(norm(el.getAttribute('action')||''));
  /* A TYPED field is filled with text, which cannot change server state, so it is safe
     regardless of its name. This carve-out is required: the danger list matches Confirm
     password, Create a password and Reset your password, so without it ordinary signup
     fields become unfillable.
     A checkbox, radio or select is TOGGLED, not typed, and a toggle is a state change that
     many apps auto-save. Those fall through to the danger test below, so
     <input type=checkbox role=switch aria-label='Revoke all API keys'> stays mutating. */
  if(t==='TEXTAREA')return false;
  /* A positive allowlist, not an exclusion list. file, range and color are not typed:
     a file input attaches an upload and a range is a toggle, so an exclusion list that
     only skipped the button types let both of those through as safe. */
  if(t==='INPUT'&&TYPED.test(ty))return false;
  if(danger(el))return true;
  /* Anything left is an input the tool cannot fill with text and does not understand, so
     it is mutating whatever it is named. This line is load bearing: kindOf still calls a
     file input a field, so the fail-closed default never fires for it, and
     <input type=file aria-label='Replace production database dump'> carries no danger
     word at all. */
  if(t==='INPUT'&&!TOGGLE.test(ty))return true;
  if(t==='A'){
    const h=el.getAttribute('href')||'';
    if(h&&h.charAt(0)!=='#'&&h.indexOf('javascript:')!==0&&h!==location.pathname)return true;
  }
  return false;
};

/* The safe set is deliberately narrow. role=menuitem, data-state alone and
   button[type=button] were all removed after a live adversarial run classified 9 of 10
   destructive controls as safe: a Radix switch carries data-state, a menu item performs
   an action, and a type=button can call fetch(/api/delete). Anything not listed here
   returns null and the caller forces mutating:true. */
const kindOf=el=>{
  if(el.matches('[role=tab]'))return {kind:'tab',rank:1};
  if(el.tagName==='SUMMARY'||el.matches('[aria-expanded]'))return {kind:'disclosure',rank:2};
  if(el.matches('[aria-haspopup]'))return {kind:'dialog',rank:3};
  if(el.tagName==='FORM')return {kind:'form',rank:4};
  if(FIELD.test(el.tagName)&&!(el.tagName==='INPUT'&&BTN_TYPE.test((el.getAttribute('type')||'').toLowerCase())))return {kind:'field',rank:5};
  return null;
};

const SEL='a[href],button,input,select,textarea,form,summary,[role=tab],[role=menuitem],[role=button],[role=switch],[aria-expanded],[aria-haspopup],[data-state]';
const seen={};
const candidates=[];
for(const el of [...document.querySelectorAll(SEL)]){
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
