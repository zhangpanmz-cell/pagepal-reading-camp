/* Explicit user-initiated requests only. No keys or entire libraries in the browser. */
(() => {
  'use strict';
  // Only codes from our server protocol select user-visible error messages.
  // Never display arbitrary response text, provider diagnostics or credentials.
  const ERRORS = Object.freeze({
    INVALID_HOST:'请从本机 4173 端口的读书页面访问此服务。',
    INVALID_ORIGIN:'此接口只接受本机读书页面的请求，请重新打开页面。',
    CSRF_FAILED:'页面会话已失效，请刷新页面后再试。',
    INVALID_CONTENT_TYPE:'请求格式不正确，请刷新页面后再试。',
    INVALID_JSON:'消息格式不完整，请重新发送。',
    REQUEST_TOO_LARGE:'本次请求超过安全大小上限，请缩短内容后再发送。',
    INVALID_READING_REQUEST:'章节或对话格式不正确，请重新选择章节后再试。',
    CHAPTER_TOO_LONG:'本次阅读范围超过 40,000 字，暂不能完整分析；不会自动截断正文。',
    PLAN_UNITS_INVALID:'语义拆分需要 7 至 1500 个完整阅读单元，请检查导入内容。',
    READING_HISTORY_TOO_LONG:'本章对话超过 16 条或 16,000 字，请先复制保留记录，再开启新一轮讨论。',
    READING_MESSAGE_TOO_LONG:'每条讨论消息最多 3,000 字，请缩短后再发送。',
    REQUEST_IN_PROGRESS:'另一个请求还在处理中，请稍后再试。',
    LOCAL_RATE_LIMITED:'本分钟请求较多，请稍等片刻后手动重试。',
    READING_TIMEOUT:'请求超时，已有内容保留。不会自动重试，请稍后手动操作。',
    REQUEST_CANCELLED:'本次请求已取消，已有笔记和对话保留。',
    INVALID_MODEL_OUTPUT:'AI 返回的内容不完整或无法与本章对应，请稍后手动重试。',
    INCOMPLETE_RESPONSE:'AI 本次回复未完成，请稍后手动重试；已有内容保留。',
    MODEL_REFUSAL:'AI 无法回应这次讨论，请换一种安全、具体的问法。',
    DEEPSEEK_NOT_CONFIGURED:'尚未配置 DeepSeek，请先在本地服务端设置 API Key，不要填入网页。',
    DEEPSEEK_AUTH_FAILED:'DeepSeek 未接受 API Key，请在本地检查服务端密钥配置。',
    DEEPSEEK_BALANCE_INSUFFICIENT:'DeepSeek API 账户余额不足，请检查账户余额后再试。',
    DEEPSEEK_ACCESS_DENIED:'DeepSeek 拒绝访问，请检查账户和模型权限。',
    DEEPSEEK_MODEL_UNAVAILABLE:'当前模型不可用，请检查服务端 DEEPSEEK_MODEL 配置与权限。',
    DEEPSEEK_RATE_LIMITED:'DeepSeek 暂时限流，请稍后手动重试。',
    DEEPSEEK_UNAVAILABLE:'DeepSeek 服务暂时不可用，请稍后手动重试。',
    DEEPSEEK_NETWORK_ERROR:'暂时无法连接 DeepSeek，请检查网络后手动重试。',
    DEEPSEEK_TIMEOUT:'DeepSeek 回复超时，已有内容保留，不会自动重试。',
    CONFIG_ERROR:'服务端模型配置无法读取或格式不正确，请检查本地配置。',
    INVALID_WEREAD_REQUEST:'微信读书请求格式不正确，请重新选择书籍。',
    WEREAD_INVALID_REQUEST:'微信读书请求格式不正确，请重新选择书籍。',
    WEREAD_CLI_UNAVAILABLE:'未找到或无法运行微信读书 CLI，请先安装 weread-agent-cli，并检查本机执行路径。',
    WEREAD_NOT_CONFIGURED:'微信读书 CLI 尚未授权或授权已失效，请在本机配置官方 API Key；不要粘贴到网页。',
    WEREAD_CONFIG_ERROR:'微信读书 CLI 路径或服务端配置不正确，请检查本机设置。',
    WEREAD_UPGRADE_REQUIRED:'微信读书接口要求升级 CLI，请更新 weread-agent-cli 后重试。',
    WEREAD_TIMEOUT:'微信读书读取超时，未导入内容，请稍后手动重试。',
    WEREAD_RATE_LIMIT:'微信读书请求过于频繁，请稍后再试。',
    WEREAD_REQUEST_FAILED:'暂时无法读取微信读书数据，请检查本机 CLI 授权与网络。',
    WEREAD_INVALID_OUTPUT:'微信读书 CLI 返回格式不兼容，未导入内容，请检查版本后重试。',
    WEREAD_OUTPUT_TOO_LARGE:'微信读书数据超过单次读取上限，未截断或导入任何内容。',
    WEREAD_PAGINATION_UNSUPPORTED:'当前微信读书接口不支持分页游标，请重新读取书架。',
    WEREAD_ABORTED:'已取消微信读书读取。',
    NOT_FOUND:'未找到本地读书接口，请重启最新版本的本地服务。',
    METHOD_NOT_ALLOWED:'此接口不支持当前请求方式，请刷新页面。',
    INTERNAL_ERROR:'本地服务暂时出错，请稍后重试。',
    INVALID_RESPONSE:'本地服务返回格式不完整，未采用结果，请刷新页面后重试。',
    INVALID_SESSION:'页面会话无效，请刷新页面后再试。',
    NETWORK_ERROR:'无法连接本地读书服务，请检查服务与网络后手动重试。',
    REQUEST_FAILED:'请求未完成，请稍后手动重试。'
  });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = code => {const safe = Object.hasOwn(ERRORS,code) ? code : 'REQUEST_FAILED'; const error = new Error(ERRORS[safe]);error.code=safe;throw error;};
  const validText = (value,max,empty=false) => typeof value==='string' && value.length<=max && (empty||!!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
  const keysOnly = (value,keys) => object(value) && Object.keys(value).every(key=>keys.includes(key));
  const bookId = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
  const anchorKey = value => String(value).replace(/[^\p{L}\p{N}]/gu,'');
  function cancelled(signal) {if(signal?.aborted)throw new DOMException('本次请求已取消。','AbortError');}
  function aiBody(value,mode) {
    if(!object(value)||!object(value.book))fail('INVALID_READING_REQUEST');
    const book={id:value.book.id,title:value.book.title,author:value.book.author??''};
    if(!validText(book.id,160)||!validText(book.title,300)||!validText(book.author,300,true))fail('INVALID_READING_REQUEST');
    if(mode==='plan') {
      if(value.chapter!==undefined||value.messages!==undefined)fail('INVALID_READING_REQUEST');
      if(!Array.isArray(value.units)||value.units.length<7||value.units.length>1500)fail('PLAN_UNITS_INVALID');
      const units=value.units.map(unit=>{
        if(!object(unit))fail('INVALID_READING_REQUEST');
        if(!validText(unit.id,160)||!validText(unit.title,300))fail('INVALID_READING_REQUEST');
        if(unit.level!==undefined&&(!Number.isInteger(unit.level)||unit.level<1||unit.level>6))fail('INVALID_READING_REQUEST');
        if(unit.wordCount!==undefined&&(!Number.isInteger(unit.wordCount)||unit.wordCount<0))fail('INVALID_READING_REQUEST');
        if(!validText(unit.excerpt??'',200,true))fail('INVALID_READING_REQUEST');
        return {id:unit.id,title:unit.title,level:unit.level,wordCount:unit.wordCount??0,excerpt:unit.excerpt??''};
      });
      if(new Set(units.map(unit=>unit.id)).size!==units.length)fail('INVALID_READING_REQUEST');
      return {mode,book,units};
    }
    if(!object(value.chapter))fail('INVALID_READING_REQUEST');
    const chapter={id:value.chapter.id,title:value.chapter.title,text:value.chapter.text};
    if(!validText(chapter.id,160)||!validText(chapter.title,200))fail('INVALID_READING_REQUEST');
    const textLimit=mode==='compress'?80000:mode==='guide'?30000:40000;
    if(typeof chapter.text==='string'&&chapter.text.length>textLimit)fail('CHAPTER_TOO_LONG');
    if(!validText(chapter.text,textLimit))fail('INVALID_READING_REQUEST');
    const input=value.messages===undefined?[]:value.messages;
    if(!Array.isArray(input))fail('INVALID_READING_REQUEST');
    if(input.length>16)fail('READING_HISTORY_TOO_LONG');
    const messages=input.map(message=>{
      if(!object(message)||!['user','assistant'].includes(message.role))fail('INVALID_READING_REQUEST');
      if(typeof message.text==='string'&&message.text.length>3000)fail('READING_MESSAGE_TOO_LONG');
      if(!validText(message.text,3000))fail('INVALID_READING_REQUEST');
      return {role:message.role,text:message.text};
    });
    if(messages.reduce((total,message)=>total+message.text.length,0)>16000)fail('READING_HISTORY_TOO_LONG');
    if(mode==='topics'||mode==='compress'||mode==='guide'||mode==='daily-guide'){if(messages.length)fail('INVALID_READING_REQUEST');}else if(!messages.length||messages.at(-1).role!=='user')fail('INVALID_READING_REQUEST');
    return {mode,book,chapter,messages};
  }
  function wereadBody(value) {
    if(!object(value)||!['status','shelf','book'].includes(value.action))fail('INVALID_WEREAD_REQUEST');
    if(value.action==='book') {if(!bookId(value.bookId))fail('WEREAD_INVALID_REQUEST');return {action:'book',bookId:value.bookId};}
    if(value.action==='shelf'&&value.cursor!==undefined&&value.cursor!==null&&value.cursor!=='')fail('WEREAD_PAGINATION_UNSUPPORTED');
    return {action:value.action};
  }
  function aiResult(value,body) {
    const allowed=body.mode==='topics'?['mode','provider','model','topics']:body.mode==='compress'?['mode','provider','model','digest']:body.mode==='guide'?['mode','provider','model','guide']:body.mode==='daily-guide'?['mode','provider','model','guide']:body.mode==='plan'?['mode','provider','model','days']:['mode','provider','model','reply'];
    if(!keysOnly(value,allowed)||value.mode!==body.mode||value.provider!=='deepseek'||typeof value.model!=='string'||!/^[a-zA-Z0-9._:-]{1,100}$/.test(value.model))fail('INVALID_RESPONSE');
    const base={mode:value.mode,provider:'deepseek',model:value.model};
    if(body.mode==='chat') {if(!validText(value.reply,3000))fail('INVALID_RESPONSE');return {...base,reply:value.reply};}
    if(body.mode==='compress') {if(!validText(value.digest,12000))fail('INVALID_RESPONSE');return {...base,digest:value.digest};}
    if(body.mode==='guide') {
      if(!object(value.guide)||!keysOnly(value.guide,['intro','background','themes','questions']))fail('INVALID_RESPONSE');
      if(!validText(value.guide.intro,1200)||!validText(value.guide.background,1200))fail('INVALID_RESPONSE');
      if(!Array.isArray(value.guide.themes)||value.guide.themes.length<1||value.guide.themes.length>3||value.guide.themes.some(theme=>!validText(theme,200)))fail('INVALID_RESPONSE');
      if(!Array.isArray(value.guide.questions)||value.guide.questions.length<1||value.guide.questions.length>3||value.guide.questions.some(question=>!validText(question,400)))fail('INVALID_RESPONSE');
      return {...base,guide:{intro:value.guide.intro,background:value.guide.background,themes:value.guide.themes,questions:value.guide.questions}};
    }
    if(body.mode==='daily-guide') {
      if(!object(value.guide)||!keysOnly(value.guide,['focus','question'])||!validText(value.guide.focus,800)||!validText(value.guide.question,400))fail('INVALID_RESPONSE');
      return {...base,guide:{focus:value.guide.focus,question:value.guide.question}};
    }
    if(body.mode==='plan') {
      if(!Array.isArray(value.days)||value.days.length!==7)fail('INVALID_RESPONSE');
      const ids=body.units.map(unit=>unit.id);
      const seen=[];
      const days=value.days.map(day=>{
        if(!keysOnly(day,['unitIds','reason'])||!Array.isArray(day.unitIds)||!day.unitIds.length)fail('INVALID_RESPONSE');
        const unitIds=day.unitIds.map(id=>{if(!validText(id,160))fail('INVALID_RESPONSE');return id;});
        if(!validText(day.reason,200))fail('INVALID_RESPONSE');
        seen.push(...unitIds);
        return {unitIds,reason:day.reason};
      });
      if(seen.length!==ids.length||seen.some((id,index)=>id!==ids[index]))fail('INVALID_RESPONSE');
      return {...base,days};
    }
    if(!Array.isArray(value.topics)||value.topics.length!==3)fail('INVALID_RESPONSE');
    const topics=value.topics.map(topic=>{
      if(!keysOnly(topic,['title','question','anchor'])||!validText(topic.title,80)||!validText(topic.question,400)||!validText(topic.anchor,120)||!anchorKey(body.chapter.text).includes(anchorKey(topic.anchor)))fail('INVALID_RESPONSE');
      return {title:topic.title,question:topic.question,anchor:topic.anchor};
    });
    if(new Set(topics.map(topic=>topic.title.trim())).size!==3||new Set(topics.map(topic=>topic.question.trim())).size!==3)fail('INVALID_RESPONSE');
    return {...base,topics};
  }
  function summary(value) {
    if(!object(value)||!bookId(value.bookId)||!validText(value.title,300)||!validText(value.author,300,true))fail('INVALID_RESPONSE');
    return {bookId:value.bookId,title:value.title,author:value.author};
  }
  function wereadResult(value,body) {
    if(!object(value))fail('INVALID_RESPONSE');
    if(body.action==='status') {
      if(value.provider!=='weread'||typeof value.installed!=='boolean'||typeof value.configured!=='boolean'||value.verified!==false||value.contentAccess!=='metadata-only'||(!value.installed&&value.configured))fail('INVALID_RESPONSE');
      return {provider:'weread',installed:value.installed,configured:value.configured,verified:false,contentAccess:'metadata-only',message:!value.installed?ERRORS.WEREAD_CLI_UNAVAILABLE:!value.configured?ERRORS.WEREAD_NOT_CONFIGURED:'CLI 已配置，尚未验证联网授权。读取书架后仅导入书籍信息和目录。'};
    }
    if(body.action==='shelf') {
      if(!Array.isArray(value.books)||value.books.length>10000||value.total!==value.books.length||value.nextCursor!==null||value.pagination!=='none'||value.contentAccess!=='metadata-only'||(value.scope!==undefined&&value.scope!=='ebooks'))fail('INVALID_RESPONSE');
      const books=value.books.map(summary);
      if(new Set(books.map(book=>book.bookId)).size!==books.length)fail('INVALID_RESPONSE');
      return {books,total:books.length,nextCursor:null,pagination:'none',contentAccess:'metadata-only',...(value.scope===undefined?{}:{scope:'ebooks'}),...(value.message===undefined?{}:{message:'导入书籍信息和目录，不包含正文。'})};
    }
    const book=value.book,info=summary(book);
    if(info.bookId!==body.bookId||book.id!==`weread-${info.bookId}`||book.source!=='weread'||book.format!=='微信读书'||book.contentStatus!=='metadata-only'||!Array.isArray(book.units)||book.units.length||book.prelude!==''||!validText(book.description,4000,true)||!Array.isArray(book.chapters)||book.chapters.length>10000)fail('INVALID_RESPONSE');
    const chapters=book.chapters.map((chapter,index)=>{
      if(!object(chapter)||!bookId(chapter.chapterUid)||chapter.id!==`weread-${info.bookId}-${chapter.chapterUid}`||!validText(chapter.title,300)||!Number.isInteger(chapter.level)||chapter.level<1||chapter.level>20||chapter.order!==index||!Number.isSafeInteger(chapter.wordCount)||chapter.wordCount<0)fail('INVALID_RESPONSE');
      return {id:chapter.id,chapterUid:chapter.chapterUid,title:chapter.title,level:chapter.level,order:index,wordCount:chapter.wordCount};
    });
    if(new Set(chapters.map(chapter=>chapter.id)).size!==chapters.length)fail('INVALID_RESPONSE');
    return {book:{id:book.id,...info,source:'weread',format:'微信读书',contentStatus:'metadata-only',chapters,units:[],prelude:'',description:book.description,notice:'已导入书籍信息与目录，不含正文。请补充有权使用的本地正文后开启阅读计划和章节讨论。'}};
  }
  function create(fetchImpl = (...args) => fetch(...args)) {
    if(typeof fetchImpl!=='function')fail('INVALID_RESPONSE');
    async function json(response) {
      let value;
      try { value = await response.json(); }
      catch (error) {if(error?.name==='AbortError')throw error;fail('INVALID_RESPONSE');}
      if (!response.ok) {
        fail(typeof value?.error?.code==='string'?value.error.code:'REQUEST_FAILED');
      }
      return value;
    }
    async function fetchJson(path,options) {
      let response;
      try {response=await fetchImpl(path,{mode:'same-origin',redirect:'error',cache:'no-store',credentials:'same-origin',...options});}
      catch(error){if(error?.name==='AbortError')throw error;cancelled(options.signal);fail('NETWORK_ERROR');}
      cancelled(options.signal);
      const value=await json(response);
      cancelled(options.signal);
      return value;
    }
    async function request(path, body, {signal} = {}) {
      if (!['/api/reading/ai', '/api/reading/weread'].includes(path))fail('NOT_FOUND');
      cancelled(signal);
      // Snapshot before awaiting a session so edits cannot change either the
      // submitted chapter or the source used to validate returned anchors.
      const serialized=JSON.stringify(body),sent=JSON.parse(serialized);
      if(new TextEncoder().encode(serialized).length>(path==='/api/reading/ai'?262144:8192))fail('REQUEST_TOO_LARGE');
      const status = await fetchJson('/api/reading/session', {method:'GET',signal});
      if (!object(status)||typeof status.csrfToken !== 'string'||!/^[a-f0-9]{64}$/.test(status.csrfToken))fail('INVALID_SESSION');
      // Never retry paid/model requests automatically: a timeout does not mean
      // the upstream provider did not process the request.
      const result=await fetchJson(path, {
        method:'POST',signal,
        headers:{'Content-Type':'application/json', 'X-Pagepal-Token':status.csrfToken},
        body:serialized
      });
      return path==='/api/reading/ai'?aiResult(result,sent):wereadResult(result,sent);
    }
    return {
      analyze:async(body,options)=>request('/api/reading/ai',aiBody(body,'topics'),options),
      chat:async(body,options)=>request('/api/reading/ai',aiBody(body,'chat'),options),
      compress:async(body,options)=>request('/api/reading/ai',aiBody(body,'compress'),options),
      guide:async(body,options)=>request('/api/reading/ai',aiBody(body,'guide'),options),
      dailyGuide:async(body,options)=>request('/api/reading/ai',aiBody(body,'daily-guide'),options),
      plan:async(body,options)=>request('/api/reading/ai',aiBody(body,'plan'),options),
      weread:async(body,options)=>request('/api/reading/weread',wereadBody(body),options)
    };
  }
  window.ReadingAPI = Object.freeze({create, ...create()});
})();
