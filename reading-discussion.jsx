/* Daily-scoped, optional conversations; never submits a reading note. */
(() => {
  const {useState,useRef,useEffect} = React;
  function DailyDiscussion({book,day,value,legacy=[],onSave,onWrite}) {
    let chapter,contextError='';
    try {chapter=ReadingModel.dailyDiscussionContext(book,day);}
    catch(e){contextError=e.message;chapter={id:`reading-day-${day.day}`,title:`第 ${day.day} 天`,text:''};}
    const units=day.unitIds.map(id=>book.units.find(unit=>unit.id===id)).filter(Boolean);
    const [expanded,setExpanded]=useState(false);
    const [record,setRecord] = useState(value || {topics:[],messages:[],skipped:false});
    const [input,setInput] = useState('');
    const [busy,setBusy] = useState('');
    const [error,setError] = useState('');
    const [saveError,setSaveError] = useState('');
    const [notice,setNotice] = useState('');
    const [digest,setDigest] = useState('');
    const [compressing,setCompressing] = useState(false);
    const pending=useRef(null),alive=useRef(true),latest=useRef(record);
    const area=useRef(null);
    latest.current=record;
    useEffect(()=>()=>{alive.current=false;pending.current?.abort();},[]);
    const available=Boolean(chapter.text?.trim()),tooLong=chapter.text?.length>40000;
    const messages=record.messages || [],topics=record.topics || [];
    async function persist(next) {
      setRecord(next);latest.current=next;setSaveError('');
      try {await onSave(day.day,next);}
      catch(e){if(alive.current)setSaveError(e.message+' 本页对话仍保留，可复制后刷新。');}
    }
    async function ensureDigest() {
      if (!tooLong) return chapter.text;
      if (digest) return digest;
      if (pending.current || compressing) return null;
      const controller=new AbortController();pending.current=controller;
      setCompressing(true);setError('');
      try {
        const result=await ReadingAPI.compress({book:{id:book.id,title:book.title,author:book.author||''},chapter:{id:chapter.id,title:chapter.title,text:chapter.text}},{signal:controller.signal});
        if(!alive.current||controller.signal.aborted)return null;
        setDigest(result.digest);
        return result.digest;
      } catch(e){if(alive.current)setError(e.name==='AbortError'?'已停止压缩。原文保留，可稍后重试。':e.message);return null;}
      finally {if(alive.current)setCompressing(false);if(pending.current===controller)pending.current=null;}
    }
    async function run(mode) {
      if(pending.current || (mode==='chat'&&!input.trim()))return;
      const text=await ensureDigest();
      if(text===null)return;
      const controller=new AbortController();pending.current=controller;
      setBusy(mode);setError('');setNotice('');
      const question=input.trim();
      const nextMessages=mode==='chat'?[...messages,{role:'user',text:question}]:messages;
      const request={book:{id:book.id,title:book.title,author:book.author || ''},chapter:{id:chapter.id,title:chapter.title,text},messages:mode==='chat'?nextMessages.slice(-16):[]};
      if(request.messages.reduce((n,m)=>n+m.text.length,0)>16000){setError('最近的讨论已超过上下文上限。请先复制保留记录，再清空当天讨论后继续。');setBusy('');pending.current=null;return;}
      try {
        const result=await (mode==='topics'?ReadingAPI.analyze:ReadingAPI.chat)(request,{signal:controller.signal});
        if(!alive.current||controller.signal.aborted)return;
        const next={...latest.current,skipped:false,updatedAt:new Date().toISOString()};
        if(mode==='topics')next.topics=result.topics;
        else {next.messages=[...nextMessages,{role:'assistant',text:result.reply}];setInput('');}
        await persist(next);
      } catch(e){if(alive.current)setError(e.name==='AbortError'?'已停止等待。输入保留；模型可能仍已处理请求，不会自动重试。':e.message);}
      finally {if(alive.current)setBusy('');if(pending.current===controller)pending.current=null;}
    }
    function skip(){pending.current?.abort();setExpanded(false);persist({...latest.current,skipped:true});}
    return <section className="rc-chapter-chat" aria-label={chapter.title+'的 AI 讨论'}>
      <header><div><span className="rc-eyebrow">PAUSE & TALK</span><h3><ReadingIcon name="spark" size={18}/>今天读完了，要不要聊两句？</h3></div><span className="rc-pill">可跳过 · 不影响打卡</span></header>
      {!expanded?<div className="rc-chat-skipped"><p>围绕今天读到的内容，聊聊理解、疑惑或生活里的联想。也可以不聊，直接写笔记。</p><button className="rc-text-button" onClick={()=>setExpanded(true)}>聊聊今天读到的<ReadingIcon name="chevron" size={14}/></button></div>:<>
        {!available&&<p className="rc-callout">{contextError || "尚未取得当天完整正文，请先补充有权使用的本地正文。"}</p>}
        <div className="rc-chat-topics-heading"><b>{topics.length?'当天的 3 个话题':'从三个话题开始，也可以自由提问'}</b><button className="rc-button outline" disabled={!!busy||compressing||!available} onClick={()=>run('topics')}>{busy==='topics'?'正在分析今天读到的…':compressing?'正在压缩当天内容…':topics.length?'重新分析话题':'分析今日阅读，生成 3 个话题'}</button></div>
        {topics.length>0&&<div className="rc-chat-topics">{topics.map((topic,i)=><button key={i} disabled={!!busy||compressing} onClick={()=>{setInput(topic.question);area.current?.focus();}}><span>0{i+1}</span><strong>{topic.title}</strong><p>{topic.question}</p><small>出处：{units.filter(unit=>unit.text.includes(topic.anchor)).map(unit=>unit.title).join("；") || "当天阅读范围"}<br/>原文线索：{topic.anchor}</small></button>)}</div>}
        <div className="rc-chat-messages" role="log" aria-live="polite" aria-label="当天讨论记录">{messages.map((message,i)=><div className={'rc-chat-message '+message.role} key={i}><b>{message.role==='user'?'我的想法':'AI 读书搭子'}</b><p>{message.text}</p></div>)}{busy==='chat'&&<p role="status">正在结合今日阅读思考…</p>}</div>
        <form onSubmit={e=>{e.preventDefault();run('chat');}}><label className="rc-chat-input-label">自由提问<textarea ref={area} aria-label={chapter.title+'的自由提问'} value={input} disabled={!!busy||compressing} onChange={e=>setInput(e.target.value)} maxLength={3000} placeholder="比如：这里的观点和上一段矛盾吗？如果放到我的生活里，可以怎么理解？"/></label><div className="rc-chat-actions"><button type="button" className="rc-text-button" onClick={skip}>收起讨论</button><div>{busy?<button type="button" className="rc-button outline" onClick={()=>pending.current?.abort()}>停止等待</button>:<button className="rc-button primary" disabled={!input.trim()||compressing||!available}>发送<ReadingIcon name="arrow" size={16}/></button>}</div></div></form>
        {(error||saveError)&&<p className="rc-error" role="alert">{error||saveError}</p>}
        {messages.length>0&&<div className="rc-chat-record-actions"><button className="rc-text-button" onClick={async()=>{try{await navigator.clipboard.writeText(messages.map(m=>(m.role==='user'?'我':'AI')+'：'+m.text).join('\n\n'));setNotice('当天讨论已复制。');}catch{setNotice('请选中对话文本后手动复制。');}}}>复制当天讨论</button><button className="rc-text-button" disabled={!!busy||compressing} onClick={()=>{if(window.confirm('清空当天的 AI 对话和话题？读书笔记与打卡记录不会变化。'))persist({topics:[],messages:[],skipped:false});}}>清空当天讨论</button></div>}
        {notice&&<p className="rc-fine" role="status">{notice}</p>}<p className="rc-chat-disclaimer">讨论按阅读日保存在本机，模型可能有误。AI 对话不会自动成为笔记，也不计入 400 字打卡。</p>
      </>}
      {legacy.length>0&&<details className="rc-chat-legacy"><summary>查看以前的章节讨论（只读保留）</summary>{legacy.map(({unit,record})=><div key={unit.id}><h4>{unit.title}</h4>{(record.topics||[]).map((topic,i)=><p key={"t"+i}>{topic.title}：{topic.question}</p>)}{(record.messages||[]).map((message,i)=><p key={i}><b>{message.role==='user'?'我':'AI'}：</b>{message.text}</p>)}</div>)}</details>}
    </section>;
  }
  window.DailyDiscussion=DailyDiscussion;
})();
