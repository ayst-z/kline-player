#!/usr/bin/env node
/**
 * 内置语音识别：把音频转成播放器可直接吃的逐字字幕
 *   node tools/stt_local.js <16k.wav> [out.json] [lang]
 * 模型与 sherpa 运行时都在 tools/ 下，无需外部服务、无需联网。
 * 输出：<out>.json（播放器 subs.json 格式）+ 同名 .lrc
 */
const fs = require('fs');
const path = require('path');
const sherpa = require(path.join(__dirname, 'stt/node_modules/sherpa-onnx-node'));

const MODELS = process.env.STT_MODELS || path.join(__dirname, 'models/sensevoice');
const ASR_DIR = path.join(MODELS, 'sensevoice-onnx');
const VAD_MODEL = path.join(MODELS, 'silero/silero_vad.onnx');
const SR = 16000;
const wavPath = process.argv[2];
const outPath = process.argv[3] || 'subs.json';
const lang = process.argv[4] || 'zh';
if (!wavPath) {
  console.error('用法：node tools/stt_local.js <16k.wav> [out.json] [zh|en]');
  process.exit(2);
}

const wave = sherpa.readWave(wavPath);
if (wave.sampleRate !== SR) throw new Error('需要 16k 单声道 wav，请先 ffmpeg -ar 16000 -ac 1');
const samples = wave.samples;
console.log('[stt] ' + (samples.length / SR).toFixed(1) + ' s');

const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: SR, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: path.join(ASR_DIR, 'model.int8.onnx'), language: lang, useInverseTextNormalization: 1 },
    tokens: path.join(ASR_DIR, 'tokens.txt'), numThreads: 4, provider: 'cpu', debug: 0
  },
  decodingMethod: 'greedy_search'
});
const detector = new sherpa.Vad({
  sileroVad: {
    model: VAD_MODEL, threshold: 0.40, minSilenceDuration: 0.18,
    minSpeechDuration: 0.20, maxSpeechDuration: 3.5, windowSize: 512
  },
  sampleRate: SR, numThreads: 1, provider: 'cpu', debug: 0
}, 20);
detector.reset();

const spans = [];
const drain = () => {
  while (!detector.isEmpty()) {
    const seg = detector.front(false);
    const st = recognizer.createStream();
    st.acceptWaveform({ sampleRate: SR, samples: seg.samples });
    recognizer.decode(st);
    const text = (recognizer.getResult(st).text || '').trim();
    const start = typeof seg.start === 'number' ? seg.start / SR : null;
    const dur = seg.samples.length / SR;
    if (text) spans.push({ start: start == null ? 0 : +start.toFixed(3), end: start == null ? 0 : +(start + dur).toFixed(3), text });
    detector.pop();
  }
};
const CH = 512;
const t0 = Date.now();
for (let o = 0; o < samples.length; o += CH * 200) {
  const chunk = samples.subarray(o, Math.min(samples.length, o + CH * 200));
  for (let k = 0; k < chunk.length; k += CH) detector.acceptWaveform(chunk.subarray(k, k + CH));
  drain();
}
detector.flush();
drain();
console.log('[stt] ' + spans.length + ' 段，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

/* 逐字时间轴：SenseVoice 只给整段时间，按字符数均分（与现有 subs.json 约定一致） */
const subs = spans.map(s => {
  const t = s.start;
  const end = Math.max(s.end, t + 0.3);
  const chars = [...s.text];
  const n = chars.length || 1;
  const step = (end - t) / n;
  const words = [];
  for (let i = 0; i < n; i++) {
    const w = chars[i];
    if (w === ' ') continue;
    words.push({ t0: +(t + i * step).toFixed(3), t1: +(t + (i + 1) * step).toFixed(3), w });
  }
  return { t, end, text: s.text, words };
});

fs.writeFileSync(outPath, JSON.stringify({ shift: 0, subs }, null, 1));
const fmt = t => {
  const m = Math.floor(t / 60);
  const s2 = t - m * 60;
  return '[' + String(m).padStart(2, '0') + ':' + (s2 < 10 ? '0' : '') + s2.toFixed(2) + ']';
};
const lrc = subs.map(x => fmt(x.t) + x.text).join('\n');
fs.writeFileSync(outPath.replace(/\.json$/i, '') + '.lrc', lrc, 'utf8');
console.log('[stt] 已写出 ' + outPath + ' 与同名 .lrc');
for (const s of spans.slice(0, 10)) console.log('  ' + s.start.toFixed(2) + '-' + s.end.toFixed(2) + '  ' + s.text.slice(0, 40));
