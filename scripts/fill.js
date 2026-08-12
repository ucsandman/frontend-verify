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
  const type=(el.getAttribute('type')||'').toLowerCase();
  if(type==='submit'||type==='button'||type==='file'||type==='hidden')continue;
  if(el.tagName==='SELECT'){
    if(MODE==='invalid')continue;
    if(el.options.length>1)el.selectedIndex=1;else if(el.options.length)el.selectedIndex=0;
    el.dispatchEvent(new Event('change',{bubbles:true}));
    filled++;continue;
  }
  if(type==='checkbox'||type==='radio'){
    if(MODE==='invalid')continue;
    /* React gates checkbox and radio change-detection on the native CLICK, never on a
       change event, and plain assignment keeps its value tracker in sync so nothing
       registers. Setting checked and dispatching change is therefore invisible to a
       React-controlled checkbox: the same silent no-op the native setter exists to avoid
       for text inputs. A real click is the actual user action and works everywhere.
       This is the only click call in the file. It happens ONLY here, on a checkbox or
       radio, and it can never reach a button or anything that would send the form. */
    if(!el.checked)el.click();
    filled++;continue;
  }
  setNative(el,valueFor(el));
  filled++;
}
return {filled:filled};
})()
