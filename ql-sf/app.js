'use strict';
const DATA=window.WIKI_DATA;
const $=id=>document.getElementById(id);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const units=DATA.docs.flatMap(d=>d.sections.map(s=>({...s,doc:d,key:d.id+'/'+s.id})));
const keySet=new Set(units.map(s=>s.key));
function getSaved(key,fallback){try{return JSON.parse(localStorage.getItem('ql-book-v2-'+key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem('ql-book-v2-'+key,JSON.stringify(value));}catch{}}
let done=new Set(getSaved('done',[]).filter(key=>keySet.has(key)));
let currentDoc=null,currentSection=null,toastTimer;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2000);}
function routeOf(d,s){return '#/'+d.id+(s?'/'+s.id:'');}
function renderMath(root){
  root.querySelectorAll('.math').forEach(node=>{
    const tex=node.textContent,display=node.dataset.display==='true';node.dataset.tex=tex;
    const tag=tex.match(/\\tag\{([^}]+)\}/),visible=display?tex.replace(/\\tag\{[^}]+\}/,''):tex;
    try{if(!window.katex)throw Error('KaTeX unavailable');katex.render(visible,node,{displayMode:display,throwOnError:true,trust:false,strict:'ignore'});}
    catch(error){node.classList.add('math-error');node.title=String(error);}
    if(display){
      if(tag){const label=document.createElement('span');label.className='equation-label';label.textContent='('+tag[1]+')';node.parentElement.append(label);}
      const button=document.createElement('button');button.className='copy-eq';button.textContent='复制 TeX';button.setAttribute('aria-label','复制公式 TeX');
      button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(tex);toast('已复制公式');}catch{const t=document.createElement('textarea');t.value=tex;t.style.cssText='position:fixed;opacity:0';document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'已复制公式':'请在 TeX 源文件中查看公式');}});node.parentElement.append(button);
    }
  });
}
function sidebar(){
  const position=$('sidebar').scrollTop;
  $('chapters').innerHTML=DATA.parts.map(part=>`<div class="nav-group">${part.id==='appendix'?'':part.id+' · '}${esc(part.title)}</div>`+DATA.docs.filter(d=>d.part===part.id).map(d=>`<details class="chapter-details" ${currentDoc===d.id?'open':''}><summary><a class="chapter-link ${currentDoc===d.id?'active':''}" href="${routeOf(d)}"><span class="chapter-no">${d.id}</span><span>${esc(d.title)}</span></a></summary><div class="section-nav">${d.sections.map(s=>`<a class="section-link ${currentDoc===d.id&&currentSection===s.id?'active':''} ${done.has(d.id+'/'+s.id)?'done':''}" ${currentDoc===d.id&&currentSection===s.id?'aria-current="page"':''} href="${routeOf(d,s)}"><span>${s.number}</span>${esc(s.title)}</a>`).join('')}</div></details>`).join('')).join('');
  $('sidebar').scrollTop=position;$('progress').max=units.length;$('progress').value=done.size;$('progress-text').textContent=`已读 ${done.size} / ${units.length} 节`;
}
function home(full=false){
  return `<div class="book-cover"><p class="eyebrow">理论教材 · 第二版</p><h1>${esc(DATA.title)}</h1><p class="book-subtitle">${esc(DATA.subtitle)}</p><p>本书从电磁场量子化出发，介绍量子光场的态与统计性质、强场相互作用、联合量子动力学和弱辐射微扰理论，随后建立相空间表示及 Q 分布近似，并比较两种描述所保留的物理信息。</p><p>各节可作为独立知识页面阅读，也可通过章首页的“整章阅读”连续查看。正文与 TeX、PDF 使用同一份内容源。本版集中于理论，暂不编写数值实现章节。</p><div class="hero-meta"><span>14 章 · 5 个附录</span><span>${units.length} 个知识页面</span><span>${DATA.date}</span></div></div><p class="book-tools"><a href="#/${full?'':'toc'}">${full?'返回封面':'查看详细目录'}</a> · <a href="downloads/quantum-light-guide.pdf">PDF 阅读版</a> · <a href="downloads/main.tex" download>TeX 源文件</a></p>`+DATA.parts.map(part=>`<section class="part-list" id="part-${part.id}"><h2>${esc(part.title)}</h2>${DATA.docs.filter(d=>d.part===part.id).map(d=>`<div class="toc-chapter"><a href="${routeOf(d)}"><span>${esc(d.label)}</span> ${esc(d.title)}</a>${full?`<ol>${d.sections.map(s=>`<li><a href="${routeOf(d,s)}"><span>${s.number}</span> ${esc(s.title)}</a></li>`).join('')}</ol>`:`<small>${d.sections.length} 节</small>`}</div>`).join('')}</section>`).join('')+`<p class="notice">正文独立编写，原始公式与模型来源见<a href="#/E">附录 E</a>。可见本地对话用于定位问题，未将未取得的独立 Grok/Grokbot 原始记录作为来源。</p>`;
}
function chapterOverview(doc){return `<h1>${esc(doc.label)}　${esc(doc.title)}</h1>${doc.intro}<p class="book-tools"><a href="#/${doc.id}/all">整章阅读</a> · <a href="${routeOf(doc,doc.sections[0])}">从第一节开始</a></p><h2>本章目录</h2><ol class="entry-list">${doc.sections.map(s=>`<li><a href="${routeOf(doc,s)}"><span>${s.number}</span> ${esc(s.title)}</a></li>`).join('')}</ol>`;}
function pager(doc,section){
  if(section){const index=units.findIndex(u=>u.key===doc.id+'/'+section.id),previous=units[index-1],next=units[index+1];return `<nav class="pager" aria-label="前后知识页"><a href="${previous?routeOf(previous.doc,previous):routeOf(doc)}">← ${previous?previous.number+' '+esc(previous.title):'本章目录'}</a><a href="${next?routeOf(next.doc,next):'#/'}">${next?next.number+' '+esc(next.title)+' →':'全书目录 →'}</a></nav>`;}
  const i=DATA.docs.indexOf(doc),previous=DATA.docs[i-1],next=DATA.docs[i+1];return `<nav class="pager"><a href="${previous?routeOf(previous):'#/'}">← ${previous?esc(previous.title):'封面'}</a><a href="${next?routeOf(next):'#/'}">${next?esc(next.title)+' →':'全书目录 →'}</a></nav>`;
}
function bindRead(doc,section){
  const keys=section?[doc.id+'/'+section.id]:doc.sections.map(s=>doc.id+'/'+s.id);
  const button=document.createElement('button');button.id='read-toggle';button.className='read-toggle';
  const update=()=>button.textContent=keys.every(k=>done.has(k))?'✓ 已读'+(section?'本节':'本章')+' · 点击撤销':'标记'+(section?'本节':'本章')+'已读';
  update();button.addEventListener('click',()=>{const remove=keys.every(k=>done.has(k));keys.forEach(k=>remove?done.delete(k):done.add(k));save('done',[...done]);update();sidebar();});$('article').append(button);
}
function toc(doc,section,mode){
  if(!doc){$('toc').innerHTML=DATA.parts.map(p=>`<a href="#/${mode==='toc'?'toc/':''}part-${p.id}" data-local="part-${p.id}">${esc(p.title)}</a>`).join('');return;}
  const equationLinks=section?section.equations.map(tag=>`<a href="#/${doc.id}/eq-${tag}">式（${esc(tag)}）</a>`).join(''):'';
  const links = doc.sections.map(s => {
    const href = mode === 'all' ? '#/' + doc.id + '/all/' + s.id : routeOf(doc,s);
    return '<a href="' + href + '">' + s.number + ' ' + esc(s.title) + '</a>';
  }).join('');
  $('toc').innerHTML='<a href="#/' + doc.id + '/contents">本章目录</a><a href="' + routeOf(doc) + '">整章阅读</a>' + (section ? equationLinks : links);
}
function route(){
  const parts=location.hash.replace(/^#\/?/,'').split('/');let id=parts[0]||'',target=null;
  currentDoc=null;currentSection=null;$('sidebar').classList.remove('open');$('backdrop').hidden=true;$('menu').setAttribute('aria-expanded','false');
  if(!id||id==='toc'||id.startsWith('part-')){
    const full=id==='toc';$('article').innerHTML=home(full);$('breadcrumb').textContent='量子光驱动的强场物理 / '+(full?'详细目录':'封面');document.title=DATA.title;toc(null,null,full?'toc':'home');
    if(id.startsWith('part-'))target=id;else if(parts[1]?.startsWith('part-'))target=parts[1];
  }else{
    const doc=DATA.docs.find(d=>d.id===id);
    if(!doc){$('article').innerHTML='<h1>未找到对应页面</h1><p><a href="#/toc">返回全书目录</a></p>';$('toc').innerHTML='';$('breadcrumb').textContent='页面不存在';}
    else{
      currentDoc=id;let section=doc.sections.find(s=>s.id===parts[1]);const all=!parts[1]||parts[1]==='all'||parts[1]==='article';
      if(parts[1]?.startsWith('eq-')){target=parts[1];const tag=target.slice(3);section=doc.sections.find(s=>s.equations.includes(tag));}
      if(section){currentSection=section.id;$('article').innerHTML=`<h1>${section.number}　${esc(section.title)}</h1>${section.html}`;save('last',id+'/'+section.id);}
      else if(all){
        $('article').innerHTML=doc.html;target=parts[2]||null;
        $('article').querySelector('h1').textContent=doc.label+'　'+doc.title;
        for(const entry of doc.sections){
          const heading=document.getElementById(entry.id);
          heading.textContent=entry.number+'　'+entry.title;
        }
      }
      else if(parts[1]==='contents'){$('article').innerHTML=chapterOverview(doc);}
      else{$('article').innerHTML='<h1>未找到对应知识页</h1><p><a href="'+routeOf(doc)+'">返回整章</a></p>';}
      $('breadcrumb').innerHTML=`<a href="#/toc">目录</a> / <a href="${routeOf(doc)}">${esc(doc.label)}　${esc(doc.title)}</a>${section?' / '+section.number:''}`;
      document.title=(section?section.title:doc.title)+' · '+DATA.title;
      renderMath($('article'));toc(doc,section,all?'all':'chapter');bindRead(doc,section);$('article').insertAdjacentHTML('beforeend',pager(doc,section));
    }
  }
  sidebar();requestAnimationFrame(()=>{if(target&&document.getElementById(target))document.getElementById(target).scrollIntoView({block:'start',behavior:'instant'});else window.scrollTo({top:0,behavior:'instant'});});
}
function search(value){
  const q=value.trim().toLowerCase(),panel=$('search-panel');if(!q){panel.hidden=true;return;}
  const hits=[];
  for(const d of DATA.docs){const entries=[{id:null,number:d.label,title:d.title,text:d.intro.replace(/<[^>]*>/g,' ')},...d.sections];for(const s of entries){const title=s.title.toLowerCase(),text=s.text.replace(/\s+/g,' '),index=text.toLowerCase().indexOf(q);if(!title.includes(q)&&index<0)continue;hits.push({d,s,score:title.includes(q)?3:1,snippet:text.slice(Math.max(0,index-30),Math.max(0,index-30)+150)});}}
  hits.sort((a,b)=>b.score-a.score);const highlight=t=>{const i=t.toLowerCase().indexOf(q);return i<0?esc(t):esc(t.slice(0,i))+'<mark>'+esc(t.slice(i,i+q.length))+'</mark>'+esc(t.slice(i+q.length));};
  panel.innerHTML=`<div class="search-summary">${hits.length?'找到 '+hits.length+' 个相关页面':'未找到相关内容'}</div>`+hits.slice(0,40).map(h=>`<a class="search-hit" href="${routeOf(h.d,h.s.id?h.s:null)}"><b>${esc(h.s.number)} ${highlight(h.s.title)}</b><small>${highlight(h.snippet)}</small></a>`).join('');panel.hidden=false;
}
document.documentElement.dataset.theme=getSaved('theme','light');
$('theme').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;save('theme',next);});
$('menu').addEventListener('click',()=>{const open=!$('sidebar').classList.contains('open');$('sidebar').classList.toggle('open',open);$('backdrop').hidden=!open;$('menu').setAttribute('aria-expanded',String(open));});
$('backdrop').addEventListener('click',()=>{$('sidebar').classList.remove('open');$('backdrop').hidden=true;$('menu').setAttribute('aria-expanded','false');});
$('search').addEventListener('input',e=>search(e.target.value));$('search').addEventListener('focus',()=>search($('search').value));
$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){const first=$('search-panel').querySelector('a');if(first){first.click();$('search').blur();}}});
document.addEventListener('keydown',e=>{if((e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))||((e.ctrlKey||e.metaKey)&&e.key==='k')){e.preventDefault();$('search').focus();}if(e.key==='Escape'){$('search-panel').hidden=true;$('search').blur();$('sidebar').classList.remove('open');$('backdrop').hidden=true;$('menu').setAttribute('aria-expanded','false');}});
document.addEventListener('click',e=>{if(e.target.closest('.search-hit'))$('search-panel').hidden=true;else if(!e.target.closest('.search-panel')&&!e.target.closest('.search-label'))$('search-panel').hidden=true;const link=e.target.closest('a');if(link?.dataset.local){e.preventDefault();document.getElementById(link.dataset.local)?.scrollIntoView({behavior:'smooth'});}if(link?.getAttribute('href')==='#article'){e.preventDefault();$('article').focus();window.scrollTo({top:0,behavior:'smooth'});}});
window.addEventListener('hashchange',route);route();
