/* Explicit imports and exports; nothing is sent on mount. */
(() => {
  const {useState,useEffect,useRef}=React;
  function saveBlob(name,bytes,type) {
    const url=URL.createObjectURL(new Blob([bytes],{type}));
    const a=document.createElement('a');a.href=url;
    const extension=name.match(/\.(docx|md)$/i)?.[0] || '';
    a.download=ReadingExport.safeFileName(extension?name.slice(0,-extension.length):name)+extension;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function WereadImport({onImport}) {
    const [status,setStatus]=useState(null),[books,setBooks]=useState(null),[selected,setSelected]=useState(null);
    const [busy,setBusy]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState('');
    const pending=useRef(null),alive=useRef(true);
    useEffect(()=>()=>{alive.current=false;pending.current?.abort();},[]);
    async function load(action,bookId) {
      if(pending.current)return;
      const controller=new AbortController();pending.current=controller;setBusy(action);setError('');
      try {
        const result=await ReadingAPI.weread({action,...(bookId?{bookId}: {})},{signal:controller.signal});
        if(!alive.current||controller.signal.aborted)return;
        if(action==='status')setStatus(result);
        else if(action==='shelf'){setBooks(result.books);setStatus({installed:true,configured:true,verified:true});}
        else setSelected(result.book);
      } catch(e){if(alive.current)setError(e.name==='AbortError'?'已停止读取。':e.message);}
      finally {if(alive.current)setBusy('');pending.current=null;}
    }
    return <div className="rc-weread-import"><p className="rc-modal-lead">从微信读书书架选择一本书。CLI 在本地服务运行，授权信息不会放进网页。</p>
      <div className="rc-integration-note"><h3>先连接书架，再补充正文</h3><p>当前 CLI 可取得书籍信息和章节目录，不提供整章正文。导入后可关联你有权使用的 EPUB / TXT / Markdown，再开启七天计划和章节 AI 讨论。</p></div>
      <details className="rc-connection-help"><summary>第一次连接：安装与授权</summary><ol><li>使用 <a href="https://github.com/shiquda/weread-cli" target="_blank" rel="noreferrer">weread-agent-cli</a>，本项目已固定依赖版本 0.1.4；先点击检测。</li><li>若项目依赖尚未安装：在项目目录执行 <code>npm ci --ignore-scripts</code>。本地命令为 <code>./node_modules/.bin/weread</code>，也兼容已安装的系统命令。</li><li>到<a href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noreferrer">微信读书官方授权页</a>获取 API Key，并按 CLI 文档在本机配置；不要把 Key 粘贴到网页或聊天。</li><li>若本地服务找不到命令，可在启动服务前设置 <code>WEREAD_CLI_PATH</code> 为可执行文件的绝对路径。</li></ol><p>这是第三方 CLI 对官方接口的封装，不是腾讯官方 CLI。不会抓取 Cookie、解密或下载未授权正文。</p></details>
      <div className="rc-inline-actions"><button className="rc-button outline" disabled={!!busy} onClick={()=>load('status')}>{busy==='status'?'检测中…':'检测本机 CLI'}</button><button className="rc-button primary" disabled={!!busy} onClick={()=>load('shelf')}>{busy==='shelf'?'正在读取书架…':'读取我的微信读书书架'}</button></div>
      {status&&<p className="rc-fine" role="status">{status.verified?'已连接微信读书书架':!status.installed?'尚未安装 CLI':status.configured?'CLI 已配置，尚未验证账户连接':'已找到 CLI，尚未配置微信读书授权'} · 只导入你选择的书籍信息</p>}
      {books&&<><label className="rc-field-label">筛选书架<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入书名"/></label><div className="rc-weread-books">{books.filter(b=>b.title.includes(query)).map(b=><button key={b.bookId} disabled={!!busy} onClick={()=>load('book',b.bookId)}><ReadingIcon name="book" size={22}/><span><b>{b.title}</b><small>{b.author || '作者未标注'}</small></span><ReadingIcon name="chevron" size={16}/></button>)}{!books.length&&<p className="rc-fine">书架暂时为空，或没有可通过接口读取的书籍。</p>}</div></>}
      {selected&&<div className="rc-weread-selected"><span className="rc-pill">书籍信息 · 不含正文</span><h3>{selected.title}</h3><p>{selected.author} · {selected.chapters?.length || 0} 条目录</p><details><summary>预览目录</summary><ol>{(selected.chapters || []).map(ch=><li key={ch.id}>{ch.title}</li>)}</ol></details><button className="rc-button primary" disabled={!!busy} onClick={async()=>{setBusy('import');try{await onImport(selected);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy('');}}}>确认导入这本书<ReadingIcon name="plus" size={16}/></button></div>}
      {busy&&<button className="rc-text-button" onClick={()=>pending.current?.abort()} disabled={busy==='import'}>取消读取</button>}{error&&<p className="rc-error" role="alert">{error}</p>}
    </div>;
  }
  function AttachBook({book,onAttach,onClose}) {
    const [parsed,setParsed]=useState(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
    async function parse(file){if(!file||busy)return;setBusy(true);setError('');setParsed(null);setConfirmed(false);try{const next=await ReadingImport.parseFile(file);if(alive.current)setParsed(next);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
    return <div className="rc-attach-book"><p className="rc-modal-lead">给《{book.title}》补充正文。微信读书的目录会保留，七天分组将以本地文件里的完整章节 / 小节为准。</p><label className="rc-file-select">选择合法持有的 EPUB / TXT / Markdown<input type="file" accept=".epub,.txt,.md" disabled={busy} onChange={e=>parse(e.target.files[0])}/></label>{parsed&&<><div className="rc-import-preview"><ReadingIcon name="book"/><div><h3>{parsed.title}</h3><p>{parsed.units.length} 个完整阅读单元 · 只在本机解析</p></div></div><label className="rc-chat-consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我确认这是《{book.title}》的正文，且我有权使用该文件；书名 / 版本可能不同，已核对内容。</span></label></>}{error&&<p className="rc-error" role="alert">{error}</p>}<footer className="rc-modal-actions"><button className="rc-button ghost" onClick={onClose}>暂不补充</button><button className="rc-button primary" disabled={!parsed||!confirmed||busy} onClick={async()=>{setBusy(true);try{await onAttach(book,parsed);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}}>{busy?'处理中…':'确认关联正文'}</button></footer></div>;
  }
  function ExportPanel({book,camp,onNotice}) {
    const [format,setFormat]=useState('word'),[vault,setVault]=useState(''),[folder,setFolder]=useState('阅读笔记');
    const [error,setError]=useState(''),[clipboardReady,setClipboardReady]=useState(false),[uri,setUri]=useState('');
    const [exportId]=useState(()=>new Date().toISOString().replace(/[:.]/g,'-')+'-'+Math.random().toString(36).slice(2,7));
    const standard=ReadingModel.exportMarkdown(book,camp),obsidian=ReadingExport.toObsidianMarkdown(book,camp);
    const name=ReadingExport.safeFileName(book.title+'-读书笔记');
    const content=format==='obsidian'?obsidian:standard;
    function download(){try{if(format==='word')saveBlob(name+'.docx',ReadingExport.createDocx(book,camp),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');else saveBlob(name+'.md',content,'text/markdown;charset=utf-8');setError('');onNotice('已发起下载，请查看浏览器下载列表。');}catch(e){setError(e.message);}}
    async function prepareObsidian(){try{const file=(folder.trim()?folder.trim()+'/':'')+name+'-'+exportId+'.md';const target=ReadingExport.buildObsidianUri({vault:vault.trim(),file,clipboard:true});await navigator.clipboard.writeText(obsidian);setUri(target);setClipboardReady(true);setError('');}catch(e){setError('未能准备 Obsidian 导出：'+e.message+' 也可以下载 Markdown 后放入仓库。');}}
    return <div className="rc-export-panel"><p className="rc-modal-lead">《{book.title}》 · 本读书营已提交的 {Object.keys(camp.notes).length} 篇笔记。不包含未提交草稿或 AI 对话。</p><div className="rc-export-formats" role="tablist" aria-label="笔记导出格式">{[['word','Word 文档'],['markdown','Markdown'],['obsidian','Obsidian']].map(([key,label])=><button role="tab" aria-selected={format===key} className={format===key?'active':''} key={key} onClick={()=>{setFormat(key);setError('');setClipboardReady(false);}}>{label}</button>)}</div>
      <p className="rc-fine">{format==='word'?'下载可编辑的 .docx，保留书名、阅读日期、章节范围、字数与提交状态。下方仅预览内容，Word 文件包含排版。':format==='obsidian'?'导出带书籍属性、标签和章节标题的 Markdown；下载后可放入任何 Obsidian 仓库。':'标准 Markdown，可导入其他笔记工具。'}</p><textarea className="rc-export-preview" aria-label="导出内容预览" readOnly value={content}/>
      {format==='obsidian'&&<div className="rc-obsidian-options"><h3>也可以交给本机 Obsidian 新建</h3><label className="rc-field-label">仓库名称<input aria-label="Obsidian 仓库名称" value={vault} onChange={e=>{setVault(e.target.value);setClipboardReady(false);}} placeholder="填写 Obsidian 中已有的仓库名"/></label><label className="rc-field-label">仓库内文件夹<input aria-label="Obsidian 文件夹" value={folder} onChange={e=>{setFolder(e.target.value);setClipboardReady(false);}} placeholder="阅读笔记"/></label><p className="rc-fine">需已安装 Obsidian。为避免长文超出链接长度，先把导出内容复制到剪贴板，再点击打开；这会替换当前剪贴板内容。使用带时间标记的新文件名，不要求覆盖或追加现有笔记。</p><button className="rc-button outline" onClick={prepareObsidian} disabled={!vault.trim()}>1. 复制内容，准备导出</button>{clipboardReady&&<a className="rc-button primary" href={uri} onClick={()=>onNotice('已请求打开 Obsidian，请在 Obsidian 中确认新笔记是否创建。网页无法确认写入结果。')}>2. 打开 Obsidian 新建笔记<ReadingIcon name="arrow" size={16}/></a>}<p className="rc-fine">第二步前不要复制其他内容。浏览器可能询问是否允许打开外部应用；未安装或无法打开时，请下载 Markdown。</p></div>}
      {error&&<p className="rc-error" role="alert">{error}</p>}<footer className="rc-modal-actions"><button className="rc-button outline" onClick={async()=>{try{setClipboardReady(false);await navigator.clipboard.writeText(content);onNotice('导出内容已复制。');}catch{setError('请选中上方预览文字后手动复制。');}}}>复制内容</button><button className="rc-button primary" onClick={download}><ReadingIcon name="download" size={17}/>{format==='word'?'下载 Word 文档':'下载 Markdown'}</button></footer></div>;
  }
  Object.assign(window,{WereadImport,AttachBook,ReadingExportPanel:ExportPanel});
})();
