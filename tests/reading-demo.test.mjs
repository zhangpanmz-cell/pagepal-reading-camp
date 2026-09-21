import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import vm from 'node:vm';
import {createAppServer} from '../server.mjs';

const read = name => readFile(new URL('../'+name, import.meta.url), 'utf8');
const ui = await read('reading-ui.jsx');
const scope = vm.createContext({window:{}, Intl, Date, crypto});
vm.runInContext(await read('reading-model.js'), scope);
vm.runInContext(await read('reading-content.js'), scope);
const start = ui.indexOf('  const M =');
const end = ui.indexOf('  function Cover(');
assert(start > 0 && end > start);
vm.runInContext(ui.slice(start,end) + '\nglobalThis.helpers={makeSeed,todayDay,displayTitle};',scope);
const {ReadingModel:M,helpers:H}=scope;

test('original sample seeds only two labelled notes and exactly seven complete theme groups',()=>{
  const data=H.makeSeed(),camp=data.camps[0],book=data.books[0];
  assert.equal(book.source,'sample');
  assert.match(book.notice,/原创.*非出版物/);
  assert.deepEqual(Object.keys(camp.notes),['1','2']);
  assert(camp.notes['1'].count>=400 && camp.notes['2'].count>=400);
  assert(camp.notes['1'].text.includes('演示笔记'));
  assert.equal(camp.days.length,7);
  assert.equal(camp.days.flatMap(d=>d.unitIds).join(','),book.units.map(u=>u.id).join(','));
  assert(camp.days.every(d=>d.question && d.intro));
  assert.equal(H.displayTitle(book,camp.days[2]),'把时间留给在意的事');
});

test('today navigation remains day three after submitting, and sample clock does not alter real camps',()=>{
  const camp=H.makeSeed().camps[0];
  assert.equal(H.todayDay(camp),3);
  const submitted=M.commitNote(camp,3,'记'.repeat(400),new Date(camp.demoNow));
  assert.equal(H.todayDay(submitted),3);
  assert.equal(M.stateForDay(submitted,3,new Date(camp.demoNow)),'done');
  assert.equal(M.stateForDay(submitted,4,new Date(camp.demoNow)),'future');
  const real=M.createCamp(scope.window.ReadingContent.sampleBook,'2030-01-01');
  assert.equal(real.demo,false);
  assert.equal(real.demoNow,undefined);
});

test('five independent HTML entries share ordered scripts and each declares its screen',async()=>{
  const entries={
    'reading.html':{screen:'home',title:'页伴 · 阅读空间'},
    'reading-library.html':{screen:'library',title:'页伴 · 我的书架'},
    'reading-camp.html':{screen:'camp',title:'页伴 · 七天阅读计划'},
    'reading-session.html':{screen:'session',title:'页伴 · 每日阅读'},
    'reading-notes.html':{screen:'notes',title:'页伴 · 读书笔记'}
  };
  for(const [file,{screen,title}]of Object.entries(entries)){
    const html=await read(file);
    assert(html.includes(`data-reading-page="${screen}"`));
    assert(html.includes(`<title>${title}</title>`));
    assert(html.includes('window.READING_PREFERENCE_DEFAULTS='));
    assert(!/一天开营|EDITMODE|READING_TWEAK_DEFAULTS|tweaks-panel\.jsx/.test(html));
    const scripts=[...html.matchAll(/<script[^>]+src="([^"?]+)[^\"]*"/g)].map(m=>m[1]);
    for(const name of ['react.production.min.js','react-dom.production.min.js','reading-content.js','reading-model.js','reading-store.js','reading-import.js','reading-preferences.js','reading-art.js','reading-ui.js'])assert(scripts.includes(name));
    assert(scripts.indexOf('reading-model.js')<scripts.indexOf('reading-ui.js'));
    assert(scripts.indexOf('reading-art.js')<scripts.indexOf('reading-ui.js'));
    assert(!/https?:\/\/|text\/babel|\.jsx(?:[?\"])/.test(html));
    assert(!html.includes('llm-client.js'));
  }
});

test('reading preferences stay local and expose only product controls',async()=>{
  const preferences=await read('reading-preferences.jsx');
  assert(preferences.includes("pagepal-reading-preferences-v1"));
  assert(preferences.includes("pagepal:preferences:open"));
  for(const name of ['useTweaks','TweaksPanel','TweakToggle','TweakSlider','TweakColor'])assert(preferences.includes(name));
  assert(!/miaoda|postMessage|addEventListener\(['"]message|TweakSection|TweakRadio|TweakSelect|TweakText|TweakNumber|TweakButton/.test(preferences));
  assert(ui.includes("window.dispatchEvent(new CustomEvent('pagepal:preferences:open'))"));
  assert(ui.includes('window.READING_PREFERENCE_DEFAULTS'));
});

test('reading UI discloses automated guides, click-only discussion and awaits durable saves',async()=>{
  assert(ui.includes('await onSubmit(dayNumber, text)'));
  assert(ui.includes('await onDraft(dayNumber, text)'));
  assert(ui.includes('await S.save(fn(old), old.revision)'));
  assert(ui.includes('startDate: c.demo ? c.startDate : dateString()'));
  assert(ui.includes('不检查是否回答问题，不做 AI 评分'));
  assert(ui.includes('当前 demo 尚未接入'));
  assert(ui.includes('真实书导入完成后会自动生成全书导读'));
  assert(ui.includes('首次进入当天（或主动预览的某天）阅读页时，也会自动发送书名、作者和当天正文生成每日导读'));
  assert(ui.includes('点击生成 AI 七日拆分建议时，会发送书名、作者、单元标题、层级、字数和每单元前 200 个字符'));
  assert(ui.includes('AI 讨论不会自动开始'));
  assert(ui.includes('只有你点击“分析今日阅读”或“发送”后'));
  assert(ui.includes("+'&tab=write'"));
  for(const file of ['reading-ui.jsx','reading-import.js','reading-model.js','reading-store.js']){
    const content=await read(file);
    assert(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|api\/planner/.test(content),file+' must not send book/note/model requests');
    assert(!content.includes('/api/planner'));
  }
});

test('local server exposes all reading assets but never configuration or reading test source',async t=>{
  const server=createAppServer({configLoader:async()=>({configured:false,apiKey:'',model:'unused'}),fetchImpl:()=>assert.fail('no model call expected')});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const name of ['reading.html','reading-library.html','reading-camp.html','reading-session.html','reading-notes.html','reading.css','react.production.min.js','react-dom.production.min.js','reading-ui.js','reading-preferences.js','reading-art.js','reading-content.js','reading-model.js','reading-store.js','reading-import.js']){
    const response=await fetch(origin+'/'+name);
    assert.equal(response.status,200,name);assert((await response.text()).length>200);
  }
  for(const name of ['server/.env.local','server/.env.deepseek.local','reading-demo.test.mjs','tests/reading-demo.test.mjs','reading-ui.jsx','reading-preferences.jsx'])assert.equal((await fetch(origin+'/'+name)).status,404);
});
