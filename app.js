(() => {
'use strict';

const $ = id => document.getElementById(id);
/* 高频路径的 DOM 写入守门：只在值变化时落 DOM，避免每帧重复解析/重排 */
const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
const setHTML = (el, v) => { if (el && el.__h !== v) { el.__h = v; el.innerHTML = v; } };
const setVal = (el, v) => { if (el && el.value !== String(v)) el.value = v; };
const setCss = (el, prop, v) => {
  if (!el) return;
  const c = el.__css || (el.__css = {});
  if (c[prop] !== v) { c[prop] = v; el.style[prop] = v; }
};
/* series 按 [6]=起始秒 升序；返回首个 c[6] >= t 的下标 */
const idxAt = (series, t) => {
  let lo = 0, hi = series.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (series[mid][6] < t) lo = mid + 1; else hi = mid; }
  return lo;
};
const DATA = window.KLINE_DATA || {};
const LIBRARY = (window.KLINE_LIBRARY || []).slice();
const MUSIC = (window.KLINE_MUSIC || []).slice();
const KLC = window.klinecharts;

const RED = '#ff381a';
const GREEN = '#009b67';
const MA_COLORS = ['#f5a623', '#1677ff', '#13c2c2', '#722ed1', '#eb2f96'];
const MA_PERIODS = [5, 10, 20, 30, 60];
const SPEEDS = [2, 4, 8, 16, 32, 64, 128];
const SPEED_LABELS = {2:'0.5x',4:'1x',8:'2x',16:'4x',32:'8x',64:'16x',128:'32x'};
const MUSIC_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const PERIOD_LABEL = {day:'日K', week:'周K', month:'月K'};
const MUSIC_WINDOWS = [0.1, 0.25, 0.5, 1, 2, 4, 8];
const MUSIC_BANDS = [200, 256, 300, 400, 512];
const MUSIC_VIEWS = [10, 20, 30, 60, 120];
const FFT_SIZES = [1024, 2048, 4096];
const HOP_SIZES = [0.05, 0.1, 0.2];
const BAND_RANGES = [[20, 8000], [40, 12000], [60, 16000]];
const MUSIC_THICKS = [0.5, 1, 2, 5];
const MUSIC_THINS = [5, 10, 20, 30];
const CHIP_GROUPS = [
  ['windowChips', 'win', MUSIC_WINDOWS, v => v + 's', 'musicWindow'],
  ['thickChips', 'thick', MUSIC_THICKS, v => v + 's', 'musicThick'],
  ['thinChips', 'thin', MUSIC_THINS, v => v + 's', 'musicThin'],
  ['bandChips', 'bands', MUSIC_BANDS, v => String(v), 'spectrumBands'],
  ['viewChips', 'view', MUSIC_VIEWS, v => v + 's', 'viewSpan'],
  ['shareChips', 'scale', [1, 2, 3], v => v + '×', 'shareScale'],
  ['fftChips', 'n', FFT_SIZES, v => String(v), 'fftSize'],
  ['hopChips', 'hop', HOP_SIZES, v => (v * 1000) + 'ms', 'hopSec'],
  ['rangeChips', 'range', BAND_RANGES.map((_, i) => i), i => BAND_RANGES[i][0] + '–' + (BAND_RANGES[i][1] / 1000) + 'k', 'bandRange']
];
function effBands() {
  if (state.spectrumBands === 'auto') {
    const w = (state.mCanvas && state.mCanvas.w) || 1200;
    /* 每根谱线约 4.2px，太密会糊成一团、太疏又不像谱 */
    return clamp(Math.round((w - GUT_W) / (state.density === 'compact' ? 3.6 : 4.0)), 120, 512);
  }
  return state.spectrumBands;
}
function buildSettingChips() {
  CHIP_GROUPS.forEach(([id, key, list, label]) => {
    const box = $(id);
    if (!box) return;
    box.innerHTML = '';
    if (id === 'bandChips') {
      const au = document.createElement('button');
      au.dataset.bands = 'auto';
      au.textContent = '自适应';
      box.appendChild(au);
    }
    list.forEach(v => {
      const b = document.createElement('button');
      b.dataset[key] = v;
      b.textContent = label(v);
      box.appendChild(b);
    });
  });
}

const DM_MARKET = ['老实赚钱，很枯燥吧','杠杆拉满！','这一针扎心了','止损？不存在的','满仓梭哈！','这波我熟','别追了，求你','落袋为安','央行爸爸出手了','这根够我吹一年'];
const DM_BY_ID = {
  usdjpy:['日元又疯了','日本央行看不下去了','套息盘还好吗','渡边太太出手了','160 了，快跑'],
  eurchf:['1.20 铁底？','流动性没了','这一根能载入史册','瑞郎黑天鹅'],
  sh:['3000 点保卫战','牛市来了？','这次是政策底'],
  n225:['日经又熔断了','巴菲特：我早说了'],
  ndx:['AI 永动机','泡沫？什么泡沫'],
  hsi:['港股又见证历史','南向资金冲啊']
};

const fmtInt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const round1 = v => Math.round(v * 10) / 10;
function escapeHTML(s) {  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function fmtPrice(v, digits) {
  if (!isFinite(v)) return '--';
  const s = Number(v).toFixed(Math.max(0, digits | 0));
  const [a, b] = s.split('.');
  return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : '');
}
function fmtSigned(v, digits) {
  return (v > 0 ? '+' : v < 0 ? '-' : '') + fmtPrice(Math.abs(v), digits);
}
function fmtPct(v) {
  if (!isFinite(v)) return '--';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}
function fmtTime(t) {
  t = Math.max(0, Number(t) || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + pad2(s);
}
function fmtVol(v) {
  v = Number(v) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
  return fmtInt(v);
}
function fmtClock() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function shortDesc(s, n) { s = String(s || ''); n = n || 52; return s.length > n ? s.slice(0, n) + '…' : s; }
function toast(text) {
  const stack = $('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  stack.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2400);
  setTimeout(() => el.remove(), 2600);
}
function dateToUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function mondayKey(s) {
  const t = dateToUTC(s);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}
function findIndexByDate(candles, date) {
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid][0] < date) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function aggregate(candles, period) {
  if (period === 'day') return candles.map(c => c.slice());
  const map = new Map();
  for (const c of candles) {
    const key = period === 'week' ? mondayKey(c[0]) : c[0].slice(0, 7);
    const g = map.get(key);
    if (g) {
      if (c[2] > g[2]) g[2] = c[2];
      if (c[3] < g[3]) g[3] = c[3];
      g[4] = c[4];
      g[5] += c[5];
      g[0] = c[0];
    } else map.set(key, c.slice());
  }
  return Array.from(map.values());
}
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function computeIndicators(series) {
  const closes = series.map(c => c[4]);
  const mas = {};
  for (const p of MA_PERIODS) mas[p] = sma(closes, p);
  return { mas };
}
function toKLine(series) {
  return series.map(c => ({
    timestamp: Date.parse(c[0] + 'T12:00:00Z'),
    open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
  }));
}
function computeStats(candles) {
  const n = candles.length;
  const hi = candles.reduce((a, b) => b[2] > a[2] ? b : a, candles[0]);
  const lo = candles.reduce((a, b) => b[3] < a[3] ? b : a, candles[0]);
  let best = { pct: 0, date: candles[0][0] }, worst = { pct: 0, date: candles[0][0] };
  for (let i = 1; i < n; i++) {
    const r = (candles[i][4] / candles[i - 1][4] - 1) * 100;
    if (r > best.pct) best = { pct: r, date: candles[i][0] };
    if (r < worst.pct) worst = { pct: r, date: candles[i][0] };
  }
  let peak = candles[0], mdd = { pct: 0, from: candles[0][0], to: candles[0][0] };
  for (const c of candles) {
    if (c[4] > peak[4]) peak = c;
    const dd = (c[4] / peak[4] - 1) * 100;
    if (dd < mdd.pct) mdd = { pct: dd, from: peak[0], to: c[0] };
  }
  return {
    high: hi[2], highDate: hi[0], low: lo[3], lowDate: lo[0],
    bestDay: { pct: round1(best.pct), date: best.date },
    worstDay: { pct: round1(worst.pct), date: worst.date },
    maxDD: { pct: round1(mdd.pct), from: mdd.from, to: mdd.to },
    lastClose: candles[n - 1][4], prevClose: n > 1 ? candles[n - 2][4] : candles[n - 1][4],
    count: n, first: candles[0][0], last: candles[n - 1][0]
  };
}

/* ================= state ================= */
const state = {
  mode: 'music',
  meta: null, raw: null, period: 'music',
  series: [], ind: null, kline: [], tsIndex: new Map(),
  chapters: [], playhead: 0, playing: false,
  speed: 16, musicRate: 1, loop: false, loopMode: 'off', muted: false, lastVol: 0.8, barSpace: 8,
  lastInt: -1, lastChapterIdx: -1, activeChapterIdx: -1, endShown: false,
  hoverIndex: null,
  danmaku: false, sound: false, sonify: false, maxVol: 1, marketReplay: false, hdr3d: true,
  showMA: true, showMACD: true, showHighLow: true, hollow: true,
  showVOL: true, showThick: true, showThin: true, showSpecL: true, showSpecR: true,
  showEMA: true, showBoll: false, bollN: 20, bollK: 2, emaFast: 12, emaSlow: 26, ovl: null, ovlKey: '',
  bpmOverride: 0, beatPhaseAdj: 0,
  lastUI: 0, dmAccum: 0, lastFrame: 0, startOpen: false,
  draggingTimeline: false, dragWasPlaying: false,
  musicWindow: 0.25, musicThick: 1, musicThin: 10, spectrumBands: 256, spectrumStep: 0.25, viewSpan: 30, musicSmooth: 0.3, musicVolume: 0.8,
  freqThick: [], freqThin: [], spectrumRows: 200, spectrumL: [], spectrumR: [], meters: { L: { v: 0, p: 0, pt: 0 }, R: { v: 0, p: 0, pt: 0 }, M: { v: 0, p: 0, pt: 0 } }, freqScale: null, lastMusicDraw: 0, mCanvas: null,
  musicAudio: null, musicAudioMeta: null, loadToken: 0, analysisWorker: undefined,
  videoEl: null, videoOn: true, videoAlpha: 0.5, videoFit: 'cover', videoPane: 'bg', videoScale: 1, videoFlipX: false, videoFilter: 'none', videoFree: false, videoRate: 1, videoAB: { a: null, b: null }, snapBars: true, showStrip: true, normPeak: false, freqOverride: false, freqMin: 40, freqMax: 12000, wall3d: false, wall3dAlpha: 0.9, stageMode: 'normal',
  mediaSource: null, mediaDest: null, mediaAC: null,
  musicHover: null, plotGeom: null, scrub: false,
  subs: [], subOffset: 0, showSubs: true, subIdx: -2, subDockFold: false, subView: 'auto',
  kMode: 'time', freqAgg: 5, chartType: 'candle', barGap: 0.72,
  splitMain: 0.44, splitSub: 0.5, specTypeL: 'candle', specTypeR: 'candle', dragSplit: '',
  freqBars: null, freqBarsKey: '', freqHover: null, freqGeom: null,
  theme: 'light', beatFlash: 0, lastBeat: -1, analyzerAt: 0, bookAt: 0, ab: { a: null, b: null }, abDrag: null,
  upIsRed: true, showBeat: true, showWatermark: true, showEnvelope: true, showGlow: true,
  heatGain: 1, fftSize: 2048, hopSec: 0.1, bandRange: 1, shareScale: 2, density: 'standard',
  ampScale: 'linear', freqAxis: 'log',
  queue: [], sort: 'default', collapsed: {}
};

/* 标题过长时滚动展示：内容装进 inline-block，按溢出量算位移与时长 */
function applyMarquee(el, retry) {
  if (!el) return;
  if (el.clientWidth < 24 && (retry || 0) < 3) {
    requestAnimationFrame(() => applyMarquee(el, (retry || 0) + 1));
    return;
  }
  const txt = el.getAttribute('data-mq') || el.textContent;
  if (!el.getAttribute('data-mq')) el.setAttribute('data-mq', txt);
  let inner = el.firstElementChild;
  if (!inner || !inner.classList.contains('mq-inner') || inner.textContent !== txt) {
    el.textContent = '';
    inner = document.createElement('span');
    inner.className = 'mq-inner';
    inner.textContent = txt;
    el.appendChild(inner);
  }
  el.classList.remove('mq-run');
  requestAnimationFrame(() => {
    const over = inner.scrollWidth - el.clientWidth;
    if (over > 4) {
      el.classList.add('mq-run');
      el.style.setProperty('--mq-shift', (-over - 4) + 'px');
      el.style.setProperty('--mq-dur', Math.max(4, Math.min(20, over / 18)).toFixed(1) + 's');
    } else {
      el.style.removeProperty('--mq-shift');
      el.style.removeProperty('--mq-dur');
    }
  });
}
function refreshMarquees() {
  applyMarquee($('qNameTop'));
  applyMarquee($('qName'));
  document.querySelectorAll('#sidebar .q-name').forEach(applyMarquee);
}
/* ---------- 字幕：LRC / SRT / VTT ---------- */
function parseTimestamp(str) {
  const m = String(str).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number('0.' + m[4]) : 0);
}
function parseSubs(text, ext) {
  const out = [];
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (ext === 'srt' || ext === 'vtt' || raw.indexOf('-->') >= 0) {
    const blocks = raw.split(/\n{2,}/);
    for (const b of blocks) {
      const lines = b.split('\n').filter(l => l.trim() !== '' && !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()));
      if (!lines.length) continue;
      const tm = lines[0].match(/(.+?)\s*-->\s*(.+)/);
      if (!tm) continue;
      const t0 = parseTimestamp(tm[1]), t1 = parseTimestamp(tm[2]);
      const txt = lines.slice(1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (t0 != null && txt) out.push({ t: t0, end: t1 == null ? t0 + 4 : t1, text: txt });
    }
  } else {
    for (const line of raw.split('\n')) {
      const close = line.indexOf(']');
      if (close < 0) continue;
      const t = parseTimestamp(line.slice(0, close));
      if (t == null) continue;
      const txt = line.slice(close + 1).replace(/<[^>]+>/g, '').trim();
      if (txt) out.push({ t, end: null, text: txt });
    }
    out.sort((a, b) => a.t - b.t);
    for (let i = 0; i < out.length; i++) {
      out[i].end = out[i].end == null ? (i + 1 < out.length ? out[i + 1].t : out[i].t + 5) : out[i].end;
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
function subAt(t) {
  const subs = state.subs;
  if (!subs || !subs.length) return null;
  const tt = t - (state.subOffset || 0);
  for (let i = subs.length - 1; i >= 0; i--) {
    if (tt >= subs[i].t) return tt < subs[i].end ? subs[i] : null;
  }
  return null;
}
let subLineKey = null;
function updateSubs(force) {
  updateSubDock(force);
  const el = $('subLayer');
  if (!el) return;
  const on = state.showSubs && state.subs.length > 0 && state.mode === 'music';
  if (!on) { if (!el.hidden) el.hidden = true; subLineKey = null; return; }
  const t = state.musicAudio ? state.musicAudio.currentTime : 0;
  const tt = t - (state.subOffset || 0);
  const cur = subAt(t);
  if (!cur) { if (!el.hidden) { el.hidden = true; el.textContent = ''; } subLineKey = null; return; }
  const key = cur.t + '|' + cur.text;
  if (force || key !== subLineKey) {
    subLineKey = key;
    el.innerHTML = '';
    if (cur.words && cur.words.length) {
      for (const w of cur.words) {
        const sp = document.createElement('span');
        sp.className = 'sub-word';
        sp.textContent = w.w || w.word || '';
        sp.dataset.t0 = String(w.t0 != null ? w.t0 : w.start);
        sp.dataset.t1 = String(w.t1 != null ? w.t1 : w.end);
        el.appendChild(sp);
      }
    } else {
      el.textContent = cur.text;
    }
    el.hidden = false;
    el.dataset.lit = '-1';
    el.classList.remove('sub-in');
    void el.offsetWidth;
    el.classList.add('sub-in');
  }
  if (cur.words && cur.words.length) {
    const kids = el.children;
    let lit = 0;
    while (lit < kids.length && Number(kids[lit].dataset.t0) <= tt + 0.001) lit++;
    const prev = el.dataset.lit == null ? -1 : Number(el.dataset.lit);
    if (prev !== lit) {
      const a = Math.max(0, Math.min(prev, lit));
      const b = Math.max(prev, lit);
      for (let i = a; i < b; i++) kids[i].classList.toggle('on', i < lit);
      el.dataset.lit = lit;
    }
  }
}
async function aiTranscribe() {
  const meta = state.meta;
  if (!meta || state.mode !== 'music') { toast('先加载一首曲子'); return; }
  let blob = null;
  try {
    if (meta.file) blob = meta.file;
    else if (meta.demo && window.KLINE_DEMO_AUDIO) blob = await (await fetch(window.KLINE_DEMO_AUDIO)).blob();
    else if (meta.url) blob = await (await fetch(meta.url)).blob();
  } catch (e) { blob = null; }
  if (!blob) { toast('这个片源没有可提交的音频'); return; }
  toast('AI 听写中…（本地桥 127.0.0.1:8765）');
  let data;
  try {
    const res = await fetch('http://127.0.0.1:8765/transcribe?language=zh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': (meta.name || 'audio') + '.m4a' },
      body: blob
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (e) {
    toast('连不上本地字幕桥：python tools/ai_subtitles_server.py --model-dir <模型目录>');
    return;
  }
  const segs = (data && data.segments) || [];
  const list = segs.map(sg => ({
    t: Number(sg.start) || 0,
    end: Number(sg.end) || (Number(sg.start) || 0) + 3,
    text: String(sg.text || '').trim(),
    words: (sg.words || []).map(w => ({ t0: Number(w.start) || 0, t1: Number(w.end) || 0, w: String(w.word || '') })).filter(w => w.w)
  })).filter(x => x.text);
  if (!list.length) { toast('没识别出内容'); return; }
  setSubs(list, list.length + ' 条 · AI 逐字');
  toast('AI 字幕就绪 · ' + list.length + ' 条 · 逐字高亮');
}
function renderSubTracks() {
  const sel = $('subTrackSel');
  if (!sel) return;
  sel.innerHTML = '';
  if (!subTracks.length) { const o = document.createElement('option'); o.textContent = '（无）'; sel.appendChild(o); return; }
  subTracks.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = t.name;
    if (t.list === state.subs) o.selected = true;
    sel.appendChild(o);
  });
}
function syncSubLabel() {
  const lbl = $('subName');
  if (!lbl) return;
  const off = state.subOffset || 0;
  lbl.textContent = state.subs.length
    ? (state.subLabel || state.subs.length + ' 条') + (off ? ' · ' + (off > 0 ? '+' : '') + off.toFixed(1) + 's' : '')
    : '未加载';
}
let subTracks = [];
function setSubs(list, name) {
  state.subs = Array.isArray(list) ? list : [];
  if (state.subs.length && name) {
    const i = subTracks.findIndex(t => t.name === name);
    if (i >= 0) subTracks[i].list = state.subs; else subTracks.push({ name, list: state.subs });
  }
  renderSubTracks();
  state.subIdx = -2;
  state.subLabel = name || '';
  if (state.meta) state.meta.subs = state.subs;
  syncSubLabel();
  updateSubs(true);
  buildLyricsPane(true);
}

/* ---- 字幕区：嵌进版式的三行歌词条（与画布浮层独立） ---- */
function subIdxAt(t) {
  const subs = state.subs || [];
  const tt = t - (state.subOffset || 0);
  for (let i = subs.length - 1; i >= 0; i--) if (tt >= subs[i].t - 0.001) return i;
  return -1;
}
function bpmOf() {
  if (state.bpmOverride > 0) return state.bpmOverride;
  const m = state.meta || {};
  return m.bpm || (m.analysis && m.analysis.bpm) || 0;
}
function beatPhaseOf() {
  const m = state.meta || {};
  const base = m.beatPhase != null ? m.beatPhase : ((m.analysis && m.analysis.beatPhase) || 0);
  return base + (state.beatPhaseAdj || 0) / 1000;
}
function syncSubViewChips() {
  document.querySelectorAll('#subViewChips button').forEach(b => b.classList.toggle('active', b.dataset.subview === state.subView));
}
function subViewNow() {
  if (state.subView === 'dock' || state.subView === 'float') return state.subView;
  return document.hasFocus() && document.visibilityState === 'visible' ? 'dock' : 'float';
}
function paintSubWords(el, line, live, tt) {
  const k = (live ? 'L' : 'G') + '|' + line.t;
  if (el.dataset.k !== k) {
    el.dataset.k = k;
    el.innerHTML = '';
    if (live && line.words && line.words.length) {
      for (const w of line.words) {
        const sp = document.createElement('span');
        sp.className = 'sub-word';
        sp.textContent = w.w || '';
        sp.dataset.t0 = String(w.t0 != null ? w.t0 : 0);
        el.appendChild(sp);
      }
    } else {
      const sp = document.createElement('span');
      sp.className = 'sd-empty';
      sp.textContent = (live ? '' : '♪ ') + (line.text || '');
      el.appendChild(sp);
    }
    el.dataset.lit = '-1';
  }
  if (!(live && line.words && line.words.length)) return;
  const kids = el.children;
  let lit = 0;
  while (lit < kids.length && Number(kids[lit].dataset.t0) <= tt + 0.001) lit++;
  const prev = el.dataset.lit == null ? -1 : Number(el.dataset.lit);
  if (prev !== lit) {
    const a = Math.max(0, Math.min(prev, lit)), b = Math.max(prev, lit);
    for (let i = a; i < b; i++) kids[i].classList.toggle('on', i < lit);
    el.dataset.lit = lit;
  }
}
/* 前台=内嵌字幕区；失焦/后台=悬浮条（将来的 EXE 小窗沿用同一套） */
let subDockChrome = '';
function updateSubDock(force) {
  const dock = $('subDock');
  if (!dock) return;
  const subs = state.subs || [];
  const mode = subViewNow();
  const show = state.mode === 'music' && subs.length > 0;
  const showDock = show && mode === 'dock';
  const showFloat = show && mode === 'float';
  /* 外壳状态只在模式/折叠/字幕轨变化时重写；逐帧只更新当前句与逐字高亮 */
  const chrome = [showDock, showFloat, state.subDockFold ? 1 : 0, state.subView, state.showSubs ? 1 : 0, state.subLabel || '', state.subOffset || 0, subs.length].join('|');
  if (chrome !== subDockChrome) {
    subDockChrome = chrome;
    if (dock.hidden === showDock) dock.hidden = !showDock;
    dock.classList.toggle('folded', !!state.subDockFold);
    const fl = $('subFloat');
    if (fl && fl.hidden === showFloat) fl.hidden = !showFloat;
    const canvasBtn = $('btnSubDockCanvas');
    if (canvasBtn) canvasBtn.classList.toggle('active', !!state.showSubs);
    const foldBtn = $('btnSubDockFold');
    if (foldBtn) foldBtn.textContent = state.subDockFold ? '展开' : '收起';
    const vmBtn = $('btnSubDockView');
    if (vmBtn) vmBtn.textContent = state.subView === 'auto' ? '模式·自动' : state.subView === 'dock' ? '模式·内嵌' : '模式·悬浮';
    syncSubViewChips();
    setText($('subDockName'), state.subLabel || (subs.length + ' 条'));
  }
  if (!show) return;
  const t = state.musicAudio ? state.musicAudio.currentTime : 0;
  const tt = t - (state.subOffset || 0);
  const idx = subIdxAt(t);
  const live = idx >= 0 && tt < subs[idx].end;
  const line = idx >= 0 ? subs[idx] : subs[0];
  if (showDock) {
    setText($('subDockCount'), (idx < 0 ? '--' : (idx + 1) + '/' + subs.length)
      + (state.subOffset ? ' · ' + (state.subOffset > 0 ? '+' : '') + state.subOffset.toFixed(1) + 's' : ''));
    setText($('sdPrev'), idx > 0 ? subs[idx - 1].text : '');
    setText($('sdNext'), idx + 1 < subs.length ? subs[idx + 1].text : '');
    paintSubWords($('sdCur'), line, live, tt);
  }
  if (showFloat) {
    paintSubWords($('sfCur'), line, live, tt);
    setText($('sfNext'), idx + 1 < subs.length ? subs[idx + 1].text : '');
  }
}
function seekMusicTo(t) {
  if (state.mode !== 'music' || !state.musicAudio) return;
  setPlayhead(clamp(t, 0, Math.max(0, (state.meta.duration || 0) - 0.05)) / (state.musicWindow || 0.25));
  updateSubs(true);
  drawMusic(true);
}
function exportSubsLrc() {
  if (!state.subs.length) { toast('还没有字幕'); return; }
  const fmt = t => {
    t = Math.max(0, t);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return '[' + String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(2) + ']';
  };
  const text = state.subs.map(l => fmt(l.t + (state.subOffset || 0)) + l.text).join(String.fromCharCode(10));
  saveBlob('字幕-' + ((state.meta && state.meta.name) || 'subs') + '.lrc', new Blob([text], { type: 'text/plain;charset=utf-8' }));
  toast('LRC 已导出 · ' + state.subs.length + ' 行');
}
function mediaCode(meta) {
  if (!meta) return 'AUDIO';
  if (meta.kind !== 'music') return meta.market === '本地' ? 'LOCAL' : 'INDEX';
  return meta.videoUrl ? 'VIDEO' : 'AUDIO';
}

/* ================= audio sfx ================= */
/* ---------- K 线声化：把每根 K 线合成一个音 ---------- */
const Sonify = {
  ctx: null, master: null, count: 0,
  ensure() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = state.lastVol || 0.8;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) { return null; }
  },
  bar(i) {
    const ctx = this.ensure();
    if (!ctx || !state.series.length) return;
    const S = state.series;
    const c = S[clamp(i, 0, S.length - 1)];
    const p = S[clamp(i - 1, 0, S.length - 1)] || c;
    const pct = p[4] ? (c[4] / p[4] - 1) : 0;
    /* 五声音阶（A 小调五声）两个八度，涨跌映射到音级 */
    const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
    const step = clamp(Math.round(((pct + 0.06) / 0.12) * (scale.length - 1)), 0, scale.length - 1);
    const freq = 220 * Math.pow(2, scale[step] / 12);
    const v = (c[5] || 0) / Math.max(1, state.maxVol || 1);
    const vol = 0.035 + Math.min(0.12, v * 0.16);
    const dur = 0.34;
    const t0 = ctx.currentTime + 0.005;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = pct >= 0 ? 'triangle' : 'sawtooth';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    this.count++;
    /* 大幅波动：加一个五度泛音，听起来像“大单” */
    if (Math.abs(pct) > 0.02) {
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(freq * 1.5, t0);
      g2.gain.setValueAtTime(0, t0);
      g2.gain.linearRampToValueAtTime(vol * 0.6, t0 + 0.008);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
      o2.connect(g2); g2.connect(this.master);
      o2.start(t0); o2.stop(t0 + dur);
    }
  },
  setVolume(v) {
    if (this.master) this.master.gain.value = clamp(v, 0, 1);
  }
};

const AudioFX = {
  ctx: null,
  ensure() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) { return null; }
  },
  tone(freq, dur, type, vol, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  },
  event() { if (!state.sound) return; this.ensure(); this.tone(660, .13, 'sine', .03); this.tone(990, .16, 'sine', .025, .11); },
  crash() { if (!state.sound) return; this.ensure(); this.tone(140, .35, 'sawtooth', .025); this.tone(90, .4, 'sine', .03, .05); }
};

/* ================= chart ================= */
let chart = null;

const BASE_STYLES = {
  grid: {
    show: true,
    horizontal: { show: true, size: 1, color: '#e6e6e6', style: 'dashed', dashedValue: [1, 4] },
    vertical: { show: true, size: 1, color: '#efefef', style: 'dashed', dashedValue: [1, 4] }
  },
  candle: {
    type: 'candle_solid',
    bar: {
      upColor: RED, downColor: GREEN, noChangeColor: '#999999',
      upBorderColor: RED, downBorderColor: GREEN, noChangeBorderColor: '#999999',
      upWickColor: RED, downWickColor: GREEN, noChangeWickColor: '#999999'
    },
    priceMark: {
      show: true,
      high: { show: true, color: '#999999', textOffset: 5, textSize: 10, textFamily: 'Consolas', textWeight: 'normal' },
      low: { show: true, color: '#999999', textOffset: 5, textSize: 10, textFamily: 'Consolas', textWeight: 'normal' },
      last: {
        show: true, upColor: RED, downColor: GREEN, noChangeColor: '#999999',
        line: { show: true, style: 'dashed', dashedValue: [4, 4], size: 1 },
        text: {
          show: true, style: 'fill', size: 11, family: 'Consolas', weight: 'bold', color: '#ffffff',
          borderStyle: 'solid', borderSize: 0, borderColor: 'transparent', borderRadius: 2,
          paddingLeft: 4, paddingTop: 3, paddingRight: 4, paddingBottom: 3, backgroundColor: RED
        }
      }
    },
    area: {
      lineSize: 1, lineColor: RED, value: 'close', smooth: false,
      backgroundColor: 'rgba(255,56,26,0.08)',
      point: { show: false, color: RED, radius: 3, rippleColor: 'rgba(255,56,26,.2)', rippleRadius: 5, animation: false, animationDuration: 1000 }
    },
    tooltip: {
      showRule: 'follow_cross', showType: 'rect', defaultValue: '--',
      text: { color: '#333333', size: 11, family: 'Consolas, Microsoft YaHei', weight: 'normal', marginLeft: 6, marginTop: 4, marginRight: 6, marginBottom: 4 },
      icons: [],
      rect: {
        position: 'pointer', color: '#ffffff', borderColor: '#e8e8e8', borderSize: 1, borderRadius: 4,
        paddingLeft: 10, paddingTop: 8, paddingRight: 10, paddingBottom: 8,
        offsetLeft: 14, offsetTop: 14, offsetRight: 14, offsetBottom: 14
      }
    }
  },
  indicator: {
    ohlc: { upColor: RED, downColor: GREEN, noChangeColor: '#999999' },
    bars: [{ style: 'fill', upColor: RED, downColor: GREEN, noChangeColor: '#999999' }],
    lines: [
      { style: 'solid', smooth: false, size: 1, color: MA_COLORS[0], dashedValue: [2, 2] },
      { style: 'solid', smooth: false, size: 1, color: MA_COLORS[1], dashedValue: [2, 2] },
      { style: 'solid', smooth: false, size: 1, color: MA_COLORS[2], dashedValue: [2, 2] },
      { style: 'solid', smooth: false, size: 1, color: MA_COLORS[3], dashedValue: [2, 2] },
      { style: 'solid', smooth: false, size: 1, color: MA_COLORS[4], dashedValue: [2, 2] }
    ],
    circles: [],
    lastValueMark: { show: false },
    tooltip: {
      showRule: 'none', showType: 'standard', defaultValue: '--',
      text: { color: '#888888', size: 10, family: 'Consolas', weight: 'normal', marginLeft: 2, marginTop: 2, marginRight: 2, marginBottom: 2 },
      icons: [], showName: true, showParams: false,
      offsetLeft: 0, offsetTop: 0, offsetRight: 0, offsetBottom: 0
    }
  },
  xAxis: {
    show: true, size: 22,
    axisLine: { show: true, color: '#e8e8e8', size: 1, style: 'solid', dashedValue: [2, 2] },
    tickLine: { show: false, length: 3, color: '#e8e8e8', size: 1, style: 'solid', dashedValue: [2, 2] },
    tickText: { show: true, color: '#999999', weight: 'normal', family: 'Consolas', size: 10, marginStart: 4, marginEnd: 4 }
  },
  yAxis: {
    show: true, size: 58, type: 'normal', position: 'right', inside: false, reverse: false,
    axisLine: { show: true, color: '#e8e8e8', size: 1, style: 'solid', dashedValue: [2, 2] },
    tickLine: { show: false, length: 3, color: '#e8e8e8', size: 1, style: 'solid', dashedValue: [2, 2] },
    tickText: { show: true, color: '#999999', weight: 'normal', family: 'Consolas', size: 10, marginStart: 4, marginEnd: 4 }
  },
  separator: { size: 1, color: '#f0f0f0', fill: true, activeBackgroundColor: '#f7f7f7' },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, style: 'dashed', dashedValue: [3, 3], size: 1, color: '#b0b0b0' },
      text: {
        show: true, style: 'fill', color: '#ffffff', size: 10, family: 'Consolas', weight: 'normal',
        borderStyle: 'solid', borderSize: 0, borderColor: 'transparent', borderRadius: 2,
        paddingLeft: 4, paddingTop: 3, paddingRight: 4, paddingBottom: 3, backgroundColor: '#555555'
      }
    },
    vertical: {
      show: true,
      line: { show: true, style: 'dashed', dashedValue: [3, 3], size: 1, color: '#b0b0b0' },
      text: {
        show: true, style: 'fill', color: '#ffffff', size: 10, family: 'Consolas', weight: 'normal',
        borderStyle: 'solid', borderSize: 0, borderColor: 'transparent', borderRadius: 2,
        paddingLeft: 4, paddingTop: 3, paddingRight: 4, paddingBottom: 3, backgroundColor: '#555555'
      }
    }
  },
  overlay: {
    point: { color: '#1677ff', borderColor: '#1677ff', borderSize: 1, radius: 3, activeColor: '#1677ff', activeBorderColor: '#1677ff', activeBorderSize: 1, activeRadius: 3 },
    line: { style: 'solid', smooth: false, size: 1, color: '#1677ff', dashedValue: [2, 2] },
    rect: { style: 'fill', color: 'rgba(22,119,255,.1)', borderColor: '#1677ff', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2], borderRadius: 0 },
    polygon: { style: 'fill', color: 'rgba(22,119,255,.1)', borderColor: '#1677ff', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] },
    circle: { style: 'fill', color: 'rgba(22,119,255,.1)', borderColor: '#1677ff', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] },
    arc: { style: 'solid', size: 1, color: '#1677ff', dashedValue: [2, 2] },
    text: {
      style: 'fill', color: '#333333', size: 12, family: 'Microsoft YaHei', weight: 'normal',
      borderStyle: 'solid', borderSize: 0, borderColor: 'transparent', borderRadius: 2,
      paddingLeft: 4, paddingTop: 4, paddingRight: 4, paddingBottom: 4, backgroundColor: '#ffffff'
    }
  }
};

/* 主题差异只覆盖必要字段，KLineChart 的 setStyles 会深合并 */
function themeChartStyles() {
  const t = T();
  const line = { color: t.panelBorder };
  const tick = { color: t.text3 };
  return {
    grid: { horizontal: { color: t.chartGridH }, vertical: { color: t.chartGridV } },
    candle: {
      bar: { upColor: t.up, downColor: t.down, upBorderColor: t.up, downBorderColor: t.down, upWickColor: t.up, downWickColor: t.down },
      priceMark: {
        high: { color: t.text3 }, low: { color: t.text3 },
        last: { upColor: t.up, downColor: t.down, text: { color: t.tagText } }
      },
      tooltip: { text: { color: t.text }, rect: { color: t.panelBg, borderColor: t.panelBorder } }
    },
    indicator: {
      ohlc: { upColor: t.up, downColor: t.down },
      bars: [{ style: 'fill', upColor: t.up, downColor: t.down, noChangeColor: t.text3 }],
      tooltip: { text: { color: t.text3 } }
    },
    xAxis: { axisLine: line, tickLine: line, tickText: tick },
    yAxis: { axisLine: line, tickLine: line, tickText: tick },
    separator: { color: t.panelBorder, activeBackgroundColor: t.panelBg },
    crosshair: {
      horizontal: { line: { color: t.tickMajor }, text: { backgroundColor: t.crosshairBg } },
      vertical: { line: { color: t.tickMajor }, text: { backgroundColor: t.crosshairBg } }
    },
    overlay: {
      point: { color: t.mainAccent, borderColor: t.mainAccent, activeColor: t.mainAccent, activeBorderColor: t.mainAccent },
      line: { color: t.mainAccent }, arc: { color: t.mainAccent },
      text: { color: t.text, backgroundColor: t.panelBg }
    }
  };
}

function dateFormatter(dtf, timestamp, format, type) {
  if (state.mode === 'music') return fmtTime(timestamp / 1000);
  const d = new Date(timestamp);
  const y = d.getUTCFullYear(), m = pad2(d.getUTCMonth() + 1), day = pad2(d.getUTCDate());
  return type === 2 ? y + '-' + m : y + '-' + m + '-' + day;
}

function initChart() {
  if (!KLC) {
    $('chart').innerHTML = '<div style="padding:30px;color:#e6352b">KLineChart 未加载。</div>';
    return;
  }
  chart = KLC.init('chart');
  if (!chart) return;
  try { chart.setTimezone('UTC'); } catch (e) {}
  try { chart.setLocale('zh-CN'); } catch (e) {}
  try { chart.setCustomApi({ formatBigNumber: fmtVol, formatDate: dateFormatter }); } catch (e) {}
  chart.setStyles(BASE_STYLES);
  try { chart.setStyles(themeChartStyles()); } catch (e) {}
  chart.setOffsetRightDistance(0);
  createIndicators();
  chart.subscribeAction('onCrosshairChange', onCrosshair);
  chart.subscribeAction('onCandleBarClick', onCandleClick);
  chart.subscribeAction('onDataReady', () => {
    if (state.mode !== 'music') {
      try { chart.setBarSpace(state.barSpace); chart.scrollToRealTime(0); } catch (e) {}
    }
  });
  setTimeout(() => { try { chart.resize(); } catch (e) {} }, 30);
}

function createIndicators() {
  if (!chart) return;
  try { chart.removeIndicator('candle_pane', 'MA'); } catch (e) {}
  if (state.showMA) {
    try { chart.createIndicator({ name: 'MA', calcParams: MA_PERIODS }, false, { id: 'candle_pane' }); } catch (e) {}
  }
  const paneTip = (showParams) => ({
    tooltip: {
      showRule: 'always', showType: 'standard', defaultValue: '--',
      text: { color: '#999999', size: 10, family: 'Consolas', weight: 'normal', marginLeft: 2, marginTop: 2, marginRight: 2, marginBottom: 2 },
      icons: [], showName: true, showParams,
      offsetLeft: 0, offsetTop: 0, offsetRight: 0, offsetBottom: 0
    }
  });
  try {
    if (state.showVOL) {
      if (!chart.getIndicatorByPaneId('pane_vol', 'VOL')) {
        chart.createIndicator({ name: 'VOL', styles: paneTip(false) }, false, { id: 'pane_vol', height: 86, minHeight: 54, dragEnabled: false });
      }
    } else chart.removeIndicator('pane_vol');
  } catch (e) {}
  try {
    if (state.showMACD) {
      if (!chart.getIndicatorByPaneId('pane_macd', 'MACD')) {
        chart.createIndicator({ name: 'MACD', calcParams: [6, 13, 5], styles: paneTip(true) }, false, { id: 'pane_macd', height: 98, minHeight: 54, dragEnabled: false });
      }
    } else chart.removeIndicator('pane_macd');
  } catch (e) {}
}

function onCrosshair(data) {
  if (data && data.kLineData && typeof data.kLineData.timestamp === 'number') {
    const idx = state.tsIndex.get(data.kLineData.timestamp);
    state.hoverIndex = idx == null ? null : idx;
  } else state.hoverIndex = null;
  updateLegend();
  updateFoot();
}
function onCandleClick(data) {
  if (!data) return;
  const ts = typeof data.timestamp === 'number' ? data.timestamp : (data.kLineData && data.kLineData.timestamp);
  if (typeof ts !== 'number') return;
  const idx = state.tsIndex.get(ts);
  if (idx == null) return;
  setPlayhead(idx, { fromUser: true });
}

/* ================= audio analysis ================= */
function makeFFT(n) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = Math.sin(-2 * Math.PI * i / n);
  }
  return { rev, cos, sin };
}
function fft(re, im, tw) {
  const n = re.length, { rev, cos, sin } = tw;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step, c = cos[k], s = sin[k];
        const xr = re[i + j + half] * c - im[i + j + half] * s;
        const xi = re[i + j + half] * s + im[i + j + half] * c;
        re[i + j + half] = re[i + j] - xr;
        im[i + j + half] = im[i + j] - xi;
        re[i + j] += xr;
        im[i + j] += xi;
      }
    }
  }
}
function normalizeField(frames, key, p = 0.98) {
  if (!frames.length) return;
  const vals = frames.map(f => f[key]).sort((a, b) => a - b);
  const ref = vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] || 1;
  const scale = 100 / Math.max(ref, 1e-9);
  for (const f of frames) f[key] = clamp(f[key] * scale, 0, 100);
}
function smoothField(frames, key, s) {
  if (!frames.length) return;
  let prev = frames[0][key];
  for (const f of frames) {
    prev = prev * s + f[key] * (1 - s);
    f[key] = prev;
  }
}
function detectBpm(frames) {
  if (frames.length < 8) return 0;
  const onset = [];
  for (let i = 1; i < frames.length; i++) onset.push(Math.max(0, frames[i].rawRms - frames[i - 1].rawRms));
  const dt = (frames[1].t - frames[0].t) || 0.1;
  const fps = 1 / dt;
  let best = 0, lagBest = 0;
  for (let lag = Math.round(fps * 0.3); lag <= Math.round(fps * 1.0); lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag];
    if (sum > best) { best = sum; lagBest = lag; }
  }
  if (!lagBest) return 0;
  let bpm = 60 * fps / lagBest;
  while (bpm > 180) bpm /= 2;
  while (bpm < 70) bpm *= 2;
  return Math.round(bpm);
}
/* 节拍：自相关取候选周期 → 5ms 包络梳状打分（含反拍惩罚）→ 相位与 onset 刻度 */
function analyzeBeats(buffer) {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const buildEnv = hopSec => {
    const hop = Math.max(1, Math.round(sr * hopSec));
    const n = Math.floor(L.length / hop);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const st = i * hop, en = Math.min(L.length, st + hop);
      let acc = 0, c = 0;
      for (let j = st; j < en; j += 2) { const v = L[j] + R[j]; acc += v * v; c++; }
      env[i] = Math.sqrt(acc / Math.max(1, c));
    }
    const nov = new Float32Array(n);
    for (let i = 1; i < n; i++) nov[i] = Math.max(0, Math.log(1 + env[i] * 8) - Math.log(1 + env[i - 1] * 8));
    let mean = 0;
    for (let i = 0; i < n; i++) mean += nov[i];
    mean /= n || 1;
    for (let i = 0; i < n; i++) nov[i] = Math.max(0, nov[i] - mean * 0.55);
    return nov;
  };
  const nov20 = buildEnv(0.02);
  const n20 = nov20.length;
  if (n20 < 64) return { bpm: 0, phase: 0, conf: 0, onsets: [] };
  const peaks = [];
  for (let lag = 15; lag <= Math.min(n20 - 2, 120); lag++) {
    let dot = 0, aa = 0, bb = 0;
    for (let i = lag; i < n20; i++) { dot += nov20[i] * nov20[i - lag]; aa += nov20[i] * nov20[i]; bb += nov20[i - lag] * nov20[i - lag]; }
    peaks.push({ lag, r: dot / Math.sqrt(aa * bb + 1e-9) });
  }
  peaks.sort((a, b) => b.r - a.r);
  const cands = [];
  for (const pk of peaks.slice(0, 8)) {
    let b = 60 / (pk.lag * 0.02);
    while (b < 80) b *= 2;
    while (b > 160) b /= 2;
    for (const m of [1, 2, 0.5]) {
      const bb = b * m;
      if (bb < 75 || bb > 165) continue;
      if (!cands.some(x => Math.abs(x - bb) < 0.6)) cands.push(bb);
    }
  }
  const nov5 = buildEnv(0.005);
  const n5 = nov5.length;
  const comb = bpm => {
    const P = 60 / bpm / 0.005;
    let best = { sc: -1e9, ph: 0, on: 0, off: 0 };
    for (let ph = 0; ph < P; ph += 0.25) {
      let on = 0, onN = 0, off = 0, offN = 0;
      for (let k = 0; ; k++) {
        const i0 = Math.round(ph + k * P);
        if (i0 >= n5) break;
        on += Math.max(nov5[i0], nov5[i0 + 1] || 0); onN++;
        const i1 = Math.round(ph + k * P + P / 2);
        if (i1 < n5) { off += Math.max(nov5[i1], nov5[i1 + 1] || 0); offN++; }
      }
      if (onN < 8) continue;
      const sc = on / onN - 0.65 * off / (offN || 1);
      if (sc > best.sc) best = { sc, ph: ph * 0.005, on: on / onN, off: off / (offN || 1) };
    }
    return best;
  };
  let picked = null;
  for (const b of cands) {
    const c = comb(b);
    if (!picked || c.sc > picked.sc) picked = { bpm: b, ...c };
  }
  if (!picked) return { bpm: 0, phase: 0, conf: 0, onsets: [] };
  const conf = clamp((picked.on - picked.off) / (picked.on + picked.off + 1e-6), 0, 1);
  const pos = [];
  for (let i = 0; i < n5; i++) if (nov5[i] > 0) pos.push(nov5[i]);
  pos.sort((a, b) => a - b);
  const thr = pos.length ? pos[Math.floor(pos.length * 0.95)] : 0;
  const onsets = [];
  let lastT = -1;
  for (let i = 1; i < n5 - 1; i++) {
    if (nov5[i] < thr || nov5[i] < nov5[i - 1] || nov5[i] < nov5[i + 1]) continue;
    const t = i * 0.005;
    if (t - lastT < 0.18) continue;
    onsets.push(Math.round(t * 1000) / 1000);
    lastT = t;
    if (onsets.length >= 3000) break;
  }
  return {
    bpm: Math.round(picked.bpm * 10) / 10,
    phase: Math.round(picked.ph * 1000) / 1000,
    conf: Math.round(conf * 100) / 100,
    onsets
  };
}

const BAND_COUNT = 512;
const FREQ_MIN = 40;
const FREQ_MAX = 12000;
let FREQ_LO = FREQ_MIN, FREQ_HI = FREQ_MAX;
/* 画布配色：浅色 = 同花顺网页版实测值，深色 = 同花顺客户端看盘配色 */
const THEMES = {
  light: {
    canvasBg: '#ffffff', panelBg: '#fdfdfe', panelBorder: '#e6e8ec', mainAccent: '#1677ff',
    gridMajor: 'rgba(0,0,0,.105)', gridMinor: 'rgba(0,0,0,.055)',
    timeMajor: 'rgba(0,0,0,.09)', timeMinor: 'rgba(0,0,0,.05)',
    tickMajor: '#9aa3af', tickMinor: '#c6ccd4',
    up: '#ff381a', down: '#009b67', hot: '#faad14', neutral: 'rgba(0,0,0,.42)',
    thick: '#4f8bff', thin: '#f3a83d',
    playhead: 'rgba(80,96,122,.55)', cursorLine: 'rgba(22,119,255,.45)', cursorTag: '#1677ff',
    beat: 'rgba(22,119,255,.16)', beatStrong: 'rgba(22,119,255,.34)', beatSoft: 'rgba(22,119,255,.3)',
    meterBg: '#f2f4f7', meterBorder: '#dfe3e8', meterPeak: '#5a6472', meterTick: '#b6bcc6',
    ch: { L: '#0e7490', R: '#b45309', M: '#334155' },
    chRGB: { L: '14,116,144', R: '180,83,9', M: '51,65,85' },
    heatBase: .05, heatSpan: .8, cellAlpha: .9, envAlpha: .9, headAlpha: .35,
    chartGridH: '#e6e6e6', chartGridV: '#efefef', tagText: '#ffffff',
    glow: false, text: '#252525', text2: 'rgba(0,0,0,.6)', text3: 'rgba(0,0,0,.42)', crosshairBg: '#5a6472',
    poster: { bg: '#ffffff', panel: '#fafbfc', text: '#252525', sub: 'rgba(0,0,0,.6)', faint: 'rgba(0,0,0,.42)', line: '#ebebeb', chartBg: '#fdfdfe' }
  },
  dark: {
    canvasBg: '#101318', panelBg: '#15191f', panelBorder: '#252b35', mainAccent: '#4f8bff',
    gridMajor: 'rgba(255,255,255,.105)', gridMinor: 'rgba(255,255,255,.05)',
    timeMajor: 'rgba(255,255,255,.09)', timeMinor: 'rgba(255,255,255,.045)',
    tickMajor: '#6b7482', tickMinor: '#414855',
    up: '#ff4d35', down: '#00c285', hot: '#ffc24d', neutral: 'rgba(255,255,255,.4)',
    thick: '#5f9bff', thin: '#ffc24d',
    playhead: 'rgba(180,205,235,.5)', cursorLine: 'rgba(95,155,255,.5)', cursorTag: '#5f9bff',
    beat: 'rgba(95,155,255,.14)', beatStrong: 'rgba(95,155,255,.3)', beatSoft: 'rgba(95,155,255,.28)',
    meterBg: '#0c0f14', meterBorder: '#252b35', meterPeak: '#e8e9ec', meterTick: '#3a424f',
    ch: { L: '#22b8d4', R: '#f59f4a', M: '#8fa0bd' },
    chRGB: { L: '34,184,212', R: '245,159,74', M: '143,160,189' },
    heatBase: .07, heatSpan: .85, cellAlpha: .92, envAlpha: .95, headAlpha: .45,
    chartGridH: '#242a34', chartGridV: '#1d222a', tagText: '#0c0f14',
    glow: true, text: '#e8e9ec', text2: 'rgba(255,255,255,.62)', text3: 'rgba(255,255,255,.38)', crosshairBg: '#3a424f',
    poster: { bg: '#101318', panel: '#15191f', text: '#e8e9ec', sub: 'rgba(255,255,255,.62)', faint: 'rgba(255,255,255,.38)', line: '#2b2d34', chartBg: '#15191f' }
  }
};
let palCache = null, palKey = '';
function pal() {
  const theme = state.stageMode === '3d' ? 'dark' : state.theme;
  const key = [theme, state.upIsRed ? 1 : 0, state.showGlow ? 1 : 0, state.heatGain].join('|');
  if (palCache && palKey === key) return palCache;
  const base = THEMES[theme] || THEMES.light;
  const p = Object.assign({}, base);
  if (!state.upIsRed) { p.up = base.down; p.down = base.up; }
  if (!state.showGlow) p.glow = false;
  p.heatBase = clamp(base.heatBase * state.heatGain, 0.02, 0.35);
  p.heatSpan = clamp(base.heatSpan * state.heatGain, 0.25, 1);
  palCache = p; palKey = key;
  return p;
}
function T() { return pal(); }
function invalidatePalette() {
  palCache = null;
  specCache.L = null; specCache.R = null;
}

function createFrameProcessor(buffer, opts) {
  const o = Object.assign({ N: 2048, hopSec: 0.1, fMin: FREQ_MIN, fMax: FREQ_MAX }, opts || {});
  FREQ_LO = o.fMin; FREQ_HI = o.fMax;
  const sr = buffer.sampleRate, len = buffer.length, nCh = buffer.numberOfChannels;
  const L = buffer.getChannelData(0);
  const R = nCh > 1 ? buffer.getChannelData(1) : L;
  const hop = Math.max(1, Math.floor(sr * o.hopSec));
  const N = o.N;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const tw = makeFFT(N);
  const logMin = Math.log(o.fMin), logMax = Math.log(o.fMax);
  const binBand = new Int16Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) {
    const f = k * sr / N;
    if (f < o.fMin || f > o.fMax) continue;
    const bi = Math.floor((Math.log(f) - logMin) / (logMax - logMin) * BAND_COUNT);
    binBand[k] = clamp(bi, 0, BAND_COUNT - 1);
  }
  const channelSpec = (data, start, count) => {
    const re = new Float32Array(N), im = new Float32Array(N);
    let sq = 0;
    for (let i = 0; i < count; i++) {
      const s = data[start + i];
      re[i] = s * win[i];
      sq += s * s;
    }
    fft(re, im, tw);
    const bands = new Float32Array(BAND_COUNT);
    let sumMag = 0, sumFMag = 0;
    for (let k = 1; k < N / 2; k++) {
      const bi = binBand[k];
      if (bi < 0) continue;
      const p = re[k] * re[k] + im[k] * im[k];
      const mag = Math.sqrt(p);
      const f = k * sr / N;
      sumMag += mag;
      sumFMag += f * mag;
      bands[bi] += p;
    }
    for (let b = 0; b < BAND_COUNT; b++) bands[b] = Math.sqrt(bands[b]);
    return { freq: sumMag ? sumFMag / sumMag : 0, bands, rms: Math.sqrt(sq / Math.max(1, count)) };
  };
  const total = Math.max(0, Math.ceil(len / hop));
  return {
    total, sr, channels: nCh, duration: len / sr, hopSec: hop / sr, N, fMin: o.fMin, fMax: o.fMax,
    at(i) {
      const start = i * hop;
      const count = Math.min(N, len - start);
      const l = channelSpec(L, start, count);
      const r = channelSpec(R, start, count);
      const rms = Math.max(l.rms, r.rms);
      const denom = l.rms + r.rms || 1;
      const freq = (l.freq * l.rms + r.freq * r.rms) / denom;
      const bands = new Float32Array(BAND_COUNT);
      for (let b = 0; b < BAND_COUNT; b++) bands[b] = (l.bands[b] + r.bands[b]) * 0.5;
      return { t: start / sr, freq, freqL: l.freq, freqR: r.freq, bands, bandsL: l.bands, bandsR: r.bands, rms, rmsL: l.rms, rmsR: r.rms };
    },
    finish(frames, smooth) {
      const np = o.normPeak ? 1 : 0.98;
      normalizeField(frames, 'rms', np);
      normalizeField(frames, 'rmsL', np);
      normalizeField(frames, 'rmsR', np);
      for (const f of frames) f.rawRms = f.rms;
      smoothField(frames, 'rms', smooth);
      smoothField(frames, 'rmsL', smooth);
      smoothField(frames, 'rmsR', smooth);
      const sample = new Float32Array(Math.min(frames.length, 512));
      const sampleStep = Math.max(1, Math.floor(frames.length / sample.length));
      for (const key of ['bandsL', 'bandsR']) {
        for (let b = 0; b < BAND_COUNT; b++) {
          let m = 0;
          for (let i = 0; i < frames.length; i += sampleStep) sample[m++] = frames[i][key][b];
          const vals = sample.subarray(0, m);
          vals.sort((x, y) => x - y);
          const ref = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))] || 0;
          const scale = ref > 1e-6 ? 100 / ref : 0;
          for (const f of frames) f[key][b] = clamp(f[key][b] * scale, 0, 100);
          let prev = frames.length ? frames[0][key][b] : 0;
          for (const f of frames) {
            prev = prev * smooth + f[key][b] * (1 - smooth);
            f[key][b] = prev;
          }
        }
      }
      for (const f of frames) {
        for (let b = 0; b < BAND_COUNT; b++) f.bands[b] = (f.bandsL[b] + f.bandsR[b]) * 0.5;
      }
      let prevF = frames.length ? frames[0].freq : 0;
      for (const f of frames) {
        prevF = prevF * smooth + f.freq * (1 - smooth);
        f.freq = clamp(prevF, 20, 20000);
      }
      return {
        frames, smooth, sr: this.sr, channels: this.channels, duration: this.duration,
        hopSec: this.hopSec, fMin: this.fMin, fMax: this.fMax, fftSize: this.N, bpm: detectBpm(frames)
      };
    }
  };
}

function setLoadStage(text) {
  state.loadStage = text || '';
  const bar = $('loadBar'), txt = $('loadBarText'), fill = $('loadBarFill');
  if (bar) {
    bar.hidden = !text;
    bar.classList.toggle('indet', !!text);
  }
  if (fill) fill.style.width = text ? '0%' : '0%';
  if (txt) txt.textContent = text || '';
  const sub = $('startSub'), ov = $('startOverlay');
  if (text && sub && ov && !ov.classList.contains('hidden')) sub.textContent = text;
}
function setAnalyzeProgress(p) {
  const el = $('mAnalyze');
  const bar = $('loadBar'), fill = $('loadBarFill'), txt = $('loadBarText');
  if (p == null) {
    if (el) el.textContent = '就绪';
    if (bar) { bar.hidden = true; bar.classList.remove('indet'); }
    if (fill) fill.style.width = '0%';
    if (txt) txt.textContent = '';
    state.loadStage = '';
    return;
  }
  const pct = Math.round(clamp(p, 0, 1) * 100);
  if (el) el.textContent = p >= 1 ? '完成' : '分析中 ' + pct + '%';
  if (bar) { bar.hidden = false; bar.classList.remove('indet'); }
  if (fill) fill.style.width = pct + '%';
  if (txt) txt.textContent = '分析音频 ' + pct + '%';
  const sub = $('startSub'), ov = $('startOverlay');
  if (sub && ov && !ov.classList.contains('hidden')) sub.textContent = '分析音频… ' + pct + '%';
}
/* 分析跑在 Web Worker 里（file:// 下用 Blob URL 起线程）；失败则回落主线程 */
const analysisBoot = `
var job = null;
onmessage = function (e) {
  var d = e.data;
  if (d.type === 'init') {
    job = { id: d.id, len: d.len, rate: d.sampleRate, smooth: d.smooth, opts: d.opts, ch: d.channels, at: 0,
            L: new Float32Array(d.len), R: d.channels > 1 ? new Float32Array(d.len) : null };
    return;
  }
  if (!job || d.id !== job.id) return;
  if (d.type === 'chunk') {
    job.L.set(d.a, job.at);
    if (job.R && d.b) job.R.set(d.b, job.at);
    job.at += d.a.length;
    return;
  }
  if (d.type !== 'run') return;
  try {
    var buf = { sampleRate: job.rate, length: job.len, numberOfChannels: job.ch, getChannelData: function (i) { return i ? job.R : job.L; } };
    var p = createFrameProcessor(buf, job.opts);
    var frames = new Array(p.total);
    for (var i = 0; i < p.total; i++) {
      frames[i] = p.at(i);
      if ((i & 127) === 0) postMessage({ id: job.id, type: 'progress', p: i / p.total });
    }
    var res = p.finish(frames, job.smooth);
    var bt = analyzeBeats(buf);
    if (bt.bpm) { res.bpm = bt.bpm; res.beatPhase = bt.phase; res.beatConf = bt.conf; }
    res.onsets = bt.onsets || [];
    job = null;
    postMessage({ id: d.id, type: 'done', result: res });
  } catch (err) {
    postMessage({ id: d.id, type: 'error', message: String((err && err.message) || err) });
  }
};
`;
function analysisWorkerSource() {
  return [
    'const FREQ_MIN = 40, FREQ_MAX = 12000;',
    'let FREQ_LO = FREQ_MIN, FREQ_HI = FREQ_MAX;',
    'const BAND_COUNT = 512;',
    'const clamp = ' + clamp.toString() + ';',
    makeFFT.toString(),
    fft.toString(),
    normalizeField.toString(),
    smoothField.toString(),
    detectBpm.toString(),
    createFrameProcessor.toString(),
    analyzeBeats.toString(),
    analysisBoot
  ].join(String.fromCharCode(10));
}
function getAnalysisWorker() {
  if (state.analysisWorker !== undefined) return state.analysisWorker;
  state.analysisWorker = null;
  try {
    const url = URL.createObjectURL(new Blob([analysisWorkerSource()], { type: 'text/javascript' }));
    state.analysisWorker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn('analysis worker 不可用，回落到主线程', e);
  }
  return state.analysisWorker;
}
let analysisSeq = 0;
let analysisPending = null;
function cancelAnalysis() {
  if (!analysisPending) return;
  const rej = analysisPending;
  analysisPending = null;
  try { rej(new Error('cancelled')); } catch (e) {}
}
/* 分块传输：每块 2s，块间让出主线程，避免一次拷 100MB 造成长卡顿 */
async function runAnalysisWorker(buffer, opts) {
  const w = getAnalysisWorker();
  if (!w) return null;
  const id = ++analysisSeq;
  const len = buffer.length;
  const channels = buffer.numberOfChannels > 1 ? 2 : 1;
  const chL = buffer.getChannelData(0);
  const chR = channels > 1 ? buffer.getChannelData(1) : null;
  const done = new Promise((resolve, reject) => {
    const onMsg = ev => {
      const m = ev.data;
      if (!m || m.id !== id) return;
      if (m.type === 'progress') { setAnalyzeProgress(m.p); return; }
      w.removeEventListener('message', onMsg);
      if (analysisPending === reject) analysisPending = null;
      if (m.type === 'done') resolve(m.result);
      else reject(new Error(m.message || 'worker error'));
    };
    w.addEventListener('message', onMsg);
    analysisPending = reject;
  });
  w.postMessage({ id, type: 'init', len, sampleRate: buffer.sampleRate, smooth: state.musicSmooth, opts, channels });
  const CH = Math.round(buffer.sampleRate * 2);
  for (let off = 0; off < len; off += CH) {
    const n = Math.min(CH, len - off);
    const a = new Float32Array(n);
    a.set(chL.subarray(off, off + n));
    let b = null;
    if (chR) { b = new Float32Array(n); b.set(chR.subarray(off, off + n)); }
    w.postMessage({ id, type: 'chunk', a, b }, b ? [a.buffer, b.buffer] : [a.buffer]);
    if (off % (CH * 8) === 0) await new Promise(r => setTimeout(r, 0));
  }
  w.postMessage({ id, type: 'run' });
  return done;
}
async function runAnalysis(buffer) {
  setAnalyzeProgress(0);
  const range = state.freqOverride ? [state.freqMin, state.freqMax] : (BAND_RANGES[state.bandRange] || BAND_RANGES[1]);
  const opts = { N: state.fftSize, hopSec: state.hopSec, fMin: range[0], fMax: range[1], normPeak: state.normPeak };
  try {
    try {
      const a = await runAnalysisWorker(buffer, opts);
      if (a) return a;
    } catch (err) {
      if (String(err && err.message) === 'cancelled') throw err;
      console.warn('worker 分析失败，回落主线程', err);
    }
    const a = await analyzeBufferAsync(buffer, state.musicSmooth, setAnalyzeProgress, opts);
    const bt = analyzeBeats(buffer);
    if (bt.bpm) { a.bpm = bt.bpm; a.beatPhase = bt.phase; a.beatConf = bt.conf; }
    a.onsets = bt.onsets || [];
    return a;
  } finally {
    setAnalyzeProgress(null);
    invalidatePalette();
  }
}

async function reanalyzeCurrent() {
  if (!state.meta || state.meta.kind !== 'music' || !state.meta.buffer) return false;
  const token = state.loadToken;
  const a = await runAnalysis(state.meta.buffer).catch(() => null);
  if (!a || token !== state.loadToken) return false;
  state.meta.analysis = a;
  state.meta.analysisSmooth = state.musicSmooth;
  state.meta.bpm = a.bpm;
  state.meta.beatPhase = a.beatPhase || 0;
  state.meta.beatConf = a.beatConf || 0;
  state.meta.onsets = a.onsets || [];
  const t = state.musicAudio ? state.musicAudio.currentTime : 0;
  rebuildMusic(state.musicWindow);
  if (state.musicAudio) state.musicAudio.currentTime = t;
  state.playhead = t / state.musicWindow;
  drawMusic(true);
  syncChart(true);
  updateAllUI(true);
  updateStaticInfo();
  return true;
}

function analyzeBuffer(buffer, smooth, opts) {
  const p = createFrameProcessor(buffer, opts);
  const frames = [];
  for (let i = 0; i < p.total; i++) frames.push(p.at(i));
  return p.finish(frames, smooth);
}

/* 分片分析：每片约 55ms 后让出主线程，长音频不卡界面并给出进度 */
function analyzeBufferAsync(buffer, smooth, onProgress, opts) {
  return new Promise(resolve => {
    const p = createFrameProcessor(buffer, opts);
    const frames = [];
    let i = 0;
    (function slice() {
      const t0 = performance.now();
      while (i < p.total && performance.now() - t0 < 55) frames.push(p.at(i++));
      if (onProgress) onProgress(i / p.total);
      if (i < p.total) setTimeout(slice, 0);
      else resolve(p.finish(frames, smooth));
    })();
  });
}

function buildFrequencySeries(frames, windowSec, duration, opts) {
  const getF = (opts && opts.getF) || (f => f.freq);
  const getV = (opts && opts.getV) || (f => f.rms);
  const series = [];
  const n = Math.max(1, Math.ceil(duration / windowSec - 1e-9));
  const acc = new Array(n);
  /* 每帧只归属一个窗口（含浮点容差），避免小窗口时出现空 K 线 */
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k];
    const fv = getF(f) || 0;
    const wi = clamp(Math.floor(f.t / windowSec + 1e-9), 0, n - 1);
    let a = acc[wi];
    if (!a) {
      a = acc[wi] = { o: fv, c: fv, hi: fv, lo: fv, vmax: getV(f), sum: fv, cnt: 1 };
    } else {
      a.c = fv;
      if (fv > a.hi) a.hi = fv;
      if (fv < a.lo) a.lo = fv;
      if (getV(f) > a.vmax) a.vmax = getV(f);
      a.sum += fv;
      a.cnt++;
    }
  }
  let prevVmax = null;
  let lastC = null;
  for (let i = 0; i < n; i++) {
    let a = acc[i];
    if (!a) {
      if (lastC == null) continue;
      a = { o: lastC, c: lastC, hi: lastC, lo: lastC, vmax: 0, sum: lastC, cnt: 1, empty: true };
    }
    lastC = a.c;
    const colorUp = prevVmax == null ? true : a.vmax >= prevVmax;
    const t0 = i * windowSec;
    series.push([
      fmtTime(t0), Math.round(a.o), Math.round(a.hi), Math.round(a.lo), Math.round(a.c),
      round1(a.vmax), t0, Math.round(a.sum / a.cnt), colorUp ? 1 : 0
    ]);
    prevVmax = a.vmax;
  }
  return series;
}

function buildFrequencyLines(frames, series, thickSec, thinSec, windowSec) {
  const thick = [], thin = [];
  for (const c of series) {
    const end = c[6] + windowSec;
    let sum = 0, cnt = 0, mx = 0;
    for (const f of frames) {
      if (f.t < end - thinSec || f.t > end) continue;
      if (f.freq > mx) mx = f.freq;
      if (f.t >= end - thickSec) { sum += f.freq; cnt++; }
    }
    thick.push(cnt ? sum / cnt : c[7]);
    thin.push(mx || c[2]);
  }
  return { thick, thin };
}

/* 左右声道一趟构建：窗口用游标推进，保留每根谱线的 OHLC（首帧/末帧/窗内峰谷） */
function buildSpectrumPair(frames, rows, step, duration) {
  const L = [], R = [];
  if (!frames.length || !rows) return { L, R };
  const n = Math.max(1, Math.ceil(duration / step));
  const bounds = bandBounds(rows, state.freqAxis);
  const maxL = new Float32Array(BAND_COUNT), minL = new Float32Array(BAND_COUNT);
  const maxR = new Float32Array(BAND_COUNT), minR = new Float32Array(BAND_COUNT);
  let prevL = null, prevR = null, cursor = 0;
  for (let i = 0; i < n; i++) {
    const t0 = i * step, t1 = Math.min(duration, t0 + step);
    while (cursor < frames.length && frames[cursor].t < t0 - 1e-9) cursor++;
    let cnt = 0, vL = 0, vR = 0, first = null;
    for (let k = cursor; k < frames.length; k++) {
      const f = frames[k];
      if (f.t >= t1) break;
      const bl = f.bandsL, br = f.bandsR;
      if (!cnt) {
        maxL.set(bl); minL.set(bl); maxR.set(br); minR.set(br);
        first = f;
      } else {
        for (let b = 0; b < BAND_COUNT; b++) {
          if (bl[b] > maxL[b]) maxL[b] = bl[b];
          if (bl[b] < minL[b]) minL[b] = bl[b];
          if (br[b] > maxR[b]) maxR[b] = br[b];
          if (br[b] < minR[b]) minR[b] = br[b];
        }
      }
      if (f.rmsL > vL) vL = f.rmsL;
      if (f.rmsR > vR) vR = f.rmsR;
      cnt++;
      cursor = k + 1;
    }
    if (!cnt) continue;
    const last = frames[cursor - 1];
    const bandsL = [], bandsR = [];
    for (let k = 0; k < rows; k++) {
      const a = bounds[k], bnd = Math.max(a + 1, bounds[k + 1]), width = bnd - a;
      let sF = 0, sC = 0, sH = 0, sLo = 0, sF2 = 0, sC2 = 0, sH2 = 0, sLo2 = 0;
      for (let b = a; b < bnd; b++) {
        sF += first.bandsL[b]; sH += maxL[b]; sLo += minL[b]; sC += last.bandsL[b];
        sF2 += first.bandsR[b]; sH2 += maxR[b]; sLo2 += minR[b]; sC2 += last.bandsR[b];
      }
      const oL = sF / width, cL = sC / width;
      const oR = sF2 / width, cR = sC2 / width;
      bandsL.push([oL, Math.max(sH / width, oL, cL), Math.min(sLo / width, oL, cL), cL]);
      bandsR.push([oR, Math.max(sH2 / width, oR, cR), Math.min(sLo2 / width, oR, cR), cR]);
    }
    L.push({ t: t0, bands: bandsL, colorUp: prevL == null ? true : vL >= prevL, v: vL });
    R.push({ t: t0, bands: bandsR, colorUp: prevR == null ? true : vR >= prevR, v: vR });
    prevL = vL; prevR = vR;
  }
  return { L, R };
}

function buildMusicChapters(meta, frames, series, windowSec) {
  const chapters = [];
  if (meta.sections && meta.sections.length) {
    for (const s of meta.sections) {
      const idx = clamp(Math.floor(s.t / windowSec), 0, series.length - 1);
      chapters.push({
        date: fmtTime(s.t), title: s.title, desc: s.desc || '',
        price: series[idx][4], move: series[idx][8] ? 1 : -1, idx, time: s.t
      });
    }
  } else {
    const peaks = [];
    for (let i = 2; i < frames.length - 2; i++) {
      const e = frames[i].rms;
      if (e > frames[i - 1].rms && e >= frames[i + 1].rms && e > 55) peaks.push({ t: frames[i].t, e });
    }
    peaks.sort((a, b) => b.e - a.e);
    const picked = [];
    for (const p of peaks) {
      if (picked.every(x => Math.abs(x.t - p.t) > 2)) picked.push(p);
      if (picked.length >= 6) break;
    }
    picked.sort((a, b) => a.t - b.t);
    picked.forEach((p, i) => {
      const idx = clamp(Math.floor(p.t / windowSec), 0, series.length - 1);
      chapters.push({
        date: fmtTime(p.t), title: '音量峰值 ' + (i + 1), desc: '',
        price: series[idx][4], move: series[idx][8] ? 1 : -1, idx, time: p.t
      });
    });
  }
  return chapters;
}

function resizeMusicCanvas() {
  const cv = $('musicCanvas'), wrap = $('chartWrap');
  if (!cv || !wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(20, wrap.clientWidth), h = Math.max(20, wrap.clientHeight);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.mCanvas = { w, h };
  drawWaveStrip();
}

const GUT_W = 50;
const GUT_METER = 32;

function freqFrac(f) {
  const lo = FREQ_LO, hi = FREQ_HI;
  if (state.freqAxis === 'linear') return clamp((clamp(f, lo, hi) - lo) / (hi - lo), 0, 1);
  return clamp(Math.log(clamp(f, lo, hi) / lo) / Math.log(hi / lo), 0, 1);
}
/* 谱线 -> 频带边界：log = 等比（默认），linear = 等宽（低频细节多） */
function bandBounds(rows, mode) {
  const b = new Int32Array(rows + 1);
  if (mode === 'linear') {
    const ratio = FREQ_HI / FREQ_LO;
    for (let k = 0; k <= rows; k++) {
      const f = FREQ_LO + (k / rows) * (FREQ_HI - FREQ_LO);
      b[k] = Math.round(Math.log(f / FREQ_LO) / Math.log(ratio) * BAND_COUNT);
    }
  } else {
    for (let k = 0; k <= rows; k++) b[k] = Math.floor(k * BAND_COUNT / rows);
  }
  for (let k = 1; k <= rows; k++) b[k] = Math.max(b[k], b[k - 1] + 1);
  if (b[rows] > BAND_COUNT) {
    b[rows] = BAND_COUNT;
    for (let k = rows - 1; k >= 0; k--) b[k] = Math.min(b[k], b[k + 1] - 1);
  }
  return b;
}
/* 振幅 -> 0..1：linear 直接比例，db 用 60dB 对数窗口（安静细节更清楚） */
function ampFrac(v) {
  const x = clamp(v, 0, 100) / 100;
  if (state.ampScale !== 'db') return x;
  return clamp((20 * Math.log10(Math.max(x, 1e-4)) + 60) / 60, 0, 1);
}

function panelFrame(ctx, x, y, w, h, accent) {
  const t = T();
  if (state.stageMode !== '3d') {
    ctx.fillStyle = t.panelBg;
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, y, 3, h);
  ctx.globalAlpha = 0.12;
  ctx.fillRect(x + 3, y, 2, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = t.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/* 纸面栅格：24px 点阵 + 120px 主格线，预渲染成层，每帧只 blit 一次 */
const paperGridCache = { key: '', cv: null };
function paperGridLayer(w, h) {
  const dark = state.theme === 'dark' || state.stageMode === '3d';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = [w, h, dark ? 'd' : 'l', dpr].join('|');
  if (paperGridCache.key === key) return paperGridCache.cv;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const step = 24, major = step * 5;
  c.fillStyle = dark ? 'rgba(200,220,255,.06)' : 'rgba(30,60,110,.06)';
  for (let y = step; y < h; y += step) {
    for (let x = step; x < w; x += step) c.fillRect(x, y, 1, 1);
  }
  c.strokeStyle = dark ? 'rgba(200,220,255,.085)' : 'rgba(30,60,110,.075)';
  c.lineWidth = 1;
  c.beginPath();
  for (let x = major; x < w; x += major) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
  for (let y = major; y < h; y += major) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
  c.stroke();
  paperGridCache.key = key;
  paperGridCache.cv = cv;
  return cv;
}
function drawPaperGrid(ctx, w, h) {
  if (w < 8 || h < 8) return;
  const layer = paperGridLayer(w, h);
  ctx.drawImage(layer, 0, 0, w, h);
}

function updateMeter(ch, now) {
  const m = state.meters[ch] || (state.meters[ch] = { v: 0, p: 0, pt: 0 });
  const f = frameAt(now);
  const target = f ? (ch === 'R' ? f.rmsR : ch === 'L' ? f.rmsL : f.rms) : 0;
  m.v += (target - m.v) * (target > m.v ? 0.6 : 0.11);
  if (m.v >= m.p) { m.p = m.v; m.pt = now; }
  else if (now - m.pt > 1.0) m.p = Math.max(m.v, m.p - 0.9);
  return m;
}

function drawMeter(ctx, x, y, h, ch) {
  const t = T();
  const m = state.meters[ch] || { v: 0, p: 0 };
  const w = 14;
  ctx.fillStyle = t.meterBg;
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.strokeStyle = t.meterBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 2.5, w - 1, h - 5);
  const seg = 3, gap = 1;
  const usable = h - 6;
  const lvl = clamp(m.v, 0, 100) / 100;
  const lit = Math.floor(usable * lvl / (seg + gap));
  for (let i = 0; i < lit; i++) {
    const yy = y + h - 3 - (i + 1) * (seg + gap) + gap;
    const ratio = (i + 1) / Math.max(1, usable / (seg + gap));
    ctx.fillStyle = ratio > 0.88 ? t.up : ratio > 0.7 ? t.hot : t.down;
    ctx.fillRect(x + 2, yy, w - 4, seg);
  }
  const py = y + h - 3 - usable * clamp(m.p, 0, 100) / 100;
  ctx.fillStyle = t.meterPeak;
  ctx.fillRect(x + 2, Math.max(y + 3, py - 1), w - 4, 2);
  ctx.strokeStyle = t.meterTick;
  for (const tk of [1, 0.72, 0.45, 0.22]) {
    const yy = Math.round(y + h - 3 - usable * tk) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x + w + 1, yy);
    ctx.lineTo(x + w + 5, yy);
    ctx.stroke();
  }
  ctx.fillStyle = t.ch[ch];
  ctx.fillRect(x + 2, y + h - 2, w - 4, 2);
}

/* 频谱面板离屏缓存：滚动按半屏分块重绘，其余帧只做一次 drawImage + 播放头遮罩 */
const specCache = { L: null, R: null };

function renderSpectrumTile(lctx, lw, lh, t0, t1, pxPerSec, cols, rows, ch) {
  const t = T();
  const step = state.spectrumStep || 0.5;
  lctx.fillStyle = t.panelBg;
  lctx.fillRect(0, 0, lw, lh);
  const hz = [60, 125, 250, 500, 1000, 2000, 4000, 8000];
  lctx.lineWidth = 1;
  for (const f of hz) {
    const yy = lh - freqFrac(f) * lh;
    lctx.strokeStyle = (f === 250 || f === 1000 || f === 4000) ? t.gridMajor : t.gridMinor;
    lctx.beginPath();
    lctx.moveTo(0, Math.round(yy) + 0.5);
    lctx.lineTo(lw, Math.round(yy) + 0.5);
    lctx.stroke();
  }
  for (let s = Math.ceil(t0); s <= t1; s++) {
    const xx = (s - t0) * pxPerSec;
    lctx.strokeStyle = s % 5 === 0 ? t.timeMajor : t.timeMinor;
    lctx.beginPath();
    lctx.moveTo(Math.round(xx) + 0.5, 2);
    lctx.lineTo(Math.round(xx) + 0.5, lh - 2);
    lctx.stroke();
  }
  const rowH = (lh - 6) / rows;
  const colW = step * pxPerSec;
  const cw = Math.max(1, Math.min(colW * 1.08, 30));
  const candleMode = rowH >= 2.1;
  if (t.glow && candleMode) lctx.shadowBlur = 4;
  for (const col of cols) {
    if (col.t + step < t0 || col.t > t1) continue;
    const x = (col.t + step / 2 - t0) * pxPerSec;
    if (x < -8 || x > lw + 8) continue;
    const color = col.colorUp ? t.up : t.down;
    lctx.fillStyle = color;
    lctx.strokeStyle = color;
    if (t.glow && candleMode) lctx.shadowColor = color;
    for (let k = 0; k < rows; k++) {
      const b = col.bands[k];
      if (!b) continue;
      const rowBottom = lh - 3 - k * rowH;
      if (!candleMode) {
        lctx.globalAlpha = t.heatBase + t.heatSpan * ampFrac(b[3]);
        lctx.fillRect(x - cw / 2, rowBottom - Math.max(1, rowH), cw, Math.max(1, rowH - 0.4));
      } else {
        const yv = v => rowBottom - 1 - ampFrac(v) * Math.max(1, rowH - 2);
        const yO = yv(b[0]), yC = yv(b[3]), yH = yv(b[1]), yL = yv(b[2]);
        lctx.globalAlpha = t.cellAlpha;
        lctx.lineWidth = 1;
        lctx.beginPath();
        lctx.moveTo(x, yH);
        lctx.lineTo(x, yL);
        lctx.stroke();
        lctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
      }
    }
  }
  lctx.shadowBlur = 0;
  lctx.globalAlpha = 1;
  lctx.beginPath();
  let started = false;
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci];
    if (col.t + step < t0 || col.t > t1) continue;
    const x = (col.t + step / 2 - t0) * pxPerSec;
    if (x < -8 || x > lw + 8) continue;
    const pv = cols[ci - 1] ? cols[ci - 1].v : col.v;
    const nv = cols[ci + 1] ? cols[ci + 1].v : col.v;
    const env = pv * 0.25 + col.v * 0.5 + nv * 0.25;
    const yy = lh - 3 - (clamp(env, 0, 100) / 100) * (lh - 8);
    if (!started) { lctx.moveTo(x, yy); started = true; } else lctx.lineTo(x, yy);
  }
  if (started && state.showEnvelope) {
    lctx.strokeStyle = t.ch[ch];
    lctx.lineWidth = 1.5;
    lctx.globalAlpha = t.envAlpha;
    lctx.stroke();
    lctx.globalAlpha = 1;
  }
}

/* 副图 K 线：该声道谱心随时间的 K 线，观感与主图一致 */
function drawChannelCandles(ctx, pw, y, h, now, start, span, series, ch) {
  if (!series || !series.length) return;
  const t = T();
  if (!state.chScale) state.chScale = { L: { min: 0, max: 0 }, R: { min: 0, max: 0 } };
  const i0 = Math.max(0, idxAt(series, start - span * 0.3) - 1);
  const i1 = Math.min(series.length, idxAt(series, now + 0.001));
  let vmin = Infinity, vmax = -Infinity;
  for (let i = i0; i < i1; i++) {
    const c = series[i];
    if (c[6] > now + 0.001 || c[6] + (span / Math.max(1, series.length)) < start - 1) continue;
    if (c[3] < vmin) vmin = c[3];
    if (c[2] > vmax) vmax = c[2];
  }
  if (!isFinite(vmin) || !isFinite(vmax) || vmin <= 0) { vmin = 120; vmax = 2400; }
  vmin = Math.max(20, vmin * 0.86);
  vmax = Math.max(vmin * 1.3, vmax * 1.14);
  const s = state.chScale[ch];
  if (!s.max) { s.min = vmin; s.max = vmax; }
  const k = 0.2;
  s.min = Math.min(vmin, Math.exp(Math.log(s.min) * (1 - k) + Math.log(vmin) * k));
  s.max = Math.max(vmax, Math.exp(Math.log(s.max) * (1 - k) + Math.log(vmax) * k));
  const lmin = Math.log(s.min), lmax = Math.log(s.max);
  const yOf = f => y + h - 5 - clamp((lmax - Math.log(clamp(f, s.min, s.max))) / (lmax - lmin), 0, 1) * (h - 10);
  ctx.strokeStyle = t.gridMinor;
  for (const f of [125, 500, 2000, 8000]) {
    if (f < s.min || f > s.max) continue;
    const yy = Math.round(yOf(f)) + 0.5;
    if (yy < y + 6 || yy > y + h - 4) continue;
    ctx.beginPath();
    ctx.moveTo(5, yy);
    ctx.lineTo(pw, yy);
    ctx.stroke();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(5, y + 1, pw - 5, h - 2);
  ctx.clip();
  for (let i = i0; i < i1; i++) {
    const c = series[i];
    if (c[6] > now + 0.001 || c[6] + 1 < start - span * 0.2) continue;
    const slotW = (state.musicWindow / span) * pw;
    const bw = Math.max(1, Math.min(16, slotW * (state.barGap || 0.72)));
    const x = 5 + ((c[6] + state.musicWindow / 2 - start) / span) * (pw - 5);
    if (x < 0 || x > pw) continue;
    const col = c[8] ? t.up : t.down;
    const age = now - c[6];
    const grow = age < 0.3 ? clamp(age / 0.3, 0, 1) : 1;
    let yO = yOf(c[1]), yC = yOf(c[4]), yH = yOf(c[2]), yL = yOf(c[3]);
    if (grow < 1) {
      yO = yC + (yO - yC) * grow;
      yH = yC + (yH - yC) * grow;
      yL = yC + (yL - yC) * grow;
      ctx.globalAlpha = 0.15 + 0.85 * grow;
    }
    catmullBody(ctx, x, bw, yO, yC, yH, yL, col, state.chartType === 'hollow', h);
    if (grow < 1) ctx.globalAlpha = 1;
  }
  /* 收盘均线：把零散的小实体串成趋势 */
  ctx.beginPath();
  let maStarted = false, maSum = 0;
  const MA_N = 5;
  for (let i = Math.max(0, i0 - MA_N); i < i1; i++) {
    const c = series[i];
    maSum += c[4];
    if (i - MA_N >= 0) maSum -= series[i - MA_N][4];
    if (i < MA_N - 1 || i < i0) continue;
    if (c[6] > now + 0.001 || c[6] + 1 < start - span * 0.2) { maStarted = false; continue; }
    const x = 5 + ((c[6] + state.musicWindow / 2 - start) / span) * (pw - 5);
    if (x < 0 || x > pw) { maStarted = false; continue; }
    const yy = yOf(maSum / MA_N);
    if (!maStarted) { ctx.moveTo(x, yy); maStarted = true; } else ctx.lineTo(x, yy);
  }
  ctx.strokeStyle = t.ch[ch];
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.font = '9px Consolas';
  ctx.textAlign = 'right';
  ctx.fillStyle = t.text3;
  for (const f of [125, 500, 2000, 8000]) {
    if (f < s.min || f > s.max) continue;
    const yy = yOf(f);
    if (yy < y + 6 || yy > y + h - 4) continue;
    ctx.fillText(hzLabel(f), pw - 3, yy - 2);
  }
  /* 最新一根的数值签 */
  for (let i = series.length - 1; i >= 0; i--) {
    const c = series[i];
    if (c[6] > now + 0.001) continue;
    const yy = clamp(yOf(c[4]) - 7, y + 1, y + h - 15);
    ctx.fillStyle = c[8] ? t.up : t.down;
    ctx.beginPath();
    ctx.roundRect(pw + 2, yy, 28, 14, 2);
    ctx.fill();
    ctx.fillStyle = t.tagText;
    ctx.textAlign = 'center';
    ctx.font = 'bold 9px Consolas';
    ctx.fillText(hzLabel(c[4]), pw + 16, yy + 10);
    ctx.textAlign = 'left';
    break;
  }
  ctx.textAlign = 'left';
  if (h > 56) {
    const lab = (ch === 'L' ? '左声道' : '右声道') + ' · 谱心K';
    ctx.font = '9px "Microsoft YaHei", sans-serif';
    const lw2 = ctx.measureText(lab).width;
    ctx.fillStyle = t.panelBg;
    ctx.globalAlpha = 0.82;
    ctx.fillRect(8, y + 3, lw2 + 10, 13);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(' + t.chRGB[ch] + ',.95)';
    ctx.fillText(lab, 13, y + 12);
  }
}
function catmullBody(ctx, x, bw, yO, yC, yH, yL, col, hollow, h) {
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, yH);
  ctx.lineTo(x, yL);
  ctx.stroke();
  const bodyY = Math.min(yO, yC);
  const bodyH = Math.max(1, Math.abs(yC - yO));
  if (hollow && bw >= 3) {
    ctx.fillRect(x - bw / 2, bodyY, bw, Math.min(1, bodyH));
    ctx.fillRect(x - bw / 2, bodyY + bodyH - 1, bw, 1);
    ctx.fillRect(x - bw / 2, bodyY, 1, bodyH);
    ctx.fillRect(x + bw / 2 - 1, bodyY, 1, bodyH);
  } else {
    ctx.fillRect(x - bw / 2, bodyY, bw, bodyH);
  }
}
function drawSpectrumPane(ctx, pw, y, h, now, start, span, cols, rows, ch) {
  if (!rows || !cols) return;
  const t = T();
  const step = state.spectrumStep || 0.5;
  const spanQ = Math.max(1, Math.round(span * 10) / 10);
  const pxPerSec = (pw - 5) / spanQ;
  const chunkSec = spanQ * 0.5;
  const tileIdx = Math.max(0, Math.floor(start / chunkSec));
  const t0 = tileIdx * chunkSec;
  const t1 = t0 + spanQ * 2;
  const lw = Math.max(64, Math.ceil((t1 - t0) * pxPerSec));
  const lh = Math.max(24, Math.ceil(h));
  const stype = ch === 'L' ? state.specTypeL : state.specTypeR;
  let c = null, dx = 0;
  if (stype === 'heat') {
    const key = [tileIdx, spanQ, pw, h, rows, step, state.theme, state.freqAxis, state.ampScale, state.heatGain].join('|');
    c = specCache[ch];
    if (!c || c.key !== key) {
      if (!c || c.cv.width !== lw || c.cv.height !== lh) {
        const cv = document.createElement('canvas');
        cv.width = lw; cv.height = lh;
        c = specCache[ch] = { cv, ctx: cv.getContext('2d') };
      }
      c.key = key; c.t0 = t0; c.pxPerSec = pxPerSec;
      renderSpectrumTile(c.ctx, lw, lh, t0, t1, pxPerSec, cols, rows, ch);
    }
    dx = (c.t0 - start) * c.pxPerSec + 5;
  }
  panelFrame(ctx, 0, y, pw, h, t.ch[ch]);
  if (stype === 'candle') {
    drawChannelCandles(ctx, pw, y, h, now, start, span, ch === 'L' ? state.meta.chL : state.meta.chR, ch);
    drawMeter(ctx, pw + GUT_METER, y, h, ch);
    return;
  }
  const maskW = Math.max(0, Math.min(pw - 5, (now - start + step / 2) * pxPerSec));
  if (stype === 'heat' && c) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(5, y, maskW, h);
    ctx.clip();
    /* 只贴可见且已播放到的那一段，避免整块 2 倍宽缓存图参与合成 */
    const sx0 = clamp(Math.ceil(5 - dx), 0, c.cv.width);
    const sx1 = clamp(Math.floor(maskW - dx), 0, c.cv.width);
    if (sx1 > sx0) ctx.drawImage(c.cv, sx0, 0, sx1 - sx0, c.cv.height, dx + sx0, y, sx1 - sx0, c.cv.height);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(5, y, maskW, Math.max(0, h - 2));
    ctx.clip();
    const bw = Math.max(1, pxPerSec * step * (state.barGap || 0.72));
    const base = y + h - 4;
    if (stype === 'bar') {
      ctx.fillStyle = 'rgba(' + t.chRGB[ch] + ',0.85)';
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        if (!col || col.t > now + step) continue;
        const x = (col.t - start) * pxPerSec + 5 + (step * pxPerSec) / 2;
        if (x < 5 || x > pw) continue;
        const hh = Math.max(1, clamp(col.v, 0, 100) / 100 * (h - 12));
        ctx.fillRect(x - bw / 2, base - hh, bw, hh);
      }
    } else {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        if (!col || col.t > now + step) continue;
        const x = (col.t - start) * pxPerSec + 5 + (step * pxPerSec) / 2;
        if (x < 5 || x > pw) continue;
        const yy = base - clamp(col.v, 0, 100) / 100 * (h - 12);
        if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = 'rgba(' + t.chRGB[ch] + ',0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, pw, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(' + t.chRGB[ch] + ',' + t.headAlpha + ')';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(5, y + 2.5);
  ctx.lineTo(pw, y + 2.5);
  ctx.stroke();
  for (const f of [60, 125, 250, 500, 1000, 2000, 4000, 8000]) {
    const yy = Math.round(y + h - freqFrac(f) * h) + 0.5;
    const major = f === 250 || f === 1000 || f === 4000;
    ctx.strokeStyle = major ? t.tickMajor : t.tickMinor;
    ctx.beginPath();
    ctx.moveTo(pw, yy);
    ctx.lineTo(pw + 3, yy);
    ctx.stroke();
  }
  ctx.restore();
  for (const f of [60, 125, 250, 500, 1000, 2000, 4000, 8000]) {
    const frac = freqFrac(f);
    if (frac <= 0.02 || frac >= 0.98) continue;
    const yy = Math.round(y + h - frac * h) + 0.5;
    ctx.fillStyle = t.text3;
    ctx.font = '9px Consolas';
    ctx.textAlign = 'left';
    ctx.fillText(hzLabel(f), pw + 5, yy + 3);
  }
  ctx.strokeStyle = t.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, y + 0.5, pw - 1, h - 1);
  drawMeter(ctx, pw + GUT_METER, y, h, ch);
}

/* ---------- 频段盘口 / 逐帧明细（同花顺五档盘口与成交明细的音乐映射） ---------- */
const MA_DEFS = [{ n: 5, c: '#f7b500' }, { n: 10, c: '#2f7bff' }, { n: 20, c: '#e05df0' }];
function maClose(arr, idx, n) {
  if (idx < n - 1) return null;
  let sum = 0;
  for (let i = idx - n + 1; i <= idx; i++) sum += arr[i][4];
  return sum / n;
}
/* EMA + 布林带：按 series 缓存，参数变了才重算，绘制每帧只读数组 */
const EMA_COLORS = ['#22d3a6', '#ff8a3d'];
function buildOverlays(force) {
  const s = state.series;
  const n = Math.max(2, Math.round(state.bollN || 20));
  const kk = Number(state.bollK) || 2;
  const pF = Math.max(2, Math.round(state.emaFast || 12));
  const pS = Math.max(3, Math.round(state.emaSlow || 26));
  const key = (s ? s.length : 0) + ':' + (s && s.length ? s[0][0] + '|' + s[s.length - 1][0] : '') + ':' + n + ':' + kk + ':' + pF + ':' + pS;
  if (!force && state.ovl && state.ovlKey === key) return state.ovl;
  const len = s ? s.length : 0;
  const ema = p => {
    const out = new Float32Array(len);
    const a = 2 / (p + 1);
    let prev = len ? s[0][4] : 0;
    for (let i = 0; i < len; i++) {
      prev = i ? s[i][4] * a + prev * (1 - a) : s[i][4];
      out[i] = prev;
    }
    return out;
  };
  const mid = new Float32Array(len), up = new Float32Array(len), lo = new Float32Array(len);
  /* 纵轴是对数频率：在对数空间做均值/标准差，带宽在屏幕上才是对称的 */
  let sum = 0, sum2 = 0;
  for (let i = 0; i < len; i++) {
    const v = Math.log(Math.max(1, s[i][4]));
    sum += v; sum2 += v * v;
    if (i >= n) { const o = Math.log(Math.max(1, s[i - n][4])); sum -= o; sum2 -= o * o; }
    const cnt = Math.min(i + 1, n);
    const m = sum / cnt;
    const sd = Math.sqrt(Math.max(0, sum2 / cnt - m * m));
    mid[i] = Math.exp(m);
    up[i] = Math.exp(m + kk * sd);
    lo[i] = Math.max(1, Math.exp(m - kk * sd));
  }
  const avg = new Float32Array(len);
  let acc = 0;
  for (let i = 0; i < len; i++) { acc += s[i][4]; avg[i] = acc / (i + 1); }
  state.ovl = { emaF: ema(pF), emaS: ema(pS), mid, up, lo, avg };
  state.ovlKey = key;
  return state.ovl;
}
const BOOK_GROUPS = [
  { a: 0, b: 0.2 }, { a: 0.2, b: 0.4 }, { a: 0.4, b: 0.6 }, { a: 0.6, b: 0.8 }, { a: 0.8, b: 1 }
];
const BOOK_NAMES = { music: ['超低频', '低频', '中频', '高频', '超高频'], market: ['微幅', '小波', '中波', '大波', '剧幅'] };
let bookRowsBuilt = false;
const bookPeaks = [0, 0, 0, 0, 0];
function bandToHz(frac) {
  return FREQ_LO * Math.pow(FREQ_HI / FREQ_LO, clamp(frac, 0, 1));
}
function hzLabel(h) {
  return h >= 1000 ? (h / 1000).toFixed(h >= 10000 ? 0 : 1) + 'k' : Math.round(h) + '';
}
function bookNow() {
  return state.mode === 'music' && state.musicAudio ? state.musicAudio.currentTime : 0;
}
function refreshBook() {
  if (!paneIsActive('paneBook')) return;
  tickLast = -1;
  updateBook(bookNow());
  updateTicks(bookNow());
}
function buildBookRows() {
  const box = $('bookRows');
  if (!box) return;
  box.innerHTML = '';
  BOOK_GROUPS.forEach(g => {
    const row = document.createElement('div');
    row.className = 'book-row';
    row.innerHTML =
      '<div class="bk-name"><span class="bk-nm"></span><em></em></div>' +
      '<div class="bk-bar"><i></i><b></b></div>' +
      '<div class="bk-val">--</div>';
    box.appendChild(row);
  });
  bookRowsBuilt = true;
}
function updateBookDepth(vals) {
  const box = $('bookDepth');
  if (!box) return;
  const kids = box.children;
  let total = 0;
  for (const v of vals) total += v;
  for (let i = 0; i < kids.length && i < vals.length; i++) {
    kids[i].style.width = total > 0 ? (vals[i] / total * 100).toFixed(1) + '%' : '0%';
  }
}
function updateBook(now) {
  const box = $('bookRows');
  if (!box) return;
  if (!bookRowsBuilt || box.children.length !== BOOK_GROUPS.length) buildBookRows();
  const rows = box.children;
  if (state.mode !== 'music') {
    const N = state.series.length;
    const lo = clamp(Math.floor(state.playhead - (state.viewSpan || 20)), 0, N - 1);
    const hi = clamp(Math.floor(state.playhead), lo + 1, N - 1);
    const edges = [0.005, 0.01, 0.02, 0.04, Infinity];
    const cnt = [0, 0, 0, 0, 0];
    let total = 0;
    for (let i = lo + 1; i <= hi; i++) {
      const c = state.series[i], p = state.series[i - 1];
      const amp = p[4] ? (c[2] - c[3]) / p[4] : 0;
      let k = 0;
      while (k < 4 && amp >= edges[k]) k++;
      cnt[k]++;
      total++;
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], bar = row.querySelector('.bk-bar i'), pk = row.querySelector('.bk-bar b'), val = row.querySelector('.bk-val');
      row.querySelector('.bk-nm').textContent = (BOOK_NAMES[state.mode === 'music' ? 'music' : 'market'])[i];
      const em = row.querySelector('.bk-name em');
      const loE = i === 0 ? 0 : edges[i - 1];
      em.textContent = i === rows.length - 1 ? '>4%' : (loE * 100).toFixed(1) + '-' + (edges[i] === Infinity ? '∞' : (edges[i] * 100).toFixed(1)) + '%';
      const pct = total ? cnt[i] / total * 100 : 0;
      bookPeaks[i] = Math.max(pct, bookPeaks[i] * 0.97);
      bar.style.width = pct.toFixed(1) + '%';
      pk.style.left = bookPeaks[i].toFixed(1) + '%';
      val.textContent = cnt[i] + ' 根';
    }
    updateBookDepth(cnt);
    const s = $('bookSum');
    if (s) s.innerHTML = '<span>区间 ' + (hi - lo) + ' 根</span><span>均幅 ' + (total ? (ampAvgRange(lo, hi) * 100).toFixed(2) + '%' : '--') + '</span>';
    return;
  }
  const f = frameAt(now);
  let sum = 0;
  const bandVals = [];
  for (let i = 0; i < BOOK_GROUPS.length; i++) {
    const g = BOOK_GROUPS[i], row = rows[i];
    const bar = row.querySelector('.bk-bar i'), pk = row.querySelector('.bk-bar b'), val = row.querySelector('.bk-val');
    row.querySelector('.bk-nm').textContent = BOOK_NAMES.music[i];
    const em = row.querySelector('.bk-name em');
    em.textContent = hzLabel(bandToHz(g.a)) + '-' + hzLabel(bandToHz(g.b)) + 'Hz';
    let v = 0;
    if (f) {
      const a = Math.floor(g.a * BAND_COUNT), b = Math.max(a + 1, Math.floor(g.b * BAND_COUNT));
      let s = 0;
      for (let k = a; k < b; k++) s += f.bands[k];
      v = s / (b - a);
    }
    sum += v;
    bandVals.push(v);
    bookPeaks[i] = Math.max(v, bookPeaks[i] * 0.985);
    bar.style.width = clamp(v, 0, 100).toFixed(1) + '%';
    pk.style.left = clamp(bookPeaks[i], 0, 100).toFixed(1) + '%';
    val.textContent = f ? v.toFixed(0) + '%' : '--';
  }
  updateBookDepth(bandVals);
  const s = $('bookSum');
  if (s) s.innerHTML = '<span>全段均值 ' + (sum / BOOK_GROUPS.length).toFixed(1) + '%</span><span>谱心 ' + (f ? Math.round(f.freq) + ' Hz' : '--') + '</span>';
}
let tickLast = -1;
function ampAvgRange(lo, hi) {
  let s = 0, n = 0;
  for (let i = lo + 1; i <= hi; i++) {
    const c = state.series[i], p = state.series[i - 1];
    if (!p[4]) continue;
    s += (c[2] - c[3]) / p[4];
    n++;
  }
  return n ? s / n : 0;
}
function updateTicks(now) {
  const list = $('tickList');
  if (!list || !state.meta || !state.series.length) return;
  if (state.mode !== 'music') {
    const N = state.series.length;
    const i = clamp(Math.floor(state.playhead), 0, N - 1);
    if (i === tickLast && list.children.length) return;
    tickLast = i;
    const frag = document.createDocumentFragment();
    for (let k = 0; k < 24; k++) {
      const idx = i - k;
      if (idx <= 0) break;
      const c = state.series[idx], p = state.series[idx - 1];
      const pct = p[4] ? (c[4] / p[4] - 1) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'tick-row' + (k === 0 ? ' now' : '');
      row.innerHTML =
        '<span>' + String(c[0]).slice(2) + '</span>' +
        '<span>' + fmtPrice(c[4], state.meta.digits) + '</span>' +
        '<span>' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '</span>' +
        '<span class="tk-dir ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '↑' : '↓') + '</span>';
      frag.appendChild(row);
    }
    list.innerHTML = '';
    list.appendChild(frag);
    return;
  }
  const a = state.meta.analysis;
  if (!a || !a.frames.length) { list.innerHTML = ''; return; }
  const i = clamp(Math.round(now / a.hopSec), 0, a.frames.length - 1);
  if (i === tickLast && list.children.length) return;
  tickLast = i;
  const frag = document.createDocumentFragment();
  for (let k = 0; k < 24; k++) {
    const idx = i - k;
    if (idx < 0) break;
    const f = a.frames[idx], prev = idx > 0 ? a.frames[idx - 1] : f;
    const up = f.rms >= prev.rms;
    const row = document.createElement('div');
    row.className = 'tick-row' + (k === 0 ? ' now' : '');
    row.innerHTML =
      '<span>' + fmtTime(f.t) + (a.hopSec < 1 ? '.' + Math.floor((f.t % 1) * 10) : '') + '</span>' +
      '<span>' + Math.round(f.freq) + ' Hz</span>' +
      '<span>' + f.rms.toFixed(0) + '%</span>' +
      '<span class="tk-dir ' + (up ? 'up' : 'down') + '">' + (up ? '↑' : '↓') + '</span>';
    frag.appendChild(row);
  }
  list.innerHTML = '';
  list.appendChild(frag);
}
function paneGeom(h) {
  const specCount = (state.showSpecL ? 1 : 0) + (state.showSpecR ? 1 : 0);
  const mainH = specCount ? clamp(Math.floor(h * state.splitMain), 90, Math.max(90, h - 100)) : h;
  const gap = 12;
  const specY = mainH + gap;
  const specH = Math.max(40, h - specY);
  const paneGap = 8;
  const subTotal = Math.max(80, specH - paneGap);
  const hL = specCount === 2 ? Math.max(36, Math.floor(subTotal * state.splitSub)) : specH;
  const hR = specCount === 2 ? Math.max(36, subTotal - hL) : specH;
  return { specCount, mainH, gap, specY, specH, paneGap, hL, hR };
}
function musicSpan(now) {
  const v = Math.max(5, state.viewSpan || 20);
  if (!now || now >= v) return v;
  /* 开头不足一屏时按整秒取窗：宽度稳定，谱图缓存不会每帧失效 */
  return Math.max(5, Math.ceil(now));
}

let analyzerRows = null;
/* ---------- 波形条 + A-B 区间（借鉴 wavesurfer.js 的 waveform / regions） ---------- */
function drawWaveStrip() {
  const cv = $('tlWave'), tl = $('timeline');
  if (!cv || !tl) return;
  const t = T();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(20, tl.clientWidth), h = Math.max(12, tl.clientHeight);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const series = state.series;
  if (!state.showStrip) { cv.style.visibility = 'hidden'; ctx.clearRect(0, 0, w, h); return; }
  cv.style.visibility = '';
  if (!series || !series.length || !state.meta) return;
  if (state.mode !== 'music') {
    /* 市场模式：价格线性轴 + K 线柱，已播放实色、未播放淡显 */
    let lo = Infinity, hi = -Infinity;
    for (const c of series) { if (c[3] < lo) lo = c[3]; if (c[2] > hi) hi = c[2]; }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 1;
    const yOf = v => h - 2 - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (h - 5);
    const n = series.length;
    const bw = clamp((w / n) * 0.72, 1, 6);
    const pos = clamp(state.playhead, 0, n - 1);
    for (let i = 0; i < n; i++) {
      const c = series[i];
      const x = (i / Math.max(1, n - 1)) * w;
      ctx.globalAlpha = i <= pos ? 1 : 0.32;
      ctx.strokeStyle = c[8] ? t.up : t.down;
      ctx.fillStyle = ctx.strokeStyle;
      const yO = yOf(c[1]), yC = yOf(c[4]), yH = yOf(c[2]), yL = yOf(c[3]);
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();
      const by = Math.min(yO, yC), bh = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(x - bw / 2, by, bw, bh);
    }
    ctx.globalAlpha = 1;
    const px = (pos / Math.max(1, n - 1)) * w;
    ctx.strokeStyle = t.playhead;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const dur = Math.max(0.001, state.meta.duration || 0);
  const now = state.musicAudio ? state.musicAudio.currentTime : 0;
  let lo = Infinity, hi = -Infinity;
  for (const c of series) { if (c[3] < lo) lo = c[3]; if (c[2] > hi) hi = c[2]; }
  if (!isFinite(lo) || lo <= 0) { lo = 100; hi = 2000; }
  const lmin = Math.log(lo), lmax = Math.log(hi * 1.02);
  const yOf = f => h - 2 - clamp((lmax - Math.log(clamp(f, lo, hi))) / (lmax - lmin || 1), 0, 1) * (h - 5);
  const n = series.length;
  const bw = clamp((w / n) * 0.8, 1.5, 5);
  for (let i = 0; i < n; i++) {
    const c = series[i];
    const x = (c[6] / dur) * w;
    if (x < -bw || x > w + bw) continue;
    const col = c[8] ? t.up : t.down;
    ctx.globalAlpha = c[6] <= now ? 1 : 0.2;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c[2]));
    ctx.lineTo(x, yOf(c[3]));
    ctx.stroke();
    const yO = yOf(c[1]), yC = yOf(c[4]);
    ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1, Math.abs(yC - yO)));
  }
  ctx.globalAlpha = 1;
  const snapNow = state.snapBars ? (Math.floor(now / (state.musicWindow || 0.25)) + 0.5) * (state.musicWindow || 0.25) : now;
  const px = Math.round((snapNow / dur) * w) + 0.5;
  ctx.strokeStyle = t.playhead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, h);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = t.playhead;
  ctx.beginPath();
  ctx.arc(px, 3, 3, 0, Math.PI * 2);
  ctx.fill();
}

function abActive() {
  return state.ab.a != null && state.ab.b != null && state.ab.b - state.ab.a > 0.05;
}

function applyAB() {
  const region = $('tlRegion'), btn = $('btnABClear');
  const dur = (state.meta && state.meta.duration) || 0;
  const on = abActive() && state.mode === 'music' && dur > 0;
  if (region) region.hidden = !on;
  if (btn) btn.hidden = !on;
  if (!on) {
    const el = $('acRange');
    if (el) el.textContent = '未选';
    if ($('acRangeFreq')) $('acRangeFreq').textContent = '--';
    if ($('acRangeVol')) $('acRangeVol').textContent = '--';
    return;
  }
  const a = state.ab.a, b = state.ab.b;
  region.style.left = (a / dur * 100) + '%';
  region.style.width = ((b - a) / dur * 100) + '%';
  const fr = state.meta.analysis.frames;
  let n = 0, sum = 0, mx = 0;
  for (const f of fr) {
    if (f.t < a) continue;
    if (f.t > b) break;
    sum += f.freq; mx = Math.max(mx, f.rms); n++;
  }
  $('acRange').textContent = fmtTime(a) + ' – ' + fmtTime(b) + ' · ' + (b - a).toFixed(1) + 's';
  $('acRangeFreq').textContent = n ? Math.round(sum / n) + ' Hz' : '--';
  $('acRangeVol').textContent = n ? Math.round(mx) + '%' : '--';
}

function clearAB() {
  state.ab.a = null; state.ab.b = null;
  if (state.musicAudio && state.musicAudio.loop) state.musicAudio.loop = false;
  applyAB();
}
/* 指数条 / 资金流向：四档频段占比，全曲均值缓存一次 */
let flowStats = null, flowKey = '';
function ensureFlowStats() {
  const m = state.meta;
  if (!m || !m.analysis || state.mode !== 'music') return null;
  const key = (m.id || m.name || '') + ':' + m.analysis.frames.length;
  if (flowKey === key && flowStats) return flowStats;
  const frames = m.analysis.frames || [];
  if (!frames.length) return null;
  const G = 4, size = Math.floor(BAND_COUNT / G);
  const gsum = new Float64Array(G);
  let fsum = 0;
  for (const f of frames) {
    fsum += f.freq;
    for (let g = 0; g < G; g++) {
      let acc = 0;
      for (let b = g * size; b < (g + 1) * size; b++) acc += f.bands[b];
      gsum[g] += acc / size;
    }
  }
  const total = gsum[0] + gsum[1] + gsum[2] + gsum[3] || 1;
  flowStats = { share: Array.from(gsum, v => v / total), freq: fsum / frames.length };
  flowKey = key;
  return flowStats;
}
function groupShares(f) {
  const G = 4, size = Math.floor(BAND_COUNT / G);
  const v = [0, 0, 0, 0];
  let total = 0;
  for (let g = 0; g < G; g++) {
    let acc = 0;
    for (let b = g * size; b < (g + 1) * size; b++) acc += f.bands[b];
    v[g] = acc / size;
    total += v[g];
  }
  return v.map(x => total ? x / total : 0);
}
function updateIndexStrip(now) {
  if (state.mode !== 'music') return;
  const st = ensureFlowStats();
  const f = frameAt(now);
  if (!st || !f) return;
  const sh = groupShares(f);
  const put = (idB, idC, val, chg, digits) => {
    const b = $(idB), c = $(idC);
    if (b) b.textContent = val.toFixed(digits);
    if (!c) return;
    c.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
    c.className = chg >= 0 ? 'up' : 'down';
  };
  put('isFreq', 'isFreqChg', f.freq, (f.freq / st.freq - 1) * 100, 0);
  for (let g = 0; g < 4; g++) put('isG' + g, 'isC' + g, sh[g] * 100, (sh[g] / (st.share[g] || 1e-6) - 1) * 100, 1);
}
function updateFlow(now) {
  if (state.mode !== 'music') return;
  const st = ensureFlowStats();
  const f = frameAt(now);
  const box = $('flowRows');
  if (!st || !f || !box) return;
  const sh = groupShares(f);
  const deltas = [];
  let dmax = 0.001;
  for (let g = 0; g < 4; g++) {
    const d = sh[g] - (st.share[g] || 0);
    deltas.push(d);
    dmax = Math.max(dmax, Math.abs(d));
  }
  const rows = box.querySelectorAll('.flow-row');
  rows.forEach((row, g) => {
    const d = deltas[g];
    const bar = row.querySelector('.fb i');
    const val = row.querySelector('.fv');
    const w = Math.min(50, Math.abs(d) / dmax * 50);
    if (bar) {
      bar.style.width = w.toFixed(1) + '%';
      bar.style.left = (d >= 0 ? 50 : 50 - w).toFixed(1) + '%';
      bar.classList.toggle('down', d < 0);
    }
    if (val) {
      val.textContent = (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + 'pt';
      val.style.color = d >= 0 ? 'var(--red)' : 'var(--green)';
    }
  });
  const fm = $('flowMain');
  if (fm) {
    const main = (sh[0] + sh[1]) - ((st.share[0] + st.share[1]) || 0);
    fm.textContent = (main >= 0 ? '净流入 +' : '净流出 ') + (main * 100).toFixed(1) + 'pt';
    fm.style.color = main >= 0 ? 'var(--red)' : 'var(--green)';
  }
}

function paneIsActive(id) {
  const p = $(id);
  return !!(p && p.classList.contains('active'));
}
function updateAnalyzerDOM(now) {
  const card = $('analyzerCard');
  if (!card || state.mode !== 'music') return;
  const vis = paneIsActive('paneVisual');
  if (!analyzerRows || !analyzerRows.length || !document.contains(analyzerRows[0].fill)) {
    analyzerRows = [...card.querySelectorAll('.meter-row')].map(r => ({
      ch: r.dataset.ch,
      fill: r.querySelector('.meter-fill'),
      peak: r.querySelector('.meter-peak'),
      val: r.querySelector('.meter-val')
    }));
  }
  if (vis) {
    for (const r of analyzerRows) {
      const m = updateMeter(r.ch, now);
      setCss(r.fill, 'width', clamp(m.v, 0, 100).toFixed(1) + '%');
      setCss(r.peak, 'left', clamp(m.p, 0, 100).toFixed(1) + '%');
      setText(r.val, String(Math.round(m.v)));
    }
  }
  const a = state.meta && state.meta.analysis;
  const f = frameAt(now);
  if (!a || !f) return;
  if (vis) {
    setText($('acCentroid'), Math.round(f.freq) + ' Hz');
    const i = clamp(Math.round(now / a.hopSec), 1, a.frames.length - 1);
    setText($('acTrans'), '+' + Math.max(0, f.rawRms - a.frames[i - 1].rawRms).toFixed(1) + '%');
  }
  const tnow = performance.now();
  if (tnow - (state.analyzerAt || 0) > 120) {
    state.analyzerAt = tnow;
    if (paneIsActive('paneBook')) { updateBook(now); updateTicks(now); }
    updateIndexStrip(now);
    if (paneIsActive('paneFlow')) updateFlow(now);
    updateLyricsPane(false);
    if (vis) {
      let dot = 0, nl = 0, nr = 0;
      for (let b = 0; b < BAND_COUNT; b++) {
        const lv = f.bandsL[b], rv = f.bandsR[b];
        dot += lv * rv; nl += lv * lv; nr += rv * rv;
      }
      setText($('acCorr'), (nl && nr) ? (dot / Math.sqrt(nl * nr)).toFixed(2) : '--');
      setText($('acPeak'), Math.round(Math.max(state.meters.L.p, state.meters.R.p, state.meters.M.p)) + '%');
    }
  }
}

function drawMusic(force) {
  if (state.mode !== 'music') return;
  const cv = $('musicCanvas');
  if (!cv) return;
  if (!state.mCanvas || !cv.width) resizeMusicCanvas();
  const nowMs = performance.now();
  if (!force && nowMs - (state.lastMusicDraw || 0) < 30) return;
  state.lastMusicDraw = nowMs;
  const w = (state.mCanvas && state.mCanvas.w) || cv.clientWidth;
  const h = (state.mCanvas && state.mCanvas.h) || cv.clientHeight;
  const ctx = cv.getContext('2d');
  const t = T();
  if (state.stageMode === '3d') { ctx.clearRect(0, 0, w, h); }
  else { ctx.fillStyle = t.canvasBg; ctx.fillRect(0, 0, w, h); }

  const series = state.series;
  if (!series || !series.length) return;
  if (state.kMode === 'freq') { drawMusicFreq(ctx, w, h, t); return; }
  const audio = state.musicAudio;
  const now = audio ? audio.currentTime : 0;
  const win = state.musicWindow || 1;
  const span = musicSpan(now);
  const start = Math.max(0, now - span);
  const pgm = paneGeom(h);
  const specCount = pgm.specCount;
  const mainH = pgm.mainH;
  const pw = Math.max(80, w - GUT_W);
  state.mPlotW = pw;
  const xOf = t => ((t - start) / span) * pw;
  const thick = state.freqThick || [];
  const thin = state.freqThin || [];
  /* 只遍历屏内数据：长曲目小窗口时 series 可达上万根，全量遍历会吃掉每帧预算 */
  const i0 = Math.max(0, idxAt(series, start - win * 2) - 1);
  const i1 = Math.min(series.length, idxAt(series, now + 0.001));

  let vmin = Infinity, vmax = -Infinity;
  const ovl = (state.showBoll || state.showEMA) ? buildOverlays() : null;
  for (let i = i0; i < i1; i++) {
    const c = series[i];
    if (c[3] < vmin) vmin = c[3];
    if (c[2] > vmax) vmax = c[2];
    if (thick[i] && thick[i] < vmin) vmin = thick[i];
    if (thin[i] && thin[i] > vmax) vmax = thin[i];
    if (ovl && state.showBoll) {
      if (ovl.lo[i] < vmin) vmin = ovl.lo[i];
      if (ovl.up[i] > vmax) vmax = ovl.up[i];
    }
  }
  if (!isFinite(vmin) || !isFinite(vmax) || vmin <= 0) { vmin = FREQ_MIN; vmax = FREQ_MAX; }
  vmin = Math.max(FREQ_MIN, vmin * 0.86);
  vmax = Math.min(FREQ_MAX * 1.4, vmax * 1.14);
  if (vmax / vmin < 1.25) {
    const mid = Math.sqrt(vmin * vmax);
    vmin = mid / 1.3;
    vmax = mid * 1.3;
  }
  let fs = state.freqScale;
  if (!fs) fs = state.freqScale = { min: vmin, max: vmax };
  const k = 0.18;
  fs.min = Math.min(vmin, Math.exp(Math.log(fs.min) * (1 - k) + Math.log(vmin) * k));
  fs.max = Math.max(vmax, Math.exp(Math.log(fs.max) * (1 - k) + Math.log(vmax) * k));
  const lmin = Math.log(fs.min), lmax = Math.log(fs.max);
  const PAD_T = 3, PAD_B = 3;
  const yOf = f => clamp((lmax - Math.log(clamp(f, fs.min, fs.max))) / (lmax - lmin), 0, 1) * (mainH - PAD_T - PAD_B) + PAD_T;

  panelFrame(ctx, 0, 0, pw, mainH, t.mainAccent);
  drawVideoLayer(ctx, 0, 0, pw, mainH);
  drawPaperGrid(ctx, pw, mainH);
  if (state.wall3d && state.stageMode !== '3d') draw3DWall(ctx, pw, mainH, t, state.musicAudio ? state.musicAudio.currentTime : 0);
  /* 右侧价格轴：独立底色带，观感更接近行情终端 */
  ctx.fillStyle = t.panelBg;
  ctx.globalAlpha = 0.94;
  ctx.fillRect(pw, 0, GUT_METER - 2, mainH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = t.panelBorder;
  ctx.beginPath();
  ctx.moveTo(pw + 0.5, 0);
  ctx.lineTo(pw + 0.5, mainH);
  ctx.stroke();
  const hzMain = [60, 125, 250, 500, 1000, 2000, 4000, 8000];
  const majorYs = [];
  for (const f of hzMain) {
    if (f < fs.min || f > fs.max) continue;
    const yy = yOf(f);
    if (yy < 1 || yy > mainH - 1) continue;
    const major = f === 250 || f === 1000 || f === 4000;
    ctx.strokeStyle = major ? t.gridMajor : t.gridMinor;
    ctx.lineWidth = 1;
    ctx.setLineDash(major ? [] : [1, 4]);
    ctx.beginPath();
    ctx.moveTo(5, Math.round(yy) + 0.5);
    ctx.lineTo(pw, Math.round(yy) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = major ? t.tickMajor : t.tickMinor;
    ctx.beginPath();
    ctx.moveTo(pw, Math.round(yy) + 0.5);
    ctx.lineTo(pw + 3, Math.round(yy) + 0.5);
    ctx.stroke();
    ctx.fillStyle = t.text3;
    ctx.font = '9px Consolas';
    ctx.textAlign = 'right';
    ctx.fillText(hzLabel(f), pw + GUT_METER - 4, Math.round(yy) + 3);
    ctx.textAlign = 'left';
    if (major) majorYs.push(Math.round(yy) + 0.5);
  }
  const cur = frameAt(now);
  if (cur && state.musicHover == null) {
    const midY = yOf(cur.freq);
    ctx.strokeStyle = t.cursorLine;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(5, midY);
    ctx.lineTo(pw, midY);
    ctx.stroke();
    ctx.setLineDash([]);
    const li = clamp(Math.floor(now / win), 0, series.length - 1);
    const up = series[li][8];
    ctx.fillStyle = up ? t.up : t.down;
    ctx.beginPath();
    ctx.roundRect(pw + 2, midY - 7, 28, 14, 2);
    ctx.fill();
    ctx.fillStyle = t.tagText;
    ctx.font = 'bold 9px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText(hzLabel(cur.freq), pw + 16, midY + 3);
    ctx.textAlign = 'left';
  }
  drawMeter(ctx, pw + GUT_METER, 0, mainH, 'M');
  if (state.showWatermark && isFinite(vmax) && isFinite(vmin) && vmax > vmin) {
    ctx.setLineDash([1, 3]);
    ctx.strokeStyle = t.up;
    ctx.globalAlpha = .5;
    ctx.beginPath();
    ctx.moveTo(5, Math.round(yOf(vmax)) + .5);
    ctx.lineTo(pw, Math.round(yOf(vmax)) + .5);
    ctx.stroke();
    ctx.strokeStyle = t.down;
    ctx.beginPath();
    ctx.moveTo(5, Math.round(yOf(vmin)) + .5);
    ctx.lineTo(pw, Math.round(yOf(vmin)) + .5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  const firstSec = Math.ceil(start);
  const majorXs = [];
  const majorLabels = [];
  for (let s = firstSec; s <= start + span; s++) {
    const xx = ((s - start) / span) * pw;
    const major = s % 5 === 0;
    const sx = Math.round(xx) + 0.5;
    ctx.strokeStyle = major ? t.timeMajor : t.timeMinor;
    ctx.setLineDash(major ? [] : [1, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, 2);
    ctx.lineTo(sx, mainH - 2);
    ctx.stroke();
    if (major) {
      ctx.setLineDash([]);
      ctx.strokeStyle = t.tickMinor;
      ctx.beginPath();
      ctx.moveTo(sx, mainH);
      ctx.lineTo(sx, mainH + 5);
      ctx.stroke();
      majorXs.push(sx);
      majorLabels.push([sx, s]);
    }
  }
  ctx.setLineDash([]);
  /* 主格交点十字：纸面栅格的视觉锚点 */
  if (majorXs.length && majorYs.length) {
    ctx.strokeStyle = t.tickMinor;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of majorXs) {
      for (const y of majorYs) {
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x + 2.5, y);
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x, y + 2.5);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /* 时间刻度标签落在主图与副图之间的格栅缝里 */
  if (specCount && pgm.gap >= 10 && majorLabels.length) {
    ctx.fillStyle = t.text3;
    ctx.font = '9px Consolas';
    ctx.textAlign = 'left';
    for (const [x, s] of majorLabels) {
      if (x > pw + 2) continue;
      ctx.fillText(span > 60 ? fmtTime(s) : s + 's', x + 3, mainH + 9);
    }
  }
  /* 节拍网格（BPM 推导）：像素间距过密时自动跳过 */
  const bpm = bpmOf();
  const beatSec = state.showBeat && bpm ? 60 / bpm : 0;
  if (beatSec) {
    const phase = beatPhaseOf();
    const perBar = state.meta.beatsPerBar || 4;
    const beatPx = (beatSec / span) * pw;
    const barPx = beatPx * perBar;
    if (barPx >= 10) {
      const drawBeats = beatPx >= 7;
      const k0 = Math.floor((start - phase) / beatSec);
      const k1 = Math.ceil((start + span - phase) / beatSec);
      for (let k = k0; k <= k1; k++) {
        const tb = phase + k * beatSec;
        if (tb < 0) continue;
        const bar = ((k % perBar) + perBar) % perBar === 0;
        if (!drawBeats && !bar) continue;
        const xx = Math.round((tb - start) / span * pw) + 0.5;
        ctx.strokeStyle = bar ? t.beatStrong : t.beat;
        ctx.beginPath();
        ctx.moveTo(xx, bar ? 1 : mainH * 0.8);
        ctx.lineTo(xx, mainH - 1);
        ctx.stroke();
        if (bar && xx > 232) {
          ctx.fillStyle = t.text3;
          ctx.font = '9px Consolas';
          ctx.textAlign = 'left';
          ctx.fillText(String(k / perBar + 1), xx + 3, 9);
        }
      }
    }
  }
  const onsets = (state.showBeat && state.meta.onsets) || [];
  if (onsets.length) {
    const gap = (0.12 / span) * pw;
    if (gap >= 3) {
      let prevX = -99;
      ctx.strokeStyle = t.beatSoft || t.beat;
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < onsets.length; i++) {
        const t0 = onsets[i];
        if (t0 < start - 0.1) continue;
        if (t0 > start + span) break;
        const xx = Math.round((t0 - start) / span * pw) + 0.5;
        if (xx - prevX < 3) continue;
        prevX = xx;
        ctx.beginPath();
        ctx.moveTo(xx, mainH - 5);
        ctx.lineTo(xx, mainH - 1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pw, mainH);
  ctx.clip();
  const chartType = state.chartType || 'hollow';
  if (chartType === 'timeline') {
    const ov = ovl || buildOverlays();
    const pts = [];
    for (let i = i0; i < i1; i++) {
      const c = series[i];
      const tc = c[6] + win / 2;
      if (tc > now + 0.001 || tc < start - win) continue;
      pts.push([xOf(tc), yOf(c[4]), c]);
    }
    if (pts.length > 1) {
      const base = yOf(ov.avg[ov.avg.length - 1]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], base);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(pts[pts.length - 1][0], base);
      ctx.closePath();
      ctx.fillStyle = state.theme === 'dark' ? 'rgba(255,90,60,.16)' : 'rgba(255,56,26,.1)';
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = t.up;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      if (t.glow) { ctx.shadowColor = t.up; ctx.shadowBlur = 6; }
      ctx.stroke();
      if (t.glow) ctx.shadowBlur = 0;
      ctx.beginPath();
      let on = false;
      for (let i = i0; i < i1; i++) {
        const tc = series[i][6] + win / 2;
        if (tc > now + 0.001 || tc < start - win) { on = false; continue; }
        const x = xOf(tc), y = yOf(ov.avg[i]);
        if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#f7b500';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = t.text3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, base);
      ctx.lineTo(pw, base);
      ctx.stroke();
      ctx.setLineDash([]);
      let vmax2 = 0;
      for (const p of pts) vmax2 = Math.max(vmax2, p[2][5] || 0);
      if (vmax2 > 0) {
        const vh = mainH * 0.16;
        for (const p of pts) {
          const bh = Math.max(0.5, (p[2][5] / vmax2) * vh);
          ctx.fillStyle = p[2][8] ? 'rgba(255,56,26,.32)' : 'rgba(0,155,103,.32)';
          ctx.fillRect(p[0] - 1, mainH - bh, 2, bh);
        }
      }
    }
  } else if (chartType === 'line' || chartType === 'area') {
    const pts = [];
    for (let i = i0; i < i1; i++) {
      const c = series[i];
      const tc = c[6] + win / 2;
      if (tc > now + 0.001 || tc < start - win) continue;
      pts.push([xOf(tc), yOf(c[4])]);
    }
    if (pts.length > 1) {
      if (chartType === 'area') {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], mainH);
        for (const p of pts) ctx.lineTo(p[0], p[1]);
        ctx.lineTo(pts[pts.length - 1][0], mainH);
        ctx.closePath();
        ctx.globalAlpha = state.theme === 'dark' ? 0.2 : 0.12;
        ctx.fillStyle = t.thick;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = t.thick;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      if (t.glow) { ctx.shadowColor = t.thick; ctx.shadowBlur = 6; }
      ctx.stroke();
      if (t.glow) ctx.shadowBlur = 0;
    }
  } else {
    for (let i = i0; i < i1; i++) {
      const c = series[i];
      if (c[6] > now + 0.001 || c[6] + win < start) continue;
      const slotW = (win / span) * pw;
      const bw = Math.max(slotW >= 3 ? 2 : 1, Math.min(30, slotW * (state.barGap || 0.72)));
      let x = xOf(c[6] + win / 2);
      if (x > pw - bw / 2) x = pw - bw / 2;
      if (x < -20) continue;
      const color = c[8] ? t.up : t.down;
      const alpha = c[6] + win > now ? 0.55 : 1;
      const yO = yOf(c[1]), yC = yOf(c[4]), yH = yOf(c[2]), yL = yOf(c[3]);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      if (t.glow) { ctx.shadowColor = color; ctx.shadowBlur = 6; }
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      if (chartType === 'ohlc') {
        const tick = Math.max(2, Math.min(6, bw * 0.5));
        ctx.moveTo(x - tick, yO);
        ctx.lineTo(x, yO);
        ctx.moveTo(x, yC);
        ctx.lineTo(x + tick, yC);
      }
      ctx.stroke();
      if (chartType !== 'ohlc') {
        const bodyY = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yC - yO));
        if (chartType === 'hollow' && c[8] && bw >= 3) {
          ctx.fillRect(x - bw / 2, bodyY, bw, Math.min(1, bodyH));
          ctx.fillRect(x - bw / 2, bodyY + bodyH - 1, bw, 1);
          ctx.fillRect(x - bw / 2, bodyY, 1, bodyH);
          ctx.fillRect(x + bw / 2 - 1, bodyY, 1, bodyH);
        } else {
          ctx.fillRect(x - bw / 2, bodyY, bw, bodyH);
        }
      }
      if (t.glow) ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = Math.max(1, i0); i < i1; i++) {
    const c0 = series[i - 1], c1 = series[i];
    const ta = c0[6] + win / 2, tb = c1[6] + win / 2;
    if (tb > now + 0.001 || tb < start) continue;
    const x0 = xOf(ta), x1 = xOf(tb);
    if (x1 < -20 || x0 > pw + 20) continue;
    if (chartType === 'timeline' || (!state.showThin && !state.showThick)) continue;
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = t.thin;
    ctx.lineWidth = 1;
    if (state.showThin) {
      ctx.beginPath();
      ctx.moveTo(x0, yOf(thin[i - 1] || c0[4]));
      ctx.lineTo(x1, yOf(thin[i] || c1[4]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (state.showThick) {
      ctx.strokeStyle = t.thick;
      ctx.lineWidth = 2.4;
      if (t.glow) { ctx.shadowColor = t.thick; ctx.shadowBlur = 8; }
      ctx.beginPath();
      ctx.moveTo(x0, yOf(thick[i - 1] || c0[4]));
      ctx.lineTo(x1, yOf(thick[i] || c1[4]));
      ctx.stroke();
      if (t.glow) ctx.shadowBlur = 0;
    }
  }
  if (state.showMA && chartType !== 'timeline') {
    for (const ma of MA_DEFS) {
      ctx.beginPath();
      let started = false, sum = 0;
      /* 从屏内起始点回退一个窗口预置均线，避免每帧从第 0 根累加 */
      const m0 = Math.max(0, i0 - ma.n);
      for (let i = m0; i < i1; i++) {
        sum += series[i][4];
        if (i - ma.n >= m0) sum -= series[i - ma.n][4];
        if (i < m0 + ma.n - 1) continue;
        const tc = series[i][6] + win / 2;
        if (tc > now + 0.001 || tc < start - win) { started = false; continue; }
        const x = xOf(tc), y = yOf(sum / ma.n);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ma.c;
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.9;
      if (t.glow) { ctx.shadowColor = ma.c; ctx.shadowBlur = 4; }
      ctx.stroke();
      if (t.glow) ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
  if (state.showBoll && ovl && chartType !== 'timeline') {
    const xs = [];
    for (let i = i0; i < i1; i++) {
      const tc = series[i][6] + win / 2;
      if (tc > now + 0.001) break;
      if (tc < start - win) continue;
      xs.push(i);
    }
    if (xs.length > 1) {
      ctx.beginPath();
      for (let j = 0; j < xs.length; j++) {
        const i = xs[j], x = xOf(series[i][6] + win / 2), y = yOf(ovl.up[i]);
        if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      for (let j = xs.length - 1; j >= 0; j--) {
        const i = xs[j];
        ctx.lineTo(xOf(series[i][6] + win / 2), yOf(ovl.lo[i]));
      }
      ctx.closePath();
      ctx.fillStyle = state.theme === 'dark' ? 'rgba(126,144,255,.14)' : 'rgba(70,96,220,.085)';
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = state.theme === 'dark' ? 'rgba(150,168,255,.5)' : 'rgba(70,96,220,.4)';
      for (const arr of [ovl.up, ovl.lo]) {
        ctx.beginPath();
        for (let j = 0; j < xs.length; j++) {
          const i = xs[j], x = xOf(series[i][6] + win / 2), y = yOf(arr[i]);
          if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = state.theme === 'dark' ? 'rgba(150,168,255,.75)' : 'rgba(70,96,220,.62)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let j = 0; j < xs.length; j++) {
        const i = xs[j], x = xOf(series[i][6] + win / 2), y = yOf(ovl.mid[i]);
        if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  if (state.showEMA && ovl && chartType !== 'timeline') {
    for (const [arr, color] of [[ovl.emaF, EMA_COLORS[0]], [ovl.emaS, EMA_COLORS[1]]]) {
      ctx.beginPath();
      let on = false;
      for (let i = i0; i < i1; i++) {
        const tc = series[i][6] + win / 2;
        if (tc > now + 0.001 || tc < start - win) { on = false; continue; }
        const x = xOf(tc), y = yOf(arr[i]);
        if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = .95;
      if (t.glow) { ctx.shadowColor = color; ctx.shadowBlur = 4; }
      ctx.stroke();
      if (t.glow) ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  const px = xOf(now);
  if (px >= 0 && px <= pw) {
    const flash = state.beatFlash || 0;
    ctx.strokeStyle = t.playhead;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.setLineDash([]);
    if (flash > 0.02) {
      ctx.globalAlpha = flash * (state.theme === 'dark' ? 0.5 : 0.32);
      ctx.fillStyle = t.cursorTag;
      ctx.fillRect(px - 5 * flash, 0, 10 * flash, mainH);
      ctx.globalAlpha = 1;
    }
  }

  if (specCount) {
    /* 段落色带：同花顺的区间标记在音乐语义下就是歌曲结构 */
    const chs = state.chapters || [];
    if (chs.length) {
      const ry = mainH + 3, rh = 7;
      const dur = state.meta.duration || 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ry, pw, rh);
      ctx.clip();
      let activeIdx = -1;
      for (let i = 0; i < chs.length; i++) {
        const t0 = chs[i].time != null ? chs[i].time : chs[i].idx * win;
        if (t0 <= now) activeIdx = i;
      }
      for (let i = 0; i < chs.length; i++) {
        const t0 = chs[i].time != null ? chs[i].time : chs[i].idx * win;
        const t1 = i + 1 < chs.length
          ? (chs[i + 1].time != null ? chs[i + 1].time : (i + 1) * win)
          : dur;
        const x0 = (t0 - start) / span * pw, x1 = (t1 - start) / span * pw;
        if (x1 < 0 || x0 > pw) continue;
        ctx.globalAlpha = i === activeIdx ? 0.95 : 0.5;
        ctx.fillStyle = chs[i].move > 0 ? t.up : t.down;
        ctx.fillRect(x0, ry, Math.max(1.5, x1 - x0 - 1.5), rh);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = t.panelBg;
        ctx.fillRect(x1 - 1.5, ry, 1, rh);
      }
      ctx.restore();
    }
    let paneY = pgm.specY;
    if (state.showSpecL) { drawSpectrumPane(ctx, pw, paneY, pgm.hL, now, start, span, state.spectrumL, state.spectrumRows, 'L'); paneY += pgm.hL + pgm.paneGap; }
    if (state.showSpecR) { drawSpectrumPane(ctx, pw, paneY, pgm.hR, now, start, span, state.spectrumR, state.spectrumRows, 'R'); }
  }

  updateAnalyzerDOM(now);
  state.plotGeom = { start, span, pw, mainH, win, now, yOf };
  drawMusicHover(ctx);
}

/* 十字光标：悬停到某根 K 线上给出竖线/横线与右侧数值签，页脚同步显示该根的数据 */
function drawMusicHover(ctx) {
  const g = state.plotGeom, hv = state.musicHover;
  if (!g || hv == null) return;
  const s = state.series[hv];
  if (!s) return;
  const frac = (s[6] + g.win / 2 - g.start) / g.span;
  if (frac < 0 || frac > 1) return;
  const t = T();
  const bx = Math.round(frac * g.pw) + 0.5;
  const yy = Math.round(clamp(g.yOf(s[4]), 0, g.mainH)) + 0.5;
  const col = s[8] ? t.up : t.down;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.cursorLine;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(bx, 0);
  ctx.lineTo(bx, g.mainH);
  ctx.stroke();
  ctx.strokeStyle = t.playhead;
  ctx.beginPath();
  ctx.moveTo(0, yy);
  ctx.lineTo(g.pw, yy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = 'bold 9px Consolas';
  const label = hzLabel(s[4]);
  const chipW = Math.max(28, ctx.measureText(label).width + 10);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(g.pw + 2, clamp(yy - 7, 0, g.mainH - 14), chipW, 14, 2);
  ctx.fill();
  ctx.fillStyle = t.tagText;
  ctx.textAlign = 'center';
  ctx.fillText(label, g.pw + 2 + chipW / 2, clamp(yy - 7, 0, g.mainH - 14) + 10);
  ctx.textAlign = 'left';
  ctx.restore();
}

/* ---------- 频率轴 K 线：横轴是频段，每根 K 线=一个频段的能量 OHLC ---------- */
function bandCenterHz(k, n) {
  const frac = (k + 0.5) / Math.max(1, n);
  return state.freqAxis === 'linear'
    ? FREQ_LO + frac * (FREQ_HI - FREQ_LO)
    : FREQ_LO * Math.pow(FREQ_HI / FREQ_LO, frac);
}
function bandIndexOfFreq(f, n) {
  const frac = state.freqAxis === 'linear'
    ? (f - FREQ_LO) / (FREQ_HI - FREQ_LO)
    : Math.log(f / FREQ_LO) / Math.log(FREQ_HI / FREQ_LO);
  return frac * n;
}
function buildFreqBars() {
  const meta = state.meta;
  const rows = state.spectrumRows;
  const frames = meta && meta.analysis && meta.analysis.frames;
  if (!meta || !rows || !frames || !frames.length) return null;
  const now = state.musicAudio ? state.musicAudio.currentTime : 0;
  const agg = state.freqAgg > 0 ? state.freqAgg : Math.max(0.5, meta.duration || 1);
  const t0 = Math.max(0, now - agg);
  /* 50ms 一档：帧一前进就重算，右沿不会停在 0.25s 的列边界上 */
  const key = meta.id + '|' + rows + '|' + state.freqAxis + '|' + agg + '|' + Math.round(now * 20);
  if (state.freqBarsKey === key && state.freqBars) return state.freqBars;
  let i1 = 0;
  for (let i = frames.length - 1; i >= 0; i--) { if (frames[i].t <= now + 1e-6) { i1 = i; break; } }
  let i0 = i1;
  while (i0 > 0 && frames[i0 - 1].t >= t0 - 1e-9) i0--;
  const count = i1 - i0 + 1;
  const stride = Math.max(1, Math.ceil(count / 96));
  const bounds = bandBounds(rows, state.freqAxis);
  const fA = frames[i0], fB = frames[i1];
  const bars = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const a = bounds[r], bnd = Math.max(a + 1, bounds[r + 1]), width = bnd - a;
    let o = 0, c = 0, sum = 0, sum2 = 0, cnt = 0;
    for (let b = a; b < bnd; b++) { o += fA.bands[b]; c += fB.bands[b]; }
    o /= width; c /= width;
    for (let i = i0; i <= i1; i += stride) {
      const bd = frames[i].bands;
      let v = 0;
      for (let b = a; b < bnd; b++) v += bd[b];
      v /= width;
      sum += v; sum2 += v * v; cnt++;
    }
    const mean = cnt ? sum / cnt : c;
    const sd = cnt ? Math.sqrt(Math.max(0, sum2 / cnt - mean * mean)) : 0;
    const hi = Math.max(o, c, mean + sd * 1.3);
    const lo = Math.min(o, c, Math.max(0, mean - sd * 1.3));
    bars[r] = [o, hi, lo, c, c >= o ? 1 : 0];
  }
  state.freqBars = bars;
  state.freqBarsKey = key;
  return bars;
}
function loudestBand(bars) {
  let k = 0, best = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i][3] > best) { best = bars[i][3]; k = i; }
  return k;
}
function freqPickBand() {
  const bars = state.freqBars;
  if (!bars || !bars.length) return -1;
  return state.freqHover != null ? clamp(state.freqHover, 0, bars.length - 1) : loudestBand(bars);
}
function applyFreqHeader() {
  const bars = state.freqBars;
  if (!bars || !bars.length) return;
  const n = bars.length;
  const k = freqPickBand();
  const b = bars[k], pv = bars[k - 1] || b;
  const pct = v => Math.round(v);
  const d = pct(b[3]) - pct(pv[3]);
  const dp = pv[3] ? (b[3] / pv[3] - 1) * 100 : 0;
  const cls = b[4] ? 'up' : 'down';
  const set = el => {
    if (!el || el.__cls === cls) return;
    el.__cls = cls;
    el.classList.remove('up', 'down', 'flat');
    el.classList.add(cls);
  };
  set($('qPriceTop')); set($('qChangeTop'));
  setText($('qPriceTop'), String(pct(b[3])));
  setText($('priceUnit'), '%');
  setText($('qChangeTop'), (d >= 0 ? '+' : '') + d + ' · ' + fmtPct(dp));
  setText($('qOpenTop'), String(pct(b[0])));
  setText($('qHighTop'), String(pct(b[1])));
  $('qLowTop').textContent = pct(b[2]);
  $('qPrevTop').textContent = pct(pv[3]);
  setText($('qVolTop'), pct(b[1]) + '%');
  setText($('qAmpTop'), (b[1] - b[2]).toFixed(1) + 'pp');
  let mx = 0, mn = 1;
  for (const x of bars) { if (x[3] > mx) mx = x[3]; if (x[3] < mn) mn = x[3]; }
  setText($('qRangeHighTop'), pct(mx) + '%');
  setText($('qRangeLowTop'), pct(mn) + '%');
  setText($('qCountTop'), String(n));
  setText($('qIndex'), '第 ' + (k + 1) + ' / ' + n + ' 段');
  setText($('rbIndex'), '第 ' + (k + 1) + ' / ' + n + ' 段');
}
function drawMusicFreq(ctx, w, h, t) {
  const pw = Math.max(80, w - GUT_W);
  const pgm = paneGeom(h);
  const specCount = pgm.specCount;
  const mainH = pgm.mainH;
  const bars = buildFreqBars();
  if (!bars || !bars.length) return;
  const n = bars.length;
  const padT = 10, padB = 6;
  /* 纵轴用 98 分位 + 0.55 次幂：把大片小能量的频段抬起来，柱子长短一眼可比 */
  let topV = 1;
  for (const b of bars) if (b[1] > topV) topV = b[1];
  topV = Math.max(1, topV * 1.05);
  const GAMMA = 0.55;
  const sc = topV;
  const yOf = v => Math.round(mainH - padB - Math.pow(clamp(v / sc, 0, 1), GAMMA) * (mainH - padT - padB)) + 0.5;
  state.freqGeom = { pw, mainH, n, yOf };
  panelFrame(ctx, 0, 0, pw, mainH, t.mainAccent);
  drawVideoLayer(ctx, 0, 0, pw, mainH);
  drawPaperGrid(ctx, pw, mainH);
  if (state.wall3d && state.stageMode !== '3d') draw3DWall(ctx, pw, mainH, t, state.musicAudio ? state.musicAudio.currentTime : 0);
  ctx.fillStyle = t.panelBg;
  ctx.globalAlpha = 0.94;
  ctx.fillRect(pw, 0, GUT_METER - 2, mainH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = t.panelBorder;
  ctx.beginPath();
  ctx.moveTo(pw + 0.5, 0);
  ctx.lineTo(pw + 0.5, mainH);
  ctx.stroke();
  ctx.font = '9px Consolas';
  ctx.textAlign = 'right';
  const levelYs = [];
  for (const p of [0.25, 0.5, 0.75, 1]) {
    const yy = yOf(p * sc);
    if (yy < 3 || yy > mainH - 2) continue;
    const major = p === 0.5;
    ctx.strokeStyle = major ? t.gridMajor : t.gridMinor;
    ctx.setLineDash(major ? [] : [1, 4]);
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(pw, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = t.text3;
    ctx.fillText(Math.round(sc * Math.pow(p, 1 / GAMMA)) + '%', pw + GUT_METER - 4, yy - 3);
    levelYs.push(yy);
  }
  /* 频率主格线：与底部刻度同一套频率，上下贯通 */
  const majorFx = [];
  for (const f of [50, 100, 250, 500, 1000, 2000, 4000, 8000]) {
    if (f < FREQ_LO || f > FREQ_HI) continue;
    const x = Math.round(bandIndexOfFreq(f, n) / n * pw) + 0.5;
    if (x < 4 || x > pw - 2) continue;
    const major = f === 250 || f === 1000 || f === 4000;
    ctx.strokeStyle = major ? t.gridMinor : t.timeMinor;
    ctx.setLineDash(major ? [] : [1, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x, mainH - 2);
    ctx.stroke();
    if (major) majorFx.push(x);
  }
  ctx.setLineDash([]);
  if (majorFx.length && levelYs.length) {
    ctx.strokeStyle = t.tickMinor;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const x of majorFx) {
      for (const y of levelYs) {
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x + 2.5, y);
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x, y + 2.5);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /* 频段太密时合并成更少的柱子，宽度够、看得清 */
  const stepK = Math.max(1, Math.ceil(n / 150));
  const nb = Math.ceil(n / stepK);
  const disp = new Array(nb);
  for (let i = 0; i < nb; i++) {
    let o = 0, c = 0, hi = 0, lo = 1, got = false;
    const k1 = Math.min(n, (i + 1) * stepK);
    for (let k = i * stepK; k < k1; k++) {
      const b = bars[k];
      if (!b) continue;
      if (!got) { o = b[0]; c = b[3]; hi = b[1]; lo = b[2]; got = true; }
      else { c = b[3]; if (b[1] > hi) hi = b[1]; if (b[2] < lo) lo = b[2]; }
    }
    if (got) disp[i] = [o, hi, lo, c, c >= o ? 1 : 0];
  }
  const slot = pw / nb;
  const bw = Math.max(1.5, slot * (state.barGap || 0.72));
  const type = state.chartType || 'candle';
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pw, mainH);
  ctx.clip();
  if (type === 'line' || type === 'area') {
    const pts = disp.map((b, k) => [(k + 0.5) * slot, yOf(b[3])]);
    if (type === 'area') {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], mainH);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(pts[pts.length - 1][0], mainH);
      ctx.closePath();
      ctx.globalAlpha = state.theme === 'dark' ? 0.2 : 0.12;
      ctx.fillStyle = t.thick;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = t.thick;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  } else {
    for (let k = 0; k < nb; k++) {
      const b = disp[k];
      if (!b) continue;
      const x = (k + 0.5) * slot;
      const col = b[4] ? t.up : t.down;
      const yO = yOf(b[0]), yC = yOf(b[3]), yH = yOf(b[1]), yL = yOf(b[2]);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      if (type === 'ohlc') {
        const tick = Math.max(1.5, Math.min(6, bw * 0.5));
        ctx.moveTo(x - tick, yO);
        ctx.lineTo(x, yO);
        ctx.moveTo(x, yC);
        ctx.lineTo(x + tick, yC);
      }
      ctx.stroke();
      if (type !== 'ohlc') {
        const bodyY = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yC - yO));
        if (type === 'hollow' && b[4] && bw >= 3) {
          ctx.fillRect(x - bw / 2, bodyY, bw, Math.min(1, bodyH));
          ctx.fillRect(x - bw / 2, bodyY + bodyH - 1, bw, 1);
          ctx.fillRect(x - bw / 2, bodyY, 1, bodyH);
          ctx.fillRect(x + bw / 2 - 1, bodyY, 1, bodyH);
        } else {
          ctx.fillRect(x - bw / 2, bodyY, bw, bodyH);
        }
      }
    }
  }
  /* 频段能量均线 */
  ctx.beginPath();
  for (const ma of MA_DEFS) {
    ctx.beginPath();
    let sum = 0, started = false;
    for (let k = 0; k < nb; k++) {
      if (!disp[k]) continue;
      sum += disp[k][3];
      if (k >= ma.n) sum -= (disp[k - ma.n] ? disp[k - ma.n][3] : 0);
      if (k < ma.n - 1) continue;
      const x = (k + 0.5) * slot, y = yOf(sum / ma.n);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = ma.c;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.95;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  let sumC = 0, cntC = 0;
  for (const b of disp) if (b) { sumC += b[3]; cntC++; }
  const ym = yOf(sumC / Math.max(1, cntC));
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = t.text3;
  ctx.beginPath();
  ctx.moveTo(0, ym);
  ctx.lineTo(pw, ym);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  const hvi = state.freqHover != null ? Math.min(nb - 1, Math.floor(state.freqHover / stepK)) : -1;
  if (hvi >= 0 && disp[hvi]) {
    const b = disp[hvi];
    const x = Math.round((hvi + 0.5) * slot) + 0.5;
    const y = yOf(b[3]);
    ctx.strokeStyle = t.cursorLine;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mainH);
    ctx.stroke();
    ctx.strokeStyle = t.playhead;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(pw, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 9px Consolas';
    ctx.textAlign = 'center';
    const label = Math.round(b[3]) + '%';
    const chipW = Math.max(28, ctx.measureText(label).width + 10);
    const cy = clamp(y - 7, 0, mainH - 14);
    ctx.fillStyle = b[4] ? t.up : t.down;
    ctx.beginPath();
    ctx.roundRect(pw + 2, cy, chipW, 14, 2);
    ctx.fill();
    ctx.fillStyle = t.tagText;
    ctx.fillText(label, pw + 2 + chipW / 2, cy + 10);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  /* 底部频率刻度 */
  ctx.save();
  ctx.font = '9px Consolas';
  ctx.textAlign = 'center';
  for (const f of [50, 100, 250, 500, 1000, 2000, 4000, 8000]) {
    if (f < FREQ_LO || f > FREQ_HI) continue;
    const x = bandIndexOfFreq(f, n) / n * pw;
    if (x < 16 || x > pw - 16) continue;
    const major = f === 250 || f === 1000 || f === 4000;
    ctx.strokeStyle = major ? t.tickMajor : t.tickMinor;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, mainH);
    ctx.lineTo(Math.round(x) + 0.5, mainH + 4);
    ctx.stroke();
    ctx.fillStyle = t.text3;
    ctx.fillText(hzLabel(f), x, mainH + 12);
  }
  ctx.textAlign = 'left';
  ctx.restore();
  if (specCount) {
    const now = state.musicAudio ? state.musicAudio.currentTime : 0;
    const span = musicSpan(now);
    const start = Math.max(0, now - span);
    let paneY = pgm.specY;
    if (state.showSpecL) { drawSpectrumPane(ctx, pw, paneY, pgm.hL, now, start, span, state.spectrumL, state.spectrumRows, 'L'); paneY += pgm.hL + pgm.paneGap; }
    if (state.showSpecR) { drawSpectrumPane(ctx, pw, paneY, pgm.hR, now, start, span, state.spectrumR, state.spectrumRows, 'R'); }
  }
  updateAnalyzerDOM(state.musicAudio ? state.musicAudio.currentTime : 0);
}

function rebuildMusic(windowSec) {
  const meta = state.meta;
  if (!meta || !meta.analysis) return;
  const frames = meta.analysis.frames;
  /* 以实际解码出来的长度为准，声明时长可能比真实音频长，否则尾部会出现空窗口 */
  const dur = Math.max(0.5, Math.min(meta.duration || 0, meta.analysis.duration || meta.duration || 0));
  meta.duration = dur;
  const series = buildFrequencySeries(frames, windowSec, dur);
  if (!series.length) { toast('音频太短'); return; }
  const stats = computeStats(series);
  Object.assign(meta, {
    count: series.length, high: stats.high, highDate: stats.highDate,
    low: stats.low, lowDate: stats.lowDate, bestDay: stats.bestDay, worstDay: stats.worstDay,
    maxDD: stats.maxDD, lastClose: stats.lastClose, prevClose: stats.prevClose,
    first: '0:00', last: fmtTime(meta.duration), digits: 0,
    volProxy: false, volNote: '最大音量（RMS）', windowSec
  });
  meta.chapters = buildMusicChapters(meta, frames, series, windowSec);
  meta.chL = buildFrequencySeries(frames, windowSec, dur, { getF: f => f.freqL, getV: f => f.rmsL });
  meta.chR = buildFrequencySeries(frames, windowSec, dur, { getF: f => f.freqR, getV: f => f.rmsR });
  state.series = series;
  state.ind = null;
  state.kline = [];
  state.tsIndex = new Map();
  state.chapters = meta.chapters;
  const lines = buildFrequencyLines(frames, series, state.musicThick, state.musicThin, windowSec);
  state.freqThick = lines.thick;
  state.freqThin = lines.thin;
  const rows = Math.max(1, effBands());
  state.spectrumRows = rows;
  const pair = buildSpectrumPair(frames, rows, state.spectrumStep, meta.duration);
  state.spectrumL = pair.L;
  state.spectrumR = pair.R;
  const audio = state.musicAudio;
  state.playhead = audio ? audio.currentTime / windowSec : 0;
  state.lastInt = -1;
  state.lastChapterIdx = -1;
  state.activeChapterIdx = -1;
  state.hoverIndex = null;
  state.musicHover = null;
  state.endShown = false;
  state.freqScale = null;
  buildChapters();
  buildTimelineMarks();
  updateStaticInfo();
  updateAllUI(true);
  updateVisualUI();
  updatePlayUI();
  resizeMusicCanvas();
  applyAB();
  drawMusic(true);
}

/* ================= music audio ================= */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function dataUriToBuffer(uri) {
  const b64 = uri.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function decodeAudio(arrayBuffer) {
  return await getAudioCtx().decodeAudioData(arrayBuffer.slice(0));
}
function stopAudio() {
  syncVideo(false);
  if (!state.musicAudio) return;
  try { state.musicAudio.pause(); } catch (e) {}
  try { state.musicAudio.currentTime = 0; } catch (e) {}
  state.playing = false;
}
function ensureMusicAudio(meta) {
  if (state.musicAudio && state.musicAudioMeta === meta.id) return state.musicAudio;
  stopAudio();
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = state.musicVolume;
  audio.loop = state.loop;
  audio.playbackRate = state.musicRate;
  audio.src = meta.demo ? window.KLINE_DEMO_AUDIO : meta.url;
  audio.addEventListener('play', () => { state.playing = true; updatePlayUI(); });
  audio.addEventListener('pause', () => { state.playing = false; updatePlayUI(); });
  audio.addEventListener('ended', () => { if (state.mode === 'music') endReached(); });
  audio.addEventListener('timeupdate', () => { if (state.mode === 'music' && state.playing) syncMusicPlayback(0.25); });
  audio.addEventListener('error', () => toast('音频播放失败'));
  state.musicAudio = audio;
  state.musicAudioMeta = meta.id;
  return audio;
}
/* 视频画面层：音频时钟不变，视频只作为可同步的背景帧源 */
function ensureMusicVideo(meta) {
  const box = $('videoLayerBox');
  if (!meta.videoUrl) {
    if (state.videoEl) { state.videoEl.pause(); state.videoEl.removeAttribute('src'); state.videoEl.load(); state.videoEl = null; }
    if (box) box.innerHTML = '';
    if (box) box.hidden = true;
    return null;
  }
  if (box) box.hidden = false;
  if (state.videoEl && state.videoEl.dataset.mid === meta.id) return state.videoEl;
  if (box) box.innerHTML = '';
  const v = document.createElement('video');
  v.src = meta.videoUrl;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.dataset.mid = meta.id;
  v.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none;';
  if (box) box.appendChild(v);
  state.videoEl = v;
  v.addEventListener('loadeddata', () => {
    try {
      const cv = document.createElement('canvas');
      cv.width = 160; cv.height = 90;
      const c = cv.getContext('2d');
      const grab = () => { try { c.drawImage(v, 0, 0, 160, 90); meta.thumb = cv.toDataURL('image/jpeg', 0.6); renderClips(); } catch (e) {} };
      v.addEventListener('seeked', grab, { once: true });
      try { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); } catch (e) {}
    } catch (e) {}
  }, { once: true });
  return v;
}
function renderClips() {
  const box = $('clipList');
  if (!box) return;
  const items = LIBRARY.filter(m => m.videoUrl);
  box.innerHTML = '';
  items.forEach(m => {
    const d = document.createElement('div');
    d.className = 'clip' + (state.meta && state.meta.id === m.id ? ' on' : '');
    const img = document.createElement('img');
    if (m.thumb) img.src = m.thumb;
    const sp = document.createElement('span');
    sp.textContent = m.name;
    d.appendChild(img); d.appendChild(sp);
    d.addEventListener('click', () => loadDataset(m.id));
    box.appendChild(d);
  });
}
function videoReady() {
  const v = state.videoEl;
  return state.videoOn && v && v.readyState >= 2 && v.videoWidth > 0;
}
let vSyncAt = 0, vSeekAt = 0;
function syncVideo(play, force) {
  const v = state.videoEl;
  if (!v) return;
  if (state.videoFree) return;
  const nowMs = performance.now();
  const base = state.musicRate || 1;
  if (!state.musicAudio) {
    if (!v.paused) v.pause();
    return;
  }
  if (!force) {
    if (nowMs - vSyncAt < 220) return;
    vSyncAt = nowMs;
  }
  const t = state.musicAudio.currentTime;
  const drift = v.currentTime - t;
  /* 大偏差才重新定位，并加冷却，避免每帧 seek 造成卡顿 */
  if (Math.abs(drift) > 0.6 && nowMs - vSeekAt > 1800) {
    try { v.currentTime = t; } catch (e) {}
    vSeekAt = nowMs;
  }
  let want = base;
  if (play && state.videoOn && Math.abs(drift) > 0.08) {
    /* 小偏差用 ±6% 的微调速度追上，而不是跳帧 */
    want = clamp(base * (1 - drift * 0.07), base * 0.94, base * 1.06);
  }
  if (Math.abs(v.playbackRate - want) > 0.004) { try { v.playbackRate = want; } catch (e) {} }
  if (play && state.videoOn) {
    if (v.paused) v.play().catch(() => {});
  } else if (!v.paused) v.pause();
}
/* ---------- 平滑回放：最后一根 K 线随播放头生长 ---------- */
let smoothK = -1;
function partialBar(k, f) {
  const S = state.kline;
  const real = S[clamp(k, 0, S.length - 1)];
  const prev = S[clamp(k - 1, 0, S.length - 1)] || real;
  const open = prev.close;
  const lerp = (a, b) => a + (b - a) * f;
  const close = lerp(open, real.close);
  return {
    timestamp: real.timestamp,
    open,
    high: Math.max(open, close, lerp(open, real.high, f)),
    low: Math.min(open, close, lerp(open, real.low, f)),
    close,
    volume: Math.round(lerp(prev.volume || 0, real.volume || 0, f))
  };
}
function smoothChartTick() {
  if (state.mode === 'music' || !chart || !state.kline.length) return;
  const k = clamp(Math.floor(state.playhead), 0, state.kline.length - 1);
  const f = clamp(state.playhead - k, 0, 1);
  const bars = chart.getDataList().length;
  if (k < bars - 1) { smoothK = -1; syncChart(true); return; }
  if (k !== smoothK) {
    if (smoothK >= 0 && state.kline[smoothK]) { try { chart.updateData(state.kline[smoothK]); } catch (e) {} }
    if (k >= bars) { try { chart.applyMoreData(state.kline.slice(bars, k + 1)); } catch (e) {} }
    smoothK = k;
  }
  try { chart.updateData(partialBar(k, f)); } catch (e) {}
}
function finishSmooth() {
  if (smoothK >= 0 && state.kline[smoothK]) { try { chart.updateData(state.kline[smoothK]); } catch (e) {} }
  smoothK = -1;
}

/* ---------- 播放位置进度线 + 空闲自动跟随 ---------- */
let playLineId = null, followAt = 0;
function syncPlayLine() {
  if (state.mode === 'music' || !chart || !state.kline.length) return;
  const bar = state.kline[clamp(Math.floor(state.playhead), 0, state.kline.length - 1)];
  if (!bar) return;
  if (!playLineId) {
    try {
      playLineId = chart.createOverlay({
        name: 'verticalStraightLine',
        points: [{ timestamp: bar.timestamp }],
        styles: { line: { color: '#ff5a3c', size: 1, style: 'dashed', dashedValue: [4, 3] } }
      });
    } catch (e) {
      try { playLineId = chart.createOverlay({ name: 'verticalStraightLine', points: [{ timestamp: bar.timestamp }] }); } catch (e2) {}
    }
  } else {
    try { chart.overrideOverlay({ id: playLineId, points: [{ timestamp: bar.timestamp }] }); }
    catch (e) { playLineId = null; }
  }
}
function resetPlayLine() { playLineId = null; syncPlayLine(); }
function noteChartIdle() { state.chartIdleAt = performance.now(); }
let scrollAnim = 0;
function animateScrollToIndex(target, dur) {
  if (!chart) return;
  const range = chart.getVisibleRange ? chart.getVisibleRange() : null;
  if (!range) { try { chart.scrollToDataIndex(target); } catch (e) {} return; }
  const barSpace = state.barSpace || 7;
  const dist = (target - range.to) * barSpace;
  if (Math.abs(dist) < 2) return;
  cancelAnimationFrame(scrollAnim);
  const t0 = performance.now();
  let done = 0;
  const step = now => {
    const p = clamp((now - t0) / (dur || 420), 0, 1);
    const e = 1 - Math.pow(1 - p, 3);
    const want = e * dist;
    try { chart.scrollByDistance(want - done); } catch (err) {}
    done = want;
    if (p < 1) scrollAnim = requestAnimationFrame(step);
  };
  scrollAnim = requestAnimationFrame(step);
}
function autoFollowChart() {
  if (state.mode === 'music' || !chart || !state.meta) return;
  if (performance.now() - (state.chartIdleAt || 0) < 4000) return;
  const now = performance.now();
  if (now - followAt < 900) return;
  followAt = now;
  const idx = clamp(Math.floor(state.playhead), 0, state.kline.length - 1);
  animateScrollToIndex(idx, 420);
  syncPlayLine();
}

/* ---------- 画线工具（KLineChart overlay） ---------- */
const DRAW_STORE_KEY = 'klp.drawings';
let drawStore = {};
try { drawStore = JSON.parse(localStorage.getItem(DRAW_STORE_KEY) || '{}') || {}; } catch (e) { drawStore = {}; }
let drawToolId = null, drawPts = [], drawIds = [];
function drawKeyOf() {
  const m = state.meta;
  return m ? (m.id + '|' + state.period) : '';
}
function saveDrawStore() {
  try { localStorage.setItem(DRAW_STORE_KEY, JSON.stringify(drawStore)); } catch (e) {}
}
function clearDrawOverlays() {
  for (const id of drawIds) { try { chart.removeOverlay(id); } catch (e) {} }
  drawIds = [];
}
function replayDrawings() {
  if (!chart || state.mode === 'music') return;
  clearDrawOverlays();
  const list = drawStore[drawKeyOf()] || [];
  for (const d of list) {
    try {
      const id = chart.createOverlay({ name: d.name, points: d.points });
      if (id) drawIds.push(id);
    } catch (e) {}
  }
}
function syncDrawTools() {
  const box = $('drawTools');
  if (!box) return;
  box.hidden = state.mode === 'music' || !state.meta;
  if (box.hidden) { drawToolId = null; drawPts = []; }
  box.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tool === drawToolId));
}
function setDrawTool(name) {
  if (name === 'clear') {
    drawStore[drawKeyOf()] = [];
    saveDrawStore();
    clearDrawOverlays();
    toast('画线已清除');
    return;
  }
  drawToolId = drawToolId === name ? null : name;
  drawPts = [];
  syncDrawTools();
  if (drawToolId) toast('在图上点击两次画线 · Esc 退出');
}
function initDrawTools() {
  const box = $('drawTools');
  if (!box) return;
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setDrawTool(b.dataset.tool)));
  const wrap = $('chartWrap');
  ['mousedown', 'wheel', 'pointerdown'].forEach(ev => wrap.addEventListener(ev, noteChartIdle, { passive: true }));
  window.addEventListener('keydown', noteChartIdle);
  wrap.addEventListener('mousedown', e => {
    if (!drawToolId || state.mode === 'music' || !chart) return;
    if (e.button !== 0) return;
    if (e.target.closest('.draw-tools,.chart-legend,.toast-stack,.sub-layer')) return;
    const cv = $('chart');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    let p = null;
    try { p = chart.convertFromPixel({ x: e.clientX - r.left, y: e.clientY - r.top }, { paneId: 'candle_pane' }); } catch (err) {}
    if (!p || p.timestamp == null || p.value == null) return;
    e.preventDefault();
    drawPts.push({ timestamp: p.timestamp, value: p.value });
    const need = (drawToolId === 'horizontalStraightLine' || drawToolId === 'verticalStraightLine') ? 1 : 2;
    if (drawPts.length >= need) {
      const pts = drawPts.slice(0, need);
      try {
        const id = chart.createOverlay({ name: drawToolId, points: pts });
        if (id) drawIds.push(id);
      } catch (err) {}
      const key = drawKeyOf();
      (drawStore[key] = drawStore[key] || []).push({ name: drawToolId, points: pts });
      saveDrawStore();
      drawPts = [];
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawToolId) { drawToolId = null; drawPts = []; syncDrawTools(); }
  });
}

/* ---------- A 股实时行情：东方财富公开 K 线（JSONP，file:// 下可用） ---------- */
function resolveSymbol(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const m = s.match(/^(sh|sz|bj)?(\d{6})$/);
  if (!m) return null;
  const code = m[2];
  const mk = m[1] || (/^(6|9)/.test(code) ? 'sh' : /^(0|2|3)/.test(code) ? 'sz' : 'bj');
  const secid = (mk === 'sh' ? '1' : '0') + '.' + code;
  return { code, mk, secid };
}
function jsonpLoad(url, cbParam, timeout) {
  return new Promise((resolve, reject) => {
    const name = '__klp_cb_' + Math.random().toString(36).slice(2, 10);
    const el = document.createElement('script');
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      el.remove();
      if (err) reject(err); else resolve(data);
    };
    window[name] = data => finish(null, data);
    el.onerror = () => finish(new Error('网络请求失败'));
    el.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + cbParam + '=' + name + '&_=' + Date.now();
    document.head.appendChild(el);
    setTimeout(() => finish(new Error('请求超时')), timeout || 10000);
  });
}
async function fetchRealKline(code, klt) {
  const sym = resolveSymbol(code);
  if (!sym) throw new Error('代码格式：6 位数字，可加 sh/sz 前缀');
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + sym.secid
    + '&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6'
    + '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
    + '&klt=' + (klt || 101) + '&fqt=1&end=20500101&lmt=420';
  const j = await jsonpLoad(url, 'cb', 12000);
  const d = j && j.data;
  if (!d || !d.klines || !d.klines.length) throw new Error('未返回数据（代码可能不存在）');
  const candles = d.klines.map(line => {
    const a = line.split(',');
    return [a[0], +a[1], +a[3], +a[4], +a[2], +a[5]];
  }).filter(c => isFinite(c[1]) && isFinite(c[4]));
  return { name: d.name || ('代码 ' + sym.code), code: sym.code, candles };
}
async function loadRealQuote(code, klt) {
  const sym = resolveSymbol(code);
  if (!sym) { toast('请输入 6 位代码，如 600519'); return; }
  const sel = $('rtPeriod');
  const period = klt || (sel ? Number(sel.value) : 101);
  setLoadStage('拉取行情…');
  try {
    const q = await fetchRealKline(code, period);
    if (q.candles.length < 20) throw new Error('K 线太少（' + q.candles.length + ' 根）');
    const id = 'local-rt-' + q.code + '-' + period;
    const label = period === 102 ? '周K' : period === 103 ? '月K' : '日K';
    const meta = makeLocalMeta(id, q.name, q.candles, '东方财富 · ' + label + ' · 前复权 · ' + q.candles.length + ' 根');
    meta.code = q.code;
    DATA[id] = { id, candles: q.candles };
    const i = LIBRARY.findIndex(m => m.id === id);
    if (i >= 0) LIBRARY[i] = meta; else LIBRARY.push(meta);
    renderSidebar();
    state.marketReplay = false;
    const rb = $('btnReplayTop'); if (rb) rb.classList.remove('active');
    loadMarketDataset(meta, { noOverlay: true, index: q.candles.length - 1 });
    try { chart.setBarSpace(7); chart.scrollToRealTime(0); } catch (e) {}
    const want = Math.max(2, Math.round(q.candles.length / 45));
    setSpeed(SPEEDS.filter(x => x <= want).pop() || 2);
    toast(q.name + ' · ' + label + ' · ' + q.candles.length + ' 根 · 按播放可回放');
  } catch (e) {
    toast('行情拉取失败：' + (e && e.message ? e.message : e));
  } finally {
    setLoadStage('');
  }
}
function initRealQuote() {
  const btn = $('btnRtLoad');
  const input = $('rtCode');
  if (btn) btn.addEventListener('click', () => loadRealQuote(input ? input.value : ''));
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') loadRealQuote(input.value); });
  document.querySelectorAll('#rtChips button').forEach(b => b.addEventListener('click', () => {
    if (input) input.value = b.dataset.code;
    loadRealQuote(b.dataset.code);
  }));
}

/* ---------- 歌词面板：一条独立的歌词空间 ---------- */
let lrcRows = [], lrcActive = -2, lrcKey = '';
function buildLyricsPane(force) {
  const box = $('lrcList');
  if (!box) return;
  const subs = state.subs || [];
  const key = (state.subLabel || '') + '|' + subs.length + '|' + (subs[0] ? subs[0].t : 0) + '|' + (state.subOffset || 0);
  if (!force && key === lrcKey) return;
  lrcKey = key;
  lrcRows = [];
  lrcActive = -2;
  box.innerHTML = '';
  const sub = $('lrcSub');
  if (!subs.length) {
    const d = document.createElement('div');
    d.className = 'lrc-empty';
    d.textContent = '还没有歌词。点上方「导入」选 LRC / SRT / VTT，或用「AI 逐字」在本机听写。';
    box.appendChild(d);
    if (sub) sub.textContent = '未加载 · 可导入 LRC / SRT / VTT';
    return;
  }
  if (sub) sub.textContent = (state.subLabel || '') + ' · ' + subs.length + ' 行';
  subs.forEach((line, i) => {
    const row = document.createElement('div');
    row.className = 'lrc-row';
    row.dataset.i = String(i);
    const t = document.createElement('span');
    t.className = 'lt';
    t.textContent = fmtTime(line.t + (state.subOffset || 0));
    const x = document.createElement('span');
    x.className = 'lx';
    x.textContent = line.text || '';
    row.appendChild(t);
    row.appendChild(x);
    row.addEventListener('click', () => seekMusicTo(line.t + (state.subOffset || 0)));
    box.appendChild(row);
    lrcRows.push(row);
  });
  updateLyricsPane(true);
}
function updateLyricsPane(force) {
  if (!lrcRows.length || state.mode !== 'music') return;
  const pane = $('paneLyrics');
  if (!pane || !pane.classList.contains('active')) return;
  const t = state.musicAudio ? state.musicAudio.currentTime : 0;
  const idx = subIdxAt(t);
  if (!force && idx === lrcActive) return;
  lrcActive = idx;
  for (let i = 0; i < lrcRows.length; i++) {
    lrcRows[i].classList.toggle('on', i === idx);
    lrcRows[i].classList.toggle('past', i < idx);
  }
  const row = lrcRows[idx];
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
}
function initLyricsPane() {
  const imp = $('btnLrcImport');
  if (imp) imp.addEventListener('click', () => $('subFile').click());
  const ai = $('btnLrcAi');
  if (ai) ai.addEventListener('click', () => aiTranscribe());
  const shift = d => {
    state.subOffset = clamp((state.subOffset || 0) + d, -30, 30);
    syncSubLabel();
    updateSubs(true);
    buildLyricsPane(true);
    saveSettings();
  };
  const mi = $('btnLrcMinus');
  if (mi) mi.addEventListener('click', () => shift(-0.5));
  const pl = $('btnLrcPlus');
  if (pl) pl.addEventListener('click', () => shift(0.5));
}

/* ---------- 3D 背景（three.js）：只铺在 K 线后面 ---------- */
let stageRAF = 0, stageLast = 0, stage3 = null;
const STAGE_N = 160, STAGE_COLS = 20, STAGE_ROWS = 8;
const STAGE_COLORS = { up: 0xff5a3c, down: 0x2fd6a0, grid: 0x1d3557, grid2: 0x122238 };
function stageColors() {
  return STAGE_COLORS;
}
function initStage3D() {
  if (stage3 || !window.THREE) return stage3;
  const cv = $('bg3d');
  const wrap = $('chartWrap');
  if (!cv || !wrap) return null;
  const w = Math.max(80, wrap.clientWidth), h = Math.max(80, wrap.clientHeight);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04070c, 0.026);
  const camera = new THREE.PerspectiveCamera(56, w / h, 0.1, 220);
  camera.position.set(0, 3.4, 9.5);
  camera.lookAt(0, 1.1, -14);

  const C = stageColors();
  const grid = new THREE.GridHelper(80, 40, C.grid, C.grid2);
  grid.position.set(0, 0, -18);
  grid.material.opacity = 0.55;
  grid.material.transparent = true;
  scene.add(grid);

  const geo = new THREE.BoxGeometry(0.62, 1, 0.62);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const mesh = new THREE.InstancedMesh(geo, mat, STAGE_N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STAGE_N * 3), 3);
  scene.add(mesh);
  const topGeo = new THREE.BoxGeometry(0.7, 0.05, 0.7);
  const topMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  const tops = new THREE.InstancedMesh(topGeo, topMat, STAGE_N);
  tops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STAGE_N * 3), 3);
  scene.add(tops);

  const PN = 260;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PN * 3);
  const pCol = new Float32Array(PN * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const ppt = new THREE.PointsMaterial({ size: 0.24, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(pGeo, ppt);
  scene.add(points);
  const pLife = new Float32Array(PN);
  const pVel = new Float32Array(PN);
  for (let i = 0; i < PN; i++) { pLife[i] = Math.random(); pVel[i] = 0.6 + Math.random() * 1.2; }

  scene.add(new THREE.AmbientLight(0x88aaff, 0.55));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(6, 12, 6);
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0x4488ff, 0.7);
  rim.position.set(-8, 6, -12);
  scene.add(rim);

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  /* HDR：WebGL2 rec2100-pq 画布 + 线性渲染 + ST2084 后处理 */
  let hdr = null;
  try {
    const gl = renderer.getContext();
    const hdrDisplay = (window.matchMedia && window.matchMedia('(dynamic-range: high)').matches) || /[?&]hdr=1/.test(location.search);
    if (renderer.capabilities.isWebGL2 && hdrDisplay && 'drawingBufferColorSpace' in gl) {
      gl.drawingBufferColorSpace = 'rec2100-pq';
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace });
      const quadScene = new THREE.Scene();
      const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const mat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: rt.texture }, npl: { value: 203 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: [
          'varying vec2 vUv; uniform sampler2D tDiffuse; uniform float npl;',
          'vec3 pq(vec3 L){ vec3 m1=vec3(0.1593017578125), m2=vec3(78.84375);',
          ' vec3 c1=vec3(0.8359375), c2=vec3(18.8515625), c3=vec3(18.6875);',
          ' vec3 Lp=pow(max(L,0.0),m1); return pow((c1+c2*Lp)/(1.0+c3*Lp),m2); }',
          'void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb * (npl/10000.0); gl_FragColor = vec4(pq(c),1.0); }'
        ].join(String.fromCharCode(10)),
        depthTest: false, depthWrite: false
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      quadScene.add(quad);
      hdr = { rt, quadScene, quadCam, mat };
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    }
  } catch (e) { hdr = null; }
  stage3 = {
    renderer, scene, camera, mesh, tops, grid, dummy, col, w, h,
    points, pPos, pCol, pLife, pVel, pN: PN, pGeo, hdr,
    init() {}
  };
  return stage3;
}
function resizeStage() {
  const st = stage3, wrap = $('chartWrap'), cv = $('bg3d');
  if (!st || !wrap || !cv) return;
  const fullW = Math.max(80, wrap.clientWidth), fullH = Math.max(80, wrap.clientHeight);
  const g = paneGeom(fullH);
  const w = Math.max(80, fullW - GUT_W), h = Math.max(60, g.mainH);
  if (w !== st.w || h !== st.h) {
    st.w = w; st.h = h;
    st.renderer.setSize(w, h, false);
    if (st.hdr) st.hdr.rt.setSize(w, h);
    st.camera.aspect = w / h;
    st.camera.updateProjectionMatrix();
  }
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
}
function drawStage3D(ts) {
  const st = stage3;
  if (!st) return;
  const now = state.musicAudio ? state.musicAudio.currentTime : (performance.now() / 1000) % 60;
  const f = frameAt(now);
  if (!f) return;
  const bands = f.bands;
  const prev = frameAt(Math.max(0, now - 0.15));
  const C = stageColors();
  const col = st.col;
  const white = st.white || (st.white = new THREE.Color(0xffffff));
  let i = 0;
  for (let r = 0; r < STAGE_ROWS; r++) {
    for (let c = 0; c < STAGE_COLS; c++, i++) {
      const bi = clamp(Math.round((c / (STAGE_COLS - 1)) * (BAND_COUNT - 1)), 0, BAND_COUNT - 1);
      const raw = (bands[bi] || 0) / 100;
      const v = Math.pow(clamp(raw, 0, 1), 0.55);
      const pvRaw = prev ? (prev.bands[bi] || 0) / 100 : raw;
      const pv = Math.pow(clamp(pvRaw, 0, 1), 0.55);
      const hgt = 0.15 + v * 5.2 + (1 - r / STAGE_ROWS) * 0.3;
      const x = (c - (STAGE_COLS - 1) / 2) * 1.25;
      const z = -3.5 - r * 4.2;
      st.dummy.position.set(x, hgt / 2, z);
      st.dummy.scale.set(1, hgt, 1);
      st.dummy.updateMatrix();
      st.mesh.setMatrixAt(i, st.dummy.matrix);
      if (st.tops) {
        st.dummy.position.set(x, hgt + 0.03, z);
        st.dummy.scale.set(1, 1, 1);
        st.dummy.updateMatrix();
        st.tops.setMatrixAt(i, st.dummy.matrix);
      }
      const isUp = v >= pv;
      col.setHex(isUp ? C.up : C.down);
      col.multiplyScalar(0.5 + v * 0.55);
      st.mesh.setColorAt(i, col);
      if (st.tops) {
        col.setHex(isUp ? C.up : C.down);
        col.lerp(white, 0.35 + v * 0.3);
        st.tops.setColorAt(i, col);
      }
    }
  }
  st.mesh.instanceMatrix.needsUpdate = true;
  if (st.mesh.instanceColor) st.mesh.instanceColor.needsUpdate = true;
  if (st.tops) {
    st.tops.instanceMatrix.needsUpdate = true;
    if (st.tops.instanceColor) st.tops.instanceColor.needsUpdate = true;
  }
  /* 塔顶拖尾粒子 */
  if (st.points) {
    const dt = 1 / 30;
    const flash = state.beatFlash || 0;
    for (let i = 0; i < st.pN; i++) {
      st.pLife[i] -= dt * 0.55;
      if (st.pLife[i] <= 0) {
        const ti = Math.floor(Math.random() * STAGE_N);
        const c = ti % STAGE_COLS, r = Math.floor(ti / STAGE_COLS);
        const bi = clamp(Math.round((c / (STAGE_COLS - 1)) * (BAND_COUNT - 1)), 0, BAND_COUNT - 1);
        const v = Math.pow(clamp((bands[bi] || 0) / 100, 0, 1), 0.55);
        const hgt = 0.15 + v * 5.2 + (1 - r / STAGE_ROWS) * 0.3;
        st.pPos[i * 3] = (c - (STAGE_COLS - 1) / 2) * 1.25 + (Math.random() - 0.5) * 0.3;
        st.pPos[i * 3 + 1] = hgt + Math.random() * 0.3;
        st.pPos[i * 3 + 2] = -3.5 - r * 4.2;
        st.pLife[i] = 0.7 + Math.random() * 0.9;
      }
      st.pPos[i * 3 + 1] += dt * st.pVel[i] * (0.6 + flash);
      const k = clamp(st.pLife[i], 0, 1) * (0.85 + flash * 0.6);
      st.pCol[i * 3] = k;
      st.pCol[i * 3 + 1] = k * 0.55;
      st.pCol[i * 3 + 2] = k * 0.35;
    }
    st.pGeo.attributes.position.needsUpdate = true;
    st.pGeo.attributes.color.needsUpdate = true;
  }
  /* 冷/暖色调：能量越高越暖 */
  if (st.scene.fog) {
    const e = clamp((f.rawRms || 0) / 60, 0, 1);
    st.scene.fog.color.setRGB(0.016 + e * 0.06, 0.03 + e * 0.012, 0.05 - e * 0.03);
  }
  /* 网格随拍脉冲 */
  if (st.grid && st.grid.material) st.grid.material.opacity = 0.26 + 0.55 * (state.beatFlash || 0);
  /* 雾密度随能量呼吸 */
  const rms = f.rawRms || 0;
  if (st.scene.fog) st.scene.fog.density = 0.023 + Math.min(0.012, (rms / 100) * 0.012);
  const tsec = now;
  st.camera.position.x = Math.sin(tsec * 0.13) * 1.6;
  st.camera.position.y = 3.3 + Math.sin(tsec * 0.09) * 0.35;
  st.camera.position.z = 9.2 + Math.sin(tsec * 0.055) * 1.1;
  st.camera.lookAt(0, 1.1 + Math.sin(tsec * 0.07) * 0.2, -14);
  if (st.hdr) {
    st.renderer.setRenderTarget(st.hdr.rt);
    st.renderer.render(st.scene, st.camera);
    st.renderer.setRenderTarget(null);
    st.renderer.render(st.hdr.quadScene, st.hdr.quadCam);
  } else {
    st.renderer.render(st.scene, st.camera);
  }
}
function startStage() {
  cancelAnimationFrame(stageRAF);
  stageLast = 0;
  const tick = ts => {
    if (state.stageMode !== '3d') return;
    if (!stageLast || ts - stageLast >= 33) {
      stageLast = ts;
      resizeStage();
      drawStage3D(ts);
    }
    stageRAF = requestAnimationFrame(tick);
  };
  stageRAF = requestAnimationFrame(tick);
}
function setStageMode(mode) {
  state.stageMode = mode === '3d' ? '3d' : 'normal';
  document.documentElement.dataset.stage = state.stageMode;
  const btn = $('btnStage');
  if (btn) btn.textContent = state.stageMode === '3d' ? '界面 · 3D' : '界面 · 普通';
  invalidatePalette();
  if (state.stageMode === '3d') {
    initStage3D();
    resizeStage();
    startStage();
    const badge = $('hdrBadge');
    if (badge) badge.hidden = !(stage3 && stage3.hdr);
  } else {
    cancelAnimationFrame(stageRAF);
  }
  if (state.mode === 'music') { drawMusic(true); canvasSwap(); }
  syncDrawTools();
  saveSettings();
}
/* ---------- 3D 行情墙：透视走廊 + 地面频谱 + 漂浮百分比 ---------- */
function drawWallPanel(ctx, P, X, Y, Z, W, H, yaw, v, energy, isUp, dark, up, down) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cs = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]]
    .map(([dx, dy]) => P(X + dx * cyw, Y + dy, Z + dx * syw));
  const fog = clamp(1 - (Z - 3.4) / 30, 0.1, 1);
  ctx.save();
  ctx.globalAlpha *= fog;
  ctx.beginPath();
  ctx.moveTo(cs[0][0], cs[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(cs[i][0], cs[i][1]);
  ctx.closePath();
  ctx.fillStyle = dark ? 'rgba(9,16,26,.72)' : 'rgba(255,255,255,.66)';
  ctx.fill();
  ctx.globalAlpha *= 0.6;
  ctx.strokeStyle = isUp ? up : down;
  ctx.lineWidth = 1;
  ctx.stroke();
  const mx = (cs[0][0] + cs[2][0]) / 2, my = (cs[0][1] + cs[2][1]) / 2;
  const span = Math.abs(cs[1][0] - cs[0][0]) + Math.abs(cs[2][0] - cs[1][0]);
  if (fog > 0.26 && span > 16) {
    const color = isUp ? up : down;
    const size = clamp(span * 0.15, 7, 30);
    ctx.globalAlpha = clamp(fog * 1.15, 0, 1);
    ctx.fillStyle = color;
    ctx.font = '700 ' + size.toFixed(0) + 'px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText(hzLabel(v), mx, my - size * 0.05);
    /* 能量条：数值是真频率，条长是当前能量 */
    const bw = span * 0.72, bh = Math.max(2, size * 0.16);
    const bx = mx - bw / 2, by = my + size * 0.28;
    ctx.globalAlpha *= 0.25;
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, bw, bh);
    ctx.globalAlpha = clamp(fog * 1.1, 0, 1) * 0.9;
    ctx.fillRect(bx, by, bw * clamp(energy / 100, 0, 1), bh);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}
function draw3DWall(ctx, w, h, t, now) {
  const f = frameAt(now);
  if (!f) return;
  const dark = state.theme === 'dark';
  const alpha = state.wall3dAlpha == null ? 0.9 : state.wall3dAlpha;
  const cx = w * 0.5, cy = h * 0.42;
  const fov = w * 0.72;
  const zNear = 3.4, zFar = 30;
  const flow = (now * 0.9) % 3.2;
  const bands = f.bands;
  const prev = frameAt(Math.max(0, now - 0.15));
  const up = t.up, down = t.down;
  const P = (X, Y, Z) => [cx + fov * X / Z, cy + fov * Y / Z, fov / Z];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  if (dark) { bg.addColorStop(0, '#04070c'); bg.addColorStop(0.5, '#070d16'); bg.addColorStop(1, '#010307'); }
  else { bg.addColorStop(0, '#f8fafd'); bg.addColorStop(0.5, '#eef3fa'); bg.addColorStop(1, '#dfe8f4'); }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = dark ? 'rgba(80,130,190,.16)' : 'rgba(60,110,180,.2)';
  for (let i = 0; i < 10; i++) {
    const Z = zNear + i * 2.4;
    const a = P(-9, 3.1, Z), b = P(9, 3.1, Z);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (let i = -8; i <= 8; i++) {
    const a = P(i * 1.15, 3.1, zNear), b = P(i * 1.15, 3.1, zFar);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  const rows = [-1.35, 0.35];
  const cols = [2.7, 4.5, 6.3];
  for (let side = -1; side <= 1; side += 2) {
    for (let ci = 0; ci < cols.length; ci++) {
      for (let ri = 0; ri < rows.length; ri++) {
        const yaw = side * (0.4 + ci * 0.12);
        for (let k = 0; k < 4; k++) {
          const Z = zNear + ((k * 6.1 + flow * 1.4 + ci * 1.3 + ri * 0.9) % (zFar - zNear));
          const bi = clamp(Math.round(((ci * 2 + ri + 1) / 6) * (BAND_COUNT - 1)), 0, BAND_COUNT - 1);
          const v = bands[bi] || 0;
          const pv = prev ? (prev.bands[bi] || 0) : v;
          drawWallPanel(ctx, P, side * cols[ci], rows[ri], Z, 2.1, 1.05, yaw, bandCenterHz(bi, BAND_COUNT), v, v >= pv, dark, up, down);
        }
      }
    }
  }
  const nBars = 26;
  for (let i = 0; i < nBars; i++) {
    const X = -7.5 + (i / (nBars - 1)) * 15;
    const Z = zNear + 1.2 + ((i * 1.7 + flow * 2.2) % (zFar - zNear - 3));
    const bi = clamp(Math.round((i / (nBars - 1)) * (BAND_COUNT - 1)), 0, BAND_COUNT - 1);
    const v = (bands[bi] || 0) / 100;
    const hgt = 0.25 + v * 2.2;
    const a = P(X, 3.1, Z), b = P(X, 3.1 - hgt, Z);
    const bw = Math.max(1.5, a[2] * 0.2);
    ctx.fillStyle = dark ? 'rgba(80,160,255,.68)' : 'rgba(40,120,220,.5)';
    ctx.fillRect(a[0] - bw / 2, b[1], bw, a[1] - b[1]);
  }
  const pcts = [0.52, -0.94, 0.47, 1.26, -0.31, 0.88];
  for (let i = 0; i < pcts.length; i++) {
    const Z = zNear + 3 + ((i * 5.3 + flow * 0.6) % (zFar - zNear - 6));
    const X = (i % 2 ? 1 : -1) * (2 + (i % 3) * 1.6);
    const Y = -1.9 + (i % 3) * 1.4;
    const p = P(X, Y, Z);
    const size = clamp(p[2] * 0.05, 8, 42);
    ctx.globalAlpha = alpha * 0.42;
    ctx.fillStyle = pcts[i] >= 0 ? up : down;
    ctx.font = '700 ' + size.toFixed(0) + 'px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText((pcts[i] >= 0 ? '+' : '') + pcts[i].toFixed(2) + '%', p[0], p[1]);
    ctx.globalAlpha = alpha;
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

function videoFilterCss() {
  const f = state.videoFilter || 'none';
  if (f === 'blur') return 'blur(6px)';
  if (f === 'gray') return 'grayscale(1)';
  if (f === 'warm') return 'sepia(.45) saturate(1.25)';
  return 'none';
}
function hookVideoAB() {
  const v = state.videoEl;
  if (!v) return;
  v.ontimeupdate = () => {
    const { a, b } = state.videoAB || {};
    if (a != null && b != null && b > a && v.currentTime >= b - 0.03) {
      try { v.currentTime = a; } catch (e) {}
    }
  };
}
function stepVideoFrame(d) {
  const v = state.videoEl;
  if (!v) { toast('先导入视频'); return; }
  setPlaying(false);
  try { v.currentTime = clamp(v.currentTime + d / 30, 0, (v.duration || 999) - 0.03); } catch (e) {}
  drawMusic(true);
}
function drawVideoLayer(ctx, x, y, w, h) {
  if (!videoReady()) return false;
  const v = state.videoEl;
  const cw = Math.max(1, w - 2), chh = Math.max(1, h - 2);
  const vw = v.videoWidth, vh = v.videoHeight;
  if (state.videoPane === 'corner') {
    const ww = clamp(w * 0.3, 180, 560);
    const hh = ww * (vw && vh ? vh / vw : 9 / 16);
    const wx = x + w - ww - 14, wy = y + h - hh - 14;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(wx, wy, ww, hh, 8);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(wx, wy, ww, hh);
    const f0 = videoFilterCss();
    if (f0 !== 'none') ctx.filter = f0;
    ctx.drawImage(v, wx, wy, ww, hh);
    ctx.filter = 'none';
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(wx, wy, ww, hh, 8);
    ctx.strokeStyle = 'rgba(255,90,60,.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    return true;
  }
  let dw = cw, dh = chh, dx = x + 1, dy = y + 1;
  const fit = state.videoFit || 'cover';
  if (fit !== 'fill' && vw && vh) {
    const scale = fit === 'contain' ? Math.min(cw / vw, chh / vh) : Math.max(cw / vw, chh / vh);
    dw = vw * scale;
    dh = vh * scale;
    dx = x + 1 + (cw - dw) / 2;
    dy = y + 1 + (chh - dh) / 2;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, cw, chh);
  ctx.clip();
  ctx.globalAlpha = state.videoAlpha;
  const f = videoFilterCss();
  if (f !== 'none') ctx.filter = f;
  const sc = clamp(state.videoScale || 1, 0.5, 2);
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.scale(sc * (state.videoFlipX ? -1 : 1), sc);
  ctx.drawImage(v, -dw / 2, -dh / 2, dw, dh);
  ctx.filter = 'none';
  ctx.restore();
  return true;
}
function frameAt(time) {
  const a = state.meta && state.meta.analysis;
  if (!a || !a.frames.length) return null;
  const idx = clamp(Math.round(time / a.hopSec), 0, a.frames.length - 1);
  return a.frames[idx];
}

async function loadMusicDataset(meta, opts = {}) {
  const token = ++state.loadToken;
  cancelAnalysis();
  state.mode = 'music';
  state.meta = meta;
  state.period = 'music';
  state.playing = false;
  applyModeCopy();
  $('startTitle').textContent = meta.name;
  $('startSub').textContent = '分析音频…';
  $('startDesc').textContent = '';
  if (!opts.noOverlay) $('startOverlay').classList.remove('hidden');
  else hideStartOverlay();
  if (!meta.demo) stopAudio();
  if (!meta.analysis || meta.analysisSmooth !== state.musicSmooth) {
    toast('分析音频…');
    let buffer = meta.buffer;
    if (!buffer) {
      const arrayBuffer = meta.demo ? dataUriToBuffer(window.KLINE_DEMO_AUDIO) : await meta.file.arrayBuffer();
      buffer = await decodeAudio(arrayBuffer);
      meta.buffer = buffer;
      meta.duration = buffer.duration;
      meta.sampleRate = buffer.sampleRate;
      meta.channels = buffer.numberOfChannels;
      if (!meta.desc) meta.desc = fmtTime(meta.duration) + ' · 本地音频';
    }
    meta.analysis = await runAnalysis(buffer).catch(() => null);
    if (!meta.analysis) return;
    meta.analysisSmooth = state.musicSmooth;
    if (token !== state.loadToken) return;
  }
  if (meta.analysis) {
    meta.bpm = meta.analysis.bpm || meta.bpm;
    meta.beatPhase = meta.analysis.beatPhase || 0;
    meta.beatConf = meta.analysis.beatConf || 0;
    meta.onsets = meta.analysis.onsets || [];
  }
  ensureMusicAudio(meta);
  ensureMusicVideo(meta);
  if (state.musicAudio) {
    state.musicAudio.currentTime = 0;
    state.musicAudio.volume = state.musicVolume;
    state.musicAudio.playbackRate = state.musicRate;
    state.musicAudio.loop = state.loop;
  }
  setSubs(meta.subs || [], meta.subs && meta.subs.length ? meta.subs.length + ' 条' : '');
  rebuildMusic(state.musicWindow);
  renderSidebarActive();
  if (!opts.noOverlay) showStartOverlay();
  else hideStartOverlay();
  saveSettings();
}

function loadMarketDataset(meta, opts = {}) {
  state.loadToken++;
  stopAudio();
  ensureMusicVideo({});
  state.mode = 'market';
  state.meta = meta;
  state.raw = DATA[meta.id] ? DATA[meta.id].candles : [];
  if (!state.raw || !state.raw.length) { toast('没有 K 线数据'); return; }
  const period = opts.period || (PERIOD_LABEL[state.period] ? state.period : 'day');
  state.period = period;
  state.series = aggregate(state.raw, period);
  state.ind = computeIndicators(state.series);
  state.kline = toKLine(state.series);
  state.tsIndex = new Map(state.kline.map((k, i) => [k.timestamp, i]));
  state.chapters = (meta.chapters || []).map(ch => ({ ...ch, idx: findIndexByDate(state.series, ch.date) }));
  let idx = findIndexByDate(state.series, meta.startDate || meta.first);
  if (typeof opts.index === 'number' && isFinite(opts.index)) idx = opts.index;
  if (opts.date) idx = findIndexByDate(state.series, opts.date);
  state.maxVol = 1;
  for (const c of state.series) if ((c[5] || 0) > state.maxVol) state.maxVol = c[5];
  state.playhead = clamp(idx, 0, state.series.length - 1);
  state.lastInt = -1;
  state.lastChapterIdx = -1;
  state.activeChapterIdx = -1;
  state.hoverIndex = null;
  state.musicHover = null;
  state.endShown = false;
  state.playing = false;
  applyModeCopy();
  if (chart) {
    chart.setPriceVolumePrecision(meta.digits, 0);
    chart.applyNewData(state.marketReplay ? state.kline.slice(0, Math.floor(state.playhead) + 1) : state.kline);
    chart.setBarSpace(state.barSpace);
    chart.scrollToRealTime(0);
    replayDrawings();
    syncDrawTools();
    resetPlayLine();
    smoothK = -1;
    canvasSwap();
  }
  renderSidebarActive();
  buildChapters();
  buildTimelineMarks();
  updateStaticInfo();
  updateAllUI(true);
  updateVisualUI();
  updatePlayUI();
  if (!opts.noOverlay) showStartOverlay();
  else hideStartOverlay();
  saveSettings();
}

function loadDataset(id, opts = {}) {
  const meta = LIBRARY.find(m => m.id === id) || LIBRARY[0];
  if (!meta) return Promise.resolve();
  if (meta.kind === 'music') return loadMusicDataset(meta, opts);
  return Promise.resolve(loadMarketDataset(meta, opts));
}

/* ================= playback ================= */
function setPlaying(v, silent) {
  if (!state.meta) return;
  if (state.mode === 'music') {
    const audio = state.musicAudio;
    if (!audio) return;
    if (v) {
      if (state.playhead >= state.series.length - 1 && audio.currentTime >= (audio.duration || state.meta.duration) - 0.05) {
        audio.currentTime = 0;
      }
      state.playing = true;
      syncVideo(true, true);
      audio.play().catch(() => { state.playing = false; updatePlayUI(); toast('点击播放按钮开始'); });
    } else {
      audio.pause();
      state.playing = false;
      syncVideo(false, true);
    }
  } else {
    if (!v) finishSmooth();
    if (v && state.playhead >= state.series.length - 1) {
      setPlayhead(0, { fromUser: true });
      state.endShown = false;
    }
    state.playing = !!v;
    if (state.playing && state.sound) AudioFX.ensure();
  }
  if (videoRec) { try { v ? videoRec.resume() : videoRec.pause(); } catch (e) {} }
  updatePlayUI();
  if (!silent) updateAllUI(true);
}
function togglePlay() {
  if (!state.meta) return;
  if (state.startOpen) hideStartOverlay();
  if (state.playing) setPlaying(false);
  else setPlaying(true);
}
function setPlayhead(v, opts = {}) {
  if (!state.meta) return;
  const N = state.series.length;
  if (state.mode === 'music') {
    const audio = state.musicAudio;
    if (!audio) return;
    const dur = audio.duration || state.meta.duration;
    const t = clamp(v * state.musicWindow, 0, Math.max(0, dur - 0.02));
    try { audio.currentTime = t; } catch (e) {}
    syncVideo(state.playing, true);
    state.playhead = t / state.musicWindow;
    if (state.playhead < N - 1) state.endShown = false;
    updateActiveChapter();
    updateAllUI(true);
    updateLegend();
    updateFoot();
    drawMusic(true);
    refreshBook();
    updateSubs(true);
    return;
  }
  state.playhead = clamp(v, 0, N - 1);
  if (state.playhead < N - 1) state.endShown = false;
  syncChart(false);
  updateActiveChapter();
  updateAllUI(true);
  updateLegend();
  updateFoot();
  refreshBook();
  if (opts.fromUser) saveSettings();
}
function syncChart(forceReset) {
  if (state.mode === 'music') { drawMusic(true); return; }
  if (!chart || !state.kline.length) return;
  const replay = !!state.marketReplay;
  const target = replay ? clamp(Math.floor(state.playhead) + 1, 1, state.kline.length) : state.kline.length;
  try {
    const list = chart.getDataList() || [];
    const current = list.length;
    if (forceReset || target < current) {
      chart.applyNewData(state.kline.slice(0, target));
    } else if (target > current) {
      chart.applyMoreData(state.kline.slice(current, target));
    }
    /* 自由浏览时不动用户的缩放/平移，只有回放才跟到最右 */
    if (replay) { chart.setBarSpace(state.barSpace); chart.scrollToRealTime(0); }
  } catch (e) {
    try { chart.applyNewData(state.kline.slice(0, target)); if (replay) { chart.setBarSpace(state.barSpace); chart.scrollToRealTime(0); } } catch (e2) {}
  }
}
function step(n) {
  if (!state.meta) return;
  setPlaying(false);
  setPlayhead(Math.floor(state.playhead) + n, { fromUser: true });
}
function jumpChapter(dir) {
  if (!state.chapters.length) return;
  const idx = Math.floor(state.playhead);
  let target = null;
  if (dir > 0) target = state.chapters.find(ch => ch.idx > idx) || state.chapters[0];
  else {
    const before = state.chapters.filter(ch => ch.idx < idx - 1);
    target = before.length ? before[before.length - 1] : state.chapters[state.chapters.length - 1];
  }
  if (!target) return;
  if (state.mode === 'music' && target.time != null) setPlayhead(target.time / state.musicWindow, { fromUser: true });
  else setPlayhead(target.idx, { fromUser: true });
  triggerChapter(target);
}
function checkChapters(prev, cur) {
  if (!state.chapters.length) return;
  const p = Math.floor(prev), c = Math.floor(cur);
  let hit = null;
  for (const ch of state.chapters) if (ch.idx > p && ch.idx <= c) hit = ch;
  if (hit) {
    state.lastChapterIdx = Math.max(state.lastChapterIdx, hit.idx);
    triggerChapter(hit);
  }
  updateActiveChapter();
}
let bannerTimer = 0;
function showEvent(ch) {
  if (state.mode === 'music') return;
  const banner = $('eventBanner');
  if (!banner) return;
  banner.querySelector('.event-title').textContent = ch.title;
  banner.querySelector('.event-desc').textContent = ch.desc || '';
  banner.querySelector('.event-price').textContent = fmtPrice(ch.price, state.meta ? state.meta.digits : 1);
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), 6000);
}
function triggerChapter(ch) {
  if (state.mode === 'music') return;
  showEvent(ch);
  if (state.danmaku) {
    const pool = DM_BY_ID[state.meta.id] || DM_MARKET;
    for (let i = 0; i < 2; i++) spawnDanmaku(pool[Math.floor(Math.random() * pool.length)]);
  }
  if (state.mode === 'market' && (ch.move <= -4 || ch.move >= 4)) AudioFX.crash();
  else AudioFX.event();
}
function currentChapterAt() {
  if (!state.chapters.length) return null;
  const idx = Math.floor(state.playhead);
  let active = null;
  for (const ch of state.chapters) if (ch.idx <= idx) active = ch;
  return active || state.chapters[0];
}
function updateActiveChapter() {
  if (!state.chapters.length) return;
  const idx = Math.floor(state.playhead);
  let active = -1;
  for (let i = 0; i < state.chapters.length; i++) if (state.chapters[i].idx <= idx) active = i;
  if (active === state.activeChapterIdx) return;
  state.activeChapterIdx = active;
  document.querySelectorAll('.chapter-item').forEach(el => el.classList.toggle('active', Number(el.dataset.idx) === active));
  document.querySelectorAll('.tl-mark').forEach(el => el.classList.toggle('active', Number(el.dataset.idx) === active));
  if (active >= 0 && state.playing) {
    const item = document.querySelector('.chapter-item.active');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }
}
const LOOP_LABELS = { off: '循环:关', one: '循环:单曲', all: '循环:列表' };
function setLoopMode(m, silent) {
  state.loopMode = m;
  state.loop = m !== 'off';
  if (state.musicAudio) state.musicAudio.loop = m === 'one';
  const btn = $('rbLoop');
  if (btn) btn.textContent = LOOP_LABELS[m];
  const b2 = $('btnLoopTop');
  if (b2) b2.classList.toggle('active', m !== 'off');
  if (!silent) saveSettings();
}
function cycleLoop() {
  const order = ['off', 'one', 'all'];
  const m = order[(order.indexOf(state.loopMode || 'off') + 1) % order.length];
  setLoopMode(m);
  toast('循环：' + ({ off: '关闭', one: '单曲', all: '列表' }[m]));
}
function skipSeconds(d) {
  if (state.mode === 'music' && state.musicAudio) {
    const dur = state.musicAudio.duration || (state.meta && state.meta.duration) || 0;
    const t = clamp(state.musicAudio.currentTime + d, 0, Math.max(0, dur - 0.05));
    setPlayhead(t / state.musicWindow, { fromUser: true });
  } else if (state.series.length) {
    setPlayhead(state.playhead + d * (state.speed || 1), { fromUser: true });
  }
}
function endReached() {
  const mode = state.loopMode || (state.loop ? 'one' : 'off');
  if (mode === 'off') {
    state.playing = false;
    updatePlayUI();
    updateAllUI(true);
    toast('播放结束');
    return;
  }
  if (mode !== 'one' && state.queue.length) {
    const nextId = state.queue.shift();
    renderQueue();
    saveSettings();
    if (LIBRARY.find(m => m.id === nextId)) {
      toast('队列接播：' + (LIBRARY.find(m => m.id === nextId).name));
      loadDataset(nextId).then(() => setPlaying(true)).catch(() => {});
      return;
    }
  }
  if (state.endShown && !state.loop) return;
  if (state.loop) {
    if (state.mode === 'music' && state.musicAudio) {
      state.musicAudio.currentTime = 0;
      setPlayhead(0);
      state.musicAudio.play().catch(() => {});
      return;
    }
    state.playhead = 0;
    state.lastInt = -1;
    state.lastChapterIdx = -1;
    state.activeChapterIdx = -1;
    syncChart(true);
    updateAllUI(true);
    return;
  }
  state.endShown = true;
  if (state.mode === 'music' && state.musicAudio) {
    state.musicAudio.pause();
    state.playing = false;
    state.playhead = state.series.length - 1;
    syncChart(false);
  } else {
    state.playhead = state.series.length - 1;
    state.playing = false;
    syncChart(false);
  }
  updatePlayUI();
  updateAllUI(true);
  toast('播放结束');
}
function syncMusicPlayback(dt) {
  const audio = state.musicAudio;
  if (!audio || !state.meta) return;
  if (abActive() && audio.currentTime >= state.ab.b - 0.02) {
    try { audio.currentTime = state.ab.a; } catch (e) {}
  }
  if (state.videoEl) syncVideo(state.playing && !audio.paused);
  const beatSec = state.showBeat && bpmOf() ? 60 / bpmOf() : 0;
  if (beatSec) {
    const bi = Math.floor((audio.currentTime - beatPhaseOf()) / beatSec);
    if (bi !== state.lastBeat) {
      state.lastBeat = bi;
      state.beatFlash = ((bi % (state.meta.beatsPerBar || 4)) + (state.meta.beatsPerBar || 4)) % (state.meta.beatsPerBar || 4) === 0 ? 1 : 0.45;
    }
  }
  state.beatFlash = Math.max(0, (state.beatFlash || 0) - dt * 3.2);
  const prev = state.playhead;
  state.playhead = audio.currentTime / state.musicWindow;
  const idx = Math.floor(state.playhead);
  const changed = idx !== state.lastInt;
  if (changed) {
    syncChart(false);
    state.lastInt = idx;
    checkChapters(prev, state.playhead);
  }
  updateAllUI(changed);
  updateSubs(false);
  drawMusic(false);
  if (audio.duration && audio.currentTime >= audio.duration - 0.05) endReached();
}
function playbackFrame(now) {
  const dt = Math.min(0.12, (now - state.lastFrame) / 1000 || 0);
  state.lastFrame = now;
  if (state.meta) {
    if (state.mode === 'music') {
      const audio = state.musicAudio;
      if (audio && state.playing && !audio.paused) { syncMusicPlayback(dt); updateTimeLabels(); }
    } else if (state.playing) {
      const prev = state.playhead;
      const N = state.series.length;
      const next = prev + dt * state.speed;
      if (next >= N - 1) {
        state.playhead = N - 1;
        checkChapters(prev, N - 1);
        syncChart(false);
        updateAllUI(true);
        endReached();
      } else {
        state.playhead = next;
        const newInt = Math.floor(next);
        if (newInt !== state.lastInt) {
          state.lastInt = newInt;
          syncPlayLine();
          drawWaveStrip();
          if (state.sonify) Sonify.bar(newInt);
        }
        smoothChartTick();
        autoFollowChart();
        checkChapters(prev, next);
        updateAllUI();
        updateDanmaku(dt);
      }
    }
  }
  requestAnimationFrame(playbackFrame);
}

/* ================= UI ================= */
function updateThemeBtn() {
  const b = $('btnThemeTop');
  if (b) b.textContent = state.theme === 'dark' ? '浅色' : '深色';
}
function canvasSwap() {
  ['musicCanvas', 'chart'].forEach(id => {
    const cv = $(id);
    if (!cv) return;
    cv.classList.remove('swap');
    void cv.offsetWidth;
    cv.classList.add('swap');
  });
}
function setTheme(name, quiet) {
  state.theme = name === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  specCache.L = null; specCache.R = null;
  if (chart) { try { chart.setStyles(themeChartStyles()); } catch (e) {} }
  if (state.mode === 'music') drawMusic(true); else { syncChart(false); updateLegend(); }
  drawWaveStrip();
  updateThemeBtn();
  canvasSwap();
  if (!quiet) saveSettings();
}
function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
function applyPaletteChange() {
  invalidatePalette();
  if (chart) { try { chart.setStyles(themeChartStyles()); } catch (e) {} }
  if (state.mode === 'music') drawMusic(true); else syncChart(false);
  drawWaveStrip();
}
function applyDensity() {
  document.documentElement.dataset.density = state.density;
  requestAnimationFrame(() => {
    resizeMusicCanvas();
    drawMusic(true);
    try { if (chart) chart.resize(); } catch (e) {}
  });
}
function syncStyleChips() {
  const set = (sel, fn) => document.querySelectorAll(sel).forEach(b => b.classList.toggle('active', fn(b)));
  set('#themeChips button', b => b.dataset.theme === state.theme);
  set('#upDownChips button', b => (b.dataset.updown === 'red') === state.upIsRed);
  set('#densityChips button', b => b.dataset.density === state.density);
  set('#shareChips button', b => Number(b.dataset.scale) === state.shareScale);
  set('#fftChips button', b => Number(b.dataset.n) === state.fftSize);
  set('#hopChips button', b => Number(b.dataset.hop) === state.hopSec);
  set('#rangeChips button', b => Number(b.dataset.range) === state.bandRange);
  set('#freqScaleChips button', b => b.dataset.fscale === state.freqAxis);
  set('#ampScaleChips button', b => b.dataset.ascale === state.ampScale);
  const hr = $('heatRange');
  if (hr) hr.value = state.heatGain;
  const hv = $('heatVal');
  if (hv) hv.textContent = state.heatGain.toFixed(2);
  const vr = $('vidRange');
  if (vr) vr.value = state.videoAlpha;
  const gr = $('gapRange');
  if (gr) gr.value = state.barGap;
  const gn = $('gapNum'); if (gn) gn.value = state.barGap;
  const wn = $('winNum'); if (wn) wn.value = state.musicWindow;
  const bn = $('bandNum'); if (bn) bn.value = effBands();
  const vn = $('viewNum'); if (vn) vn.value = state.viewSpan;
  const rl = $('rbLoop'); if (rl) rl.textContent = LOOP_LABELS[state.loopMode || 'off'];
  const mb2 = $('rbMute'); if (mb2) mb2.textContent = state.musicVolume === 0 ? '已静音' : '静音';
  const cs = $('chkSubs'); if (cs) cs.checked = !!state.showSubs;
  const rv = $('rbVol'); if (rv) rv.value = state.musicVolume;
  const gv = $('gapVal');
  if (gv) gv.textContent = state.barGap.toFixed(2);
  document.querySelectorAll('#axisChips button').forEach(b => b.classList.toggle('active', b.dataset.axis === state.kMode));
  document.querySelectorAll('#typeChips button').forEach(b => b.classList.toggle('active', b.dataset.type === state.chartType));
  document.querySelectorAll('#fitChips button').forEach(b => b.classList.toggle('active', b.dataset.fit === state.videoFit));
  document.querySelectorAll('#specLChips button').forEach(b => b.classList.toggle('active', b.dataset.st === state.specTypeL));
  document.querySelectorAll('#specRChips button').forEach(b => b.classList.toggle('active', b.dataset.st === state.specTypeR));
  const vv = $('vidVal');
  if (vv) vv.textContent = Math.round(state.videoAlpha * 100) + '%';
  [['chkVideo', 'videoOn'], ['chkWall', 'wall3d'], ['chkBeat', 'showBeat'], ['chkWatermark', 'showWatermark'], ['chkEnvelope', 'showEnvelope'], ['chkGlow', 'showGlow']].forEach(([id, key]) => {
    const el = $(id);
    if (el) el.checked = !!state[key];
  });
}
function rebuildSpectrumOnly() {
  if (!state.meta || !state.meta.analysis) return;
  const rows = Math.max(1, effBands());
  state.spectrumRows = rows;
  const pair = buildSpectrumPair(state.meta.analysis.frames, rows, state.spectrumStep, state.meta.duration);
  state.spectrumL = pair.L;
  state.spectrumR = pair.R;
  invalidatePalette();
  drawMusic(true);
  updateVisualUI();
}
function bindStylePanel() {
  document.querySelectorAll('#themeChips button').forEach(b => b.addEventListener('click', () => {
    setTheme(b.dataset.theme);
    syncStyleChips();
  }));
  document.querySelectorAll('#upDownChips button').forEach(b => b.addEventListener('click', () => {
    state.upIsRed = b.dataset.updown === 'red';
    applyPaletteChange();
    saveSettings();
    syncStyleChips();
  }));
  document.querySelectorAll('#densityChips button').forEach(b => b.addEventListener('click', () => {
    state.density = b.dataset.density;
    applyDensity();
    saveSettings();
    syncStyleChips();
  }));
  document.querySelectorAll('#freqScaleChips button').forEach(b => b.addEventListener('click', () => {
    state.freqAxis = b.dataset.fscale;
    rebuildSpectrumOnly();
    saveSettings();
    syncStyleChips();
  }));
  document.querySelectorAll('#ampScaleChips button').forEach(b => b.addEventListener('click', () => {
    state.ampScale = b.dataset.ascale;
    invalidatePalette();
    drawMusic(true);
    saveSettings();
    syncStyleChips();
  }));
  document.querySelectorAll('#shareChips button').forEach(b => b.addEventListener('click', () => {
    state.shareScale = Number(b.dataset.scale);
    saveSettings();
    syncStyleChips();
  }));
  let heatRAF = 0;
  on('heatRange', 'input', e => {
    state.heatGain = Number(e.target.value);
    $('heatVal').textContent = state.heatGain.toFixed(2);
    if (heatRAF) return;
    heatRAF = requestAnimationFrame(() => { heatRAF = 0; applyPaletteChange(); });
  });
  on('heatRange', 'change', () => { applyPaletteChange(); saveSettings(); });
  [['chkBeat', 'showBeat'], ['chkWatermark', 'showWatermark'], ['chkEnvelope', 'showEnvelope'], ['chkGlow', 'showGlow']].forEach(([id, key]) => on(id, 'change', e => {
    state[key] = e.target.checked;
    applyPaletteChange();
    saveSettings();
  }));
  on('chkVideo', 'change', e => {
    state.videoOn = e.target.checked;
    syncVideo(state.playing);
    if (state.mode === 'music') drawMusic(true);
    saveSettings();
  });
  on('chkWall', 'change', e => {
    state.wall3d = e.target.checked;
    if (state.mode === 'music') drawMusic(true);
    saveSettings();
    toast(state.wall3d ? '3D 行情墙已开' : '3D 行情墙已关');
  });
  document.querySelectorAll('#paneChips button').forEach(b => b.addEventListener('click', () => {
    state.videoPane = b.dataset.pane;
    document.querySelectorAll('#paneChips button').forEach(x => x.classList.toggle('active', x === b));
    if (state.mode === 'music') drawMusic(true);
    saveSettings();
  }));
  on('vscRange', 'input', e => {
    state.videoScale = clamp(Number(e.target.value), 0.5, 2);
    const l = $('vscVal'); if (l) l.textContent = state.videoScale.toFixed(2);
    if (state.mode === 'music') drawMusic(true);
  });
  on('vscRange', 'change', saveSettings);
  document.querySelectorAll('#vfilterChips button').forEach(b => b.addEventListener('click', () => {
    state.videoFilter = b.dataset.vf;
    document.querySelectorAll('#vfilterChips button').forEach(x => x.classList.toggle('active', x === b));
    if (state.mode === 'music') drawMusic(true);
    saveSettings();
  }));
  on('btnVidFlip', 'click', () => { state.videoFlipX = !state.videoFlipX; if (state.mode === 'music') drawMusic(true); saveSettings(); toast(state.videoFlipX ? '画面已镜像' : '镜像已关'); });
  on('btnVidPip', 'click', async () => {
    const v = state.videoEl;
    if (!v) { toast('先导入视频'); return; }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (e) { toast('画中画不可用'); }
  });
  on('btnVidFree', 'click', () => {
    state.videoFree = !state.videoFree;
    const b = $('btnVidFree'); if (b) b.classList.toggle('active', state.videoFree);
    const v = state.videoEl;
    if (v && state.videoFree) { try { v.playbackRate = state.videoRate || 1; v.play().catch(() => {}); } catch (e) {} }
    toast(state.videoFree ? '视频独立播放（不跟随音频）' : '视频跟随音频');
    saveSettings();
  });
  on('vidRate', 'change', e => {
    state.videoRate = clamp(Number(e.target.value) || 1, 0.25, 2);
    const v = state.videoEl; if (v) { try { v.playbackRate = state.videoRate; } catch (err) {} }
    saveSettings();
  });
  on('btnVidPlay', 'click', () => {
    const v = state.videoEl;
    if (!v) { toast('先导入视频'); return; }
    if (state.videoFree) { if (v.paused) v.play().catch(() => {}); else v.pause(); return; }
    setPlaying(!state.playing);
  });
  on('btnVidA', 'click', () => {
    const v = state.videoEl; if (!v) return;
    state.videoAB.a = v.currentTime;
    if (state.videoAB.b != null && state.videoAB.b <= state.videoAB.a) state.videoAB.b = null;
    hookVideoAB();
    toast('视频 A ' + state.videoAB.a.toFixed(2) + 's');
  });
  on('btnVidB', 'click', () => {
    const v = state.videoEl; if (!v) return;
    state.videoAB.b = v.currentTime;
    hookVideoAB();
    toast('视频 A-B ' + (state.videoAB.a || 0).toFixed(2) + '–' + state.videoAB.b.toFixed(2) + 's');
  });
  on('btnVidNextClip', 'click', () => {
    const cur = state.meta ? LIBRARY.findIndex(m => m.id === state.meta.id) : -1;
    for (let i = 1; i <= LIBRARY.length; i++) {
      const m = LIBRARY[(Math.max(0, cur) + i) % LIBRARY.length];
      if (m && m.videoUrl) { loadDataset(m.id); toast('下一段：' + m.name); return; }
    }
    toast('列表里没有其它视频');
  });
  on('btnFreqApply', 'click', async () => {
    const a = clamp(Number($('fminNum').value) || 40, 20, 2000);
    const b = clamp(Number($('fmaxNum').value) || 12000, Math.max(a + 500, 2000), 20000);
    state.freqMin = a; state.freqMax = b; state.freqOverride = true;
    toast('重分析：' + a + '–' + b + ' Hz');
    await reanalyzeCurrent();
  });
  on('chkNormPeak', 'change', async e => {
    state.normPeak = !!e.target.checked;
    await reanalyzeCurrent();
  });
  on('btnSnapBars', 'click', () => {
    state.snapBars = !state.snapBars;
    $('btnSnapBars').classList.toggle('active', state.snapBars);
    updateAllUI(true); drawWaveStrip(); saveSettings();
  });
  on('btnShowStrip', 'click', () => {
    state.showStrip = !state.showStrip;
    $('btnShowStrip').classList.toggle('active', state.showStrip);
    drawWaveStrip(); saveSettings();
  });
  on('btnSubTrackRename', 'click', () => {
    const sel = $('subTrackSel');
    const i = Number(sel && sel.value);
    if (!subTracks[i]) { toast('没有可重命名的字幕轨'); return; }
    const name = prompt('字幕轨名称', subTracks[i].name);
    if (!name) return;
    subTracks[i].name = name.slice(0, 24);
    if (subTracks[i].list === state.subs) { state.subLabel = subTracks[i].name; syncSubLabel(); }
    renderSubTracks(); saveSettings();
  });
  on('btnSubTrackDel', 'click', () => {
    const sel = $('subTrackSel');
    const i = Number(sel && sel.value);
    if (!subTracks[i]) { toast('没有可删的字幕轨'); return; }
    subTracks.splice(i, 1);
    if (!subTracks.length) setSubs([], '');
    else { const t = subTracks[Math.max(0, i - 1)]; state.subs = t.list; state.subLabel = t.name; syncSubLabel(); updateSubs(true); updateSubDock(true); }
    renderSubTracks(); toast('字幕轨已删除');
  });
  on('subTrackSel', 'change', e => {
    const t = subTracks[Number(e.target.value)];
    if (!t) return;
    state.subs = t.list;
    state.subLabel = t.name;
    syncSubLabel();
    updateSubs(true);
    updateSubDock(true);
    toast('字幕轨：' + t.name);
  });
  on('btnVidPrev', 'click', () => stepVideoFrame(-1));
  on('btnVidNext', 'click', () => stepVideoFrame(1));
  on('vidRange', 'input', e => {
    state.videoAlpha = clamp(Number(e.target.value), 0, 1);
    const vv = $('vidVal');
    if (vv) vv.textContent = Math.round(state.videoAlpha * 100) + '%';
    if (state.mode === 'music') drawMusic(true);
  });
  on('vidRange', 'change', () => saveSettings());
  document.querySelectorAll('#axisChips button').forEach(b => b.addEventListener('click', () => {
    if (state.kMode === b.dataset.axis) return;
    state.kMode = b.dataset.axis;
    state.musicHover = null;
    state.freqHover = null;
    rebuildPeriodTabs();
    syncStyleChips();
    drawMusic(true);
    updateAllUI(true);
    updateStaticInfo();
    updateVisualUI();
    saveSettings();
  }));
  document.querySelectorAll('#typeChips button').forEach(b => b.addEventListener('click', () => {
    state.chartType = b.dataset.type;
    state.hollow = state.chartType === 'hollow';
    const hk = $('chkHollow');
    if (hk) hk.checked = state.hollow;
    applyCandleType();
    drawMusic(true);
    updateLegend();
    syncStyleChips();
    canvasSwap();
    saveSettings();
  }));
  on('gapRange', 'input', e => {
    state.barGap = clamp(Number(e.target.value), 0.2, 0.95);
    const gv = $('gapVal');
    if (gv) gv.textContent = state.barGap.toFixed(2);
    if (state.mode === 'music') drawMusic(true);
  });
  on('gapRange', 'change', () => saveSettings());
  document.querySelectorAll('#fitChips button').forEach(b => b.addEventListener('click', () => {
    state.videoFit = b.dataset.fit;
    if (state.mode === 'music') drawMusic(true);
    syncStyleChips();
    saveSettings();
  }));
  [['specLChips', 'specTypeL'], ['specRChips', 'specTypeR']].forEach(([id, key]) => {
    document.querySelectorAll('#' + id + ' button').forEach(b => b.addEventListener('click', () => {
      state[key] = b.dataset.st;
      specCache.L = null;
      specCache.R = null;
      drawMusic(true);
      syncStyleChips();
      saveSettings();
    }));
  });
  const reanalyze = (apply) => async (b) => {
    apply(b);
    syncStyleChips();
    toast('按新参数重新分析…');
    await reanalyzeCurrent();
    saveSettings();
  };
  const fftJob = reanalyze(b => { state.fftSize = Number(b.dataset.n); });
  const hopJob = reanalyze(b => { state.hopSec = Number(b.dataset.hop); });
  const rangeJob = reanalyze(b => { state.bandRange = Number(b.dataset.range); });
  [['#fftChips button', fftJob], ['#hopChips button', hopJob], ['#rangeChips button', rangeJob]].forEach(([sel, job]) => {
    document.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => {
      if (state.mode !== 'music' || !state.meta || !state.meta.buffer) { toast('请先导入或选择音频'); return; }
      job(b);
    }));
  });
}
/* 术语表：同一套同花顺终端结构，两种数据语义 */
const TERMS = {
  music: {
    open: '起', high: '峰', low: '谷', prev: '前段', vol: '强', amp: '带宽',
    rh: '段峰', rl: '段谷', count: '根数', chgPrefix: '强',
    statsTitle: '频谱统计', frames: '频谱根数', window: '窗口 / 跨度', bands: '谱线 L/R',
    bookTitle: '频段盘口', bookBadge: '能量 / 峰值线', bkH: ['档位', '能量', '当前'],
    tickTitle: '逐帧明细', tickBadge: '最近 24 帧', tkH: ['时间', '频率', '音量', '方向'],
    foot: ['起', '峰', '谷', '均', '强'], unit: 'Hz'
  },
  market: {
    open: '开', high: '高', low: '低', prev: '昨收', vol: '量', amp: '幅',
    rh: '区高', rl: '区低', count: '根', chgPrefix: '',
    statsTitle: 'K线统计', frames: 'K线数', window: '周期 / 跨度', bands: '谱线 L/R',
    bookTitle: '振幅分档', bookBadge: '占比 / 峰值线', bkH: ['区间', '占比', '根数'],
    tickTitle: '逐日明细', tickBadge: '最近 24 根', tkH: ['日期', '收盘', '涨跌', '方向'],
    foot: ['开', '高', '低', '收', '量'], unit: ''
  }
};
function TM() { return TERMS[state.mode === 'music' ? 'music' : 'market']; }
function applyTerms() {
  const t = TM();
  const put = (id, text) => { const el = $(id); if (el && text != null) el.textContent = text; };
  put('lblOpen', t.open); put('lblHigh', t.high); put('lblLow', t.low);
  put('lblPrev', t.prev); put('lblVol', t.vol); put('lblAmp', t.amp);
  put('lblRH', t.rh); put('lblRL', t.rl); put('lblCount', t.count);
  put('statsTitle', t.statsTitle); put('lblFrames', t.frames);
  put('lblWindow', t.window); put('lblBands', t.bands);
  put('bookTitle', t.bookTitle); put('bookBadge', t.bookBadge);
  put('tickTitle', t.tickTitle); put('tickBadge', t.tickBadge);
  ['bkH1', 'bkH2', 'bkH3'].forEach((id, i) => put(id, t.bkH[i]));
  ['tkH1', 'tkH2', 'tkH3', 'tkH4'].forEach((id, i) => put(id, t.tkH[i]));
  buildBookRows();
}
function applyModeCopy() {
  const music = state.mode === 'music';
  document.body.dataset.mode = state.mode;
  $('sourceLabel').textContent = music
    ? (state.meta && state.meta.demo ? '音频源 · 内置演示' : '音频源 · 本地文件')
    : '数据源 · 东方财富';
  $('qInfoTitle').textContent = music ? '曲目信息' : '片源信息';
  $('musicSettings').hidden = !music;
  $('marketSettings').hidden = music;
  const fftCard = $('fftSettings');
  if (fftCard) fftCard.hidden = !music;
  applyTerms();
  refreshBook();
  syncStyleChips();
  $('qVolNoteLabel').textContent = music ? '音量口径' : '量能口径';
  $('footMode').textContent = music ? '主图：频率 · 粗/细线 · 副图：L/R 频谱' : '主图：K线 · MA · 副图：VOL / MACD';
  $('footVolNote').textContent = music ? '最大音量（RMS）' : (state.meta ? state.meta.volNote : '量能');
  $('qHighLabel').textContent = music ? '最高频率' : '区间最高';
  $('qLowLabel').textContent = music ? '最低频率' : '区间最低';
  $('qHighDateLabel').textContent = music ? '最高时刻' : '最高日期';
  $('qLowDateLabel').textContent = music ? '最低时刻' : '最低日期';
  $('qBestLabel').textContent = music ? '最大频率跳升' : '最大单段涨';
  $('qWorstLabel').textContent = music ? '最大频率回落' : '最大单段跌';
  $('qDDLabel').textContent = music ? '最大回落' : '最大回撤';
  rebuildPeriodTabs();
  rebuildSpeedOptions();
  updateVisualUI();
  if (music) { resizeMusicCanvas(); drawMusic(true); }
  else { try { chart && chart.resize(); } catch (e) {} }
}
function rebuildPeriodTabs() {
  const box = $('periodTabs');
  if (!box) return;
  box.innerHTML = '';
  if (state.mode === 'music') {
    ['time', 'freq'].forEach(mode => {
      const b = document.createElement('button');
      b.dataset.axis = mode;
      b.textContent = mode === 'time' ? '时间轴' : '频率轴';
      b.classList.toggle('active', state.kMode === mode);
      box.appendChild(b);
    });
    const sep = document.createElement('span');
    sep.className = 'period-sep';
    box.appendChild(sep);
    if (state.kMode === 'freq') {
      [[2, '2s'], [5, '5s'], [10, '10s'], [30, '30s'], [0, '全曲']].forEach(([w, label]) => {
        const b = document.createElement('button');
        b.dataset.agg = w;
        b.textContent = label + '聚合';
        b.classList.toggle('active', w === state.freqAgg);
        box.appendChild(b);
      });
    } else {
      MUSIC_WINDOWS.forEach(w => {
        const b = document.createElement('button');
        b.dataset.win = w;
        b.textContent = w + 'sK';
        b.classList.toggle('active', w === state.musicWindow);
        box.appendChild(b);
      });
    }
  } else {
    [['day', '日K'], ['week', '周K'], ['month', '月K']].forEach(([p, label]) => {
      const b = document.createElement('button');
      b.dataset.period = p;
      b.textContent = label;
      b.classList.toggle('active', p === state.period);
      box.appendChild(b);
    });
  }
  const inkAxis = document.createElement('i');
  inkAxis.className = 'period-ink axis-ink';
  box.appendChild(inkAxis);
  const inkWin = document.createElement('i');
  inkWin.className = 'period-ink win-ink';
  box.appendChild(inkWin);
  requestAnimationFrame(syncPeriodInk);
}
function rebuildSpeedOptions() {
  const sel = $('rbSpeed');
  if (!sel) return;
  sel.innerHTML = '';
  if (state.mode === 'music') {
    MUSIC_RATES.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v + 'x';
      sel.appendChild(o);
    });
    sel.value = String(state.musicRate);
    $('trSpeed').textContent = state.musicRate + 'x';
  } else {
    SPEEDS.forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = SPEED_LABELS[v];
      sel.appendChild(o);
    });
    sel.value = String(state.speed);
    $('trSpeed').textContent = SPEED_LABELS[state.speed];
  }
}
function updateTimeLabels() {
  const cur = $('tlTimeCur'), all = $('tlTimeAll');
  if (!cur || !all || !state.meta) return;
  if (state.mode === 'music') {
    const dur = state.meta.duration || 0;
    const t = state.musicAudio ? state.musicAudio.currentTime : 0;
    const a = fmtTime(Math.min(t, dur));
    const b = fmtTime(dur);
    if (cur.textContent !== a) cur.textContent = a;
    if (all.textContent !== b) all.textContent = b;
  } else {
    const n = state.series.length;
    const i = clamp(Math.floor(state.playhead) + 1, 1, n);
    const a = i + '/' + n;
    const last = state.kline[n - 1];
    const b = last ? new Date(last.timestamp).toISOString().slice(0, 10) : '';
    if (cur.textContent !== a) cur.textContent = a;
    if (all.textContent !== b) all.textContent = b;
  }
}
function updatePlayUI() {
  updateTimeLabels();
  const playing = state.playing;
  $('rbPlay').textContent = playing ? '❚❚' : '▶';
  $('trPlay').innerHTML = playing
    ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"></path></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>';
  const modeText = playing ? '播放中' : (state.endShown ? '已结束' : '已暂停');
  $('statusMode').textContent = modeText;
  $('qStateTop').textContent = modeText;
  const sp = state.mode === 'music' ? state.musicRate + 'x' : state.speed + ' 根/秒';
  $('statusSpeed').textContent = sp;
  $('qSpeed').textContent = sp;
  $('btnLoopTop').classList.toggle('active', state.loop);
}
function updateStaticInfo() {
  const m = state.meta;
  if (!m) return;
  $('qNameTop').textContent = m.name;
  $('qNameTop').removeAttribute('data-mq');
  applyMarquee($('qNameTop'));
  $('qCodeTop').textContent = m.code;
  $('qMarketTop').textContent = m.market;
  $('qName').textContent = m.name;
  $('qName').removeAttribute('data-mq');
  applyMarquee($('qName'));
  $('qCode').textContent = m.code + ' · ' + m.market;
  $('qMarket').textContent = mediaCode(m);
  $('qDesc').textContent = shortDesc(m.desc);
  $('qHigh').textContent = fmtPrice(m.high, m.digits);
  $('qHighDate').textContent = m.highDate;
  $('qLow').textContent = fmtPrice(m.low, m.digits);
  $('qLowDate').textContent = m.lowDate;
  $('qBestDay').textContent = fmtPct(m.bestDay.pct) + ' · ' + m.bestDay.date;
  $('qWorstDay').textContent = fmtPct(m.worstDay.pct) + ' · ' + m.worstDay.date;
  $('qDDDetail').textContent = m.maxDD.pct.toFixed(2) + '%';
  $('qDDDetail').title = m.maxDD.from + ' → ' + m.maxDD.to;
  $('qVolNote').textContent = state.mode === 'music' ? '最大音量（RMS）' : (m.volProxy ? '按振幅估算' : '真实成交量');
  $('qRange').textContent = state.mode === 'music' ? '0:00 → ' + fmtTime(m.duration) : (m.first + ' → ' + m.last);
  $('chapterCount').textContent = state.chapters.length;
  if (state.mode === 'music') {
    $('mBpm').textContent = bpmOf() ? bpmOf() : '--';
    $('mDuration').textContent = fmtTime(m.duration);
    $('mSampleRate').textContent = m.sampleRate ? (m.sampleRate / 1000).toFixed(1) + ' kHz' : '--';
    $('mChannels').textContent = m.channels ? m.channels + ' ch' : '--';
    $('mFrames').textContent = m.count || state.series.length;
    $('mWindow').textContent = state.kMode === 'freq'
      ? (state.freqAgg ? state.freqAgg + ' s 聚合' : '全曲聚合') + ' / ' + state.spectrumRows + ' 线'
      : state.musicWindow + ' s / ' + state.viewSpan + ' s';
    $('mBands').textContent = effBands() + ' 线 ×2';
    const pu = $('priceUnit');
    if (pu) pu.textContent = state.kMode === 'freq' ? '%' : 'Hz';
  } else {
    $('mBpm').textContent = '--';
    $('mDuration').textContent = '--';
    $('mSampleRate').textContent = '--';
    $('mChannels').textContent = '--';
    $('mFrames').textContent = state.series.length;
    $('mWindow').textContent = PERIOD_LABEL[state.period] || '--';
  }
  document.title = m.name + ' · K线播放器';
}
function updateAllUI(force) {
  if (!state.meta || !state.series.length) return;
  const now = performance.now();
  if (!force && now - state.lastUI < 70) return;
  state.lastUI = now;
  if (state.mode !== 'music' && now - (state.bookAt || 0) > 200) {
    state.bookAt = now;
    refreshBook();
  }
  const N = state.series.length;
  const idx = clamp(Math.floor(state.playhead), 0, N - 1);
  const c = state.series[idx];
  const prev = idx > 0 ? state.series[idx - 1] : c;
  const digits = state.meta.digits || 0;
  const price = c[4], prevClose = prev[4];
  const chg = price - prevClose;
  const pct = prevClose ? chg / prevClose * 100 : 0;
  const cls = state.mode === 'music'
    ? (c[8] ? 'up' : 'down')
    : (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat');
  const setCls = el => {
    if (!el || el.__cls === cls) return;
    el.__cls = cls;
    el.classList.remove('up', 'down', 'flat');
    el.classList.add(cls);
  };
  setCls($('qPriceTop')); setCls($('qChangeTop'));
  const qc = $('qChapter');
  if (qc) {
    const chap = currentChapterAt();
    const key = chap && chap.title ? (chap.title + '\u0001' + chap.date + '\u0001' + (chap.desc || '')) : '';
    if (key !== state._chapKey) {
      state._chapKey = key;
      if (key) {
        qc.hidden = false;
        qc.innerHTML = '段落 <b>' + escapeHTML(chap.title) + '</b> · ' + escapeHTML(chap.date) +
          (chap.desc ? ' · ' + escapeHTML(chap.desc) : '');
      } else {
        qc.hidden = true;
        qc.textContent = '';
      }
    }
  }
  setText($('qPriceTop'), state.mode === 'music' ? String(Math.round(price)) : fmtPrice(price, digits));
  if (state.mode === 'music') {
    const vprev = prev[5] || 0;
    const vchg = c[5] - vprev;
    const vpct = vprev ? vchg / vprev * 100 : 0;
    setText($('qChangeTop'), TM().chgPrefix + ' ' + (vchg >= 0 ? '+' : '') + Math.round(vchg) + ' ' + fmtPct(vpct));
  } else {
    setText($('qChangeTop'), fmtSigned(chg, digits) + ' ' + fmtPct(pct));
  }
  setText($('qOpenTop'), fmtPrice(c[1], digits));
  setText($('qHighTop'), fmtPrice(c[2], digits));
  setText($('qLowTop'), fmtPrice(c[3], digits));
  setText($('qPrevTop'), fmtPrice(prevClose, digits));
  setText($('qVolTop'), state.mode === 'music' ? Math.round(c[5]) + '%' : fmtVol(c[5]));
  setText($('qAmpTop'), prevClose ? ((c[2] - c[3]) / prevClose * 100).toFixed(2) + '%' : '--');
  setText($('qRangeHighTop'), fmtPrice(state.meta.high, digits));
  setText($('qRangeLowTop'), fmtPrice(state.meta.low, digits));
  setText($('qCountTop'), fmtInt(N));
  const currentTime = state.mode === 'music' && state.musicAudio ? state.musicAudio.currentTime : 0;
  const win = state.musicWindow || 0.25;
  const snapT = state.mode === 'music' ? (state.snapBars ? (Math.floor(currentTime / win) + 0.5) * win : currentTime) : 0;
  const pctPos = state.mode === 'music'
    ? (state.meta.duration ? clamp(snapT / state.meta.duration, 0, 1) * 100 : 0)
    : (N > 1 ? idx / (N - 1) * 100 : 0);
  const dateText = state.mode === 'music' ? fmtTime(currentTime) : c[0];
  setText($('qDate'), dateText);
  setText($('qIndex'), '第 ' + fmtInt(idx + 1) + ' / ' + fmtInt(N) + ' 根');
  setCss($('qProgress'), 'width', pctPos.toFixed(2) + '%');
  setText($('chartDate'), dateText);
  setText($('rbIndex'), '第 ' + fmtInt(idx + 1) + ' / ' + fmtInt(N) + ' 根');
  setText($('rbDate'), dateText);
  setText($('rbPct'), pctPos.toFixed(1) + '%');
  setCss($('tlFill'), 'width', pctPos.toFixed(2) + '%');
  setCss($('tlThumb'), 'left', pctPos.toFixed(2) + '%');
  if (state.mode === 'music' && state.kMode === 'freq') applyFreqHeader();
  updateFoot();
  updateLegend();
  updateTicker();
  updateVisualUI();
}
function updateLegend() {
  const el = $('chartLegend');
  if (!el) return;
  if (!state.series.length) { setHTML(el, ''); return; }
  if (state.mode === 'music') {
    if (state.chartType === 'timeline' && state.kMode !== 'freq') {
      const ov = buildOverlays();
      const i = clamp(Math.floor(state.playhead), 0, state.series.length - 1);
      const avg = Math.round(ov.avg[i] || 0);
      const base = Math.round(ov.avg[ov.avg.length - 1] || 0);
      setHTML(el, '<span class="lg" style="color:#999">分时</span>'
        + '<span class="lg" style="color:#f7b500">均价 <b>' + avg + '</b></span>'
        + '<span class="lg" style="color:#999">昨收 <b>' + base + '</b></span>');
      return;
    }
    if (state.kMode === 'freq' || !state.showMA) { setHTML(el, ''); return; }
    const idx = state.musicHover != null ? clamp(state.musicHover, 0, state.series.length - 1) : clamp(Math.floor(state.playhead), 0, state.series.length - 1);
    let html = '<span class="lg" style="color:#999">MA</span>';
    for (const ma of MA_DEFS) {
      const v = maClose(state.series, idx, ma.n);
      html += '<span class="lg" style="color:' + ma.c + '">MA' + ma.n + ' <b>' + (v == null ? '--' : Math.round(v)) + '</b></span>';
    }
    setHTML(el, html);
    return;
  }
  if (!state.ind || !state.showMA) { setHTML(el, ''); return; }
  const idx = state.hoverIndex != null ? state.hoverIndex : clamp(Math.floor(state.playhead), 0, state.series.length - 1);
  const digits = state.meta.digits || 1;
  let html = '<span class="lg" style="color:#999">MA</span>';
  MA_PERIODS.forEach((p, i) => {
    const v = state.ind.mas[p][idx];
    html += '<span class="lg" style="color:' + MA_COLORS[i] + '">MA' + p + ' <b>' + (v == null ? '--' : fmtPrice(v, digits)) + '</b></span>';
  });
  setHTML(el, html);
}
function updateFoot() {
  if (!state.meta || !state.series.length) return;
  if (state.mode === 'music' && state.kMode === 'freq') {
    const bars = state.freqBars;
    if (!bars || !bars.length) return;
    const k = freqPickBand();
    if (k < 0) return;
    const b = bars[k], tf = TM();
    const pct = v => Math.round(v);
    const cls = b[4] ? 'up' : 'down';
    setHTML($('footOhlc'),
      '频段 <b>' + hzLabel(bandCenterHz(k, bars.length)) + 'Hz</b> ' +
      tf.foot[0] + ' <b>' + pct(b[0]) + '</b> ' + tf.foot[1] + ' <b>' + pct(b[1]) +
      '</b> ' + tf.foot[2] + ' <b>' + pct(b[2]) + '</b> ' + tf.foot[3] +
      ' <b class="' + cls + '">' + pct(b[3]) + '</b> ' + tf.foot[4] + ' <b>' + pct(b[1]) + '%</b>');
    return;
  }
  const idx = state.mode === 'music'
    ? (state.musicHover != null ? clamp(state.musicHover, 0, state.series.length - 1) : clamp(Math.floor(state.playhead), 0, state.series.length - 1))
    : (state.hoverIndex != null ? state.hoverIndex : clamp(Math.floor(state.playhead), 0, state.series.length - 1));
  const c = state.series[idx];
  const digits = state.meta.digits || 1;
  const chg = idx > 0 ? c[4] / state.series[idx - 1][4] - 1 : 0;
  const cls = state.mode === 'music' ? (c[8] ? 'up' : 'down') : (chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat');
  const volText = state.mode === 'music' ? Math.round(c[5]) + '%' : fmtVol(c[5]);
  const t = TM();
  setHTML($('footOhlc'),
    t.foot[0] + ' <b>' + fmtPrice(c[1], digits) + '</b> ' + t.foot[1] + ' <b>' + fmtPrice(c[2], digits) +
    '</b> ' + t.foot[2] + ' <b>' + fmtPrice(c[3], digits) +
    '</b> ' + t.foot[3] + ' <b class="' + cls + '">' + fmtPrice(c[4], digits) + '</b> ' + t.foot[4] + ' <b>' + volText + '</b> · ' + c[0]);
}
function updateTicker() {
  const box = $('ticker');
  if (!box) return;
  if (state.mode === 'music') {
    const f = frameAt(state.musicAudio ? state.musicAudio.currentTime : 0);
    const bpm = bpmOf() || '--';
    const bandRms = (a, b) => { let x = 0; for (let i = a; i < b; i++) { const v = f.bands[i]; x += v * v; } return Math.sqrt(x / (b - a)); };
    const loEnd = Math.floor(BAND_COUNT * 0.32), midEnd = Math.floor(BAND_COUNT * 0.66);
    setHTML(box,
      '<span><b>低频</b> <i>' + (f ? bandRms(0, loEnd).toFixed(0) + '%' : '--') + '</i></span>' +
      '<span><b>中频</b> <i>' + (f ? bandRms(loEnd, midEnd).toFixed(0) + '%' : '--') + '</i></span>' +
      '<span><b>高频</b> <i>' + (f ? bandRms(midEnd, BAND_COUNT).toFixed(0) + '%' : '--') + '</i></span>' +
      '<span><b>BPM</b> <i>' + bpm + '</i></span>' +
      '<span><b>最大音量</b> <i>' + (f ? f.rms.toFixed(0) + '%' : '--') + '</i></span>');
  } else {
    let html = '';
    for (const id of ['sh', 'hsi', 'n225', 'usdjpy', 'ndx']) {
      const m = LIBRARY.find(x => x.id === id);
      if (!m) continue;
      const chg = m.prevClose ? (m.lastClose / m.prevClose - 1) * 100 : 0;
      const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
      html += '<span><b>' + m.name + '</b> <i class="' + cls + '" style="font-style:normal">' + fmtPrice(m.lastClose, m.digits) + ' ' + fmtPct(chg) + '</i></span>';
    }
    setHTML(box, html);
  }
}
function updateVisualUI() {
  if (!state.meta) return;
  const chipKey = [state.musicWindow, state.musicThick, state.musicThin, state.spectrumBands, state.viewSpan].join('|');
  if (chipKey !== state._visChips) {
    state._visChips = chipKey;
    document.querySelectorAll('#windowChips button').forEach(b => b.classList.toggle('active', Number(b.dataset.win) === state.musicWindow));
    document.querySelectorAll('#thickChips button').forEach(b => b.classList.toggle('active', Number(b.dataset.thick) === state.musicThick));
    document.querySelectorAll('#thinChips button').forEach(b => b.classList.toggle('active', Number(b.dataset.thin) === state.musicThin));
    document.querySelectorAll('#bandChips button').forEach(b => b.classList.toggle('active', b.dataset.bands === 'auto' ? state.spectrumBands === 'auto' : Number(b.dataset.bands) === state.spectrumBands));
    document.querySelectorAll('#viewChips button').forEach(b => b.classList.toggle('active', Number(b.dataset.view) === state.viewSpan));
  }
  setVal($('smoothRange'), state.musicSmooth);
  setText($('smoothVal'), state.musicSmooth.toFixed(2));
  setVal($('volRange'), state.musicVolume);
  setText($('volVal'), Math.round(state.musicVolume * 100) + '%');
  if (state.mode === 'music') {
    setText($('mBpm'), String(bpmOf() || '--'));
    setText($('mDuration'), fmtTime(state.meta.duration));
    setText($('mSampleRate'), state.meta.sampleRate ? (state.meta.sampleRate / 1000).toFixed(1) + ' kHz' : '--');
    setText($('mChannels'), state.meta.channels ? state.meta.channels + ' ch' : '--');
    setText($('mFrames'), String(state.series.length));
    setText($('mWindow'), state.musicWindow + ' s / ' + state.viewSpan + ' s');
    setText($('mBands'), effBands() + ' 线 ×2');
  }
}

/* ================= sidebar ================= */
function applySort(list) {
  const s = state.sort;
  if (s === 'default') return list;
  const arr = list.slice();
  if (s === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  else if (s === 'duration') arr.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else if (s === 'bpm') arr.sort((a, b) => (b.bpm || 0) - (a.bpm || 0));
  return arr;
}
function enqueue(id) {
  if (state.queue.includes(id)) { toast('已在队列中'); return; }
  state.queue.push(id);
  renderQueue();
  toast('已加入队列：' + (LIBRARY.find(m => m.id === id) || {}).name);
  saveSettings();
}
function dequeueAt(i) {
  state.queue.splice(i, 1);
  renderQueue();
  saveSettings();
}
function clearQueue() {
  if (!state.queue.length) return;
  state.queue = [];
  renderQueue();
  saveSettings();
  toast('队列已清空');
}
function renderQueue() {
  const box = $('listQueue'), cnt = $('countQueue');
  const label = document.querySelector('.side-label[data-group="queue"]');
  if (!box) return;
  box.innerHTML = '';
  state.queue.forEach((id, i) => {
    const m = LIBRARY.find(x => x.id === id);
    if (!m) return;
    const row = makeRow(m);
    const ord = document.createElement('div');
    ord.className = 'q-ord';
    ord.textContent = String(i + 1);
    row.prepend(ord);
    const acts = row.querySelector('.q-acts') || row.appendChild(Object.assign(document.createElement('div'), { className: 'q-acts' }));
    const xb = document.createElement('button');
    xb.className = 'q-act q-dequeue';
    xb.textContent = '−';
    xb.title = '从队列移除';
    xb.addEventListener('click', e => { e.stopPropagation(); dequeueAt(i); });
    acts.insertBefore(xb, acts.firstChild);
    box.appendChild(row);
  });
  if (cnt) cnt.textContent = state.queue.length;
  const on = state.queue.length > 0;
  if (label) label.style.display = on ? '' : 'none';
  box.style.display = on ? '' : 'none';
}
function removeItem(id) {
  const i = LIBRARY.findIndex(m => m.id === id);
  if (i < 0) return;
  const m = LIBRARY[i];
  if (m.url) { try { URL.revokeObjectURL(m.url); } catch (e) {} }
  LIBRARY.splice(i, 1);
  state.queue = state.queue.filter(x => x !== id);
  const wasActive = state.meta && state.meta.id === id;
  renderSidebar();
  if (wasActive) {
    const next = LIBRARY.find(x => x.kind === 'music') || LIBRARY[0];
    if (next) loadDataset(next.id);
    else { state.meta = null; toast('列表已空'); }
  }
  toast('已移出：' + m.name);
  saveSettings();
}
function applyCollapse() {
  document.querySelectorAll('.side-label[data-group]').forEach(l => {
    const g = l.dataset.group, list = l.nextElementSibling;
    const off = !!state.collapsed[g];
    l.classList.toggle('folded', off);
    if (list && list.classList.contains('quote-list')) list.style.display = off ? 'none' : '';
  });
}
function renderSidebar() {
  const music = LIBRARY.filter(m => m.kind === 'music');
  const fx = LIBRARY.filter(m => m.kind !== 'music' && !m.local && m.market === '外汇');
  const idx = LIBRARY.filter(m => m.kind !== 'music' && !m.local && m.market === '指数');
  const local = LIBRARY.filter(m => m.local && m.kind !== 'music');
  $('listMusic').innerHTML = '';
  $('listFx').innerHTML = '';
  $('listIndex').innerHTML = '';
  $('listLocal').innerHTML = '';
  $('countMusic').textContent = music.length;
  $('countFx').textContent = fx.length;
  $('countIndex').textContent = idx.length;
  $('countLocal').textContent = local.length;
  $('localLabel').hidden = local.length === 0;
  applySort(music).forEach(m => $('listMusic').appendChild(makeRow(m)));
  applySort(fx).forEach(m => $('listFx').appendChild(makeRow(m)));
  applySort(idx).forEach(m => $('listIndex').appendChild(makeRow(m)));
  applySort(local).forEach(m => $('listLocal').appendChild(makeRow(m)));
  renderSidebarActive();
  renderQueue();
  applyCollapse();
}
function makeRow(meta) {
  const row = document.createElement('div');
  row.className = 'q-row';
  row.dataset.id = meta.id;
  row.dataset.search = (meta.name + ' ' + meta.code + ' ' + meta.market).toLowerCase();
  row.title = meta.desc || '';
  const isMusic = meta.kind === 'music';
  let priceText = '--', chgText = '--', cls = 'flat';
  if (isMusic) {
    priceText = fmtTime(meta.duration || 0);
    chgText = meta.bpm ? meta.bpm + ' BPM' : 'AUDIO';
  } else {
    const chg = meta.prevClose ? (meta.lastClose / meta.prevClose - 1) * 100 : 0;
    cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
    priceText = fmtPrice(meta.lastClose, meta.digits);
    chgText = fmtPct(chg);
  }
  const name = document.createElement('div'); name.className = 'q-name'; name.textContent = meta.name;
  const code = document.createElement('div'); code.className = 'q-code'; code.textContent = isMusic ? mediaCode(meta) : meta.code;
  const price = document.createElement('div'); price.className = 'q-price ' + cls; price.textContent = priceText;
  const ch = document.createElement('div'); ch.className = 'q-chg ' + cls; ch.textContent = chgText;
  const acts = document.createElement('div');
  acts.className = 'q-acts';
  const qb = document.createElement('button');
  qb.className = 'q-act q-enqueue';
  qb.textContent = '+';
  qb.title = '加入播放队列';
  qb.addEventListener('click', e => { e.stopPropagation(); enqueue(meta.id); });
  acts.appendChild(qb);
  if (meta.file || meta.local) {
    const xb = document.createElement('button');
    xb.className = 'q-act q-del';
    xb.textContent = '×';
    xb.title = '移出列表（释放本地引用）';
    xb.addEventListener('click', e => { e.stopPropagation(); removeItem(meta.id); });
    acts.appendChild(xb);
  }
  row.append(name, code, price, ch, acts);
  row.addEventListener('click', () => loadDataset(meta.id));
  return row;
}
function renderSidebarActive() {
  requestAnimationFrame(() => document.querySelectorAll('#sidebar .q-name').forEach(applyMarquee));
  document.querySelectorAll('.q-row').forEach(row => row.classList.toggle('active', !!state.meta && row.dataset.id === state.meta.id));
}

/* ================= chapters / timeline ================= */
function buildChapters() {
  const list = $('chapterList');
  if (!list) return;
  list.innerHTML = '';
  state.chapters.forEach((ch, i) => {
    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.dataset.idx = ch.idx;
    const meta = document.createElement('div');
    meta.className = 'chapter-meta';
    const d = document.createElement('span'); d.textContent = ch.date;
    const p = document.createElement('span'); p.className = 'ch-price';
    p.textContent = fmtPrice(ch.price, state.meta.digits || 1);
    meta.append(d, p);
    const title = document.createElement('div'); title.className = 'chapter-title'; title.textContent = ch.title;
    const desc = document.createElement('div'); desc.className = 'chapter-desc'; desc.textContent = ch.desc || '';
    item.append(meta, title, desc);
    item.addEventListener('click', () => {
      hideStartOverlay();
      if (state.mode === 'music' && ch.time != null) setPlayhead(ch.time / state.musicWindow, { fromUser: true });
      else setPlayhead(ch.idx, { fromUser: true });
      triggerChapter(ch);
    });
    list.appendChild(item);
  });
  $('chapterCount').textContent = state.chapters.length;
  updateActiveChapter();
}
function buildTimelineMarks() {
  const box = $('tlMarks');
  if (!box) return;
  box.innerHTML = '';
  const N = state.series.length;
  state.chapters.forEach(ch => {
    const mark = document.createElement('div');
    mark.className = 'tl-mark';
    mark.dataset.idx = ch.idx;
    const pct = state.mode === 'music' && ch.time != null
      ? (state.meta.duration ? ch.time / state.meta.duration * 100 : 0)
      : (N > 1 ? ch.idx / (N - 1) * 100 : 0);
    mark.style.left = pct + '%';
    mark.title = ch.title;
    box.appendChild(mark);
  });
  updateActiveChapter();
}

/* ================= danmaku ================= */
function spawnDanmaku(text) {
  if (state.mode === 'music' || !state.danmaku || !text) return;
  const layer = $('danmakuLayer');
  if (!layer || layer.children.length > 30) return;
  const el = document.createElement('span');
  const colors = ['', '', '', 'dm-red', 'dm-blue', 'dm-orange', 'dm-green'];
  el.className = 'dm ' + colors[Math.floor(Math.random() * colors.length)];
  el.textContent = text;
  const h = $('chartWrap').clientHeight || 500;
  el.style.top = (8 + Math.random() * Math.min(300, h * 0.52)) + 'px';
  el.style.animationDuration = (7 + text.length * 0.13).toFixed(1) + 's';
  el.addEventListener('animationend', () => el.remove());
  layer.appendChild(el);
}
function updateDanmaku(dt) {
  if (state.mode === 'music' || !state.danmaku || !state.playing) return;
  state.dmAccum += dt * 1000;
  const interval = Math.max(520, 1550 - state.speed * 5);
  if (state.dmAccum < interval) return;
  state.dmAccum = 0;
  const pool = DM_BY_ID[state.meta.id] || DM_MARKET;
  spawnDanmaku(pool[Math.floor(Math.random() * pool.length)]);
}

/* ================= start overlay ================= */
function showStartOverlay() {
  if (!state.meta) return;
  state.startOpen = true;
  $('startTitle').textContent = state.meta.name;
  if (state.mode === 'music') {
    $('startSub').textContent = fmtTime(state.meta.duration) + ' · ' + (state.meta.bpm || '--') + ' BPM · ' + state.musicWindow + 'sK · ' + state.chapters.length + ' 段';
  } else {
    $('startSub').textContent = (state.meta.startDate || state.meta.first) + ' 起 · ' + fmtInt(state.series.length) + ' 根 · ' + state.chapters.length + ' 段';
  }
  $('startDesc').textContent = shortDesc(state.meta.desc || '', 60);
  $('startOverlay').classList.remove('hidden');
}
function hideStartOverlay() {
  state.startOpen = false;
  $('startOverlay').classList.add('hidden');
}

/* ================= share ================= */
function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportFilename(ext) {
  const name = (state.meta && state.meta.name) || 'K线播放器';
  const d = new Date();
  const ts = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  return 'K线播放器-' + name + '-' + ts + '.' + ext;
}
function exportCurrentPng() {
  if (state.mode === 'music') {
    drawMusic(true);
    const cv = $('musicCanvas');
    if (!cv.toBlob) { toast('当前浏览器不支持导出'); return; }
    cv.toBlob(b => {
      if (!b) { toast('导出失败'); return; }
      saveBlob(exportFilename('png'), b);
      toast('已导出当前图 PNG');
    }, 'image/png');
  } else {
    try {
      const url = chart.getConvertPictureUrl(false, 'png', '#ffffff');
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename('png');
      a.click();
      toast('已导出当前图 PNG');
    } catch (e) { toast('导出失败'); }
  }
}
let videoRec = null, videoChunks = [], recT0 = 0, recTick = 0;
function startVideoExport() {
  if (videoRec) { stopVideoExport(); return; }
  if (state.mode !== 'music') { toast('视频录制只在音乐可视化模式可用'); return; }
  const cv = $('musicCanvas');
  if (!window.MediaRecorder || !cv.captureStream) { toast('当前浏览器不支持录制，请用 Chrome / Edge'); return; }
  hideStartOverlay();
  setPlaying(false);
  setPlayhead(0);
  const stream = cv.captureStream(30);
  try {
    if (state.musicAudio) {
      if (!state.mediaSource) {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const src = ac.createMediaElementSource(state.musicAudio);
        const dest = ac.createMediaStreamDestination();
        src.connect(dest);
        src.connect(ac.destination);
        state.mediaAC = ac;
        state.mediaSource = src;
        state.mediaDest = dest;
      }
      const at = state.mediaDest.stream.getAudioTracks()[0];
      if (at) stream.addTrack(at);
    }
  } catch (e) { console.warn('audio capture failed', e); }
  const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = mimes.find(m => window.MediaRecorder.isTypeSupported(m)) || '';
  try {
    videoRec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
  } catch (e) {
    console.error(e);
    toast('无法启动录制');
    return;
  }
  videoChunks = [];
  videoRec.ondataavailable = e => { if (e.data && e.data.size) videoChunks.push(e.data); };
  videoRec.onstop = () => {
    const blob = new Blob(videoChunks, { type: 'video/webm' });
    videoChunks = [];
    videoRec = null;
    $('recPill').hidden = true;
    clearInterval(recTick);
    if (blob.size > 2000) {
      saveBlob(exportFilename('webm'), blob);
      toast('视频已导出 · ' + (blob.size / 1048576).toFixed(1) + ' MB');
    } else toast('录制为空，未保存');
  };
  videoRec.start(1000);
  recT0 = performance.now();
  $('recPill').hidden = false;
  $('recTime').textContent = '0:00';
  recTick = setInterval(() => {
    const el = Math.floor((performance.now() - recT0) / 1000);
    $('recTime').textContent = Math.floor(el / 60) + ':' + pad2(el % 60);
    const a = state.musicAudio;
    if (a && state.playing && a.duration && a.currentTime >= a.duration - 0.12) stopVideoExport();
  }, 400);
  setPlaying(true);
  toast('开始录制 · 请保持标签页在前台');
}
function stopVideoExport() {
  if (videoRec && videoRec.state !== 'inactive') videoRec.stop();
}
function openShare() {
  if (!state.meta) return;
  let dataUrl = '';
  if (state.mode === 'music') {
    drawMusic(true);
    try { dataUrl = $('musicCanvas').toDataURL('image/png'); } catch (e) {}
  } else {
    try { dataUrl = chart.getConvertPictureUrl(false, 'png', '#ffffff'); } catch (e) {}
  }
  const show = img => {
    const cv = buildShareCanvas(img);
    cv.className = 'share-canvas';
    const wrap = document.createElement('div');
    wrap.appendChild(cv);
    openModal('K线海报', '', [
      { label: '下载 PNG', primary: true, onClick: () => {
          cv.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'K线播放器-' + state.meta.name + '-' + Date.now() + '.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }, 'image/png');
        } },
      { label: '关闭', onClick: closeModal }
    ]);
    $('modalBody').appendChild(wrap);
  };
  if (dataUrl) {
    const img = new Image();
    img.onload = () => show(img);
    img.onerror = () => show(null);
    img.src = dataUrl;
  } else show(null);
}
/* 海报参数：改这里即可（尺寸 / 清晰度 / 版心 / 图区比例 / 字号） */
const SHARE = {
  W: 900, H: 1280,   // 版心（逻辑像素，3:4 竖版，适合社交平台）
  scale: 2,          // 导出倍率：实际像素 = W*scale × H*scale
  pad: 48,           // 左右留白
  headerH: 150,      // 顶部品牌条高度
  chartH: 430,       // 截图区高度（宽度自动 = W - pad*2，等比完整放入不裁切）
  statsTop: 902,     // 参数网格起始 y
  statsGapX: 268,    // 参数网格列距
  statsGapY: 74      // 参数网格行距
};
function buildShareCanvas(chartImg) {
  const W = SHARE.W, H = SHARE.H, P = SHARE.pad;
  const cw = W - P * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * state.shareScale);
  cv.height = Math.round(H * state.shareScale);
  const ctx = cv.getContext('2d');
  ctx.scale(state.shareScale, state.shareScale);
  const th = T(), p = th.poster;
  const music = state.mode === 'music';
  const m = state.meta, digits = m.digits || 1;
  const idx = clamp(Math.floor(state.playhead), 0, state.series.length - 1);
  const c = state.series[idx];
  const base = state.series[0][4];
  const ret = base ? (c[4] / base - 1) * 100 : 0;

  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.up; ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = p.panel; ctx.fillRect(0, 10, W, SHARE.headerH - 10);
  ctx.fillStyle = p.line; ctx.fillRect(0, SHARE.headerH - 1, W, 1);

  ctx.fillStyle = th.up; ctx.beginPath(); ctx.roundRect(P, 40, 50, 50, 10); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 32px Consolas'; ctx.textAlign = 'center'; ctx.fillText('K', P + 25, 77);
  ctx.textAlign = 'left';
  ctx.fillStyle = p.text; ctx.font = 'bold 26px "Microsoft YaHei", sans-serif'; ctx.fillText('K线播放器', 114, 68);
  ctx.fillStyle = p.sub; ctx.font = '14px Consolas'; ctx.fillText('K-LINE PLAYER', 114, 92);
  ctx.textAlign = 'right'; ctx.fillStyle = p.faint; ctx.font = '13px Consolas';
  ctx.fillText(new Date().toLocaleDateString('zh-CN'), W - P, 68);
  ctx.fillText(music ? '频率 K 线 · 音乐可视化' : 'K 线回放 · 行情复盘', W - P, 92);
  ctx.textAlign = 'left';

  const nameMaxW = W - P * 2 - 30;
  let nameSize = 44;
  const trySizes = [44, 38, 32, 28, 24, 21];
  ctx.fillStyle = p.text;
  for (const sz of trySizes) {
    nameSize = sz;
    ctx.font = 'bold ' + sz + 'px "Microsoft YaHei", sans-serif';
    if (ctx.measureText(m.name).width <= nameMaxW) break;
  }
  let nameText = m.name;
  if (ctx.measureText(nameText).width > nameMaxW) {
    while (nameText.length > 1 && ctx.measureText(nameText + '…').width > nameMaxW) nameText = nameText.slice(0, -1);
    nameText += '…';
  }
  ctx.fillText(nameText, P, 218);
  ctx.fillStyle = p.sub; ctx.font = '16px Consolas';
  ctx.fillText(m.code + ' · ' + (music ? (m.bpm || '--') + ' BPM · ' + state.musicWindow + 'sK · ' + fmtTime(m.duration) : PERIOD_LABEL[state.period] + ' · ' + fmtInt(state.series.length) + ' 根'), P, 250);

  ctx.fillStyle = ret >= 0 ? th.up : th.down;
  ctx.font = 'bold 60px Consolas';
  ctx.fillText((ret >= 0 ? '+' : '') + ret.toFixed(2) + '%', P, 330);
  ctx.fillStyle = p.sub; ctx.font = '14px "Microsoft YaHei"';
  ctx.fillText(music ? '本段频率涨跌' : '本段行情涨跌', P, 356);
  const chapter = music ? currentChapterAt() : null;
  if (chapter) {
    ctx.textAlign = 'right'; ctx.fillStyle = p.text; ctx.font = '14px "Microsoft YaHei"';
    ctx.fillText('段落 · ' + chapter.title, W - P, 330);
    ctx.fillStyle = p.faint; ctx.font = '12px Consolas';
    ctx.fillText(chapter.date, W - P, 352);
    ctx.textAlign = 'left';
  }

  const cy = 386, chh = SHARE.chartH;
  ctx.fillStyle = p.chartBg; ctx.fillRect(P, cy, cw, chh);
  ctx.strokeStyle = p.line; ctx.lineWidth = 1; ctx.strokeRect(P + 0.5, cy + 0.5, cw - 1, chh - 1);
  if (chartImg) {
    const iw = chartImg.width, ih = chartImg.height;
    const fit = Math.min(cw / iw, chh / ih);          // 等比完整放入，不裁切
    const dw = iw * fit, dh = ih * fit;
    ctx.drawImage(chartImg, P + (cw - dw) / 2, cy + (chh - dh) / 2, dw, dh);
  }
  const readout = music
    ? '开 ' + fmtPrice(c[1], 0) + '  高 ' + fmtPrice(c[2], 0) + '  低 ' + fmtPrice(c[3], 0) + '  收 ' + fmtPrice(c[4], 0) + ' Hz    最大音量 ' + Math.round(c[5]) + '%    ' + fmtTime(c[6])
    : '开 ' + fmtPrice(c[1], digits) + '  高 ' + fmtPrice(c[2], digits) + '  低 ' + fmtPrice(c[3], digits) + '  收 ' + fmtPrice(c[4], digits) + '    ' + c[0];
  ctx.fillStyle = p.sub; ctx.font = '14px Consolas';
  ctx.fillText(readout, P, cy + chh + 26);

  const stats = music
    ? [
        ['当前频率', fmtPrice(c[4], 0) + ' Hz'],
        ['最大音量', Math.round(c[5]) + '%'],
        ['进度', (m.duration && state.musicAudio ? state.musicAudio.currentTime / m.duration : idx / Math.max(1, state.series.length - 1)) * 100],
        ['BPM', String(m.bpm || '--')],
        ['粗/细线', state.musicThick + 's / ' + state.musicThin + 's'],
        ['谱线', effBands() + ' ×2']
      ]
    : [
        ['当前日期', c[0]],
        ['进度', idx / Math.max(1, state.series.length - 1) * 100],
        ['区间高', fmtPrice(m.high, digits)],
        ['区间低', fmtPrice(m.low, digits)],
        ['最大回撤', m.maxDD.pct.toFixed(2) + '%'],
        ['K线数', fmtInt(state.series.length)]
      ];
  stats.forEach((s, i) => {
    const x = P + (i % 3) * SHARE.statsGapX, y = SHARE.statsTop + Math.floor(i / 3) * SHARE.statsGapY;
    ctx.fillStyle = p.faint; ctx.font = '13px "Microsoft YaHei"'; ctx.fillText(s[0], x, y);
    ctx.fillStyle = p.text; ctx.font = 'bold 22px Consolas';
    ctx.fillText(typeof s[1] === 'number' ? s[1].toFixed(1) + '%' : s[1], x, y + 27);
  });

  ctx.fillStyle = p.line; ctx.fillRect(P, 1150, cw, 1);
  ctx.fillStyle = p.sub; ctx.font = '13px "Microsoft YaHei"';
  ctx.fillText('K线播放器 · 音乐可视化终端', P, 1184);
  ctx.fillStyle = p.faint; ctx.font = '12px "Microsoft YaHei"';
  ctx.fillText(music ? '音频在浏览器本地分析 · 无上传 · 渲染引擎 KLineChart (Apache-2.0)' : '数据源 东方财富公开行情 · 量能按振幅估算', P, 1210);
  ctx.fillText(music ? '外观仿同花顺 Web 端，非官方产品 · 仅供娱乐' : '非官方产品 · 不构成投资建议', P, 1236);
  return cv;
}

/* ================= import ================= */
function normalizeDate(s) {
  s = String(s).trim().replace(/(\.\d+)?Z?$/, '');
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const cells = l => l.split(sep).map(s => s.trim().replace(/^"(.*)"$/, '$1'));
  const header = cells(lines[0]).map(s => s.toLowerCase());
  const idx = (names, fallback) => {
    for (const n of names) { const i = header.findIndex(h => h === n || h.includes(n)); if (i >= 0) return i; }
    return fallback;
  };
  const hasHeader = header.some(h => /date|日期|time|时间/.test(h));
  let map = { date: 0, open: 1, high: 2, low: 3, close: 4, vol: 5 };
  if (hasHeader) {
    map = {
      date: idx(['date', '日期', 'time', '时间'], 0),
      open: idx(['open', '开盘', '开'], 1),
      high: idx(['high', '最高', '高'], 2),
      low: idx(['low', '最低', '低'], 3),
      close: idx(['close', '收盘', '收'], 4),
      vol: idx(['volume', '成交量', 'vol', '量'], 5)
    };
  }
  const rows = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const v = cells(lines[i]);
    if (v.length < 5) continue;
    const date = normalizeDate(v[map.date]);
    const o = Number(v[map.open]), c = Number(v[map.close]), h = Number(v[map.high]), l = Number(v[map.low]);
    const vol = Number(v[map.vol] || 0);
    if (!date || !isFinite(o) || !isFinite(c) || !isFinite(h) || !isFinite(l) || o <= 0 || c <= 0) continue;
    rows.push([date, o, Math.max(h, l, o, c), Math.min(h, l, o, c), c, isFinite(vol) ? vol : 0]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const out = [];
  for (const r of rows) if (!out.length || out[out.length - 1][0] !== r[0]) out.push(r);
  return out;
}
function makeLocalMeta(id, name, candles, desc) {
  const volProxy = !candles.some(c => c[5] > 0);
  const stats = computeStats(candles);
  const digits = stats.lastClose < 2 ? 4 : stats.lastClose < 20 ? 3 : 2;
  const chapters = [];
  const moves = [];
  for (let i = 1; i < candles.length; i++) {
    moves.push({ i, pct: (candles[i][4] / candles[i - 1][4] - 1) * 100, date: candles[i][0] });
  }
  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  for (const m of moves.slice(0, 6)) {
    chapters.push({
      date: m.date,
      title: (m.pct >= 0 ? '单段大涨 ' : '单段大跌 ') + Math.abs(m.pct).toFixed(2) + '%',
      desc: '',
      price: candles[m.i][4], move: round1(m.pct)
    });
  }
  chapters.sort((a, b) => a.date.localeCompare(b.date));
  return {
    id, name, code: 'LOCAL', market: '本地', digits, desc: desc || '本地 K 线',
    startDate: stats.first, startIndex: 0, count: stats.count, first: stats.first, last: stats.last,
    lastClose: stats.lastClose, prevClose: stats.prevClose,
    high: stats.high, highDate: stats.highDate, low: stats.low, lowDate: stats.lowDate,
    bestDay: stats.bestDay, worstDay: stats.worstDay, maxDD: stats.maxDD,
    volProxy, volNote: volProxy ? '按振幅估算' : '成交量', chapters, local: true
  };
}
function importCSV(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const candles = parseCSV(String(reader.result || ''));
    if (candles.length < 20) { toast('至少需要 20 根 K 线'); return; }
    const id = 'local-' + Date.now();
    const name = file.name.replace(/\.csv$/i, '').slice(0, 18) || '本地 K 线';
    const meta = makeLocalMeta(id, name, candles, '本地 K 线 · ' + candles.length + ' 根');
    DATA[id] = { id, candles };
    LIBRARY.push(meta);
    renderSidebar();
    loadMarketDataset(meta, { index: candles.length - 1 });
    toast('已导入 ' + candles.length + ' 根 K 线 · 按播放从头回放');
  };
  reader.readAsText(file);
}
async function importAudio(file) {
  const id = 'audio-' + Date.now();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isVideo = (file.type || '').startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(ext);
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 48) || (isVideo ? '本地视频' : '本地音频');
  try {
    setLoadStage(isVideo ? '读取视频音轨…' : '读取音频…');
    toast(isVideo ? '读取视频音轨…' : '读取音频…');
    let raw;
    try { raw = await file.arrayBuffer(); }
    catch (e) { await new Promise(r => setTimeout(r, 400)); raw = await file.arrayBuffer(); }
    const buffer = await decodeAudio(raw);
    setLoadStage('分析音频…');
    const analysis = await runAnalysis(buffer).catch(() => null);
    if (!analysis) return;
    const meta = {
      id, name, code: isVideo ? 'VIDEO' : 'AUDIO', market: '音乐', kind: 'music', digits: 1,
      desc: fmtTime(buffer.duration) + ' · ' + (isVideo ? '本地视频' : '本地音频'),
      duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels,
      bpm: analysis.bpm, buffer, analysis, analysisSmooth: state.musicSmooth,
      url: URL.createObjectURL(file), file, demo: false
    };
    if (isVideo) meta.videoUrl = meta.url;
    LIBRARY.push(meta);
    renderSidebar();
    await loadMusicDataset(meta, { noOverlay: true });
    toast('已导入' + (isVideo ? '视频' : '音频') + ' · ' + fmtTime(buffer.duration) + (isVideo ? ' · 画面层已就绪' : ''));
  } catch (e) {
    console.error(e);
    toast(isVideo ? '这个视频里没有可解码的音轨' : '无法解码这个音频');
  }
}

/* ================= settings ================= */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('klp.settings') || '{}');
    state.danmaku = false;
    if (typeof s.sonify === 'boolean') state.sonify = s.sonify;
    if (typeof s.replay === 'boolean') state.marketReplay = s.replay;
    if (typeof s.sound === 'boolean') state.sound = s.sound;
    if (typeof s.speed === 'number') state.speed = s.speed;
    if (typeof s.musicRate === 'number') state.musicRate = s.musicRate;
    if (typeof s.musicVolume === 'number') state.musicVolume = s.musicVolume;
    if (typeof s.musicWindow === 'number') state.musicWindow = MUSIC_WINDOWS.includes(s.musicWindow) ? s.musicWindow : 0.25;
    if (typeof s.musicThick === 'number') state.musicThick = s.musicThick;
    if (typeof s.musicThin === 'number') state.musicThin = s.musicThin;
    if (s.spectrumBands === 'auto' || ([200, 256, 300, 400, 512].includes(s.spectrumBands))) state.spectrumBands = s.spectrumBands;
    if (typeof s.viewSpan === 'number' && [10, 20, 30, 60, 120].includes(s.viewSpan)) state.viewSpan = s.viewSpan;
    if (typeof s.musicSmooth === 'number') state.musicSmooth = s.musicSmooth;
    if (['linear', 'db'].includes(s.ampScale)) state.ampScale = s.ampScale;
    if (['log', 'linear'].includes(s.freqAxis)) state.freqAxis = s.freqAxis;
    if (Array.isArray(s.queue)) state.queue = s.queue.filter(x => typeof x === 'string');
    if (['default', 'name', 'duration', 'bpm'].includes(s.sort)) state.sort = s.sort;
    if (s.collapsed && typeof s.collapsed === 'object') state.collapsed = s.collapsed;
    if (s.theme === 'dark' || s.theme === 'light') state.theme = s.theme;
    if (typeof s.upIsRed === 'boolean') state.upIsRed = s.upIsRed;
    if (s.density === 'compact' || s.density === 'standard') state.density = s.density;
    if ([1, 2, 3].includes(s.shareScale)) state.shareScale = s.shareScale;
    if (typeof s.heatGain === 'number') state.heatGain = clamp(s.heatGain, 0.6, 1.6);
    if (FFT_SIZES.includes(s.fftSize)) state.fftSize = s.fftSize;
    if (HOP_SIZES.includes(s.hopSec)) state.hopSec = s.hopSec;
    if (typeof s.bandRange === 'number' && s.bandRange >= 0 && s.bandRange < BAND_RANGES.length) state.bandRange = s.bandRange;
    [['showBeat', 'showBeat'], ['showWatermark', 'showWatermark'], ['showEnvelope', 'showEnvelope'], ['showGlow', 'showGlow']].forEach(([k, key]) => {
      if (typeof s[k] === 'boolean') state[key] = s[k];
    });
    if (typeof s.videoOn === 'boolean') state.videoOn = s.videoOn;
    if (typeof s.showSubs === 'boolean') state.showSubs = s.showSubs;
    if (typeof s.subDockFold === 'boolean') state.subDockFold = s.subDockFold;
    if (['auto', 'dock', 'float'].includes(s.subView)) state.subView = s.subView;
    if (typeof s.subOffset === 'number') state.subOffset = clamp(s.subOffset, -30, 30);
    if (['cover', 'contain', 'fill'].includes(s.videoFit)) state.videoFit = s.videoFit;
    if (['off', 'one', 'all'].includes(s.loopMode)) state.loopMode = s.loopMode;
    if (typeof s.muted === 'boolean') state.muted = s.muted;
    if (typeof s.lastVol === 'number') state.lastVol = s.lastVol;
    if (s.kMode === 'freq' || s.kMode === 'time') state.kMode = s.kMode;
    if ([0, 2, 5, 10, 30].includes(s.freqAgg)) state.freqAgg = s.freqAgg;
    if (['candle', 'hollow', 'ohlc', 'line', 'area', 'timeline'].includes(s.chartType)) state.chartType = s.chartType;
    if (typeof s.barGap === 'number') state.barGap = clamp(s.barGap, 0.2, 0.95);
    if (typeof s.splitMain === 'number') state.splitMain = clamp(s.splitMain, 0.22, 0.8);
    if (typeof s.splitSub === 'number') state.splitSub = clamp(s.splitSub, 0.2, 0.8);
    if (['candle', 'heat', 'bar', 'line'].includes(s.specTypeL)) state.specTypeL = s.specTypeL;
    if (['candle', 'heat', 'bar', 'line'].includes(s.specTypeR)) state.specTypeR = s.specTypeR;
    if (typeof s.videoAlpha === 'number') state.videoAlpha = clamp(s.videoAlpha, 0, 1);
    if (typeof s.snapBars === 'boolean') state.snapBars = s.snapBars;
    if (typeof s.normPeak === 'boolean') state.normPeak = s.normPeak;
    if (typeof s.freqOverride === 'boolean') state.freqOverride = s.freqOverride;
    if (typeof s.freqMin === 'number') state.freqMin = s.freqMin;
    if (typeof s.freqMax === 'number') state.freqMax = s.freqMax;
    if (typeof s.showStrip === 'boolean') state.showStrip = s.showStrip;
    if (s.videoPane === 'bg' || s.videoPane === 'corner') state.videoPane = s.videoPane;
    if (typeof s.videoScale === 'number') state.videoScale = clamp(s.videoScale, 0.5, 2);
    if (typeof s.videoFlipX === 'boolean') state.videoFlipX = s.videoFlipX;
    if (['none', 'blur', 'gray', 'warm'].includes(s.videoFilter)) state.videoFilter = s.videoFilter;
    if (typeof s.wall3d === 'boolean') state.wall3d = s.wall3d;
    if (s.stage === '3d' || s.stage === 'normal') state.stageMode = s.stage;
    if (typeof s.hollow === 'boolean') state.hollow = s.hollow;
    if (typeof s.ma === 'boolean') state.showMA = s.ma;
    if (typeof s.showEMA === 'boolean') state.showEMA = s.showEMA;
    if (typeof s.showBoll === 'boolean') state.showBoll = s.showBoll;
    if (typeof s.bollN === 'number') state.bollN = clamp(Math.round(s.bollN), 5, 120);
    if (typeof s.bollK === 'number') state.bollK = clamp(s.bollK, 0.5, 3);
    if (typeof s.bpmOverride === 'number') state.bpmOverride = clamp(s.bpmOverride, 0, 240);
    if (typeof s.beatPhaseAdj === 'number') state.beatPhaseAdj = clamp(s.beatPhaseAdj, -500, 500);
    if (typeof s.vol === 'boolean') state.showVOL = s.vol;
    if (typeof s.macd === 'boolean') state.showMACD = s.macd;
    if (typeof s.thick === 'boolean') state.showThick = s.thick;
    if (typeof s.thin === 'boolean') state.showThin = s.thin;
    if (typeof s.specL === 'boolean') state.showSpecL = s.specL;
    if (typeof s.specR === 'boolean') state.showSpecR = s.specR;
    if (typeof s.highLow === 'boolean') state.showHighLow = s.highLow;
    if (s.period && PERIOD_LABEL[s.period]) state.period = s.period;
    if (typeof s.barSpace === 'number') state.barSpace = clamp(s.barSpace, 2, 30);
    return s;
  } catch (e) { return {}; }
}
function saveSettings() {
  try {
    localStorage.setItem('klp.settings', JSON.stringify({
      id: state.meta ? state.meta.id : '',
      danmaku: state.danmaku, sound: state.sound, sonify: state.sonify, replay: state.marketReplay, speed: state.speed,
      musicRate: state.musicRate, musicVolume: state.musicVolume,
      musicWindow: state.musicWindow, musicThick: state.musicThick, musicThin: state.musicThin, spectrumBands: state.spectrumBands, viewSpan: state.viewSpan, musicSmooth: state.musicSmooth,
      theme: state.theme, upIsRed: state.upIsRed, density: state.density, shareScale: state.shareScale,
      heatGain: state.heatGain, fftSize: state.fftSize, hopSec: state.hopSec, bandRange: state.bandRange,
      ampScale: state.ampScale, freqAxis: state.freqAxis,
      showBeat: state.showBeat, showWatermark: state.showWatermark, showEnvelope: state.showEnvelope, showGlow: state.showGlow, hollow: state.hollow, ma: state.showMA, vol: state.showVOL, macd: state.showMACD, highLow: state.showHighLow,
      showEMA: state.showEMA, showBoll: state.showBoll, bollN: state.bollN, bollK: state.bollK,
      bpmOverride: state.bpmOverride, beatPhaseAdj: state.beatPhaseAdj,
      snapBars: state.snapBars, showStrip: state.showStrip, normPeak: state.normPeak, freqOverride: state.freqOverride, freqMin: state.freqMin, freqMax: state.freqMax, videoOn: state.videoOn, videoAlpha: state.videoAlpha, videoFit: state.videoFit, videoPane: state.videoPane, videoScale: state.videoScale, videoFlipX: state.videoFlipX, videoFilter: state.videoFilter, wall3d: state.wall3d, stage: state.stageMode,
      showSubs: state.showSubs, subDockFold: state.subDockFold, subView: state.subView, subOffset: state.subOffset,
      loopMode: state.loopMode, muted: state.muted, lastVol: state.lastVol,
      kMode: state.kMode, freqAgg: state.freqAgg, chartType: state.chartType, barGap: state.barGap,
      splitMain: state.splitMain, splitSub: state.splitSub, specTypeL: state.specTypeL, specTypeR: state.specTypeR,
      queue: state.queue, sort: state.sort, collapsed: state.collapsed,
      thick: state.showThick, thin: state.showThin, specL: state.showSpecL, specR: state.showSpecR,
      period: state.period, barSpace: state.barSpace
    }));
  } catch (e) {}
}

/* ================= panels / modals ================= */
/* 页签滑块：共享指示器按 active 按钮的 offset 走 transform，只动合成层 */
function syncNavInk() {
  const nav = $('topnav');
  if (!nav) return;
  const ink = nav.querySelector('.nav-ink');
  const b = nav.querySelector('button.active');
  if (!ink || !b) { nav.classList.remove('has-ink'); return; }
  nav.classList.add('has-ink');
  const cs = getComputedStyle(b);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  ink.style.setProperty('--ink-x', (b.offsetLeft + padL) + 'px');
  ink.style.setProperty('--ink-w', String(Math.max(1, b.offsetWidth - padL - padR)));
}
function syncPeriodInk() {
  const box = $('periodTabs');
  if (!box) return;
  const place = (ink, b) => {
    if (!ink) return;
    if (!b) { ink.classList.add('off'); return; }
    ink.classList.remove('off');
    ink.style.setProperty('--ink-x', b.offsetLeft + 'px');
    ink.style.setProperty('--ink-w', String(b.offsetWidth));
  };
  place(box.querySelector('.period-ink.axis-ink'), box.querySelector('button[data-axis].active'));
  place(box.querySelector('.period-ink.win-ink'), box.querySelector('button.active:not([data-axis])'));
}
function syncRpInk() {
  const rail = $('rpRail');
  if (!rail) return;
  const ink = rail.querySelector('.rp-ink');
  const b = rail.querySelector('button.active');
  if (!ink || !b) { rail.classList.remove('has-ink'); return; }
  rail.classList.add('has-ink');
  ink.style.setProperty('--rp-y', b.offsetTop + 'px');
  ink.style.setProperty('--rp-h', String(b.offsetHeight));
}
function setPanel(name) {
  const map = { quote: 'paneQuote', book: 'paneBook', flow: 'paneFlow', lyrics: 'paneLyrics', visual: 'paneVisual', chapters: 'paneChapters' };
  document.querySelectorAll('.rp-pane').forEach(p => p.classList.toggle('active', p.id === map[name]));
  document.querySelectorAll('.rp-rail button[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('#topnav button[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  syncNavInk();
  syncRpInk();
  if (window.innerWidth <= 1040) $('rightPanel').classList.add('rp-open');
  const tt = state.musicAudio ? state.musicAudio.currentTime : 0;
  if (name === 'book') { updateBook(tt); updateTicks(tt); }
  if (name === 'flow') updateFlow(tt);
  if (name === 'visual') { updateAnalyzerDOM(tt); if (state.mode === 'music') drawMusic(true); }
  if (name === 'chapters') updateActiveChapter();
  if (name === 'lyrics') { buildLyricsPane(); updateLyricsPane(true); }
}
function openModal(title, bodyHTML, actions) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHTML;
  const box = $('modalActions');
  box.innerHTML = '';
  (actions || []).forEach(a => {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.className = 'primary';
    b.addEventListener('click', a.onClick || closeModal);
    box.appendChild(b);
  });
  $('modalMask').hidden = false;
}
function closeModal() { $('modalMask').hidden = true; }
const APP_VERSION = 'beta0.1.2';
function showAbout() {
  openModal('关于', `<div style="font:700 12px var(--mono);color:var(--red);letter-spacing:.08em;margin-bottom:10px">K线播放器 '+APP_VERSION+'</div>

    <ul class="about-list">
      <li><b>功能</b>音频频率/音量 → K 线 + 滚动频谱 + 逐字字幕</li>
      <li><b>字幕</b>LRC / SRT / VTT 导入，或接本地语音识别逐字点亮</li>
      <li><b>图表</b>KLineChart v9.8.12 · Apache-2.0</li>
      <li><b>音频</b>Web Audio · 本地文件，不上传</li>
      <li><b>示例</b>东方财富日线 K 线</li>
    </ul>
    <div class="about-note">本地可视化工具，非官方产品。</div>
  `, [{ label: '快捷键', onClick: showShortcuts }, { label: '关闭', primary: true, onClick: closeModal }]);
}
function showShortcuts() {
  openModal('快捷键', `
    <table class="data-grid" style="font-size:12px">
      <tr><td>空格</td><td>播放 / 暂停</td></tr>
      <tr><td>← / →</td><td>上一根 / 下一根（Shift 十根）</td></tr>
      <tr><td>↑ / ↓</td><td>加速 / 减速</td></tr>
      <tr><td>Home / End</td><td>回到开头 / 跳到结尾</td></tr>
      <tr><td>L</td><td>循环：关 / 单曲 / 列表</td></tr>
      <tr><td>S</td><td>字幕区 收起 / 展开</td></tr>
      <tr><td>Shift + S</td><td>画面内字幕开关</td></tr>
      <tr><td>D</td><td>弹幕</td></tr>
      <tr><td>M</td><td>音效</td></tr>
      <tr><td>T</td><td>深浅主题</td></tr>
      <tr><td>R</td><td>回到开头</td></tr>
      <tr><td>1 - 9</td><td>跳段落</td></tr>
      <tr><td>F</td><td>全屏</td></tr>
      <tr><td>滚轮</td><td>缩放视图跨度</td></tr>
      <tr><td>Ctrl / ⌘ + K</td><td>命令面板（搜功能）</td></tr>
      <tr><td>右键图表</td><td>从这里播放 / 设 A-B 点 / 复制数值 / 导出</td></tr>
      <tr><td>拖放文件</td><td>音频·视频 / LRC·SRT·VTT / CSV 直接导入</td></tr>
      <tr><td>Esc</td><td>关闭弹窗 / 起始页</td></tr>
    </table>
  `, [{ label: '关闭', onClick: closeModal }]);
}

/* ================= events ================= */
/* ---------- 拖放导入 ---------- */
async function importSubtitleFile(f) {
  try {
    const txt = await f.text();
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const list = parseSubs(txt, ext);
    if (!list.length) { toast('没解析出字幕行'); return; }
    setSubs(list, list.length + ' 条 · ' + f.name.slice(0, 18));
    toast('字幕已加载 · ' + list.length + ' 条');
  } catch (e) { toast('字幕读取失败'); }
}
function initDropZone() {
  const zone = $('dropZone');
  if (!zone) return;
  let depth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    zone.classList.add('on');
  });
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
  });
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('on');
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove('on');
    Array.from(e.dataTransfer.files || []).forEach(f => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (ext === 'lrc' || ext === 'srt' || ext === 'vtt') importSubtitleFile(f);
      else if (ext === 'csv') importCSV(f);
      else importAudio(f);
    });
  });
}

/* ---------- 右键菜单 ---------- */
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => toast('已复制：' + t), () => toast(t));
  } else toast(t);
}
function ctxTimeAt(e) {
  const cv = $('musicCanvas');
  const g = state.plotGeom;
  if (state.mode !== 'music' || !cv || !g || !state.meta) return null;
  const r = cv.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.left + r.width) return null;
  const x = clamp((e.clientX - r.left) * (g.pw / Math.max(1, r.width)), 0, g.pw);
  return clamp(g.start + (x / g.pw) * g.span, 0, state.meta.duration || 0);
}
let ctxOpen = false;
function closeCtxMenu() {
  const m = $('ctxMenu');
  if (!m || m.hidden) return;
  m.hidden = true;
  ctxOpen = false;
}
function openCtxMenu(e) {
  const menu = $('ctxMenu');
  if (!menu) return;
  e.preventDefault();
  const t = ctxTimeAt(e);
  const items = [];
  const add = (label, key, fn, disabled) => items.push({ label, key, fn, disabled });
  if (t != null) {
    const f = frameAt(t);
    add('从这里播放', fmtTime(t), () => { seekMusicTo(t); setPlaying(true); });
    add('设为 A 点', '', () => {
      state.ab.a = t;
      if (state.ab.b != null && state.ab.b <= t) state.ab.b = null;
      applyAB();
      toast('A 点 ' + fmtTime(t));
    });
    add('设为 B 点', '', () => { state.ab.b = t; applyAB(); toast('B 点 ' + fmtTime(t)); }, state.ab.a == null);
    add('清除 A-B', '', () => clearAB(), !abActive() && state.ab.a == null);
    items.push({ sep: true });
    add('复制时间码', '', () => copyText(fmtTime(t)));
    add('复制当前频率', '', () => copyText(hzLabel(f ? f.freq : 0) + ' Hz'), !f);
  }
  add('播放 / 暂停', 'Space', () => setPlaying(!state.playing));
  add('导出当前图 PNG', '', () => exportCurrentPng());
  items.push({ sep: true });
  add('全屏', 'F', () => $('btnFullTop').click());
  add('快捷键一览', '?', () => showShortcuts());

  menu.innerHTML = '';
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'csep';
      menu.appendChild(s);
      continue;
    }
    const d = document.createElement('div');
    d.className = 'ci' + (it.disabled ? ' disabled' : '');
    const a = document.createElement('span');
    a.textContent = it.label;
    const b = document.createElement('em');
    b.textContent = it.key || '';
    d.appendChild(a);
    d.appendChild(b);
    d.addEventListener('click', () => { closeCtxMenu(); try { it.fn(); } catch (err) {} });
    menu.appendChild(d);
  }
  menu.hidden = false;
  ctxOpen = true;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(6, Math.min(e.clientX, innerWidth - mw - 8)) + 'px';
  menu.style.top = Math.max(6, Math.min(e.clientY, innerHeight - mh - 8)) + 'px';
}
function initContextMenu() {
  const wrap = $('chartWrap');
  if (!wrap) return;
  wrap.addEventListener('contextmenu', e => {
    if (e.target.closest('input,textarea,button,select,.dropdown-pop')) return;
    openCtxMenu(e);
  });
  document.addEventListener('mousedown', e => {
    if (ctxOpen && !e.target.closest('#ctxMenu')) closeCtxMenu();
  }, true);
  window.addEventListener('blur', closeCtxMenu);
  window.addEventListener('resize', closeCtxMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });
  window.addEventListener('scroll', closeCtxMenu, true);
}

/* ---------- 命令面板 ---------- */
let cpItems = [], cpIdx = 0;
function toggleCheck(id) {
  const el = $(id);
  if (!el) return;
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function paletteCommands() {
  const cmds = [];
  const add = (label, key, fn) => cmds.push({ label, key, fn });
  add('播放 / 暂停', 'Space', () => setPlaying(!state.playing));
  add('回到开头', 'Home', () => { setPlaying(false); setPlayhead(0, { fromUser: true }); });
  add('跳到最后', 'End', () => {
    setPlaying(false);
    if (state.mode === 'music') setPlayhead((state.meta.duration - 0.1) / state.musicWindow, { fromUser: true });
    else setPlayhead(state.series.length - 1, { fromUser: true });
  });
  add('切换深浅主题', 'T', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  add('循环：关 / 单曲 / 列表', 'L', () => cycleLoop());
  add('字幕区 收起 / 展开', 'S', () => {
    if (!state.subs.length) { toast('还没有字幕'); return; }
    state.subDockFold = !state.subDockFold;
    updateSubDock(true);
    saveSettings();
    setTimeout(() => { try { resizeMusicCanvas(); drawMusic(true); } catch (err) {} }, 60);
  });
  add('画面内字幕 开 / 关', 'Shift+S', () => {
    state.showSubs = !state.showSubs;
    const cb = $('chkSubs');
    if (cb) cb.checked = state.showSubs;
    updateSubs(true);
    saveSettings();
    toast(state.showSubs ? '画面内字幕开' : '画面内字幕关');
  });
  add('导入字幕 LRC / SRT / VTT', '', () => $('subFile').click());
  add('导入音频 / 视频', '', () => $('fileInput').click());
  add('AI 逐字听写', '', () => aiTranscribe());
  add('指标：均线 MA', '', () => toggleCheck('chkMA'));
  add('指标：EMA 12 / 26', '', () => toggleCheck('chkEMA'));
  add('指标：布林带 BOLL', '', () => toggleCheck('chkBoll'));
  add('图层：粗线 · 均值', '', () => toggleSub('THICK'));
  add('图层：细线 · 峰值', '', () => toggleSub('THIN'));
  add('声化：K 线播放成音乐', '', () => { const b = $('btnSonifyTop'); if (b) b.click(); });
  add('行情：回放模式 / 自由浏览', '', () => { const b = $('btnReplayTop'); if (b) b.click(); });
  add('视频：画中画', '', () => { const b = $('btnVidPip'); if (b) b.click(); });
  add('视频：小窗 / 背景', '', () => { const b = document.querySelector('#paneChips button[data-pane="corner"]'); if (b) b.click(); });
  add('图层：3D 行情墙', '', () => toggleCheck('chkWall'));
  add('图层：左声道频谱', '', () => toggleSub('SPECL'));
  add('图层：右声道频谱', '', () => toggleSub('SPECR'));
  add('面板：曲目信息', '', () => setPanel('quote'));
  add('面板：盘口', '', () => setPanel('book'));
  add('面板：资金流向', '', () => setPanel('flow'));
  add('图表：分时图', '', () => { state.chartType = 'timeline'; state.hollow = false; drawMusic(true); saveSettings(); });
  add('面板：可视化', '', () => setPanel('visual'));
  add('界面：3D 沉浸 / 普通', '', () => setStageMode(state.stageMode === '3d' ? 'normal' : '3d'));
  add('行情：拉取 A 股 K 线', '', () => { const el = $('rtCode'); if (el) { el.focus(); el.select(); } });
  add('面板：歌词', '', () => setPanel('lyrics'));
  add('面板：段落', '', () => setPanel('chapters'));
  add('导出当前图 PNG', '', () => exportCurrentPng());
  add('录制视频 WebM', '', () => { const b = $('btnExportVideo'); if (b) b.click(); });
  add('全屏', 'F', () => $('btnFullTop').click());
  add('快捷键一览', '?', () => showShortcuts());
  for (const ch of state.chapters || []) {
    add('跳到段落 · ' + (ch.title || ''), ch.time != null ? fmtTime(ch.time) : '', () => {
      if (ch.time != null) setPlayhead(ch.time / state.musicWindow, { fromUser: true });
      else setPlayhead(ch.idx, { fromUser: true });
      triggerChapter(ch);
    });
  }
  return cmds;
}
function cpHighlight() {
  const list = $('cpList');
  if (!list) return;
  Array.from(list.children).forEach((el, i) => el.classList.toggle('on', i === cpIdx));
  const cur = list.children[cpIdx];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}
function renderPalette() {
  const q = ($('cpInput').value || '').trim().toLowerCase();
  const all = paletteCommands();
  cpItems = q ? all.filter(c => c.label.toLowerCase().indexOf(q) >= 0) : all;
  if (cpIdx >= cpItems.length) cpIdx = Math.max(0, cpItems.length - 1);
  const list = $('cpList');
  list.innerHTML = '';
  if (!cpItems.length) {
    const d = document.createElement('div');
    d.className = 'cp-empty';
    d.textContent = '没有匹配的命令';
    list.appendChild(d);
    return;
  }
  cpItems.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'cp-item' + (i === cpIdx ? ' on' : '');
    const a = document.createElement('span');
    a.textContent = c.label;
    const b = document.createElement('span');
    b.className = 'cp-k';
    b.textContent = c.key || '';
    d.appendChild(a);
    d.appendChild(b);
    d.addEventListener('mousemove', () => { if (cpIdx !== i) { cpIdx = i; cpHighlight(); } });
    d.addEventListener('click', () => runPaletteCmd(i));
    list.appendChild(d);
  });
}
function runPaletteCmd(i) {
  const c = cpItems[i];
  closePalette();
  if (c) { try { c.fn(); } catch (e) {} }
}
function openPalette() {
  const p = $('cmdPalette'), input = $('cpInput');
  if (!p || !input) return;
  p.hidden = false;
  p.classList.add('on');
  input.value = '';
  cpIdx = 0;
  renderPalette();
  setTimeout(() => input.focus(), 0);
}
function closePalette() {
  const p = $('cmdPalette');
  if (!p) return;
  p.hidden = true;
  p.classList.remove('on');
}
function initPalette() {
  const p = $('cmdPalette'), input = $('cpInput');
  if (!p || !input) return;
  input.addEventListener('input', () => { cpIdx = 0; renderPalette(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cpItems.length) { cpIdx = (cpIdx + 1) % cpItems.length; cpHighlight(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cpItems.length) { cpIdx = (cpIdx - 1 + cpItems.length) % cpItems.length; cpHighlight(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteCmd(cpIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });
  p.addEventListener('mousedown', e => { if (e.target === p) closePalette(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
      openPalette();
    }
  }, true);
}

function bindEvents() {
  on('btnStartPlay', 'click', () => { hideStartOverlay(); setPlaying(true); });
  on('btnStartFrom', 'click', () => { setPlayhead(0, { fromUser: true }); hideStartOverlay(); setPlaying(true); });
  on('btnStartClose', 'click', hideStartOverlay);
  on('modalClose', 'click', closeModal);
  on('modalMask', 'click', e => { if (e.target === $('modalMask')) closeModal(); });

  ['btnPlay', 'rbPlay', 'trPlay'].forEach(id => on(id, 'click', togglePlay));
  on('rbStart', 'click', () => { setPlaying(false); setPlayhead(0, { fromUser: true }); });
  on('rbEnd', 'click', () => {
    setPlaying(false);
    if (state.mode === 'music' && state.musicAudio) setPlayhead((state.musicAudio.duration - 0.1) / state.musicWindow, { fromUser: true });
    else setPlayhead(state.series.length - 1, { fromUser: true });
  });
  on('rbStepBack', 'click', () => step(-1));
  on('rbStepFwd', 'click', () => step(1));
  on('trPrev', 'click', () => step(-1));
  on('trNext', 'click', () => step(1));
  on('rbSpeed', 'change', e => setSpeed(Number(e.target.value)));
  on('trSpeed', 'click', () => {
    if (state.mode === 'music') {
      const i = MUSIC_RATES.indexOf(state.musicRate);
      setSpeed(MUSIC_RATES[(i + 1) % MUSIC_RATES.length]);
    } else {
      const i = SPEEDS.indexOf(state.speed);
      setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
    }
  });
  on('btnLoopTop', 'click', cycleLoop);
  on('rbLoop', 'click', cycleLoop);
  on('rbBack10', 'click', () => skipSeconds(-10));
  on('rbFwd10', 'click', () => skipSeconds(10));
  on('rbMute', 'click', () => {
    if (state.musicVolume > 0) {
      state.lastVol = state.musicVolume;
      state.musicVolume = 0;
    } else {
      state.musicVolume = state.lastVol || 0.8;
    }
    state.muted = state.musicVolume === 0;
    if (state.musicAudio) state.musicAudio.volume = state.musicVolume;
    const mv = $('rbVol'); if (mv) mv.value = state.musicVolume;
    const vo = $('volRange'); if (vo) vo.value = state.musicVolume;
    const vl = $('volVal'); if (vl) vl.textContent = Math.round(state.musicVolume * 100) + '%';
    const mb = $('rbMute'); if (mb) mb.textContent = state.muted ? '已静音' : '静音';
    saveSettings();
  });
  on('rbVol', 'input', e => {
    state.musicVolume = clamp(Number(e.target.value), 0, 1);
    state.muted = state.musicVolume === 0;
    if (state.musicVolume > 0) state.lastVol = state.musicVolume;
    if (state.musicAudio) state.musicAudio.volume = state.musicVolume;
    const vo = $('volRange'); if (vo) vo.value = state.musicVolume;
    const vl = $('volVal'); if (vl) vl.textContent = Math.round(state.musicVolume * 100) + '%';
    const mb = $('rbMute'); if (mb) mb.textContent = state.muted ? '已静音' : '静音';
  });
  on('rbVol', 'change', saveSettings);
  const applyWin = v => {
    state.musicWindow = v;
    if (state.meta && state.meta.kind === 'music' && state.meta.analysis) {
      const t0 = state.musicAudio ? state.musicAudio.currentTime : 0;
      rebuildMusic(v);
      if (state.musicAudio) state.musicAudio.currentTime = t0;
      state.playhead = t0 / v;
      drawMusic(true);
      updateAllUI(true);
      updateStaticInfo();
    }
    syncStyleChips();
    saveSettings();
  };
  const applyBands = v => {
    state.spectrumBands = v;
    rebuildSpectrumOnly();
    syncStyleChips();
    saveSettings();
  };
  const applyView = v => {
    state.viewSpan = v;
    drawMusic(true);
    updateVisualUI();
    syncStyleChips();
    saveSettings();
  };
  const applyGap = v => {
    state.barGap = v;
    drawMusic(true);
    syncStyleChips();
    saveSettings();
  };
  const debounce = (fn, ms) => {
    let t = 0;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  const winDeb = debounce(applyWin, 260);
  const bandDeb = debounce(applyBands, 300);
  const viewDeb = debounce(applyView, 90);
  const gapDeb = debounce(applyGap, 60);
  const numChange = (id, min, max, round, def, live, commit, getCur) => {
    on(id, 'input', e => {
      let v = Number(e.target.value);
      if (!isFinite(v) || e.target.value === '') return;
      if (round) v = Math.round(v);
      v = clamp(v, min, max);
      if (v === getCur()) return;
      live(v);
    });
    on(id, 'change', e => {
      let v = Number(e.target.value);
      if (!isFinite(v) || e.target.value === '') v = def;
      if (round) v = Math.round(v);
      v = clamp(v, min, max);
      if (v !== getCur()) commit(v);
    });
  };
  numChange('winNum', 0.05, 20, false, 0.25, winDeb, applyWin, () => state.musicWindow);
  numChange('bandNum', 48, 512, true, 256, bandDeb, applyBands, () => effBands());
  numChange('viewNum', 3, 900, true, 30, viewDeb, applyView, () => state.viewSpan);
  numChange('gapNum', 0.2, 0.95, false, 0.72, gapDeb, applyGap, () => state.barGap);
  const bollLive = debounce(() => { buildOverlays(true); drawMusic(true); }, 140);
  const bollCommit = () => { buildOverlays(true); drawMusic(true); saveSettings(); };
  numChange('bollN', 5, 120, true, 20, v => { state.bollN = v; bollLive(); }, v => { state.bollN = v; bollCommit(); }, () => state.bollN || 20);
  numChange('bollK', 0.5, 3, false, 2, v => { state.bollK = v; bollLive(); }, v => { state.bollK = v; bollCommit(); }, () => state.bollK || 2);
  const beatApply = () => { drawMusic(true); saveSettings(); };
  numChange('bpmNum', 0, 240, false, 0, v => { state.bpmOverride = v; beatApply(); }, v => { state.bpmOverride = v; beatApply(); }, () => state.bpmOverride || 0);
  numChange('beatPhaseNum', -500, 500, true, 0, v => { state.beatPhaseAdj = v; beatApply(); }, v => { state.beatPhaseAdj = v; beatApply(); }, () => state.beatPhaseAdj || 0);
  on('btnBeatReset', 'click', () => {
    state.bpmOverride = 0;
    state.beatPhaseAdj = 0;
    if ($('bpmNum')) $('bpmNum').value = 0;
    if ($('beatPhaseNum')) $('beatPhaseNum').value = 0;
    drawMusic(true);
    saveSettings();
    toast('节拍回到自动检测');
  });
  document.querySelectorAll('#subChips button').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.subact;
    if (act === 'import') { $('subFile').click(); return; }
    if (act === 'ai') { aiTranscribe(); return; }
    if (act === 'export') { exportSubsLrc(); return; }
    if (act === 'clear') { setSubs([]); saveSettings(); return; }
    state.subOffset = clamp((state.subOffset || 0) + (act === 'plus' ? 0.5 : -0.5), -30, 30);
    syncSubLabel();
    updateSubs(true);
    toast('字幕偏移 ' + (state.subOffset > 0 ? '+' : '') + state.subOffset.toFixed(1) + 's');
    saveSettings();
  }));
  on('subFile', 'change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const txt = await f.text();
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const list = parseSubs(txt, ext);
      if (!list.length) { toast('没解析出字幕行'); return; }
      setSubs(list, list.length + ' 条 · ' + f.name.slice(0, 18));
      toast('字幕已加载 · ' + list.length + ' 条');
    } catch (err) { toast('字幕读取失败'); }
  });
  on('chkSubs', 'change', e => {
    state.showSubs = e.target.checked;
    updateSubs(true);
    saveSettings();
  });

  $('periodTabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.axis) {
      if (state.kMode === b.dataset.axis) return;
      state.kMode = b.dataset.axis;
      state.musicHover = null;
      state.freqHover = null;
      rebuildPeriodTabs();
      syncStyleChips();
      drawMusic(true);
      canvasSwap();
      updateAllUI(true);
      updateStaticInfo();
      updateVisualUI();
      saveSettings();
    } else if (b.dataset.agg != null) {
      state.freqAgg = Number(b.dataset.agg);
      state.freqBars = null;
      state.freqBarsKey = '';
      state.freqHover = null;
      rebuildPeriodTabs();
      drawMusic(true);
      updateAllUI(true);
      updateStaticInfo();
      saveSettings();
    } else if (b.dataset.win) {
      state.musicWindow = Number(b.dataset.win);
      if (state.meta && state.meta.kind === 'music') {
        const t = state.musicAudio ? state.musicAudio.currentTime : 0;
        rebuildMusic(state.musicWindow);
        if (state.musicAudio) state.musicAudio.currentTime = t;
        state.playhead = t / state.musicWindow;
        syncChart(true);
        updateAllUI(true);
        updateStaticInfo();
      }
      document.querySelectorAll('#periodTabs button').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('#windowChips button').forEach(x => x.classList.toggle('active', Number(x.dataset.win) === state.musicWindow));
      syncPeriodInk();
      saveSettings();
    } else if (b.dataset.period) {
      setPeriod(b.dataset.period);
    }
  });

  on('btnIndicators', 'click', e => { e.stopPropagation(); document.querySelector('.dropdown').classList.toggle('open'); });
  on('chkMA', 'change', e => { state.showMA = e.target.checked; toggleMA(); updateLegend(); saveSettings(); });
  on('chkEMA', 'change', e => { state.showEMA = e.target.checked; buildOverlays(true); drawMusic(true); saveSettings(); });
  on('chkBoll', 'change', e => { state.showBoll = e.target.checked; buildOverlays(true); drawMusic(true); saveSettings(); });
  on('btnStage', 'click', () => setStageMode(state.stageMode === '3d' ? 'normal' : '3d'));
  window.addEventListener('resize', () => { resizeStage(); if (state.stageMode === '3d') drawStage3D(); });
  on('btnSubDockFold', 'click', () => {
    state.subDockFold = !state.subDockFold;
    updateSubDock(true);
    saveSettings();
    setTimeout(() => { try { resizeMusicCanvas(); drawMusic(true); } catch (e) {} }, 250);
  });
  document.querySelectorAll('#subViewChips button').forEach(b => b.addEventListener('click', () => {
    state.subView = b.dataset.subview;
    updateSubDock(true);
    saveSettings();
  }));
  ['focus', 'blur'].forEach(ev => window.addEventListener(ev, () => updateSubDock(true)));
  initDropZone();
  initContextMenu();
  initPalette();
  initLyricsPane();
  initDrawTools();
  try {
    const hdr = window.matchMedia('(dynamic-range: high)').matches;
    const badge = $('hdrBadge');
    if (badge) {
      badge.hidden = !hdr;
      badge.style.cursor = 'pointer';
      badge.title = 'HDR 背景已开（WebGL2 · rec2100-pq）；点击关闭';
      badge.addEventListener('click', () => {
        state.hdr3d = !state.hdr3d;
        if (!state.hdr3d && stage3 && stage3.hdr) {
          try { stage3.hdr = null; stage3.renderer.outputColorSpace = THREE.SRGBColorSpace; } catch (e) {}
        }
        if (state.stageMode === '3d') setStageMode('3d');
        toast(state.hdr3d ? 'HDR 背景开' : 'HDR 背景关');
      });
    }
    if (window.THREE && THREE.SRGBColorSpace) { /* 3D 输出按 sRGB 渲染，HDR 由离线管线完成 */ }
  } catch (e) {}
  initRealQuote();
  renderClips();
  setStageMode(state.stageMode);
  document.addEventListener('visibilitychange', () => updateSubDock(true));
  on('btnSubDockView', 'click', () => {
    const order = ['auto', 'dock', 'float'];
    state.subView = order[(order.indexOf(state.subView) + 1) % 3];
    updateSubDock(true);
    saveSettings();
    toast('字幕模式：' + (state.subView === 'auto' ? '自动（前台内嵌 / 失焦悬浮）' : state.subView === 'dock' ? '内嵌' : '悬浮'));
  });
  on('btnSubDockCanvas', 'click', () => {
    state.showSubs = !state.showSubs;
    updateSubs(true);
    saveSettings();
  });
  ['sdPrev', 'sdNext', 'sdCur'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', () => {
      const subs = state.subs || [];
      if (!subs.length || !state.musicAudio) return;
      const idx = subIdxAt(state.musicAudio.currentTime);
      const target = id === 'sdNext' ? idx + 1 : id === 'sdPrev' ? idx - 1 : (idx < 0 ? 0 : idx);
      const s = subs[clamp(target, 0, subs.length - 1)];
      if (s) seekMusicTo(s.t + (state.subOffset || 0));
    });
  });
  on('chkHighLow', 'change', e => { state.showHighLow = e.target.checked; applyHighLow(); saveSettings(); });
  on('chkHollow', 'change', e => {
    state.hollow = e.target.checked;
    state.chartType = state.hollow ? 'hollow' : 'candle';
    applyCandleType();
    if (state.mode === 'music') drawMusic(true);
    syncStyleChips();
    saveSettings();
  });
  ['trMA', 'trMACD'].forEach(id => on(id, 'click', () => toggleSub(id === 'trMA' ? 'MA' : 'MACD')));

  ['btnDanmakuTop', 'trDanmaku'].forEach(id => on(id, 'click', () => setDanmaku(!state.danmaku)));
  ['btnSoundTop', 'trSound'].forEach(id => on(id, 'click', () => setSound(!state.sound)));
  on('btnReplayTop', 'click', () => {
    state.marketReplay = !state.marketReplay;
    const el = $('btnReplayTop');
    if (el) el.classList.toggle('active', state.marketReplay);
    if (state.mode !== 'music') {
      if (state.marketReplay && state.playhead >= state.series.length - 2) state.playhead = 0;
      syncChart(true);
      updateAllUI(true);
      canvasSwap();
    }
    saveSettings();
    toast(state.marketReplay ? '回放：随播放揭示历史' : '自由浏览：可缩放拖动');
  });
  on('btnSonifyTop', 'click', () => {
    state.sonify = !state.sonify;
    const el = $('btnSonifyTop');
    if (el) el.classList.toggle('active', state.sonify);
    if (state.sonify) {
      Sonify.ensure();
      Sonify.setVolume(state.lastVol || 0.8);
      if (state.mode !== 'music' && state.speed > 8) setSpeed(8);
      toast('声化开 · 每根 K 线一个音（五声音阶）');
    } else toast('声化关');
    saveSettings();
  });
  ['btnFullTop', 'trFull'].forEach(id => on(id, 'click', toggleFullscreen));
  ['btnShareTop', 'trShare'].forEach(id => on(id, 'click', openShare));
  on('btnExport', 'click', e => { e.stopPropagation(); $('exportDd').classList.toggle('open'); });
  on('btnExportPng', 'click', e => { e.stopPropagation(); $('exportDd').classList.remove('open'); exportCurrentPng(); });
  on('btnExportVideo', 'click', e => { e.stopPropagation(); $('exportDd').classList.remove('open'); startVideoExport(); });
  on('recPill', 'click', () => stopVideoExport());
  document.addEventListener('click', e => {
    const dd = $('exportDd');
    if (dd && dd.classList.contains('open') && !e.target.closest('#exportDd')) dd.classList.remove('open');
  });
  ['btnImportTop', 'btnImportSide'].forEach(id => on(id, 'click', () => $('fileInput').click()));
  on('btnThemeTop', 'click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  on('fileInput', 'change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || f.type === 'text/csv') importCSV(f);
    else importAudio(f);
  });

  on('trSide', 'click', toggleSidebar);
  on('btnCollapseSide', 'click', toggleSidebar);
  on('btnSideFloat', 'click', toggleSidebar);
  document.querySelectorAll('#subtabs button[data-sub]').forEach(b => b.addEventListener('click', () => toggleSub(b.dataset.sub)));
  on('btnRpClose', 'click', () => $('rightPanel').classList.remove('rp-open'));

  document.querySelectorAll('#topnav button[data-nav]').forEach(b => b.addEventListener('click', () => {
    const nav = b.dataset.nav;
    if (nav === 'library') { toggleSidebar(); return; }
    if (nav === 'help') { showAbout(); return; }
    setPanel(nav);
  }));
  document.querySelectorAll('.rp-rail button[data-panel]').forEach(b => b.addEventListener('click', () => setPanel(b.dataset.panel)));

  document.querySelectorAll('#windowChips button').forEach(b => b.addEventListener('click', () => {
    state.musicWindow = Number(b.dataset.win);
    if (state.meta && state.meta.kind === 'music') {
      const t = state.musicAudio ? state.musicAudio.currentTime : 0;
      rebuildMusic(state.musicWindow);
      if (state.musicAudio) state.musicAudio.currentTime = t;
      state.playhead = t / state.musicWindow;
      syncChart(true);
      updateAllUI(true);
      updateStaticInfo();
    }
    document.querySelectorAll('#windowChips button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('#periodTabs button').forEach(x => x.classList.toggle('active', Number(x.dataset.win) === state.musicWindow));
    syncPeriodInk();
    saveSettings();
  }));
  document.querySelectorAll('#bandChips button').forEach(b => b.addEventListener('click', () => {
    state.spectrumBands = b.dataset.bands === 'auto' ? 'auto' : clamp(Number(b.dataset.bands), 48, 512);
    if (state.meta && state.meta.kind === 'music' && state.meta.analysis) {
      const rows = Math.max(1, effBands());
      state.spectrumRows = rows;
      const pair = buildSpectrumPair(state.meta.analysis.frames, rows, state.spectrumStep, state.meta.duration);
      state.spectrumL = pair.L;
      state.spectrumR = pair.R;
      drawMusic(true);
      updateVisualUI();
    }
    document.querySelectorAll('#bandChips button').forEach(x => x.classList.toggle('active', x === b));
    saveSettings();
  }));
  document.querySelectorAll('#thickChips button').forEach(b => b.addEventListener('click', () => {
    state.musicThick = Number(b.dataset.thick);
    if (state.meta && state.meta.kind === 'music' && state.meta.analysis) {
      const lines = buildFrequencyLines(state.meta.analysis.frames, state.series, state.musicThick, state.musicThin, state.musicWindow);
      state.freqThick = lines.thick;
      state.freqThin = lines.thin;
      drawMusic(true);
    }
    document.querySelectorAll('#thickChips button').forEach(x => x.classList.toggle('active', x === b));
    saveSettings();
  }));
  document.querySelectorAll('#thinChips button').forEach(b => b.addEventListener('click', () => {
    state.musicThin = Number(b.dataset.thin);
    if (state.meta && state.meta.kind === 'music' && state.meta.analysis) {
      const lines = buildFrequencyLines(state.meta.analysis.frames, state.series, state.musicThick, state.musicThin, state.musicWindow);
      state.freqThick = lines.thick;
      state.freqThin = lines.thin;
      drawMusic(true);
    }
    document.querySelectorAll('#thinChips button').forEach(x => x.classList.toggle('active', x === b));
    saveSettings();
  }));
  document.querySelectorAll('#viewChips button').forEach(b => b.addEventListener('click', () => {
    state.viewSpan = Number(b.dataset.view);
    drawMusic(true);
    document.querySelectorAll('#viewChips button').forEach(x => x.classList.toggle('active', x === b));
    saveSettings();
  }));
  const mc = $('musicCanvas');
  if (mc) {
    /* 悬停出十字光标；按住拖动=定位预览（拖动期间暂停音频，松手恢复） */
    let hoverRAF = 0, seekRAF = 0, dragT = 0, wasPlaying = false;
    const pickAt = e => {
      if (state.mode !== 'music' || !state.series.length) return null;
      const r = mc.getBoundingClientRect();
      if (state.kMode === 'freq') {
        const gf = state.freqGeom;
        if (!gf) return null;
        const x = clamp(e.clientX - r.left, 0, gf.pw);
        return { band: clamp(Math.floor((x / gf.pw) * gf.n), 0, gf.n - 1), idx: null, tSec: 0 };
      }
      const g = state.plotGeom;
      if (!g) return null;
      const x = clamp(e.clientX - r.left, 0, g.pw);
      const tSec = g.start + (x / g.pw) * g.span;
      const idx = clamp(Math.floor(tSec / g.win), 0, state.series.length - 1);
      return { idx, tSec };
    };
    const splitAt = e => {
      const h = (state.mCanvas && state.mCanvas.h) || mc.clientHeight;
      const g = paneGeom(h);
      if (!g.specCount) return '';
      const r = mc.getBoundingClientRect();
      const y = e.clientY - r.top;
      /* 段落色带占住中间一段，拖动只保留上下两条细边 */
      if (y >= g.mainH - 3 && y < g.mainH + 2) return 'main';
      if (y > g.mainH + 10 && y <= g.mainH + g.gap + 2) return 'main';
      if (g.specCount === 2) {
        const y2 = g.specY + g.hL;
        if (y >= y2 - 2 && y <= y2 + g.paneGap + 2) return 'sub';
      }
      return '';
    };
    const pickChapter = e => {
      if (state.kMode !== 'time' || !(state.showSpecL || state.showSpecR)) return null;
      const g = state.plotGeom;
      const chs = state.chapters || [];
      if (!g || !chs.length) return null;
      const r = mc.getBoundingClientRect();
      const y = e.clientY - r.top;
      if (y < g.mainH + 2 || y > g.mainH + 10) return null;
      const x = clamp(e.clientX - r.left, 0, g.pw);
      const tSec = g.start + (x / g.pw) * g.span;
      let hit = null;
      for (const ch of chs) {
        const t0 = ch.time != null ? ch.time : ch.idx * g.win;
        if (tSec >= t0 - 1e-6) hit = ch;
        else break;
      }
      return hit;
    };
    const redrawSoon = () => {
      if (hoverRAF) return;
      hoverRAF = requestAnimationFrame(() => { hoverRAF = 0; drawMusic(true); });
    };
    const setHover = e => {
      const p = pickAt(e);
      if (!p) return;
      if (p.band != null) {
        if (p.band === state.freqHover) return;
        state.freqHover = p.band;
        updateFoot();
        redrawSoon();
        return;
      }
      if (p.idx === state.musicHover) return;
      state.musicHover = p.idx;
      updateFoot();
      redrawSoon();
    };
    const clearHover = () => {
      if (state.musicHover == null && state.freqHover == null) return;
      state.musicHover = null;
      state.freqHover = null;
      updateFoot();
      redrawSoon();
    };
    const seekTo = e => {
      const p = pickAt(e);
      if (!p) return;
      dragT = p.tSec;
      state.musicHover = p.idx;
      if (seekRAF) return;
      seekRAF = requestAnimationFrame(() => {
        seekRAF = 0;
        setPlayhead(dragT / state.musicWindow, { fromUser: true });
      });
    };
    mc.addEventListener('pointerdown', e => {
      if (e.button !== 0 || state.mode !== 'music' || !state.series.length) return;
      const chap = pickChapter(e);
      if (chap) {
        const t0 = chap.time != null ? chap.time : chap.idx * state.musicWindow;
        setPlayhead(t0 / state.musicWindow, { fromUser: true });
        if (chap.title) toast('跳转 · ' + chap.title);
        return;
      }
      const sp = splitAt(e);
      if (sp) {
        state.dragSplit = sp;
        try { mc.setPointerCapture(e.pointerId); } catch (err) {}
        mc.style.cursor = 'row-resize';
        return;
      }
      if (state.kMode === 'freq') { setHover(e); return; }
      try { mc.setPointerCapture(e.pointerId); } catch (err) {}
      state.scrub = true;
      wasPlaying = state.playing;
      if (wasPlaying) setPlaying(false);
      mc.classList.add('grabbing');
      seekTo(e);
    });
    mc.addEventListener('pointermove', e => {
      if (state.mode !== 'music') return;
      if (state.dragSplit) {
        const h = (state.mCanvas && state.mCanvas.h) || mc.clientHeight;
        const g = paneGeom(h);
        const r = mc.getBoundingClientRect();
        const y = e.clientY - r.top;
        if (state.dragSplit === 'main') {
          state.splitMain = clamp(y / h, 0.22, 0.8);
        } else {
          const subH = Math.max(1, h - g.specY - g.paneGap);
          state.splitSub = clamp((y - g.specY) / subH, 0.2, 0.8);
        }
        drawMusic(true);
        return;
      }
      if (state.scrub) { seekTo(e); return; }
      mc.style.cursor = splitAt(e) ? 'row-resize' : (pickChapter(e) ? 'pointer' : '');
      setHover(e);
    });
    const endScrub = e => {
      if (state.dragSplit) {
        state.dragSplit = '';
        mc.style.cursor = '';
        try { mc.releasePointerCapture(e.pointerId); } catch (err) {}
        saveSettings();
        drawMusic(true);
        return;
      }
      if (!state.scrub) return;
      state.scrub = false;
      mc.classList.remove('grabbing');
      try { mc.releasePointerCapture(e.pointerId); } catch (err) {}
      if (wasPlaying) setPlaying(true);
    };
    mc.addEventListener('pointerup', endScrub);
    mc.addEventListener('pointercancel', endScrub);
    mc.addEventListener('pointerleave', () => { if (!state.scrub) clearHover(); });
    mc.addEventListener('wheel', e => {
      if (state.mode !== 'music') return;
      e.preventDefault();
      const views = [10, 20, 30, 60, 120];
      let i = views.indexOf(state.viewSpan);
      i = clamp(i + (e.deltaY > 0 ? 1 : -1), 0, views.length - 1);
      state.viewSpan = views[i];
      drawMusic(true);
      updateVisualUI();
      saveSettings();
    }, { passive: false });
  }
  on('smoothRange', 'input', e => {
    state.musicSmooth = Number(e.target.value);
    $('smoothVal').textContent = state.musicSmooth.toFixed(2);
  });
  on('smoothRange', 'change', async () => {
    await reanalyzeCurrent();
    saveSettings();
  });
  on('volRange', 'input', e => { state.lastVol = Number(e.target.value); Sonify.setVolume(state.lastVol); });
  on('volRange', 'input', e => {
    state.musicVolume = Number(e.target.value);
    if (state.musicAudio) state.musicAudio.volume = state.musicVolume;
    $('volVal').textContent = Math.round(state.musicVolume * 100) + '%';
  });
  on('volRange', 'change', saveSettings);
  on('btnReanalyze', 'click', async () => {
    if (!state.meta || state.meta.kind !== 'music' || !state.meta.buffer) { toast('当前没有音频'); return; }
    toast('重新分析…');
    const ok = await reanalyzeCurrent();
    if (ok) toast('已重新分析');
  });

  const tl = $('timeline');
  const seek = e => {
    const r = $('tlTrack').getBoundingClientRect();
    const p = clamp((e.clientX - r.left) / r.width, 0, 1);
    if (state.mode === 'music' && state.musicAudio) {
      setPlayhead(p * state.meta.duration / state.musicWindow, { fromUser: true });
    } else {
      setPlayhead(p * (state.series.length - 1), { fromUser: true });
    }
  };
  const tlPos = e => {
    const r = $('tlTrack').getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  tl.addEventListener('pointerdown', e => {
    if (e.shiftKey && state.mode === 'music' && state.meta && state.meta.duration) {
      const t0 = tlPos(e) * state.meta.duration;
      state.abDrag = t0;
      state.ab.a = t0; state.ab.b = t0;
      try { tl.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      applyAB();
      return;
    }
    state.draggingTimeline = true;
    state.dragWasPlaying = state.playing;
    setPlaying(false);
    tl.classList.add('dragging');
    tl.setPointerCapture(e.pointerId);
    seek(e);
  });
  tl.addEventListener('pointermove', e => {
    const p = tlPos(e);
    if (state.abDrag != null && state.meta && state.meta.duration) {
      const t1 = p * state.meta.duration;
      state.ab.a = Math.min(state.abDrag, t1);
      state.ab.b = Math.max(state.abDrag, t1);
      applyAB();
      return;
    }
    const tip = $('tlTip');
    if (tip) {
      if (state.mode === 'music') tip.textContent = fmtTime(p * state.meta.duration);
      else tip.textContent = state.series[Math.round(p * (state.series.length - 1))]?.[0] || '--';
      tip.style.left = (p * 100) + '%';
      tip.classList.add('show');
    }
    if (state.draggingTimeline) seek(e);
  });
  tl.addEventListener('pointerleave', () => $('tlTip').classList.remove('show'));
  tl.addEventListener('pointerup', e => {
    if (state.abDrag != null) {
      state.abDrag = null;
      if (!abActive()) clearAB();
      else toast('A-B 区间 ' + fmtTime(state.ab.a) + '–' + fmtTime(state.ab.b) + ' 循环中');
      try { tl.releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    if (!state.draggingTimeline) return;
    state.draggingTimeline = false;
    tl.classList.remove('dragging');
    try { tl.releasePointerCapture(e.pointerId); } catch (err) {}
    if (state.dragWasPlaying) setPlaying(true);
  });
  on('btnABClear', 'click', clearAB);
  document.querySelectorAll('.side-label[data-group]').forEach(l => l.addEventListener('click', e => {
    if (e.target.closest('.side-mini')) return;
    const g = l.dataset.group;
    state.collapsed[g] = !state.collapsed[g];
    applyCollapse();
    saveSettings();
  }));
  on('sideSort', 'change', e => {
    state.sort = e.target.value;
    renderSidebar();
    const q = $('searchInput');
    if (q && q.value.trim()) q.dispatchEvent(new Event('input'));
    saveSettings();
  });
  on('btnClearQueue', 'click', clearQueue);

  const search = $('searchInput');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      document.querySelectorAll('.q-row').forEach(row => {
        row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none';
      });
    });
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const row = Array.from(document.querySelectorAll('.q-row')).find(r => r.style.display !== 'none');
        if (row) row.click(); else toast('没有匹配项');
      }
    });
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown')) document.querySelector('.dropdown')?.classList.remove('open');
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (!$('modalMask').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.mode === 'music') setSpeed(MUSIC_RATES[Math.min(MUSIC_RATES.length - 1, MUSIC_RATES.indexOf(state.musicRate) + 1)]);
      else setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(state.speed) + 1)]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.mode === 'music') setSpeed(MUSIC_RATES[Math.max(0, MUSIC_RATES.indexOf(state.musicRate) - 1)]);
      else setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(state.speed) - 1)]);
    }
    else if (e.key.toLowerCase() === 'm') setSound(!state.sound);
    else if (e.key.toLowerCase() === 'l') cycleLoop();
    else if (e.key === ',' || e.key === '.') { e.preventDefault(); stepVideoFrame(e.key === ',' ? -1 : 1); }
    else if (e.key.toLowerCase() === 's' && e.shiftKey) {
      state.showSubs = !state.showSubs;
      const csb = $('chkSubs'); if (csb) csb.checked = state.showSubs;
      updateSubs(true);
      toast(state.showSubs ? '画面内字幕开' : '画面内字幕关');
      saveSettings();
    }
    else if (e.key.toLowerCase() === 's') {
      if (!state.subs.length) { toast('还没有字幕'); return; }
      state.subDockFold = !state.subDockFold;
      updateSubDock(true);
      saveSettings();
      setTimeout(() => { try { resizeMusicCanvas(); drawMusic(true); } catch (err) {} }, 60);
      toast(state.subDockFold ? '字幕区收起' : '字幕区展开');
    }
    else if (e.key === 'Home') { e.preventDefault(); setPlaying(false); setPlayhead(0, { fromUser: true }); }
    else if (e.key === 'End') { e.preventDefault(); setPlayhead(state.series.length - 1, { fromUser: true }); }
    else if (e.key.toLowerCase() === 'f') toggleFullscreen();
    else if (e.key.toLowerCase() === 't') setTheme(state.theme === 'dark' ? 'light' : 'dark');
    else if (e.key.toLowerCase() === 'r') { setPlaying(false); setPlayhead(0, { fromUser: true }); }
    else if (/^[1-9]$/.test(e.key)) {
      const ch = state.chapters[Number(e.key) - 1];
      if (ch) {
        if (state.mode === 'music' && ch.time != null) setPlayhead(ch.time / state.musicWindow, { fromUser: true });
        else setPlayhead(ch.idx, { fromUser: true });
        triggerChapter(ch);
      }
    }
    else if (e.key === 'Escape') { hideStartOverlay(); }
  });

  let mqTimer = 0, resizeRAF = 0;
  const onResize = () => {
    clearTimeout(mqTimer);
    mqTimer = setTimeout(refreshMarquees, 180);
    syncNavInk();
    syncPeriodInk();
    syncRpInk();
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => {
      resizeRAF = 0;
      if (state.mode === 'music') { resizeMusicCanvas(); drawMusic(true); }
      else { try { chart && chart.resize(); } catch (e) {} }
      updateSidebarFloat();
    });
  };
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver && $('chartWrap')) {
    new ResizeObserver(onResize).observe($('chartWrap'));
  }
}

function setSpeed(v) {
  if (state.mode === 'music') {
    if (!MUSIC_RATES.includes(v)) return;
    state.musicRate = v;
    if (state.musicAudio) state.musicAudio.playbackRate = v;
    $('rbSpeed').value = String(v);
    $('trSpeed').textContent = v + 'x';
    updatePlayUI();
    saveSettings();
    return;
  }
  if (!SPEEDS.includes(v)) return;
  if (state.sonify && state.mode !== 'music' && v > 8) v = 8;
  state.speed = v;
  $('rbSpeed').value = String(v);
  $('trSpeed').textContent = SPEED_LABELS[v];
  updatePlayUI();
  saveSettings();
}
function setPeriod(period) {
  if (!state.meta || state.meta.kind === 'music' || period === state.period) return;
  const date = state.series[clamp(Math.floor(state.playhead), 0, state.series.length - 1)]?.[0];
  state.period = period;
  state.series = aggregate(state.raw, period);
  state.ind = computeIndicators(state.series);
  state.kline = toKLine(state.series);
  state.tsIndex = new Map(state.kline.map((k, i) => [k.timestamp, i]));
  state.chapters = (state.meta.chapters || []).map(ch => ({ ...ch, idx: findIndexByDate(state.series, ch.date) }));
  state.playhead = clamp(findIndexByDate(state.series, date), 0, state.series.length - 1);
  state.lastInt = -1;
  state.lastChapterIdx = -1;
  state.endShown = false;
  setPlaying(false, true);
  if (chart) {
    chart.applyNewData(state.marketReplay ? state.kline.slice(0, Math.floor(state.playhead) + 1) : state.kline);
    chart.setBarSpace(state.barSpace);
    chart.scrollToRealTime(0);
    replayDrawings();
    syncDrawTools();
    resetPlayLine();
    smoothK = -1;
    canvasSwap();
  }
  document.querySelectorAll('#periodTabs button').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  syncPeriodInk();
  buildChapters();
  buildTimelineMarks();
  updateStaticInfo();
  updateAllUI(true);
  saveSettings();
}
function setDanmaku(v) {
  state.danmaku = !!v;
  ['btnDanmakuTop', 'trDanmaku'].forEach(id => { const el = $(id); if (el) el.classList.toggle('active', state.danmaku); });
  if (!state.danmaku) $('danmakuLayer').innerHTML = '';
  saveSettings();
}
function setSound(v) {
  state.sound = !!v;
  ['btnSoundTop', 'trSound'].forEach(id => { const el = $(id); if (el) el.classList.toggle('active', state.sound); });
  { const el = $('btnSonifyTop'); if (el) el.classList.toggle('active', !!state.sonify); }
  { const el = $('btnReplayTop'); if (el) el.classList.toggle('active', !!state.marketReplay); }
  { const el = $('chkNormPeak'); if (el) el.checked = !!state.normPeak; }
  { const el = $('fminNum'); if (el) el.value = state.freqMin; }
  { const el = $('fmaxNum'); if (el) el.value = state.freqMax; }
  if (state.sound) AudioFX.ensure();
  saveSettings();
}
function toggleMA() {
  if (!chart) return;
  try { chart.removeIndicator('candle_pane', 'MA'); } catch (e) {}
  if (state.showMA) {
    try { chart.createIndicator({ name: 'MA', calcParams: MA_PERIODS }, false, { id: 'candle_pane' }); } catch (e) {}
  }
}
const SUB_KEYS = { MA: 'showMA', VOL: 'showVOL', MACD: 'showMACD', THICK: 'showThick', THIN: 'showThin', SPECL: 'showSpecL', SPECR: 'showSpecR' };
function updateSubtabs() {
  document.querySelectorAll('#subtabs button[data-sub]').forEach(b => b.classList.toggle('active', !!state[SUB_KEYS[b.dataset.sub]]));
  const ma = $('trMA'); if (ma) ma.classList.toggle('active', state.showMA);
  const mc = $('trMACD'); if (mc) mc.classList.toggle('active', state.showMACD);
  const chk = $('chkMA'); if (chk) chk.checked = state.showMA;
}
function toggleSub(key) {
  const field = SUB_KEYS[key];
  if (!field) return;
  state[field] = !state[field];
  if (state.mode === 'music') {
    drawMusic(true);
  } else {
    if (field === 'showMA') toggleMA(); else createIndicators();
    try { chart.resize(); } catch (e) {}
    syncChart(false);
    updateLegend();
  }
  updateSubtabs();
  saveSettings();
}
function applyHighLow() {
  if (!chart) return;
  try { chart.setStyles({ candle: { priceMark: { high: { show: state.showHighLow }, low: { show: state.showHighLow } } } }); } catch (e) {}
}
function applyCandleType() {
  if (!chart) return;
  const map = {
    candle: 'candle_solid', hollow: 'candle_up_stroke', ohlc: 'ohlc',
    line: 'area', area: 'area'
  };
  try { chart.setStyles({ candle: { type: map[state.chartType] || (state.hollow ? 'candle_up_stroke' : 'candle_solid') } }); } catch (e) {}
}
function toggleSidebar() {
  $('sidebar').classList.toggle('collapsed');
  updateSidebarFloat();
  try { chart && chart.resize(); } catch (e) {}
  setTimeout(() => {
    document.querySelectorAll('#sidebar .q-name').forEach(el => applyMarquee(el));
    if (state.mode === 'music') { resizeMusicCanvas(); drawMusic(true); }
  }, 260);
}
function updateSidebarFloat() {
  const sb = $('sidebar'), float = $('btnSideFloat');
  if (!sb || !float) return;
  const collapsed = sb.classList.contains('collapsed');
  float.style.display = collapsed ? 'block' : 'none';
  $('app').classList.toggle('side-collapsed', collapsed);
}
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => toast('当前浏览器不允许全屏'));
  else document.exitFullscreen?.();
}

/* ================= init ================= */
async function init() {
  MUSIC.forEach(m => {
    m.kind = 'music';
    m.market = '音乐';
    m.demo = true;
    m.digits = 1;
    m.volNote = '量能（RMS）';
    if (m.id === 'demo-neon') m.desc = '32 秒演示曲 · 120 BPM';
    if (Array.isArray(m.sections)) m.sections = m.sections.map(s => ({ ...s, desc: '' }));
    if (!LIBRARY.find(x => x.id === m.id)) LIBRARY.unshift(m);
  });
  const s = loadSettings();
  document.documentElement.dataset.theme = state.theme;
  updateThemeBtn();
  setLoopMode(state.loopMode, true);
  initChart();
  renderSidebar();
  buildSettingChips();
  bindEvents();
  bindStylePanel();
  document.documentElement.dataset.density = state.density;
  syncStyleChips();
  $('chkMA').checked = state.showMA;
  if ($('chkEMA')) $('chkEMA').checked = state.showEMA;
  if ($('chkBoll')) $('chkBoll').checked = state.showBoll;
  if ($('bollN')) $('bollN').value = state.bollN;
  if ($('bollK')) $('bollK').value = state.bollK;
  if ($('bpmNum')) $('bpmNum').value = state.bpmOverride || 0;
  if ($('beatPhaseNum')) $('beatPhaseNum').value = state.beatPhaseAdj || 0;
  $('chkHighLow').checked = state.showHighLow;
  $('chkHollow').checked = state.hollow;
  setDanmaku(state.danmaku);
  setSound(state.sound);
  applyHighLow();
  applyCandleType();
  updateSubtabs();
  requestAnimationFrame(() => { syncNavInk(); syncPeriodInk(); syncRpInk(); });
  if (window.innerWidth <= 900) $('sidebar').classList.add('collapsed');
  updateSidebarFloat();

  const params = new URLSearchParams(location.search);
  if (params.has('danmaku')) setDanmaku(params.get('danmaku') !== '0');
  if (params.has('sound')) setSound(params.get('sound') === '1');
  if (params.has('speed')) {
    const v = Number(params.get('speed'));
    state.musicRate = clamp(v, 0.25, 2);
    state.speed = v;
  }
  if (params.has('window')) state.musicWindow = Number(params.get('window')) || 1;
  if (params.has('thick')) state.musicThick = Number(params.get('thick')) || state.musicThick;
  if (params.has('thin')) state.musicThin = Number(params.get('thin')) || state.musicThin;
  if (params.get('theme') === 'dark' || params.get('theme') === 'light') setTheme(params.get('theme'), true);
  if (params.has('bands')) state.spectrumBands = Number(params.get('bands')) || state.spectrumBands;
  if (params.has('view')) state.viewSpan = Number(params.get('view')) || state.viewSpan;
  const noOverlay = params.get('nostart') === '1';
  const id = params.get('id') || (MUSIC[0] && MUSIC[0].id) || s.id || 'usdjpy';
  if (params.get('panel')) setPanel(params.get('panel'));
  try {
    await loadDataset(id, { noOverlay });
  } catch (e) {
    console.error(e);
    const fallback = LIBRARY.find(m => m.kind !== 'music');
    if (fallback) loadMarketDataset(fallback, { noOverlay });
    toast('音频加载失败，已切到 K 线示例');
  }
  if (params.has('t') && state.mode === 'music') {
    setPlayhead(Number(params.get('t')) / state.musicWindow);
    drawMusic(true);
    refreshBook();
  }
  if (params.has('i') && state.mode === 'market') setPlayhead(Number(params.get('i')));
  if (params.get('play') === '1') setTimeout(() => { hideStartOverlay(); setPlaying(true); }, 300);

  const updateClock = () => {
    const t = fmtClock();
    $('titleClock').textContent = t;
    $('statusClock').textContent = t;
  };
  updateClock();
  setInterval(updateClock, 1000);

  state.lastFrame = performance.now();
  requestAnimationFrame(playbackFrame);
  saveSettings();

  window.KLINE_APP = {
    state, loadDataset, setPlayhead, setPlaying, setPanel, setSpeed, resolveSymbol, loadRealQuote, setStageMode,
    get sonify() { return { on: !!state.sonify, count: Sonify.count, ctx: Sonify.ctx ? Sonify.ctx.state : 'none' }; },
    get drawings() { return { tool: drawToolId, ids: drawIds.slice(), stored: drawStore }; },
    get playLine() { return playLineId; },
    get smooth() { return { k: smoothK, bars: chart ? chart.getDataList().length : 0 }; },
    setSubView(v) { if (['auto', 'dock', 'float'].includes(v)) { state.subView = v; updateSubDock(true); saveSettings(); } },
    setSubs,
    draw: drawMusic, buildSpectrumPair, buildFrequencySeries, analyzeBuffer,
    get chart() { return chart; },
    get audio() { return state.musicAudio; }
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
