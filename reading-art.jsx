(function () {
  function ReadingMark({ size = 32 }) {
    return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M5.7 12.4c4.7-2.4 9.3-1.2 14.1 2.6 4.5-3.6 9.2-4.9 14.6-2.8l-.5 21.2c-4.8-1.5-9.5-.2-14.1 3.1-4.5-3.5-9.1-4.7-14-3.2Z" fill="#fffaf1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.8 15.1c.3 7.4-.1 14.4 0 21.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M22.7 7c2.6.2 4.6.6 6.8 1.4l-.8 20.2-4.2-3.2-4.4 3.8.4-20.8c.7-.6 1.4-1 2.2-1.4Z" fill="#d6a34e" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.2 9.4c1.4.1 2.6.4 3.9.8m-14.6 8.5c1.8.2 3.5.8 5.1 1.8m4.8 1.1c1.6-.9 3.1-1.4 4.7-1.6" stroke="#7c8f83" strokeWidth="1.15" strokeLinecap="round" opacity=".75" />
      <path d="M6.5 34.7c4.6-1.1 8.6.1 12.5 2.6m2.1-.2c4.1-2.8 8.4-3.8 12.1-2.6" stroke="currentColor" strokeWidth=".8" strokeLinecap="round" opacity=".28" />
    </svg>;
  }

  function ReadingIcon({ name, size = 20, ...props }) {
    const paths = {
      home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
      book: <><path d="M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" /><path d="M12 6v15" /></>,
      note: <><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9" /><path d="m10 14 1-4 8-8 3 3-8 8ZM18 3l3 3M7 17h6" /></>,
      plus: <><path d="M12 5v14M5 12h14" /></>,
      arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
      chevron: <><path d="m9 5 7 7-7 7" /></>,
      left: <><path d="M20 12H4m6 6-6-6 6-6" /></>,
      close: <><path d="m6 6 12 12M6 18 18 6" /></>,
      check: <><path d="m5 12 4 4L19 6" /></>,
      clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
      download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
      link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)" /></>,
      upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
      settings: <><path d="m9 3-.6 2.3-2 .9-2.1-.6-2 3.4 1.6 1.8-.2 2.3L2 15l2 3.4 2.3-.5 1.8 1.3L9 21h4l.6-2.3 2-.9 2.1.6 2-3.4-1.6-1.8.2-2.3 1.7-1.6-2-3.4-2.3.5-1.8-1.3L13 3Z" transform="translate(1)" /><circle cx="12" cy="12" r="3" /></>,
      moon: <><path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" /></>,
      sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
      search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
      spark: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" /></>,
      lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
      menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
      more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.book}</svg>;
  }

  function ReadingScene({ mood = 'read', className = '' }) {
    const celebrating = mood === 'celebrate' || mood === 'done';
    const sleeping = mood === 'sleep' || mood === 'rest';
    const sceneMood = celebrating ? 'celebrate' : sleeping ? 'sleep' : 'read';
    const instanceId = React.useId().replace(/:/g, '');
    const titleId = `rc-hamster-title-${instanceId}`;
    const grainId = `rc-paper-grain-${instanceId}`;
    const cardClipId = `rc-card-clip-${instanceId}`;
    const label = celebrating
      ? '圆团仓鼠站上书堆，笨拙地举起比自己还长的书签庆祝'
      : sleeping
        ? '圆团仓鼠在夜灯下把打开的书当成被子睡着了'
        : '圆团仓鼠趴在小桌前，守着大书和凉掉的杯子陪你读一会儿';
    const C = {
      ink: '#5b4d45',
      inkSoft: '#8d7d73',
      cream: '#fff6e8',
      butter: '#ead8a8',
      caramel: '#bd8a67',
      caramelDeep: '#95654d',
      peach: '#e6a99b',
      peachLight: '#f4ded5',
      sage: '#a9bba0',
      sageLight: '#e2e9da',
      blue: '#a7c1c5',
      blueLight: '#e1ebeb',
      yellow: '#d8a548',
      paper: '#fffaf0',
      shadow: '#c9bcae'
    };
    const cardPath = 'M132 24c78-6 276-4 348 2 18 2 28 13 29 31 5 73 3 193-1 250-1 16-10 26-26 28-92 6-277 3-364-2-19-1-28-12-28-30-3-71-2-189 4-251 2-19 14-28 38-30Z';
    const outline = {
      stroke: C.ink,
      strokeWidth: 4.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    };
    const fine = {
      stroke: C.inkSoft,
      strokeWidth: 2.1,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    };
    const cardFill = celebrating ? '#e3eadc' : sleeping ? '#dfe9e5' : '#f3ead9';

    return <svg
      className={`rc-scene ${className}`}
      viewBox="0 0 600 350"
      fill="none"
      role="img"
      aria-labelledby={titleId}
      data-mood={sceneMood}
      data-character="hamster"
      data-texture="paper"
      focusable="false"
    >
      <title id={titleId}>{label}</title>
      <defs>
        <pattern id={grainId} width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-7)">
          <circle cx="3" cy="5" r=".75" fill={C.ink} opacity=".12" />
          <circle cx="15" cy="17" r=".55" fill={C.ink} opacity=".1" />
          <circle cx="20" cy="7" r=".45" fill={C.caramelDeep} opacity=".12" />
          <path d="M7 13h2.2m3-9h1.5M1 20h1.3" stroke={C.ink} strokeWidth=".65" strokeLinecap="round" opacity=".11" />
        </pattern>
        <clipPath id={cardClipId}><path d={cardPath} /></clipPath>
      </defs>

      <path d={cardPath} transform="translate(0 6)" fill={C.shadow} opacity=".2" />
      <path d={cardPath} fill={cardFill} stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".98" />
      <rect x="88" y="15" width="430" height="325" fill={`url(#${grainId})`} clipPath={`url(#${cardClipId})`} opacity=".78" />
      <path d="M124 34c84-5 251-4 345 1m-366 283c96 6 277 7 393 1" stroke={C.paper} strokeWidth="1.4" strokeLinecap="round" opacity=".45" />

      {!celebrating && !sleeping && <g className="rc-scene-read" clipPath={`url(#${cardClipId})`}>
        <path d="M116 45c32-10 90-9 119 2l-2 98c-34-5-78-5-116 2Z" fill={C.blueLight} stroke={C.blue} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M174 45c-2 32-1 65-1 99M117 98c39-4 78-3 117 0" stroke={C.blue} strokeWidth="2" strokeLinecap="round" />
        <path d="M129 78c11-9 23-8 31 0 12-8 28-5 33 7 10-1 18 3 23 10-27 3-56 2-85 0" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".72" />
        <path d="M208 59c7 2 13 5 19 9m-17-2c5 1 10 3 15 6" stroke={C.paper} strokeWidth="2" strokeLinecap="round" opacity=".8" />

        <g transform="rotate(3 455 79)">
          <path d="M438 57c12-8 29-5 36 6 7 12 4 30-8 38-13 8-29 4-36-8-6-12-3-28 8-36Z" fill={C.paper} {...fine} />
          <path d="M452 67c1 7 1 14 0 21m0 0 12 4" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="452" cy="88" r="2.3" fill={C.ink} />
        </g>

        <path d="M108 276c92-7 273-5 387 1l-1 45c-103 6-286 4-387-3Z" fill={C.sageLight} opacity=".78" />
        <path d="M108 277c111-6 264-4 387 2" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
        <path d="M132 278c-1 17-1 31-4 44m336-43c2 16 4 28 6 41" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />

        <path d="M143 234c13-5 32-4 43 1l-2 38c-11 8-29 8-39 0Z" fill={C.paper} {...outline} />
        <path d="M185 242c18-3 20 19 0 18" {...outline} />
        <path d="M170 236c3 8 5 17 4 25" stroke={C.inkSoft} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M174 252h9l-1 10-8-1Z" fill={C.peach} stroke={C.inkSoft} strokeWidth="1.5" strokeLinejoin="round" />

        <g className="rc-breathe rc-hamster">
          <path d="M292 202c-13 18-18 45-13 74 21 13 92 14 118 0 5-28 1-54-13-75-22-22-69-22-92 1Z" fill={C.caramel} {...outline} />
          <path d="M317 219c-8 18-8 42-1 62 14 5 31 5 45 0 8-22 7-45-1-62-11-11-31-11-43 0Z" fill={C.butter} opacity=".92" />

          <path d="M274 119c-13-14-9-32 7-38 15-5 28 5 30 23m78 3c1-20 15-29 30-22 14 7 16 25 3 38" fill={C.caramel} {...outline} />
          <path d="M282 92c8-3 15 2 17 12-8-2-15-6-17-12Zm126 3c-8-2-14 3-16 13 8-3 14-7 16-13Z" fill={C.peachLight} />
          <path d="M278 119c17-31 48-43 80-38 42 6 69 39 64 83-5 45-39 73-85 70-47-3-77-37-72-76 2-15 6-28 13-39Z" fill={C.caramel} {...outline} />
          <path d="M289 107c25-17 74-24 105-3" stroke={C.paper} strokeWidth="1.7" strokeLinecap="round" opacity=".34" />
          <path d="M288 121c16-27 43-38 70-34" stroke={C.ink} strokeWidth="1.6" strokeLinecap="round" opacity=".2" transform="translate(2 -2)" />

          <path d="M302 165c10-22 30-28 46-14 18-13 39-5 46 17-4 25-23 38-48 37-26-1-43-15-44-40Z" fill={C.cream} />
          <g className="rc-blink" fill={C.ink}>
            <circle cx="309" cy="151" r="4.1" />
            <circle cx="387" cy="153" r="4.1" />
          </g>
          <path d="M339 169c5-4 11-4 16 0-2 7-13 8-16 0Z" fill={C.caramelDeep} stroke={C.ink} strokeWidth="1.4" />
          <path d="M347 176v5m0 0c-5 4-10 4-14 0m14 0c5 4 10 4 14 0" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
          <ellipse cx="294" cy="178" rx="12" ry="6" fill={C.peach} opacity=".42" />
          <ellipse cx="400" cy="180" rx="12" ry="6" fill={C.peach} opacity=".42" />

          <path d="M282 208c-15 3-25 15-25 29 1 12 13 17 23 10 8-6 8-20 14-29" fill={C.caramel} {...outline} />
          <path d="M397 211c13 3 22 13 23 25 1 12-10 18-20 12-7-5-8-17-13-27" fill={C.caramel} {...outline} />

          <path d="M222 245c39-19 79-16 119 8l-1 58c-37-20-75-20-115-5Z" fill={C.paper} {...outline} />
          <path d="M341 253c41-25 84-26 126-7l-5 61c-39-15-80-14-122 4Z" fill={C.paper} {...outline} />
          <path d="M341 254c1 18 1 37-1 57" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
          <path d="M242 260c24-7 48-4 72 7m-69 8c22-5 43-2 62 6m58-17c24-8 48-8 71-1m-67 15c20-5 41-5 61-1" stroke={C.inkSoft} strokeWidth="1.8" strokeLinecap="round" opacity=".48" />
          <path className="rc-bookmark-prop" d="m416 247-2 38-8-6-9 7 4-37" fill={C.yellow} stroke={C.ink} strokeWidth="2.1" strokeLinejoin="round" />
          <path d="M274 235c13-7 24-4 34 9m82-9c-11-6-21-3-29 10" stroke={C.caramel} strokeWidth="16" strokeLinecap="round" />
          <path d="M274 235c13-7 24-4 34 9m82-9c-11-6-21-3-29 10" stroke={C.ink} strokeWidth="2.9" strokeLinecap="round" />
        </g>

        <g fill={C.inkSoft} opacity=".52"><circle cx="438" cy="141" r="2.4" /><circle cx="450" cy="132" r="3" /><circle cx="466" cy="120" r="3.5" /></g>
        <path d="M126 173c8-3 17-4 25-3m307 45c10 1 19 4 27 9M205 54l8-4" stroke={C.inkSoft} strokeWidth="1.8" strokeLinecap="round" opacity=".45" />
      </g>}

      {celebrating && <g className="rc-scene-celebrate" clipPath={`url(#${cardClipId})`}>
        <path d="M113 54c61 14 125 13 194 3 70-11 130-11 196-2" stroke={C.sage} strokeWidth="2.2" strokeLinecap="round" />
        <path d="m137 58 15 24 18-20m38 2 15 22 17-27m40 0 16 24 17-27m40 2 17 24 16-22m39-1 15 24 18-20" fill={C.cream} stroke={C.sage} strokeWidth="2" strokeLinejoin="round" />
        <path d="M108 299c98-7 267-6 390 2l-1 30c-115 5-288 3-389-2Z" fill={C.peachLight} opacity=".72" />
        <path d="M108 301c108-5 268-3 389 1" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />

        <g className="rc-book-stack">
          <path d="M135 261c56-6 113-4 171 5l-3 31c-57-7-112-8-167-2Z" fill={C.peach} {...outline} />
          <path d="M153 228c55-2 108 2 158 12l-6 29c-54-8-106-10-157-5Z" fill={C.paper} {...outline} />
          <path d="M175 198c47-3 93-1 137 6l-4 29c-46-6-91-7-136-3Z" fill={C.sageLight} {...outline} />
          <path d="M154 276c42-2 84 1 125 8m-104-42c39 0 77 3 113 9m-91-37c29 0 59 2 88 7" stroke={C.inkSoft} strokeWidth="1.8" strokeLinecap="round" opacity=".5" />
        </g>

        <g className="rc-breathe rc-hamster">
          <g transform="rotate(-3 353 226)">
            <path d="M317 211c-14 17-21 42-18 74 22 17 75 18 100 2 4-31-1-58-16-77-20-18-47-17-66 1Z" fill={C.caramel} {...outline} />
            <path d="M335 229c-7 17-6 40 1 57 11 4 25 4 36-1 7-19 5-41-3-57-9-8-24-8-34 1Z" fill={C.butter} opacity=".95" />
            <path d="M301 123c-13-15-9-32 7-38 15-5 28 5 30 23m69 3c1-20 14-29 29-22 14 7 16 25 3 38" fill={C.caramel} {...outline} />
            <path d="M309 96c7-2 14 2 16 12-8-2-13-6-16-12Zm116 2c-8-2-14 3-16 13 8-3 14-7 16-13Z" fill={C.peachLight} />
            <path d="M304 123c16-30 44-43 75-39 40 5 65 37 61 78-4 43-36 70-79 68-44-2-73-34-69-72 1-14 5-26 12-35Z" fill={C.caramel} {...outline} />
            <path d="M316 111c22-16 64-21 94-2" stroke={C.paper} strokeWidth="1.7" strokeLinecap="round" opacity=".34" />
            <path d="M324 166c9-20 27-27 43-13 16-12 35-5 41 15-3 23-21 36-43 35-24 0-40-13-41-37Z" fill={C.cream} />
            <circle cx="328" cy="151" r="4" fill={C.ink} />
            <circle cx="402" cy="153" r="4" fill={C.ink} />
            <path d="M359 169c5-4 10-4 15 0-2 7-12 8-15 0Z" fill={C.caramelDeep} stroke={C.ink} strokeWidth="1.4" />
            <path d="M366 176v5m0 0c-4 4-9 4-13 0m13 0c5 4 9 4 14 0" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
            <ellipse cx="312" cy="178" rx="11" ry="6" fill={C.peach} opacity=".48" />
            <ellipse cx="417" cy="179" rx="11" ry="6" fill={C.peach} opacity=".48" />
            <path d="M306 217c-17 2-29 12-35 26-5 12 4 22 15 19 10-3 14-15 24-23" fill={C.caramel} {...outline} />
            <path d="M402 214c15-9 23-26 25-50 1-13 11-19 21-13 9 6 5 19 2 31-6 22-17 40-34 52" fill={C.caramel} {...outline} />
            <path d="M320 287c-11 0-21 4-29 10m90-9c11 1 20 5 28 11" stroke={C.ink} strokeWidth="8" strokeLinecap="round" />
          </g>
        </g>

        <g className="rc-bookmark-prop" transform="rotate(6 449 122)">
          <path d="M429 42c13-3 26-2 39 2l-5 144-18-16-20 15Z" fill={C.yellow} {...outline} />
          <path d="M438 60c7-2 14-1 21 1m-22 13c7-2 14-1 21 1" stroke={C.cream} strokeWidth="3" strokeLinecap="round" opacity=".85" />
          <path d="M449 41c-2-10 2-17 11-22" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
        </g>
        <path d="M443 138c8-2 14 5 10 13-3 6-10 5-12 0" fill={C.blue} opacity=".78" />

        <g stroke={C.yellow} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m245 128 5 10 10 5-10 5-5 10-5-10-10-5 10-5Z" fill={C.yellow} />
          <path d="m486 210 4 8 8 4-8 4-4 8-4-8-8-4 8-4Z" fill={C.cream} />
          <path d="m196 134 7-13m16 23 13-6m257 14 10-8" />
        </g>
        <g fill={C.peach}><circle cx="215" cy="180" r="3" /><circle cx="475" cy="257" r="3.5" /><circle cx="269" cy="88" r="2.8" /></g>
      </g>}

      {sleeping && <g className="rc-scene-sleep" clipPath={`url(#${cardClipId})`}>
        <path d="M115 283c86-9 278-9 381 1l-1 45c-115 5-286 3-387-3Z" fill={C.sageLight} opacity=".78" />
        <path d="M111 286c108-7 268-5 387 1" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
        <g className="rc-lamp">
          <path d="M144 285c-2-75 2-143 34-190 18-26 47-33 70-14" stroke={C.ink} strokeWidth="4.2" strokeLinecap="round" />
          <path d="M124 291c17-6 36-6 54 0" stroke={C.ink} strokeWidth="4.2" strokeLinecap="round" />
          <path d="M228 65c24 1 42 14 48 38l-67-2c3-19 10-31 19-36Z" fill={C.butter} {...outline} />
          <path d="M219 104c13 10 29 11 47 1" stroke={C.yellow} strokeWidth="2" strokeLinecap="round" opacity=".55" />
        </g>
        <path d="M438 63c-4 21 4 35 23 41-27 7-46-9-44-33 1-17 10-29 27-35-3 9-5 18-6 27Z" fill={C.cream} stroke={C.blue} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M466 123l9-3m-25 22 12 2M180 132l-12 4m17 11-9 7" stroke={C.blue} strokeWidth="2" strokeLinecap="round" opacity=".68" />

        <path d="M207 275c28-26 82-37 139-31 61 6 107 27 111 50-48 15-154 8-228-7-18-3-28-7-22-12Z" fill={C.peachLight} stroke={C.peach} strokeWidth="2.3" strokeLinejoin="round" />

        <g className="rc-breathe rc-hamster">
          <path d="M321 203c-17 14-26 38-22 69 24 18 100 21 132 3 4-31-5-58-25-74-23-17-63-16-85 2Z" fill={C.caramel} {...outline} />
          <path d="M368 233c21 2 38 13 48 33-19 9-42 9-62 1-4-13 1-25 14-34Z" fill={C.butter} opacity=".94" />

          <path d="M272 170c-12-15-7-32 9-37 15-5 28 6 29 24m74 1c2-19 16-28 31-20 14 8 15 26 1 38" fill={C.caramel} {...outline} />
          <path d="M281 145c8-2 15 3 16 12-8-2-14-6-16-12Zm121 3c-8-2-14 3-17 13 8-2 15-7 17-13Z" fill={C.peachLight} />
          <path d="M274 173c17-31 46-43 78-38 42 6 68 39 63 82-5 44-38 71-83 68-46-3-76-36-71-75 2-14 6-26 13-37Z" fill={C.caramel} {...outline} />
          <path d="M291 218c9-21 29-28 45-14 17-13 37-5 43 17-3 24-22 37-46 36-25-1-41-14-42-39Z" fill={C.cream} />
          <path d="M291 202q9 7 18 0m42 1q9 7 18 0" stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" />
          <path d="M328 220c5-4 11-4 16 0-2 7-13 8-16 0Z" fill={C.caramelDeep} stroke={C.ink} strokeWidth="1.4" />
          <path d="M336 227v5m0 0c-5 4-10 4-14 0m14 0c5 4 10 4 14 0" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
          <ellipse cx="282" cy="232" rx="11" ry="5.5" fill={C.peach} opacity=".4" />
          <ellipse cx="394" cy="233" rx="11" ry="5.5" fill={C.peach} opacity=".4" />

          <path d="M218 257c42-14 83-10 123 12l-2 54c-39-16-79-17-119-5Z" fill={C.paper} {...outline} />
          <path d="M341 269c40-22 81-22 122-5l-5 56c-38-13-78-12-119 3Z" fill={C.paper} {...outline} />
          <path d="M341 270c1 17 0 35-2 53" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
          <path d="M236 273c25-5 49-1 73 9m61-2c23-7 46-7 68 0" stroke={C.inkSoft} strokeWidth="1.8" strokeLinecap="round" opacity=".45" />
          <path className="rc-bookmark-prop" d="m416 264-1 35-8-6-8 6 3-34" fill={C.yellow} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
          <path d="M290 267c15-8 30-6 43 4" stroke={C.caramel} strokeWidth="16" strokeLinecap="round" />
          <path d="M290 267c15-8 30-6 43 4" stroke={C.ink} strokeWidth="2.9" strokeLinecap="round" />
          <path d="M433 293c11 0 20 4 27 12" stroke={C.caramel} strokeWidth="17" strokeLinecap="round" />
          <path d="M433 293c11 0 20 4 27 12" stroke={C.ink} strokeWidth="2.8" strokeLinecap="round" />
        </g>

        <g transform="rotate(-8 207 265)" stroke={C.inkSoft} strokeWidth="2.3">
          <circle cx="197" cy="264" r="12" /><circle cx="224" cy="264" r="12" /><path d="M209 263h4m-28-1-9-4m60 4 9-4" strokeLinecap="round" />
        </g>
        <g stroke={C.inkSoft} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" opacity=".68">
          <path d="M414 163h15l-15 15h15m16-45h20l-20 20h20" />
        </g>
      </g>}

      <g stroke={C.ink} strokeWidth="1.6" strokeLinecap="round" opacity=".2">
        <path d="M104 77c-5 46-5 142-2 203m397-219c5 59 5 165 1 228" />
      </g>
    </svg>;
  }

  window.ReadingMark = ReadingMark;
  window.ReadingIcon = ReadingIcon;
  window.ReadingScene = ReadingScene;
})();
