/* Pagepal / 页伴: direct, multi-page reading-camp demo.
 * Reference direction: morning paper / forest-green actions / fox + ribbon companion.
 * Opening/daily guides remain fixtures; optional chapter discussions use DeepSeek.
 * Local imports and exports stay in browser. WeRead metadata goes through local CLI.
 * One opening day + seven reading days; submitted >=400-character notes earn stamps.
 */
(() => {
  const {
    useState,
    useEffect,
    useRef
  } = React;
  const M = window.ReadingModel,
    S = window.ReadingStore,
    C = window.ReadingContent;
  const Icon = window.ReadingIcon;
  const pages = {
    home: 'reading.html',
    library: 'reading-library.html',
    camp: 'reading-camp.html',
    session: 'reading-session.html',
    notes: 'reading-notes.html'
  };
  const labels = {
    home: '今日阅读',
    library: '我的书架',
    camp: '阅读计划',
    session: '阅读空间',
    notes: '我的笔记'
  };
  const stateNames = {
    future: '未开始',
    open: '待完成',
    missed: '未按时完成',
    done: '已完成',
    late: '已补交'
  };
  const dateString = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  function shiftDay(text, offset) {
    const d = new Date(text + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  const fmtDate = text => text.slice(5).replace('-', '.');
  const numeral = n => String(n).padStart(2, '0');
  const link = (view, camp, day) => pages[view] + (camp ? '?camp=' + encodeURIComponent(camp.id) + (day ? '&day=' + day : '') : '');
  const campNow = camp => camp?.demo ? new Date(camp.demoNow) : new Date();
  function makeSeed() {
    const today = dateString(),
      camp = M.createCamp(C.sampleBook, shiftDay(today, -2), {
        demo: true
      });
    camp.onboarded = true;
    camp.demoNow = today + 'T12:00:00+08:00';
    let result = camp;
    C.seedNotes.forEach((text, i) => {
      result = M.commitNote(result, i + 1, text, new Date(M.dayDate(result, i + 1) + 'T20:00:00+08:00'));
    });
    return {
      version: 1,
      revision: 0,
      books: [C.sampleBook],
      camps: [result],
      activeCamp: result.id
    };
  }
  function todayDay(camp) {
    if (!camp) return 1;
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:camp.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(campNow(camp));
    const value = type => parts.find(p=>p.type===type).value;
    const today = `${value('year')}-${value('month')}-${value('day')}`;
    return camp.days.find(d => M.dayDate(camp, d.day) === today)?.day || (today < M.dayDate(camp, 1) ? 1 : 7);
  }
  function readUnits(book, day) {
    return day.unitIds.map(id => book.units.find(u => u.id === id)).filter(Boolean);
  }
  function displayTitle(book, day) {
    const units=readUnits(book,day);
    return book.source==='sample' && units.every(u=>u.theme===units[0]?.theme) ? units[0].theme : day.title;
  }
  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], {
      type: 'text/markdown;charset=utf-8'
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/[\\/:*?"<>|]/g, '-');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function Cover({
    book,
    small = false
  }) {
    return <div className={'rc-cover ' + (small ? 'small' : '')} aria-label={book.title + '书封'}><span>PAGEPAL READING CLUB</span><strong>{book.title}</strong><div className="rc-cover-orbit"><i></i><b></b><em></em></div><footer>{book.author || '个人导入'}<span>{book.source === 'sample' ? '原创演示小书' : book.format}</span></footer></div>;
  }
  function Modal({
    title,
    onClose,
    children,
    wide = false
  }) {
    const panel = useRef(null),
      closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
      const previous = document.activeElement;
      const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
      panel.current?.focus();
      const key = e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeRef.current();
        }
        if (e.key === 'Tab') {
          const els = [...panel.current.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
          if (!els.length) {
            e.preventDefault();
            return;
          }
          const first = els[0],
            last = els[els.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener('keydown', key);
      return () => {
        document.removeEventListener('keydown', key);
        document.body.style.overflow=previousOverflow;previous?.focus();
      };
    }, []);
    return <div className="rc-modal-backdrop" onMouseDown={e => {
      if (e.target === e.currentTarget) onClose();
    }}><section className={'rc-modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-label={title} tabIndex="-1" ref={panel}><header><h2>{title}</h2><button className="rc-icon-button" aria-label="关闭弹窗" onClick={onClose}><Icon name="close" /></button></header>{children}</section></div>;
  }
  function BookImport({
    onClose,
    onImport
  }) {
    const [source, setSource] = useState('file');
    const sourceTabs=<div className="rc-export-formats" role="tablist" aria-label="书籍导入方式"><button role="tab" aria-selected={source==='file'} className={source==='file'?'active':''} onClick={()=>setSource('file')}>本地文件</button><button role="tab" aria-selected={source==='weread'} className={source==='weread'?'active':''} onClick={()=>setSource('weread')}>微信读书</button></div>;
    const [book, setBook] = useState(null),
      [busy, setBusy] = useState(false),
      [error, setError] = useState(''),
      [drag, setDrag] = useState(false);
    const fileRef = useRef(null),
      alive = useRef(true);
    useEffect(() => () => {
      alive.current = false;
    }, []);
    async function choose(file) {
      if (!file || busy) return;
      setBusy(true);
      setError('');
      setBook(null);
      try {
        const next = await ReadingImport.parseFile(file);
        if (alive.current) setBook(next);
      } catch (e) {
        if (alive.current) setError(e.message);
      } finally {
        if (alive.current) setBusy(false);
      }
    }
    if(source==='weread')return <Modal title="下一本，想读什么？" onClose={onClose} wide>{sourceTabs}<WereadImport onImport={onImport}/></Modal>;
    return <Modal title="下一本，想读什么？" onClose={onClose} wide>{sourceTabs}<p className="rc-modal-lead">把一本书带进来，给自己七天慢慢读。</p><div className={'rc-upload ' + (drag ? 'drag' : '')} onDragOver={e => {
        e.preventDefault();
        setDrag(true);
      }} onDragLeave={() => setDrag(false)} onDrop={e => {
        e.preventDefault();
        setDrag(false);
        choose(e.dataTransfer.files[0]);
      }}><Icon name="upload" size={32} /><h3>{busy ? '正在本机解析书籍…' : '拖拽一本书到这里'}</h3><p>EPUB、TXT 或 Markdown · 最大 6 MB</p><button className="rc-button primary" onClick={() => fileRef.current.click()} disabled={busy}>{busy ? '正在解析' : '选择文件'}<Icon name="plus" size={16} /></button><input ref={fileRef} type="file" accept=".epub,.txt,.md" hidden onChange={e => choose(e.target.files[0])} /></div><div className="rc-info-line"><Icon name="lock" size={16} /><span>文件先在本机解析与保存；加入书架后，会自动发送必要文本生成全书导读。详情可在“关于这个 demo”查看。</span></div>{book && <div className="rc-import-preview"><Icon name="book" size={25} /><div><h3>{book.title}</h3><p>{book.units.length} 个完整标题单元 · {M.countWords(book.units.map(u => u.text).join('')).toLocaleString()} 字</p></div><span className="rc-pill">解析完成</span></div>}{book && <p className="rc-fine">{book.warning} {book.units.length < 7 ? '此书不足 7 个可识别单元，可以先加入书架，但暂不能生成七天计划。' : ''}</p>}{error && <p className="rc-error" role="alert">{error}</p>}<footer className="rc-modal-actions"><button className="rc-button ghost" onClick={onClose}>暂时不导入</button><button className="rc-button primary" disabled={!book || busy} onClick={async () => {
          setBusy(true);
          try {await onImport(book);} catch(e){if(alive.current)setError(e.message);}
          finally{if(alive.current)setBusy(false);}
        }}>加入书架<Icon name="arrow" size={18} /></button></footer><p className="rc-fine">暂不支持 PDF、扫描件与加密书籍；请只导入自己有权使用的文件。首次进入某天阅读页会自动生成每日导读；AI 讨论仍需你主动点击。</p></Modal>;
  }
  function WeekStrip({
    camp,
    selected,
    vertical = false
  }) {
    return <div className={'rc-week ' + (vertical ? 'vertical' : '')}>{camp.days.map(d => {
        const state = M.stateForDay(camp, d.day, campNow(camp));
        return <a key={d.day} href={link('session', camp, d.day)} className={'rc-day ' + state + (selected === d.day ? ' current' : '')} aria-current={selected === d.day ? 'step' : undefined}><span>{state === 'done' ? <Icon name="check" size={15} /> : numeral(d.day)}</span><b>第 {d.day} 天</b><small>{stateNames[state]}</small></a>;
      })}</div>;
  }
  function Welcome({
    camp,
    book
  }) {
    const d = camp.days[todayDay(camp) - 1],
      done = Object.keys(camp.notes).length;
    const future = M.stateForDay(camp,d.day,campNow(camp))==='future';
    return <><section className="rc-hero" data-screen-label="今日阅读"><div className="rc-hero-copy"><span className="rc-eyebrow"><i></i> A LITTLE READING, EVERY DAY</span><h1>翻开一本书，<br />也读一读<span>自己。</span></h1><p>不急着找到标准答案。<br />今天，也留一点时间给自己的想法。</p></div><div className="rc-hero-art"><ReadingScene mood="read" /><span className="rc-hand-note">你的书搭子，已经就位。</span></div></section><div className="rc-home-grid"><section className="rc-current-book"><div className="rc-card-top"><span><i className="rc-dot"></i>{camp.demo ? '示例读书营' : '我的读书营'}</span><a href={link('camp', camp)}>查看全书导读<Icon name="chevron" size={14} /></a></div><div className="rc-book-feature"><Cover book={book} /><div className="rc-feature-details"><span className="rc-eyebrow muted">7 天读写</span><h2>{book.title}</h2><p className="rc-author">{book.author}</p><div className="rc-progress-label"><span>已提交 {done} 篇笔记</span><b>{done} / 7</b></div><div className="rc-progress-track"><i style={{
                  width: done / 7 * 100 + '%'
                }}></i></div><a className="rc-button primary" href={link(camp.onboarded ? 'session' : 'camp', camp, d.day)}>{camp.onboarded ? future ? '预览下一次阅读' : camp.notes[d.day] ? '回看今天的阅读' : '开始今天的阅读' : '查看阅读计划'}<Icon name="arrow" size={18} /></a></div></div></section><section className="rc-today-hint"><span className="rc-eyebrow">{future?'UP NEXT':'TODAY'} / {numeral(d.day)}</span><div className="rc-hint-heading"><Icon name="spark" size={22} /><h3>一个可以带着读的想法</h3></div><p className="rc-question">{d.question}</p><p className="rc-soft-note">可以回应，也可以写下别的触动。<br />你的笔记，不需要标准答案。</p><a href={link('session', camp, d.day)} className="rc-text-link">看看阅读范围<Icon name="arrow" size={17} /></a></section></div><section className="rc-journey"><div className="rc-section-heading"><div><span className="rc-eyebrow muted">YOUR READING JOURNEY</span><h2>七天，留下一点自己的理解。</h2></div><span className="rc-fine">{camp.demo ? '演示日期 · 阅读第 3 天' : fmtDate(camp.startDate) + ' — ' + fmtDate(M.dayDate(camp, 7))}</span></div><WeekStrip camp={camp} selected={d.day} /></section><div className="rc-footer-note"><span>读完一段，写下一点。每篇至少 400 字，表达不设限。</span><span>阅读与笔记仅保存在当前浏览器</span></div></>;
  }
  function Library({
    data,
    onImport,
    onStart,
    onAttach
  }) {
    const [filter, setFilter] = useState('全部'),
      [search, setSearch] = useState('');
    const books = data.books.filter(b => {
      const camp = data.camps.find(c => c.bookId === b.id),
        completed = camp && Object.keys(camp.notes).length === 7;
      return b.title.includes(search) && (filter === '全部' || (filter === '已读' ? completed : camp && !completed));
    });
    return <section data-screen-label="我的书架"><div className="rc-page-heading"><div><span className="rc-eyebrow">YOUR LITTLE LIBRARY</span><h1>书不必很多，<br />有一本正在读就好。</h1></div><button className="rc-button primary" onClick={onImport}><Icon name="plus" />导入一本书</button></div><div className="rc-library-tools"><div className="rc-tabs" role="tablist" aria-label="书架筛选">{['全部', '在读', '已读'].map(f => <button role="tab" aria-selected={f === filter} key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div><label className="rc-search"><Icon name="search" size={18} /><input aria-label="搜索书名" placeholder="找一本书" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="rc-library-grid">{books.map(book => {
          const camp = data.camps.find(c => c.bookId === book.id),
            count = camp ? Object.keys(camp.notes).length : 0;
          return <article className="rc-shelf-book" key={book.id}><div className="rc-shelf-cover"><Cover book={book} /><span className="rc-pill">{book.source === 'sample' ? '原创示例' : book.format}</span></div><h2>{book.title}</h2><p>{book.author || '作者未标注'}</p><div className="rc-progress-label"><span>{camp ? count + ' / 7 篇笔记' : book.contentStatus==='metadata-only'?'仅目录，待补正文':book.units.length + ' 个阅读单元'}</span><span>{camp ? count === 7 ? '已完成' : '在读' : book.contentStatus==='metadata-only'?'待补正文':'待开始'}</span></div><div className="rc-progress-track"><i style={{
                width: count / 7 * 100 + '%'
              }}></i></div>{camp ? <a className="rc-button outline" href={link(camp.onboarded ? 'session' : 'camp', camp, todayDay(camp))}>{camp.onboarded ? '继续阅读' : '查看阅读计划'}<Icon name="arrow" size={16} /></a> : <button className="rc-button outline" onClick={() => book.contentStatus==='metadata-only'?onAttach(book):onStart(book)}>{book.contentStatus==='metadata-only'?'补充本地正文':'查看七天分组'}<Icon name="arrow" size={16} /></button>}</article>;
        })}<button className="rc-add-book" onClick={onImport}><span><Icon name="plus" size={30} /></span><b>下一本，等你翻开</b><small>本地文件或微信读书</small></button></div>{books.length === 0 && <p className="rc-empty-label">这里还没有符合条件的书。试试其他筛选，或带一本新书进来。</p>}<p className="rc-fine rc-bottom-disclaimer">书架中的示例书为原创演示内容，不代表真实出版物。导入文件只按已有标题解析；本 demo 不进行真实 AI 语义拆分。</p></section>;
  }
  function Camp({
    camp,
    book,
    onConfirm,
    onGenerateGuide,
    onGeneratePlan,
    onAdoptPlan
  }) {
    const [ack, setAck] = useState(false),
      [intent, setIntent] = useState(camp.intention || '');
    const opening = book.opening;
    const guide = book.guide;
    const guideReady = guide?.status === 'ready' && guide.content;
    const planSuggestion = book.planSuggestion;
    return <section data-screen-label="开始阅读前"><div className="rc-page-heading"><div><span className="rc-eyebrow">BEFORE THE FIRST PAGE</span><h1>先认识这本书，<br />再带着自己的问题出发。</h1></div><ReadingMark size={72} /></div><div className="rc-camp-grid"><article className="rc-opening"><div className="rc-opening-book"><Cover book={book} small /><div><span className="rc-pill">{book.source === 'sample' ? 'AI 导读 · 预设示例' : guideReady ? 'AI 导读 · 已生成' : guide?.status === 'generating' ? 'AI 导读 · 生成中' : guide?.status === 'failed' ? 'AI 导读 · 生成失败' : '本地内容预览 · 待生成导读'}</span><h2>{book.title}</h2><p>{book.subtitle || '从这本书开始一段自己的阅读旅程'}</p></div></div>{book.source === 'sample' ? <><h3>{opening?.title || '先从序言与目录认识它'}</h3>{(opening?.paragraphs || []).map((p, i) => <p key={i}>{p}</p>)}{opening?.ideas && <div className="rc-opening-ideas">{opening.ideas.map((idea, i) => <div key={i}><span>{numeral(i + 1)}</span><p>{typeof idea === 'string' ? idea : idea.text}</p></div>)}</div>}</> : guideReady ? <><h3>全书导读</h3><p>{guide.content.intro}</p><p>{guide.content.background}</p>{guide.content.themes?.length ? <div className="rc-opening-ideas">{guide.content.themes.map((theme, i) => <div key={i}><span>{numeral(i + 1)}</span><p>{theme}</p></div>)}</div> : null}</> : guide?.status === 'generating' ? <><h3>正在生成全书导读…</h3><p>已取得正文，正在将正文发送给已配置的模型生成摘要，再据此准备导读。刷新不会重复生成，请稍候。</p></> : guide?.status === 'failed' ? <><h3>全书导读尚未生成</h3><p className="rc-error">{guide.error || '生成失败'}</p><button className="rc-button outline" onClick={() => onGenerateGuide(book.id)}><Icon name="spark" size={16} />重新生成导读</button></> : <><h3>先从序言与目录认识它</h3>{book.prelude ? <p>{book.prelude.slice(0, 1200)}</p> : <p>文件已在本机解析。导入正文后会自动生成全书导读，不会根据书名编造内容。</p>}</>}<div className="rc-big-question"><span className="rc-eyebrow">留给整本书的问题</span>{guideReady && guide.content.questions?.length ? guide.content.questions.map((q, i) => <h3 key={i}><b>{numeral(i + 1)}.</b> {q}</h3>) : <h3>{opening?.question || '读完这本书，你希望重新理解生活中的哪件事？'}</h3>}<p>现在不必回答。读到最后，可以再回来看看。</p></div><label className="rc-intention-label">此刻，你为什么想读它？<span>选填，只为自己留下一个起点</span><textarea value={intent} onChange={e => setIntent(e.target.value)} maxLength={1000} readOnly={camp.onboarded} placeholder="可以是一件好奇的事，也可以只是想给自己一点阅读时间。" /></label></article><aside className="rc-camp-aside"><div className="rc-section-heading"><h2>这次，我们这样读</h2><span className="rc-pill">共 7 天</span></div><p className="rc-fine">7 天阅读。先保留完整内容，再尽量均衡分配。</p>{camp.days.map(d => <a className="rc-plan-row" key={d.day} href={link('session', camp, d.day)}><span>{numeral(d.day)}</span><div><b>{displayTitle(book,d)}</b><small>{fmtDate(M.dayDate(camp, d.day))} · 第 {d.startPage}~{d.endPage} 页 · {d.wordCount.toLocaleString()} 字 · 阅读约 {d.readMinutes} 分钟</small></div><Icon name="chevron" size={15} /></a>)}<div className="rc-camp-rules"><h3>打卡有约定，表达是自由的。</h3><p>每日笔记至少 400 字，须在当天 23:59 前提交。问题只是引子，不必作答，不做评分。</p><p>写作另预留约 15–25 分钟，仅供安排参考。计数不含标点和空白。时区：{camp.timezone}。</p><p>未按时提交会保留记录，后续仍可补交。补交不变成按时完成。</p></div>{!camp.onboarded && book.source !== 'sample' && book.units.length >= 7 && <div className="rc-plan-ai"><div className="rc-section-heading"><h3>AI 七日拆分建议</h3><span className="rc-pill">可选</span></div><p className="rc-fine">AI 根据主题与篇幅提出七天边界，供你核对；采用前不会改动当前分组。</p>{planSuggestion?.status === 'ready' ? <><ol className="rc-plan-ai-days">{planSuggestion.days.map((d, i) => {const titles = d.unitIds.map(id => book.units.find(u => u.id === id)?.title).filter(Boolean);return <li key={i}><span>{numeral(i + 1)}</span><p>{titles[0]}{titles.length > 1 ? ' — ' + titles[titles.length - 1] : ''}</p><small>{d.reason}</small></li>;})}</ol><div className="rc-plan-ai-actions"><button className="rc-button primary" onClick={() => onAdoptPlan(camp.id)}>采纳这个七天计划<Icon name="check" size={16} /></button><button className="rc-text-button" onClick={() => onGeneratePlan(book.id)}>重新生成</button></div></> : planSuggestion?.status === 'generating' ? <p>正在生成拆分建议…</p> : planSuggestion?.status === 'failed' ? <><p className="rc-error">{planSuggestion.error}</p><button className="rc-button outline" onClick={() => onGeneratePlan(book.id)}>重试</button></> : <button className="rc-button outline" onClick={() => onGeneratePlan(book.id)}><Icon name="spark" size={16} />生成 AI 拆分建议</button>}{camp.planAdopted && <p className="rc-fine">已采纳 AI 拆分建议。</p>}</div>}{!camp.onboarded ? <><label className="rc-check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>我已了解七天的范围与提交约定</span></label><button className="rc-button primary full" disabled={!ack} onClick={() => onConfirm(intent)}>确认计划，开始阅读<Icon name="arrow" size={17} /></button><p className="rc-fine">确认当天即第 1 天，共 7 天；可以先预览正文。</p></> : <a className="rc-button primary full" href={link('session', camp, todayDay(camp))}>回到今天的阅读<Icon name="arrow" size={17} /></a>}<p className="rc-fine">{book.source === 'sample' ? '本书导读和问题为预设示例，未调用真实模型。' : '当前为按标题的本地均衡分组，不等同 AI 理解语义；请先核对切分边界。'}</p></aside></div></section>;
  }
  function renderParagraphs(text) {
    return text.split(/(\[\[IMG:[\s\S]*?\]\])/g).map((part, i) => {
      if (part.startsWith('[[IMG:')) return <img key={i} className="rc-illustration" src={part.slice(6, -2)} alt="" loading="lazy" />;
      return part.split(/\n\s*\n/).filter(Boolean).map((p, j) => <p key={i + '-' + j}>{p}</p>);
    });
  }
  function Session({
    camp,
    book,
    onDraft,
    onSubmit,
    onEdit,
    onExport,
    onFeishu,
    onDiscussion,
    onDailyGuide,
    readerSize
  }) {
    const queryDay = Number(new URLSearchParams(location.search).get('day'));
    const [dayNumber] = useState(() => Number.isInteger(queryDay) && queryDay >= 1 && queryDay <= 7 ? queryDay : todayDay(camp));
    const day = camp.days[dayNumber - 1];
    const note = camp.notes[String(dayNumber)],
      state = M.stateForDay(camp, dayNumber, campNow(camp));
    const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') === 'write' ? 'write' : 'read'),
      [text, setText] = useState(camp.drafts[String(dayNumber)] || ''),
      [saved, setSaved] = useState(true),
      [saveError, setSaveError] = useState(''),
      [showQuestion, setShowQuestion] = useState(true),
      [celebrate, setCelebrate] = useState(false),
      [light, setLight] = useState(true),
      [submitting, setSubmitting] = useState(false),
      [editing, setEditing] = useState(false);
    const submittingRef = useRef(false);
    const firstEffect = useRef(true),
      textRef = useRef(text),
      savedText = useRef(text),
      timer = useRef(null);
    textRef.current = text;
    const count = M.countWords(text),
      future = state === 'future',
      units = readUnits(book, day);
    const dailyGuide = camp.dailyGuides?.[String(dayNumber)];
    const [guideError, setGuideError] = useState('');
    const guideStarted = useRef(false);
    useEffect(() => {
      if (guideStarted.current) return;
      guideStarted.current = true;
      if (book.source === 'sample' || dailyGuide) return;
      let chapter;
      try { chapter = M.dailyDiscussionContext(book, day); } catch { return; }
      (async () => {
        try {
          if (chapter.text.length > 40000) {
            const digest = (await ReadingAPI.compress({book: {id: book.id, title: book.title, author: book.author || ''}, chapter: {id: chapter.id, title: chapter.title, text: chapter.text}})).digest;
            chapter = {id: chapter.id, title: chapter.title, text: digest};
          }
          const result = await ReadingAPI.dailyGuide({book: {id: book.id, title: book.title, author: book.author || ''}, chapter});
          await onDailyGuide(dayNumber, {content: result.guide, generatedAt: new Date().toISOString(), model: result.model});
        } catch (e) {
          if (e.name !== 'AbortError') setGuideError(e.message);
        }
      })();
    }, []);
    useEffect(() => {
      if (firstEffect.current) {
        firstEffect.current = false;
        return;
      }
      if (editing) return;
      setSaved(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await onDraft(dayNumber, text);
          savedText.current = text;
          if(textRef.current===text){setSaved(true);setSaveError('');}
        } catch (e) {
          setSaveError(e.message);
        }
      }, 600);
      return () => clearTimeout(timer.current);
    }, [text, editing]);
    useEffect(() => {
      const leave = e => {
        if (textRef.current !== savedText.current) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', leave);
      return () => window.removeEventListener('beforeunload', leave);
    }, []);
    async function submit() {
      if(submittingRef.current)return;
      submittingRef.current=true;setSubmitting(true);
      clearTimeout(timer.current);
      try {
        await onSubmit(dayNumber, text);
        savedText.current = text;
        setSaved(true);
        setSaveError('');
        setCelebrate(true);
      } catch (e) {
        setSaveError(e.message);
      } finally {submittingRef.current=false;setSubmitting(false);}
    }
    function beginEdit() {
      setText(note.text);
      setEditing(true);
    }
    function cancelEdit() {
      setEditing(false);
      setSaveError('');
    }
    async function submitEdit() {
      if (submittingRef.current) return;
      submittingRef.current = true; setSubmitting(true);
      clearTimeout(timer.current);
      try {
        await onEdit(dayNumber, text);
        savedText.current = text;
        setSaved(true);
        setSaveError('');
        setEditing(false);
        setCelebrate(true);
      } catch (e) {
        setSaveError(e.message);
      } finally { submittingRef.current = false; setSubmitting(false); }
    }
    return <section className="rc-session" data-screen-label="每日阅读与自由笔记"><div className="rc-session-heading"><a href={link('home', camp)} className="rc-back"><Icon name="left" size={17} />返回读书营</a><span>{book.title} / 阅读第 {dayNumber} 天</span><button className="rc-icon-button" aria-label={light ? '使用深色阅读背景' : '使用浅色阅读背景'} onClick={() => setLight(!light)}><Icon name={light ? 'moon' : 'sun'} size={18} /></button></div><div className="rc-session-grid"><aside className="rc-session-plan"><span className="rc-eyebrow muted">七天阅读路线</span><WeekStrip camp={camp} selected={dayNumber} vertical /><a className="rc-text-link" href={link('camp', camp)}>回看全书导读<Icon name="arrow" size={15} /></a></aside><div className="rc-reading-workspace"><header className="rc-daily-header"><div><span className="rc-eyebrow">DAY {numeral(dayNumber)} / 07</span><span className={'rc-status ' + state}>{future ? '预览 · 尚未到提交日期' : stateNames[state]}</span></div><h1>{displayTitle(book,day)}</h1><p className="rc-range">今日阅读范围：{day.title || units.map(u => u.title).join(' / ')}{day.startPage && day.endPage ? ` · 约第 ${day.startPage}~${day.endPage} 页` : ''}</p><div className="rc-reading-meta"><span><Icon name="book" size={15} />{day.wordCount.toLocaleString()} 字</span><span><Icon name="clock" size={15} />阅读约 {day.readMinutes} 分钟</span><span>笔记至少 400 字</span><span>{fmtDate(M.dayDate(camp, dayNumber))} 23:59 截止</span></div></header><section className="rc-daily-guide"><div className="rc-daily-guide-top"><span><Icon name="spark" size={17} />{book.source === 'sample' ? '今日导读 · 示例' : dailyGuide?.content ? '今日导读 · AI 生成' : '今日导读'}</span><button className="rc-text-button" onClick={() => setShowQuestion(!showQuestion)}>{showQuestion ? '收起引导' : '看看写作引导'}<Icon name="chevron" size={14} /></button></div>{book.source === 'sample' ? <p>{day.intro}</p> : dailyGuide?.content ? dailyGuide.content.focus.split(/\n\s*\n/).filter(Boolean).map((para, i) => <p key={i}>{para}</p>) : <p>{guideError || '今天完整阅读以上单元。今日导读正在准备中；下方是通用写作引导，不代表对正文的分析。'}</p>}{showQuestion && (book.source === 'sample' || !dailyGuide?.content ? <div className="rc-personal-question"><span>一个可以带着读的想法</span><h3>{day.question}</h3><small>可以回应，也可以写下今天另一个触动你的想法。</small></div> : <div className="rc-personal-question"><span>一个可以带着读的想法</span><h3>{dailyGuide.content.question}</h3><small>可以回应，也可以写下今天另一个触动你的想法。</small></div>)}</section><div className="rc-work-tabs" role="tablist" aria-label="阅读与笔记"><button role="tab" aria-selected={tab === 'read'} className={tab === 'read' ? 'active' : ''} onClick={() => setTab('read')}><Icon name="book" size={17} />读一读</button><button role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}><Icon name="note" size={17} />{note ? '回看笔记' : '写下想法'}{!note && count > 0 && <span>{count} 字</span>}</button></div>{tab === 'read' ? <article className={'rc-reader ' + (light ? 'light' : '')} style={{
            '--reader-size': readerSize + 'px'
          }}>{(day.chapters && day.chapters.length ? day.chapters : [{title: '', part: '', unitIds: units.map(u => u.id)}]).map(ch => <section key={ch.title || ch.unitIds[0]} className="rc-chapter">{ch.part && ch.part !== ch.title ? <div className="rc-eyebrow">{ch.part}</div> : null}{ch.title ? <h2>{ch.title}</h2> : null}{ch.unitIds.map(id => { const u = units.find(x => x.id === id); return u ? <div key={u.id} className="rc-unit">{u.title !== ch.title ? <h3>{u.title}</h3> : null}{renderParagraphs(u.text)}</div> : null; })}</section>)}<DailyDiscussion key={camp.id+"-"+dayNumber} book={book} day={day} value={camp.dailyDiscussions?.[dayNumber]} legacy={units.filter(u=>camp.discussions?.[u.id]).map(unit=>({unit,record:camp.discussions[unit.id]}))} onSave={onDiscussion} onWrite={()=>setTab("write")}/><footer><div><ReadingMark size={28} /><span>这一段，先读到这里。</span></div><button className="rc-button primary" onClick={() => setTab('write')}>{note ? '回看我的笔记' : '写下此刻的想法'}<Icon name="arrow" size={17} /></button><p>翻到这里不会自动打卡，提交笔记后才留下阅读印记。</p></footer></article> : <div className="rc-writing-space">{note && !editing ? <><div className="rc-note-receipt"><span className="rc-stamp"><Icon name="check" size={25} /></span><div><h3>{note.status === 'late' ? '笔记已补交，原逾期记录保留' : '这一天，留下了你的理解。'}</h3><p>{note.count} 字 · 已保存{camp.demo ? ' · 示例读书营' : ''}</p></div></div><div className="rc-submitted-note">{note.text.split('\n').map((p, i) => <p key={i}>{p}</p>)}</div><div className="rc-inline-actions"><button className="rc-button outline" onClick={beginEdit}><Icon name="edit" size={17} />编辑笔记</button><button className="rc-button outline" onClick={onExport}><Icon name="download" size={17} />导出笔记</button><button className="rc-button outline" onClick={onFeishu}><Icon name="link" size={17} />写入飞书</button></div></> : <><div className="rc-editor-title"><h2>{editing ? '编辑已提交的笔记' : '写下你的想法'}</h2><span>{editing ? (note.status === 'late' ? '编辑不会改变补交记录' : '编辑不会改变按时记录') : (saved ? '草稿已保存在本机' : '正在保存草稿…')}</span></div><p className="rc-editor-hint">不必回答上面的问题，也不必赞同作者。这里留给你自己的理解。</p><textarea className="rc-note-editor" aria-label="读书笔记" disabled={submitting} value={text} onChange={e => setText(e.target.value)} maxLength={20000} placeholder="今天读到这里，我想到了……" /><div className="rc-word-meter"><div><strong className={count >= 400 ? 'enough' : ''}>{count}</strong><span> / 至少 400 字</span></div><span>{count >= 400 ? '已经达到字数约定' : `还差 ${400 - count} 字，不妨多写一点自己的经历。`}</span></div><div className="rc-word-track"><i style={{
                  width: Math.min(count / 400 * 100, 100) + '%'
                }}></i></div><p className="rc-fine">仅统计正文文字与数字，不含标点和空白。不检查是否回答问题，不做 AI 评分。</p>{saveError && <p className="rc-error" role="alert">{saveError}</p>}{future && <p className="rc-callout">这一天还未开始。可以先阅读、保存草稿，到 {fmtDate(M.dayDate(camp, dayNumber))} 再提交。</p>}{!camp.onboarded && <p className="rc-callout">请先在<a href={link('camp', camp)}>阅读计划页</a>确认计划并开始阅读，再提交笔记。</p>}{state === 'missed' && <p className="rc-callout">这一天未按时完成。现在可以补交，但不会改为按时打卡。</p>}<div className="rc-submit-actions">{editing ? <button className="rc-text-button" onClick={cancelEdit}>取消编辑</button> : <button className="rc-text-button" onClick={() => downloadText(book.title + '-草稿.md', text)}>下载当前草稿</button>}<button className="rc-button primary" disabled={editing ? (submitting || count < 400) : (submitting || count < 400 || future || !camp.onboarded)} onClick={editing ? submitEdit : submit}>{submitting ? (editing ? '正在保存修改…' : '正在保存笔记…') : editing ? '保存修改' : state === 'missed' ? '补交这篇笔记' : '提交笔记，完成今日阅读'}<Icon name="check" size={18} /></button></div><p className="rc-fine">提交即确认完成本日阅读；笔记保存成功后才打卡，不会自动发送到飞书。</p></>}</div>}</div></div>{celebrate && <Modal title="今天，又读懂了一点。" onClose={() => setCelebrate(false)}><div className="rc-celebration"><ReadingScene mood="celebrate" /><span className="rc-celebration-seal">{state === 'late' ? '已补交' : '已读 · 已记'}</span><h3>{camp.notes[dayNumber]?.status === 'late' ? '你的补交笔记已保存。' : '这份理解，是你自己的。'}</h3><p>第 {dayNumber} 天 · {camp.notes[dayNumber]?.count || count} 字笔记<br />{camp.notes[dayNumber]?.status === 'late' ? '保留原来的逾期记录，继续接下来的阅读。' : '阅读印记已点亮，不必急着开始下一件事。'}</p><button className="rc-button primary full" onClick={() => setCelebrate(false)}>开心收下<Icon name="check" size={18} /></button></div></Modal>}</section>;
  }
  function Notes({
    data,
    onFeishu,
    onExport
  }) {
    const [selected, setSelected] = useState('all');
    const notes = data.camps.flatMap(camp => Object.entries(camp.notes).map(([day, note]) => ({
      camp,
      book: data.books.find(b => b.id === camp.bookId),
      day: Number(day),
      note
    }))).filter(n => selected === 'all' || n.book.id === selected).reverse();
    return <section data-screen-label="我的读书笔记"><div className="rc-page-heading"><div><span className="rc-eyebrow">WORDS THAT STAY WITH YOU</span><h1>书里的话，<br />慢慢变成自己的想法。</h1></div><span className="rc-note-count">{notes.length}<small>篇已提交笔记</small></span></div><div className="rc-library-tools"><h2>我的阅读留痕</h2><select className="rc-select" aria-label="按书筛选笔记" value={selected} onChange={e => setSelected(e.target.value)}><option value="all">全部书籍</option>{data.books.map(b => <option value={b.id} key={b.id}>{b.title}</option>)}</select></div>{!notes.length ? <div className="rc-empty"><ReadingMark size={70} /><h2>第一篇笔记，还在等你。</h2><p>阅读之后写一点自己的想法，提交后就会留在这里。</p><a className="rc-button primary" href={pages.home}>去读一读<Icon name="arrow" size={18} /></a></div> : <div className="rc-notes-list">{notes.map(({
          camp,
          book,
          day,
          note
        }) => <article key={camp.id + '-' + day} className="rc-note-card"><div className="rc-note-card-head"><span className="rc-note-day">{numeral(day)}</span><div><span className="rc-eyebrow">{book.title}{camp.demo ? ' · 示例' : ''}</span><h2>{displayTitle(book,camp.days[day - 1])}</h2></div><span className={'rc-status ' + note.status}>{note.status === 'late' ? '已补交' : '已完成'}</span></div><p className="rc-note-excerpt">{note.text.slice(0, 190)}{note.text.length > 190 ? '…' : ''}</p><footer><span>{fmtDate(M.dayDate(camp, day))} · {note.count} 字</span><div><button onClick={() => onExport(book, camp)} aria-label={'导出' + book.title + '的笔记'}><Icon name="download" size={17} /></button><button onClick={() => onFeishu(book, camp)} aria-label="写入飞书"><Icon name="link" size={17} /></button><a href={link('session', camp, day)+'&tab=write'}>阅读全文<Icon name="arrow" size={16} /></a></div></footer></article>)}</div>}<p className="rc-fine rc-bottom-disclaimer">笔记保存在当前浏览器。建议定期导出；清理浏览器数据会移除本地内容。</p></section>;
  }
  function App() {
    const [boot, setBoot] = useState({loading:true});
    const [data, setData] = useState(null),
      dataRef = useRef(null),
      writeQueue = useRef(Promise.resolve()),
      startingBook = useRef(false),
      guideBusy = useRef(new Set()),
      planBusy = useRef(new Set()),
      scanned = useRef(false),
      [modal, setModal] = useState(null),
      [toast, setToast] = useState(''),
      [conflict, setConflict] = useState(false),
      [sideOpen, setSideOpen] = useState(false),
      [feishuTarget, setFeishuTarget] = useState(null),
      [exportPreview, setExportPreview] = useState(null),
      [attachTarget, setAttachTarget] = useState(null),
      [, setClock] = useState(0);
    const [t, setTweak] = useTweaks(window.READING_PREFERENCE_DEFAULTS || {
      motion: true,
      readerSize: 19,
      accent: '#2e6753'
    });
    useEffect(() => {
      let active = true;
      S.load(makeSeed).then(value=> {if(active){dataRef.current=value;setData(value);setBoot({loading:false});}}).catch(e=>{if(active)setBoot({error:e.message});});
      return () => {active=false;};
    }, []);
    useEffect(() => {
      if (!data || scanned.current) return;
      scanned.current = true;
      const stale = data.books.filter(b => b.guide?.status === 'generating').map(b => b.id);
      if (stale.length) update(old => ({...old, books: old.books.map(b => stale.includes(b.id) ? {...b, guide: {status: 'failed', fingerprint: b.guide.fingerprint, error: '上次生成未完成，请手动重试。'}} : b)})).catch(() => {});
      for (const b of data.books) if (b.source !== 'sample' && Array.isArray(b.units) && b.units.length && !b.guide) generateBookGuide(b.id);
    }, [data]);
    const view = document.body.dataset.readingPage || 'home',
      queryCamp = new URLSearchParams(location.search).get('camp');
    const camp = data?.camps.find(c => c.id === queryCamp) || data?.camps.find(c => c.id === data.activeCamp) || data?.camps[0],
      book = data?.books.find(b => b.id === camp?.bookId);
    useEffect(() => {
      const handler = e => {
        if (e.key !== S.key && e.key !== null) return;
        if (!dataRef.current) return;
        try {
          if (!e.newValue || Number(JSON.parse(e.newValue)?.revision) !== dataRef.current?.revision) setConflict(true);
        } catch { setConflict(true); }
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    }, []);
    useEffect(() => {
      if (!toast) return;
      const timer = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(timer);
    }, [toast]);
    useEffect(() => {
      const timer = setInterval(() => setClock(n=>n+1), 30000);
      return () => clearInterval(timer);
    }, []);
    function showFeishu(b=book,c=camp) { setFeishuTarget({book:b,camp:c}); setModal('feishu'); }
    function update(fn) {
      const operation = writeQueue.current.then(async () => {
        if (conflict) throw new Error('另一个窗口更新了数据，请保留当前文本后刷新。');
        const old = dataRef.current;
        const next = await S.save(fn(old), old.revision);
        dataRef.current = next; setData(next); return next;
      });
      writeQueue.current = operation.catch(()=>{});
      return operation;
    }
    function updateCamp(fn) {
      return update(old => ({
        ...old,
        camps: old.camps.map(c => c.id === camp.id ? fn(c) : c)
      }));
    }
    function stripImages(value) {
      return String(value || '').replace(/\[\[IMG:[\s\S]*?\]\]/g, '');
    }
    function buildGuideSource(book) {
      const prelude = (book.prelude || '').trim().slice(0, 8000);
      const toc = book.units.map((unit, i) => `${i + 1}. ${unit.title}`).join('\n').slice(0, 4000);
      const bodyText = book.units.map(unit => `【${unit.title}】\n${stripImages(unit.text)}`).join('\n\n').slice(0, 80000);
      return {prelude, toc, bodyText};
    }
    async function generateBookGuide(bookId) {
      if (guideBusy.current.has(bookId)) return;
      const book = dataRef.current.books.find(b => b.id === bookId);
      if (!book || book.source === 'sample' || !Array.isArray(book.units) || !book.units.length) return;
      if (book.guide?.status === 'ready' || book.guide?.status === 'generating') return;
      const fingerprint = M.contentFingerprint(book);
      guideBusy.current.add(bookId);
      try {
        await update(old => ({...old, books: old.books.map(b => b.id === bookId ? {...b, guide: {status: 'generating', fingerprint}} : b)}));
        const source = buildGuideSource(book);
        const digest = (await ReadingAPI.compress({book: {id: book.id, title: book.title, author: book.author || ''}, chapter: {id: `compress-${book.id}`, title: book.title, text: source.bodyText}})).digest;
        const guideText = [source.prelude, `目录：\n${source.toc}`, `正文摘要：\n${digest}`].filter(part => part.trim()).join('\n\n');
        const result = await ReadingAPI.guide({book: {id: book.id, title: book.title, author: book.author || ''}, chapter: {id: `guide-${book.id}`, title: '全书导读资料', text: guideText}});
        await update(old => ({...old, books: old.books.map(b => b.id === bookId ? {...b, guide: {status: 'ready', fingerprint, content: result.guide, generatedAt: new Date().toISOString(), model: result.model}} : b)}));
      } catch (e) {
        await update(old => ({...old, books: old.books.map(b => b.id === bookId ? {...b, guide: {status: 'failed', fingerprint: b.guide?.fingerprint, error: e.message || '全书导读生成失败'}} : b)})).catch(() => {});
      } finally {
        guideBusy.current.delete(bookId);
      }
    }
    async function generatePlan(bookId) {
      if (planBusy.current.has(bookId)) return;
      const book = dataRef.current.books.find(b => b.id === bookId);
      if (!book || book.source === 'sample' || !Array.isArray(book.units) || book.units.length < 7) return;
      if (book.planSuggestion?.status === 'ready' || book.planSuggestion?.status === 'generating') return;
      const fingerprint = M.contentFingerprint(book);
      planBusy.current.add(bookId);
      try {
        await update(old => ({...old, books: old.books.map(b => b.id === bookId ? {...b, planSuggestion: {status: 'generating', fingerprint}} : b)}));
        const units = book.units.map(unit => ({id: unit.id, title: unit.title, level: unit.level, wordCount: M.countWords(unit.text), excerpt: stripImages(unit.text).slice(0, 200)}));
        const result = await ReadingAPI.plan({book: {id: book.id, title: book.title, author: book.author || ''}, units});
        await update(old => ({...old, books: old.books.map(b => b.id === bookId ? {...b, planSuggestion: {status: 'ready', fingerprint, days: result.days, generatedAt: new Date().toISOString(), model: result.model}} : b)}));
      } catch (e) {
        await update(old => ({...old, books: old.books.map(b => b.id === bookId ? {...b, planSuggestion: {status: 'failed', fingerprint, error: e.message || '拆分建议生成失败'}} : b)})).catch(() => {});
      } finally {
        planBusy.current.delete(bookId);
      }
    }
    function adoptPlan(campId) {
      const c = dataRef.current.camps.find(x => x.id === campId);
      if (!c || c.onboarded) return Promise.resolve();
      const book = dataRef.current.books.find(b => b.id === c.bookId);
      if (!book || book.planSuggestion?.status !== 'ready') return Promise.resolve();
      try {
        const days = M.planDays(book.units, book.planSuggestion.days);
        return update(old => ({...old, camps: old.camps.map(x => x.id === campId ? {...x, days, planAdopted: true} : x)}));
      } catch (e) {
        setToast(e.message);
        return Promise.resolve();
      }
    }
    function exportNotes(b = book, c = camp) {
      if (!c) return;
      try {
        M.exportMarkdown(b,c);
        setExportPreview({book:b,camp:c});
        setModal('export');
      } catch(e) { setToast(e.message); }
    }
    async function importBook(b) {
      await update(old => {
        if(old.books.some(book=>book.id===b.id))throw new Error('这本书已经在书架上了，无需重复导入。');
        return {...old,books:[...old.books,b]};
      });
      setModal(null);
      location.href = pages.library;
    }
    async function attachBook(target, parsed) {
      await update(old=>{
        if(old.camps.some(c=>c.bookId===target.id))throw new Error('已有读书营的正文不能被覆盖。请单独导入新版本。');
        const existing=old.books.find(b=>b.id===target.id);
        if(!existing || existing.contentStatus!=='metadata-only')throw new Error('书籍状态已变化，请刷新后重试。');
        const merged={...existing,units:parsed.units,format:parsed.format,prelude:parsed.prelude,opening:null,segmentation:parsed.segmentation,warning:parsed.warning,contentStatus:'available',localSourceTitle:parsed.title,notice:'微信读书书籍信息与用户提供的本地正文已关联；阅读分组以本地正文为准。'};
        return {...old,books:old.books.map(b=>b.id===target.id?merged:b)};
      });
      setModal(null);setToast('正文已关联，可以查看七天分组。');
    }
    async function startBook(b) {
      if(b.contentStatus==='metadata-only'){setAttachTarget(b);setModal('attach');return;}
      if(startingBook.current)return;
      startingBook.current=true;
      try {
        const c = M.createCamp(b, dateString());
        await update(old => ({
          ...old,
          camps: [...old.camps, c],
          activeCamp: c.id
        }));
        location.href = link('camp', c);
      } catch (e) {
        setToast(e.message);
      } finally {startingBook.current=false;}
    }
    if (boot.loading) return <main className="rc-recovery"><ReadingMark size={60}/><p>正在准备你的阅读空间…</p></main>;
    if (boot.error) return <main className="rc-recovery"><ReadingMark size={70} /><h1>本地数据需要先确认</h1><p>{boot.error}</p><p>原有打卡应用与读书数据都没有被清空。请先保留已有文件，再检查浏览器存储设置。</p><button className="rc-button outline" onClick={() => location.reload()}>重新读取</button></main>;
    return <div className={'rc-app ' + (!t.motion ? 'no-motion' : '')} style={{
      '--accent': t.accent
    }}>{sideOpen&&<button className="rc-nav-backdrop" aria-label="关闭导航遮罩" onClick={()=>setSideOpen(false)}/>}<aside id="rc-navigation" className={'rc-sidebar ' + (sideOpen ? 'is-open' : '')}><button className="rc-sidebar-close rc-icon-button" aria-label="关闭导航" onClick={()=>setSideOpen(false)}><Icon name="close"/></button><a className="rc-brand" href={pages.home}><ReadingMark size={38} /><div><strong>页伴</strong><span>PAGEPAL</span></div></a><div className="rc-sidebar-caption">留一点时间，读一读自己。</div><nav aria-label="主导航">{['home', 'library', 'notes'].map(v => <a key={v} className={view === v || (view === 'camp' || view === 'session') && v === 'home' ? 'active' : ''} aria-current={view === v ? 'page' : undefined} href={link(v, camp)}><Icon name={v === 'home' ? 'home' : v === 'library' ? 'book' : 'note'} size={20} />{labels[v]}{v === 'library' && <span>{data.books.length}</span>}</a>)}</nav><button className="rc-sidebar-import" onClick={() => setModal('import')}><Icon name="plus" size={19} />导入一本书</button><div className="rc-sidebar-bottom"><div className="rc-sidebar-quote"><span>“</span><p>读书的终点，<br />也可以是更靠近自己。</p><small>ONE PAGE AT A TIME</small></div><button onClick={() => window.dispatchEvent(new CustomEvent('pagepal:preferences:open'))}><Icon name="settings" size={18} />阅读偏好</button><button onClick={() => setModal('about')}><Icon name="spark" size={18} />关于这个 demo</button><a className="rc-old-link" href="index.html">原打卡原型<Icon name="arrow" size={13} /></a></div></aside><div className="rc-main-shell"><header className="rc-topbar"><div><button className="rc-mobile-menu rc-icon-button" aria-label="展开导航" aria-controls="rc-navigation" aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)}><Icon name="menu" /></button><span>我的阅读空间</span><Icon name="chevron" size={13} /><b>{labels[view]}</b></div><div><button className="rc-demo-tag" onClick={() => setModal('about')}><i></i>交互 DEMO</button><span className="rc-avatar" aria-label="本地体验，无需登录">我</span></div></header>{conflict && <div className="rc-global-warning" role="alert">另一个窗口更新了数据。请先复制未保存的笔记，再刷新此页面；不会覆盖你的输入。</div>}<main className="rc-main">{view === 'library' ? <Library data={data} onImport={() => setModal('import')} onStart={startBook} onAttach={b=>{setAttachTarget(b);setModal('attach');}} /> : view === 'notes' ? <Notes data={data} onFeishu={showFeishu} onExport={exportNotes} /> : !camp ? <div className="rc-empty"><h1>带一本书进来吧。</h1><button className="rc-button primary" onClick={() => setModal('import')}>导入书籍</button></div> : view === 'camp' ? <Camp camp={camp} book={book} onConfirm={async intention => {
            try {
              await updateCamp(c => ({
                ...c,
                onboarded: true,
                startDate: c.demo ? c.startDate : dateString(),
                intention
              }));
              setToast('开始阅读。今天就是第 1 天，共 7 天。');
            } catch (e) {
              setToast(e.message);
            }
          }} onGenerateGuide={generateBookGuide} onGeneratePlan={generatePlan} onAdoptPlan={adoptPlan} /> : view === 'session' ? <Session camp={camp} book={book} readerSize={t.readerSize} onDraft={(day, text) => updateCamp(c => M.saveDraft(c, day, text))} onSubmit={(day, text) => updateCamp(c => M.commitNote(c, day, text, campNow(c)))} onEdit={(day, text) => updateCamp(c => M.editNote(c, day, text, campNow(c)))} onExport={() => exportNotes()} onFeishu={() => showFeishu()} onDiscussion={(dayNumber,record)=>updateCamp(c=>({...c,dailyDiscussions:{...(c.dailyDiscussions||{}),[dayNumber]:record}}))} onDailyGuide={(day,result)=>updateCamp(c=>({...c,dailyGuides:{...(c.dailyGuides||{}),[day]:result}}))} /> : <Welcome camp={camp} book={book} />}</main></div>{modal === 'import' && <BookImport onClose={() => setModal(null)} onImport={importBook} />}{modal==='attach'&&attachTarget&&<Modal title="补充可阅读正文" onClose={()=>setModal(null)} wide><AttachBook book={attachTarget} onAttach={attachBook} onClose={()=>setModal(null)}/></Modal>} {modal === 'about' && <Modal title="关于这个 demo" onClose={() => setModal(null)}><div className="rc-about"><ReadingMark size={55} /><h3>页伴 · 七天读写</h3><p>导入、阅读、草稿保存、400 字提交校验、Word / Markdown 导出与 Obsidian 导出入口可以真实体验。数据独立保存在当前浏览器，不会改动原来的打卡记录。</p><p>示例书与前两篇笔记为原创演示内容；示例营的日期固定在阅读第 3 天，方便体验。示例导读与问题为预设内容，不代表真实模型回复。</p><p>导入的 EPUB / TXT / Markdown 按标题解析并均衡分组，不能保证 AI 级语义边界；不足 7 个单元会提示，不会截断正文凑数。</p><p>真实书导入完成后会自动生成全书导读：书名、作者和正文（最多前 80,000 个字符）会先发送到服务端配置的 DeepSeek 生成摘要，再将书名、作者、序言（最多前 8,000 个字符）、目录（最多前 4,000 个字符）和正文摘要发送给模型生成导读。首次进入当天（或主动预览的某天）阅读页时，也会自动发送书名、作者和当天正文生成每日导读；当天正文超过 40,000 个字符时会先发送正文生成摘要。点击生成 AI 七日拆分建议时，会发送书名、作者、单元标题、层级、字数和每单元前 200 个字符。AI 讨论不会自动开始；只有你点击“分析今日阅读”或“发送”后，才会发送当天正文（过长时先生成摘要），以及讨论时输入的问题和当天最近对话。微信读书 CLI 只导入书籍信息与目录，不含整章正文；飞书授权与云端同步当前仍未接入。</p><button className="rc-button primary full" onClick={() => setModal(null)}>知道了，继续阅读<Icon name="arrow" size={18} /></button></div></Modal>}{modal === 'feishu' && <Modal title="把笔记带到飞书" onClose={() => setModal(null)}><div className="rc-feishu-preview"><Icon name="link" size={38} /><h3>这里将连接你的飞书文档</h3><p>连接后，由你选择保存位置并预览内容，再明确点击写入。每本书对应一份文档，后续笔记追加保存。</p><span className="rc-pill">当前 demo 尚未接入</span><p className="rc-fine">没有发起授权、创建文档或传输笔记。你现在可以选择导出格式，再自行导入飞书。</p><button className="rc-button primary full" onClick={() => exportNotes(feishuTarget?.book, feishuTarget?.camp)} disabled={!feishuTarget?.camp}><Icon name="download" size={18} />先导出 Markdown</button></div></Modal>}{modal==='export'&&exportPreview&&<Modal title="导出读书笔记" onClose={()=>setModal(null)} wide><ReadingExportPanel book={exportPreview.book} camp={exportPreview.camp} onNotice={setToast}/></Modal>}{toast && <div className="rc-toast" role="status"><Icon name="check" size={17} />{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><Icon name="close" size={15} /></button></div>}<TweaksPanel title="阅读偏好"><TweakToggle label="书搭子轻动效" value={t.motion} onChange={v => setTweak('motion', v)} /><TweakSlider label="正文字号" value={t.readerSize} min={16} max={24} unit="px" onChange={v => setTweak('readerSize', v)} /><TweakColor label="按钮强调色" value={t.accent} options={['#2e6753', '#a8563b', '#405f7a']} onChange={v => setTweak('accent', v)} /></TweaksPanel></div>;
  }
  class Boundary extends React.Component {
    constructor(p) {
      super(p);
      this.state = {
        error: null
      };
    }
    static getDerivedStateFromError(error) {
      return {
        error
      };
    }
    render() {
      return this.state.error ? <main className="rc-recovery"><h1>页面暂时没能打开</h1><p>原有数据未被清空。请刷新重试；如果仍有问题，请保留本地数据。</p><button onClick={() => location.reload()} className="rc-button primary">重新打开</button></main> : this.props.children;
    }
  }
  ReactDOM.createRoot(document.getElementById('reading-root')).render(<Boundary><App /></Boundary>);
})();
