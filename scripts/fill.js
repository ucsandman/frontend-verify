(()=>{
const MODE='__MODE__';
const root=document.querySelector('__PATH__');
if(!root)return {filled:0};

/* React ignores a plain el.value assignment: it tracks the previous value on the node and
   sees no change. Go through the prototype setter, then dispatch a bubbling input event. */
const setNative=(el,v)=>{
  const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  const d=Object.getOwnPropertyDescriptor(proto,'value');
  if(d&&d.set)d.set.call(el,v);else el.value=v;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new Event('blur',{bubbles:true}));
};

const LONG='Test value long enough to reveal clipping';
const valueFor=(el)=>{
  const t=(el.getAttribute('type')||'text').toLowerCase();
  const bad=MODE==='invalid';
  if(t==='email')return bad?'not-an-email':'test@example.com';
  if(t==='url')return bad?'nope':'https://example.com';
  if(t==='tel')return bad?'abc':'5555550123';
  if(t==='number'){
    const min=parseFloat(el.getAttribute('min'));
    const max=parseFloat(el.getAttribute('max'));
    if(bad)return isNaN(min)?'abc':String(min-1);
    if(!isNaN(min)&&!isNaN(max))return String(Math.round((min+max)/2));
    return '42';
  }
  if(t==='date')return bad?'9999-13-45':'2026-01-15';
  if(t==='password')return bad?'a':'Password123!';
  if(bad)return el.hasAttribute('required')?'':LONG.slice(0,3);
  return LONG;
};

let filled=0;
const fields=root.matches('input,select,textarea')?[root]:[...root.querySelectorAll('input,select,textarea')];
for(const el of fields){
  if(el.disabled||el.readOnly)continue;
  const t=(el.getAttribute('type')||'').toLowerCase();
  if(t==='submit'||t==='button'||t==='file'||t==='hidden')continue;
  if(el.tagName==='SELECT'){
    if(MODE==='invalid')continue;
    if(el.options.length>1)el.selectedIndex=1;else if(el.options.length)el.selectedIndex=0;
    el.dispatchEvent(new Event('change',{bubbles:true}));
    filled++;continue;
  }
  if(t==='checkbox'||t==='radio'){
    if(MODE==='invalid')continue;
    el.checked=true;
    el.dispatchEvent(new Event('change',{bubbles:true}));
    filled++;continue;
  }
  setNative(el,valueFor(el));
  filled++;
}
return {filled:filled};
})()
