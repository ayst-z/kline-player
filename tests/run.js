#!/usr/bin/env node
/**
 * K线播放器 回归自检
 *   node tests/run.js            # 默认端口 9240
 *   PORT=9250 node tests/run.js  # 换端口
 *   CHROME="D:/Chrome/chrome.exe" node tests/run.js
 *
 * 自带合成音频（120 BPM 点击轨），不依赖任何版权素材；跑完自动关闭浏览器。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9240);
const PROFILE = path.join(os.tmpdir(), 'klp-test-profile-' + PORT + '-' + Date.now());
const TMP = path.join(__dirname, '_tmp');
const PAGE = encodeURI('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/').replace(/^\/+/, '')) + '?nostart=1&id=demo-neon&theme=light&v=' + Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 合成测试音频：120 BPM 点击 + 底噪 ---------- */
function makeWav(file, seconds = 16, bpm = 120) {
  const sr = 22050, n = sr * seconds;
  const data = Buffer.alloc(n * 2);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = Math.sin(2 * Math.PI * 110 * t) * 0.05;          // 低音底
    const ph = t % beat;
    if (ph < 0.035) {                                          // 每拍一个短促点击
      const env = Math.exp(-ph * 70);
      v += (Math.sin(2 * Math.PI * 1800 * t) * 0.55 + (Math.random() - 0.5) * 0.2) * env;
    }
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
}
function makeLrc(file) {
  const lines = [
    '[00:00.50]测试第一句',
    '[00:02.00]测试第二句',
    '[00:03.50]测试第三句',
    '[00:05.00]测试第四句',
    '[00:06.50]测试第五句'
  ];
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

/* ---------- 极简 CDP 客户端 ---------- */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method) events.push(m);
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
  });
  const evaluate = async (expr, gesture) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: !!gesture });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval error');
    return r.result.value;
  };
  return { ready, send, evaluate, events, close: () => ws.close() };
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const wav = makeWav(path.join(TMP, 'beat120.wav'));
  const lrc = makeLrc(path.join(TMP, 'subs.lrc'));
  if (!fs.existsSync(CHROME)) {
    console.error('找不到 Chrome：' + CHROME + '\n可用 CHROME=<路径> node tests/run.js 指定');
    process.exit(2);
  }
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
    '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ], { stdio: 'ignore' });

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
  };
  let client = null;
  try {
    let list = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        if (list.some(t => t.type === 'page')) break;
      } catch (e) {}
    }
    const page = list && list.find(t => t.type === 'page');
    if (!page) throw new Error('浏览器未就绪');
    client = cdp(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('DOM.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    client.events.length = 0;
    await client.send('Page.navigate', { url: PAGE });
    await sleep(2500);

    /* 1 启动 */
    const boot = await client.evaluate(`(() => {
      const s = window.KLINE_APP && KLINE_APP.state;
      return JSON.stringify({ app: !!window.KLINE_APP, meta: !!(s && s.meta), series: s ? s.series.length : 0 });
    })()`);
    const b = JSON.parse(boot);
    check('启动：KLINE_APP 与初始数据集就绪', b.app && b.meta && b.series > 100, boot);

    /* 2 主题切换 */
    const theme = await client.evaluate(`(() => {
      document.querySelector('#themeChips button[data-theme="dark"]').click();
      const a = KLINE_APP.state.theme;
      document.querySelector('#themeChips button[data-theme="light"]').click();
      return a + '/' + KLINE_APP.state.theme;
    })()`, true);
    check('主题切换 深→浅', theme === 'dark/light', theme);

    /* 3 导入音频 → Worker 分析 */
    let doc = await client.send('DOM.getDocument');
    let node = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
    await client.evaluate(`(() => {
      window.__barSeen = false;
      const b = document.getElementById('loadBar');
      new MutationObserver(() => { if (!b.hidden) window.__barSeen = true; }).observe(b, { attributes: true, attributeFilter: ['hidden'] });
      return 1;
    })()`);
    await client.send('DOM.setFileInputFiles', { files: [wav], nodeId: node.nodeId });
    let ready = false, meta = null;
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      const st = await client.evaluate(`(() => {
        const s = KLINE_APP.state;
        if (!s.meta || !s.meta.analysis) return '';
        return JSON.stringify({ dur: s.meta.duration, series: s.series.length, bpm: s.meta.bpm, phase: s.meta.beatPhase, conf: s.meta.beatConf, onsets: (s.meta.onsets || []).length });
      })()`);
      if (st) { meta = JSON.parse(st); ready = true; break; }
    }
    check('导入音频并完成分析', ready && meta && Math.abs(meta.dur - 16) < 1, JSON.stringify(meta));
    const barSeen = await client.evaluate('!!window.__barSeen');
    const barHidden = await client.evaluate(`document.getElementById('loadBar').hidden`);
    check('加载进度条出现过并在结束后隐藏', barSeen && barHidden, 'barSeen=' + barSeen + ' hidden=' + barHidden);
    if (!ready) throw new Error('analysis timeout');
    check('音乐 K 线已生成（16s ≈ 64 根）', meta.series >= 40, 'series=' + meta.series);

    /* 4 分析跑在 Worker 里 */
    const wk = await client.evaluate(`(() => {
      const w = KLINE_APP.state.analysisWorker;
      return w ? w.constructor.name : 'none';
    })()`);
    check('分析使用 Web Worker', wk === 'Worker', wk);

    /* 5 节拍识别 */
    check('节拍识别 120 BPM（±3）', Math.abs(meta.bpm - 120) <= 3, 'bpm=' + meta.bpm + ' conf=' + meta.conf + ' onsets=' + meta.onsets);

    /* 6 字幕导入与字幕区 */
    doc = await client.send('DOM.getDocument');
    node = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#subFile' });
    await client.send('DOM.setFileInputFiles', { files: [lrc], nodeId: node.nodeId });
    await sleep(700);
    const sub = await client.evaluate(`(() => {
      const s = KLINE_APP.state, d = document.getElementById('subDock'), f = document.getElementById('subFloat');
      KLINE_APP.setSubView('dock');
      const dockOn = !document.getElementById('subDock').hidden;
      return JSON.stringify({ n: s.subs.length, dockOn, cur: document.getElementById('sdCur').textContent, floatHidden: f.hidden });
    })()`, true);
    const sb = JSON.parse(sub);
    check('LRC 导入 5 行并显示字幕区', sb.n === 5 && sb.dockOn === true, sub);

    /* 7 字幕双形态 */
    const modes = await client.evaluate(`(() => {
      KLINE_APP.setSubView('float');
      const f = !document.getElementById('subFloat').hidden && document.getElementById('subDock').hidden;
      KLINE_APP.setSubView('dock');
      const d = !document.getElementById('subDock').hidden && document.getElementById('subFloat').hidden;
      return f + '/' + d;
    })()`, true);
    check('字幕 悬浮 / 内嵌 切换', modes === 'true/true', modes);

    /* 8 指标叠加（EMA / BOLL）*/
    const ovl = await client.evaluate(`(() => {
      const s = KLINE_APP.state;
      s.showEMA = true; s.showBoll = true;
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) KLINE_APP.draw(true);
      const ms = (performance.now() - t0) / 30;
      KLINE_APP.draw(true);
      return JSON.stringify({ ms: Math.round(ms * 100) / 100, up: s.ovl ? s.ovl.up.length : 0, ema: s.ovl ? s.ovl.emaF.length : 0 });
    })()`);
    const ov = JSON.parse(ovl);
    check('EMA + BOLL 可绘制且开销 < 8ms/帧', ov.up >= 40 && ov.ema >= 40 && ov.ms < 8, ovl);

    /* 9 BPM / 相位 人工覆盖 */
    const nudged = await client.evaluate(`(() => {
      const b = document.getElementById('bpmNum'), ph = document.getElementById('beatPhaseNum');
      b.value = '90'; b.dispatchEvent(new Event('input', { bubbles: true }));
      ph.value = '25'; ph.dispatchEvent(new Event('input', { bubbles: true }));
      const ok = KLINE_APP.state.bpmOverride === 90 && KLINE_APP.state.beatPhaseAdj === 25;
      document.getElementById('btnBeatReset').click();
      const reset = KLINE_APP.state.bpmOverride === 0 && KLINE_APP.state.beatPhaseAdj === 0;
      return ok + '/' + reset;
    })()`, true);
    check('BPM/相位 人工覆盖与复位', nudged === 'true/true', nudged);

    /* 10 拖放导入（合成 LRC 文件） */
    const drop = await client.evaluate(`(async () => {
      const before = KLINE_APP.state.subs.length;
      const text = '[00:00.20]拖放第一句' + String.fromCharCode(10) + '[00:01.20]拖放第二句';
      const f = new File([text], 'drop.lrc', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(f);
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      window.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
      return before + '->' + KLINE_APP.state.subs.length;
    })()`);
    check('拖放 LRC 导入字幕', /^\d+->2$/.test(drop), drop);

    /* 11 右键菜单 */
    const ctx = await client.evaluate(`(() => {
      const wrap = document.getElementById('chartWrap');
      const r = wrap.getBoundingClientRect();
      wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.5, clientY: r.top + 200 }));
      const menu = document.getElementById('ctxMenu');
      const open = !menu.hidden && menu.querySelectorAll('.ci').length >= 5;
      const items = [...menu.querySelectorAll('.ci')];
      const a = items.find(el => el.textContent.indexOf('设为 A 点') === 0);
      if (a) a.click();
      return JSON.stringify({ open, items: items.length, abA: KLINE_APP.state.ab.a });
    })()`, true);
    const cx = JSON.parse(ctx);
    check('右键菜单打开并设 A 点', cx.open && typeof cx.abA === 'number', ctx);

    /* 12 命令面板 Ctrl+K */
    const pal = await client.evaluate(`(async () => {
      const before = KLINE_APP.state.theme;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
      const p = document.getElementById('cmdPalette');
      const opened = p.classList.contains('on');
      const input = document.getElementById('cpInput');
      input.value = '主题';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const n = document.querySelectorAll('#cpList .cp-item').length;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 120));
      return JSON.stringify({ opened, n, closed: !p.classList.contains('on'), changed: KLINE_APP.state.theme !== before });
    })()`, true);
    const pl = JSON.parse(pal);
    check('命令面板 打开/过滤/执行', pl.opened && pl.n >= 1 && pl.closed && pl.changed, pal);

    /* 13 分时图 */
    const tl = await client.evaluate(`(() => {
      const s = KLINE_APP.state;
      KLINE_APP.setPlayhead(5 / s.musicWindow);
      document.querySelector('#typeChips button[data-type="timeline"]').click();
      KLINE_APP.draw(true);
      return JSON.stringify({ type: s.chartType, legend: document.getElementById('chartLegend').textContent.slice(0, 6) });
    })()`, true);
    const tlj = JSON.parse(tl);
    check('分时图模式与图例', tlj.type === 'timeline' && tlj.legend.indexOf('分时') >= 0, tl);

    /* 14 指数条 */
    await sleep(300);
    const strip = await client.evaluate(`(() => {
      const ids = ['isFreq', 'isG0', 'isG1', 'isG2', 'isG3'];
      const vals = ids.map(id => document.getElementById(id).textContent);
      return JSON.stringify({ vals, ok: vals.every(v => v !== '--') });
    })()`);
    const stj = JSON.parse(strip);
    check('顶部指数条实时更新', stj.ok, strip);

    /* 15 资金流向面板 */
    const flow = await client.evaluate(`(() => {
      KLINE_APP.setPanel('flow');
      const pane = document.getElementById('paneFlow');
      const vals = [...document.querySelectorAll('#flowRows .fv')].map(e => e.textContent);
      return JSON.stringify({ active: pane.classList.contains('active'), vals, main: document.getElementById('flowMain').textContent });
    })()`, true);
    const flj = JSON.parse(flow);
    check('资金流向面板四档有值', flj.active && flj.vals.length === 4 && flj.vals.every(v => v !== '--'), flow);

    /* 16 频率轴按帧实时解算 */
    const rt = await client.evaluate(`(() => {
      const s = KLINE_APP.state;
      s.kMode = 'freq';
      KLINE_APP.setPlayhead(6 / s.musicWindow);
      KLINE_APP.draw(true);
      const a = (s.freqBars || []).map(b => Math.round(b[3] * 100));
      KLINE_APP.setPlayhead(6.12 / s.musicWindow);
      KLINE_APP.draw(true);
      const b = (s.freqBars || []).map(x => Math.round(x[3] * 100));
      const diff = a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
      s.kMode = 'time';
      KLINE_APP.draw(true);
      return JSON.stringify({ n: a.length, diff });
    })()`);
    const rtj = JSON.parse(rt);
    check('频率轴按帧实时重算（0.12s 内变化）', rtj.n > 50 && rtj.diff > 0, rt);

    /* 17 A股行情入口与代码解析 */
    const sym = await client.evaluate(`JSON.stringify({
      a: (KLINE_APP.resolveSymbol('600519') || {}).secid,
      b: (KLINE_APP.resolveSymbol('sz000001') || {}).secid,
      c: (KLINE_APP.resolveSymbol('sh000001') || {}).secid,
      bad: KLINE_APP.resolveSymbol('abc'),
      ui: !!document.getElementById('btnRtLoad') && !!document.getElementById('rtCode')
    })`);
    const sy = JSON.parse(sym);
    check('A股代码解析（sh/sz 推断）与行情入口', sy.a === '1.600519' && sy.b === '0.000001' && sy.c === '1.000001' && sy.bad === null && sy.ui, sym);

    /* 18 3D 沉浸界面切换 */
    const stg = await client.evaluate(`(() => {
      KLINE_APP.setStageMode('3d');
      const cv = document.getElementById('bg3d');
      const on = document.documentElement.dataset.stage === '3d' && getComputedStyle(cv).display !== 'none' && cv.width > 0;
      KLINE_APP.setStageMode('normal');
      const off = document.documentElement.dataset.stage === 'normal' && getComputedStyle(cv).display === 'none';
      return JSON.stringify({ on, off });
    })()`);
    const sg = JSON.parse(stg);
    check('3D / 普通界面可切换', sg.on && sg.off, stg);

    /* 19 K 线声化开关 */
    const son = await client.evaluate(`(() => {
      const b = document.getElementById('btnSonifyTop');
      if (!b) return 'missing';
      const before = KLINE_APP.state.sonify;
      b.click();
      const after = KLINE_APP.state.sonify;
      b.click();
      return JSON.stringify({ before, after, back: KLINE_APP.state.sonify });
    })()`, true);
    const sn = JSON.parse(son === 'missing' ? '{}' : son);
    check('声化开关可切换', sn.after === !sn.before && sn.back === sn.before, son);

    /* 20 页面异常 */
    const errs = client.events.filter(e => e.method === 'Runtime.exceptionThrown');
    check('无未捕获异常', errs.length === 0, errs.length ? JSON.stringify(errs[0].params).slice(0, 200) : '');

  } catch (e) {
    check('测试执行', false, String(e && e.message || e).slice(0, 300));
  } finally {
    if (client) client.close();
    try { chrome.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
    const fail = results.filter(r => !r.ok).length;
    console.log('\n' + (results.length - fail) + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
})();
