const PAGEPAL_PREFERENCES_KEY = 'pagepal-reading-preferences-v1';

const __PREFERENCES_STYLE = `
  .rp-panel{position:fixed;right:16px;bottom:16px;z-index:1000;width:min(280px,calc(100vw - 32px));
    color:#3e392f;background:rgba(255,253,247,.96);border:1px solid rgba(86,77,61,.14);
    border-radius:18px;box-shadow:0 18px 48px rgba(73,61,41,.18);overflow:hidden;
    font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif}
  .rp-heading{display:flex;align-items:center;justify-content:space-between;padding:13px 12px 10px 16px;
    border-bottom:1px solid rgba(86,77,61,.09)}
  .rp-heading b{font-size:14px;font-weight:650;letter-spacing:.02em}
  .rp-close{appearance:none;border:0;background:transparent;color:#736b5e;width:30px;height:30px;
    border-radius:9px;cursor:pointer;font-size:15px;line-height:1}
  .rp-close:hover,.rp-close:focus-visible{background:#f1ede3;color:#3e392f;outline:none}
  .rp-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:14px}
  .rp-row{display:flex;flex-direction:column;gap:7px}
  .rp-row-inline{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}
  .rp-label{display:flex;align-items:baseline;justify-content:space-between;gap:10px;color:#5d564a}
  .rp-value{color:#8a8173;font-variant-numeric:tabular-nums}
  .rp-slider{appearance:none;-webkit-appearance:none;width:100%;height:5px;margin:6px 0;
    border-radius:999px;background:#ddd8cc;outline:none}
  .rp-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;
    border-radius:50%;background:#fff;border:1px solid #c9c1b3;box-shadow:0 2px 5px rgba(68,57,39,.2);cursor:pointer}
  .rp-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#fff;
    border:1px solid #c9c1b3;box-shadow:0 2px 5px rgba(68,57,39,.2);cursor:pointer}
  .rp-toggle{position:relative;width:38px;height:22px;border:0;border-radius:999px;background:#cec8bd;
    transition:background .16s;cursor:pointer;padding:0;flex:none}
  .rp-toggle[data-on="1"]{background:var(--accent,#2e6753)}
  .rp-toggle i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;
    background:#fff;box-shadow:0 1px 3px rgba(54,45,31,.24);transition:transform .16s}
  .rp-toggle[data-on="1"] i{transform:translateX(16px)}
  .rp-colors{display:flex;gap:9px}
  .rp-color{appearance:none;width:46px;height:34px;padding:0;border:3px solid #fff;border-radius:10px;
    box-shadow:0 0 0 1px rgba(69,60,47,.16);cursor:pointer;transition:transform .14s,box-shadow .14s}
  .rp-color:hover{transform:translateY(-1px)}
  .rp-color[data-on="1"]{box-shadow:0 0 0 2px #494237,0 3px 9px rgba(65,53,35,.16)}
  @media (max-width:560px){.rp-panel{right:12px;bottom:12px;width:calc(100vw - 24px)}}
`;

function readPreferences(defaults) {
  try {
    const stored = JSON.parse(localStorage.getItem(PAGEPAL_PREFERENCES_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {...defaults};
    return Object.keys(defaults).reduce((next, key) => {
      if (Object.hasOwn(stored, key) && typeof stored[key] === typeof defaults[key]) next[key] = stored[key];
      return next;
    }, {...defaults});
  } catch {
    return {...defaults};
  }
}

function useTweaks(defaults) {
  const [values, setValues] = React.useState(() => readPreferences(defaults));
  const allowed = React.useMemo(() => new Set(Object.keys(defaults)), []);
  const setTweak = React.useCallback((keyOrEdits, value) => {
    const requested = typeof keyOrEdits === 'object' && keyOrEdits !== null
      ? keyOrEdits : {[keyOrEdits]: value};
    setValues(previous => {
      const next = {...previous};
      for (const [key, candidate] of Object.entries(requested)) {
        if (allowed.has(key) && typeof candidate === typeof defaults[key]) next[key] = candidate;
      }
      try { localStorage.setItem(PAGEPAL_PREFERENCES_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [allowed, defaults]);
  return [values, setTweak];
}

function TweaksPanel({title = '阅读偏好', children}) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('pagepal:preferences:open', show);
    return () => window.removeEventListener('pagepal:preferences:open', show);
  }, []);
  React.useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = event => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);
  if (!open) return null;
  return <>
    <style>{__PREFERENCES_STYLE}</style>
    <section className="rp-panel" role="dialog" aria-modal="false" aria-label={title}>
      <header className="rp-heading"><b>{title}</b><button className="rp-close" type="button" aria-label="关闭阅读偏好" onClick={() => setOpen(false)}>✕</button></header>
      <div className="rp-body">{children}</div>
    </section>
  </>;
}

function TweakSlider({label, value, min = 0, max = 100, step = 1, unit = '', onChange}) {
  return <label className="rp-row">
    <span className="rp-label"><span>{label}</span><span className="rp-value">{value}{unit}</span></span>
    <input className="rp-slider" type="range" value={value} min={min} max={max} step={step}
      onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

function TweakToggle({label, value, onChange}) {
  return <div className="rp-row rp-row-inline">
    <span className="rp-label">{label}</span>
    <button className="rp-toggle" type="button" role="switch" aria-label={label}
      aria-checked={!!value} data-on={value ? '1' : '0'} onClick={() => onChange(!value)}><i /></button>
  </div>;
}

function TweakColor({label, value, options = [], onChange}) {
  return <div className="rp-row">
    <span className="rp-label">{label}</span>
    <div className="rp-colors" role="radiogroup" aria-label={label}>
      {options.map(color => <button key={color} className="rp-color" type="button" role="radio"
        aria-label={color} aria-checked={color.toLowerCase() === String(value).toLowerCase()}
        data-on={color.toLowerCase() === String(value).toLowerCase() ? '1' : '0'}
        style={{background: color}} onClick={() => onChange(color)} />)}
    </div>
  </div>;
}

Object.assign(window, {useTweaks, TweaksPanel, TweakSlider, TweakToggle, TweakColor});
