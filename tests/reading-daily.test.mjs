import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {runReadingAI,validateReadingRequest} from '../server/reading-ai.mjs';
const context=vm.createContext({window:{},Intl,Date});
vm.runInContext(readFileSync(new URL('../reading-model.js',import.meta.url),'utf8'),context);
const M=context.ReadingModel;
const book={id:'daily-book',title:'演示书',author:'演示作者',units:Array.from({length:14},(_,i)=>({id:'unit-'+i,title:'章节'+i,text:`正文${i}开始。\n\n完整段落${i}结尾。`}))};
const day={day:2,unitIds:['unit-3','unit-2']};
const plain=x=>JSON.parse(JSON.stringify(x));

test('daily context includes all selected units unabridged, in plan order, with chapter labels',()=>{
  const snapshot=JSON.stringify(book),result=M.dailyDiscussionContext(book,day);
  assert.equal(result.id,'reading-day-2');
  assert.equal(result.text,`【章节3】\n${book.units[3].text}\n\n【章节2】\n${book.units[2].text}`);
  assert.ok(!result.text.includes(book.units[4].text));
  assert.equal(JSON.stringify(book),snapshot);
  assert.notEqual(result.id,M.dailyDiscussionContext(book,{...day,day:3}).id);
});

test('missing or empty units fail instead of silently analyzing only remaining chapters',()=>{
  for(const selection of [{...day,unitIds:['unit-3','missing']},{...day,day:8},{...day,unitIds:[]}])assert.throws(()=>M.dailyDiscussionContext(book,selection));
  assert.throws(()=>M.dailyDiscussionContext({...book,units:[{id:'unit-3',title:'空',text:''}]},{day:1,unitIds:['unit-3']}));
});

test('large daily context is preserved by builder and rejected by transport, never truncated',()=>{
  const long={...book,units:[{id:'a',title:'甲',text:'甲'.repeat(25000)},{id:'b',title:'乙',text:'乙'.repeat(25000)}]};
  const chapter=plain(M.dailyDiscussionContext(long,{day:1,unitIds:['a','b']}));
  assert.ok(chapter.text.endsWith('乙'.repeat(25000)));
  assert.throws(()=>validateReadingRequest({mode:'topics',book:{id:book.id,title:book.title},chapter,messages:[]}),e=>e.code==='CHAPTER_TOO_LONG');
});

test('daily model request carries the whole day and asks for only three cross-chapter topics',async()=>{
  const chapter=plain(M.dailyDiscussionContext(book,day));
  const result=await runReadingAI({mode:'topics',book:{id:book.id,title:book.title,author:book.author},chapter,messages:[]},{
    config:{configured:true,apiKey:'TEST_ONLY_FAKE_CREDENTIAL_DO_NOT_USE',model:'deepseek-flash'},
    fetchImpl:async(_url,options)=>{
      const sent=JSON.parse(options.body);
      assert.match(sent.messages[0].content,/三个话题仍然总共只有三个/);
      assert.match(sent.messages[0].content,/不能只分析最后一章/);
      const payload=JSON.parse(sent.messages[1].content.split('\n').slice(1).join('\n'));
      assert.deepEqual(payload.chapter,chapter);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({topics:[{title:'理解',question:'如何理解前半段？',anchor:'正文3开始'},{title:'联系',question:'两章有什么联系？',anchor:'完整段落2结尾'},{title:'生活',question:'如果愿意，可以联系生活想一想。',anchor:'正文2开始'}]})}}]}));
    }
  });
  assert.equal(result.topics.length,3);
});

test('daily and legacy discussions survive note submission and do not count toward 400 characters',()=>{
  const camp={...M.createCamp(book,'2026-09-13'),onboarded:true,discussions:{'unit-0':{messages:[{role:'user',text:'旧记录'}]}},dailyDiscussions:{1:{skipped:true,messages:[{role:'assistant',text:'文'.repeat(1000)}]}}};
  assert.throws(()=>M.commitNote(camp,1,'字'.repeat(399),new Date('2026-09-14T12:00:00+08:00')));
  const next=M.commitNote(camp,1,'字'.repeat(400),new Date('2026-09-14T12:00:00+08:00'));
  assert.deepEqual(plain(next.dailyDiscussions),plain(camp.dailyDiscussions));
  assert.deepEqual(plain(next.discussions),plain(camp.discussions));
  assert.equal(next.notes[1].count,400);
});

test('session renders exactly one daily discussion and retains the legacy archive separately',()=>{
  const ui=readFileSync(new URL('../reading-ui.jsx',import.meta.url),'utf8');
  assert.equal((ui.match(/<DailyDiscussion\b/g)||[]).length,1);
  assert.doesNotMatch(ui,/<ChapterDiscussion\b/);
  assert.match(ui,/<\/section>\)\}<DailyDiscussion/);
  assert.match(ui,/camp\.dailyDiscussions\?\.\[dayNumber\]/);
  const component=readFileSync(new URL('../reading-discussion.jsx',import.meta.url),'utf8');
  assert.match(component,/\[expanded,setExpanded\]=useState\(false\)/);
  assert.match(component,/直接写笔记/);
  assert.match(component,/以前的章节讨论（只读保留）/);
});
