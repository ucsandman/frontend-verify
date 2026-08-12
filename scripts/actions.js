(()=>{
/* Visibility must agree with probe.js, including the sr-only clip signature. */
const srOnly=s=>s.clip==='rect(0px, 0px, 0px, 0px)'||/inset\(\s*50%/.test(s.clipPath||'');
const vis=el=>{const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;if(srOnly(s))return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};

/* djb2. Digits are stripped first: a clock, a countdown or a 3-of-12 counter would
   otherwise change on every sample and make every interaction look like a new state. */
const hash=s=>{let h=5381;for(let i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))>>>0}return h};
const signature=()=>{
  const els=[...document.querySelectorAll('body *')].filter(vis);
  const txt=(document.body.innerText||'').replace(/[0-9]/g,'#');
  return els.length+'|'+hash(txt);
};

return {sig:signature(),candidates:[]};
})()
