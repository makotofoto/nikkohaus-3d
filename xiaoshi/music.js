// 背景音樂「光線連動」：全部用 Web Audio 即時合成，沒有音樂檔、沒有版權問題
// 跟著日期、時間、天氣換調性和樂器：早上明亮鋼琴＋鳥叫、中午溫暖和弦、晚上低沉鋪底、陰天加雨聲

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const pick = a => a[(Math.random() * a.length) | 0];
const chance = p => Math.random() < p;

export function createMusic(getLight) {
  let ctx = null, master, musicBus, ambBus, comp, meter, timer = null, preset = null, volume = 0.6;
  let beds = [], nextBeat = 0, beat = 0, white, pink, brightness;

  // iPhone 的靜音鍵預設會讓網頁音效無聲。把網頁宣告成「播放音樂」，靜音模式下也照常播放，
  // 大小聲交給手機音量鍵。新版 iOS（16.4+）用 audioSession；舊版用一段無聲的 <audio> 循環播放，
  // 讓系統把整個網頁當成正在播音樂。
  let keepAlive = null;
  function silentWav() {
    const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function playThroughSilentSwitch() {
    try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; } } catch {}
    if (!/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
    if (!keepAlive) {
      keepAlive = new Audio(silentWav());
      keepAlive.loop = true; keepAlive.setAttribute('playsinline', ''); keepAlive.volume = 0.01;
    }
    keepAlive.play().catch(() => {});
  }
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    meter = ctx.createAnalyser(); comp.connect(meter); // 只用來量音量（測試用）
    // 音樂走一個低通（控制明暗）＋一點殘響，環境音直接進總線
    brightness = ctx.createBiquadFilter(); brightness.type = 'lowpass'; brightness.frequency.value = 5000;
    musicBus = ctx.createGain(); musicBus.connect(brightness).connect(master);
    const verb = ctx.createConvolver(), wet = ctx.createGain(); wet.gain.value = 0.28;
    verb.buffer = impulse(2.6); brightness.connect(verb).connect(wet).connect(master);
    ambBus = ctx.createGain(); ambBus.connect(master);
    white = noiseBuf(2, false); pink = noiseBuf(4, true);
    document.addEventListener('visibilitychange', () => {
      if (!ctx || !preset) return;
      document.hidden ? ctx.suspend() : ctx.resume();
      if (keepAlive) document.hidden ? keepAlive.pause() : keepAlive.play().catch(() => {});
    });
  }
  function impulse(sec) {
    const n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    return b;
  }
  function noiseBuf(sec, isPink) {
    const n = ctx.sampleRate * sec, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (!isPink) { d[i] = w; continue; }
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    return b;
  }
  const gainAt = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
  function env(g, t, a, peak, len) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  }

  // ---------- 樂器 ----------
  function piano(m, t, v = 0.12, len = 2.6) {
    const f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(9000, f * 7), t); lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 1.6), t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    for (const [mul, a, type] of [[1, 1, 'triangle'], [2, 0.32, 'sine'], [3, 0.1, 'sine'], [4.01, 0.04, 'sine']]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = (Math.random() - 0.5) * 6;
      o.connect(gainAt(a, lp)); o.start(t); o.stop(t + len + 0.05);
    }
    lp.connect(g).connect(musicBus);
  }
  function bell(m, t, v = 0.05, len = 2.4, bus = musicBus) {
    const f = mtof(m);
    [[1, 1, len], [2.76, 0.4, len * 0.5], [5.4, 0.18, len * 0.25], [8.93, 0.08, len * 0.12]].forEach(([mul, a, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f * mul;
      env(g, t, 0.003, v * a, d); o.connect(g).connect(bus); o.start(t); o.stop(t + d + 0.05);
    });
  }
  function pad(notes, t, dur, v = 0.03) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(v * 0.8, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.25);
    for (const m of notes) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur * 1.3);
    }
    lp.connect(g).connect(musicBus);
  }
  function bass(m, t, len = 0.5, v = 0.14) {
    const g = ctx.createGain(); env(g, t, 0.01, v, len);
    for (const [type, a] of [['sine', 1], ['triangle', 0.4]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.connect(gainAt(a, g)); o.start(t); o.stop(t + len + 0.05); }
    g.connect(musicBus);
  }
  function noiseHit(t, freq, q, len, v, bus = musicBus, type = 'bandpass') {
    const s = ctx.createBufferSource(); s.buffer = white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.004, v, len);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + len + 0.05);
  }

  // ---------- 環境音 ----------
  function bed(type, level) {
    const s = ctx.createBufferSource(); s.buffer = pink; s.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
    const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 700;
    const l = ctx.createBiquadFilter(); l.frequency.value = 7000;
    s.connect(h).connect(l).connect(g).connect(ambBus); s.start();
    const b = { type, set(v) { g.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 1.5); },
      stop() { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); s.stop(ctx.currentTime + 2); } };
    beds.push(b); return b;
  }
  const bedOf = type => beds.find(b => b.type === type);
  function bird(t, v = 0.03) {
    const base = 2600 + Math.random() * 2400, n = 2 + ((Math.random() * 5) | 0), up = chance(0.5);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.08 + Math.random() * 0.06), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(base * (up ? 0.8 : 1.3), tt); o.frequency.exponentialRampToValueAtTime(base * (up ? 1.4 : 0.85), tt + 0.06);
      env(g, tt, 0.008, v, 0.07); o.connect(g).connect(ambBus); o.start(tt); o.stop(tt + 0.1);
    }
  }
  const raindrop = t => noiseHit(t, 3000 + Math.random() * 3000, 2, 0.03, 0.02, ambBus);

  // ---------- 每拍呼叫一次 ----------
  const CH = {
    morning: { bpm: 72, ch: [[60, 64, 67, 71], [65, 69, 72, 76], [57, 60, 64, 67], [55, 59, 62, 67]], root: [48, 53, 45, 43] },
    noon: { bpm: 62, ch: [[61, 65, 68, 72], [66, 70, 73, 77], [63, 66, 70, 73], [56, 60, 63, 66]], root: [49, 54, 51, 44] },
    night: { bpm: 54, ch: [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 56, 59, 62]], root: [45, 41, 38, 40] },
  };
  function lightMood() {
    const L = getLight(), dark = L.el < 2, w = L.w;
    const key = dark ? 'night' : L.t < 11 ? 'morning' : L.t < 16 ? 'noon' : 'night';
    return { key, L, birds: dark ? 0 : (L.t < 10 ? 0.35 : L.t < 12 ? 0.15 : 0.05) * (w === 'overcast' ? 0.25 : 1),
      rain: w === 'overcast' ? 0.22 : w === 'haze' ? 0.04 : 0, bright: (dark ? 1800 : key === 'morning' ? 5200 : 3400) * (w === 'overcast' ? 0.6 : 1) };
  }
  const STYLES = {
    light: {
      beds: () => { bed('rain', 0.0001); },
      bpm: () => CH[lightMood().key].bpm,
      beat(i, t, spb) {
        const md = lightMood(), c = CH[md.key], bar = Math.floor(i / 4) % 4, b = i % 4, ch = c.ch[bar];
        brightness.frequency.setTargetAtTime(md.bright, t, 2);
        bedOf('rain')?.set(md.rain);
        if (md.key === 'morning') {
          if (b === 0) bass(c.root[bar], t, 2.5, 0.09);
          piano(ch[(i * 2) % 4] + 12, t, 0.07, 2); piano(ch[(i * 2 + 1) % 4] + 12, t + spb / 2, 0.055, 2);
        } else if (md.key === 'noon') {
          if (b === 0) { bass(c.root[bar], t, 3, 0.09); ch.forEach((m, k) => piano(m, t + k * 0.035, 0.06, 3.2)); }
          else if (chance(0.55)) piano(pick(ch) + 12, t + (chance(0.4) ? spb / 2 : 0), 0.05, 2.4);
          if (md.L.enters && chance(0.18)) bell(pick(ch) + 24, t, 0.025, 2.4); // 陽光照進來時偶爾一點閃光
        } else {
          if (b === 0) { pad(ch, t, spb * 4, 0.022); bass(c.root[bar], t, 3.5, 0.08); }
          if (b === 2 && chance(0.65)) piano(pick(ch) + 12, t, 0.045, 3);
        }
        if (chance(md.birds)) bird(t + Math.random() * spb);
        if (md.rain > 0.1) for (let k = 0; k < 3; k++) if (chance(0.6)) raindrop(t + Math.random() * spb);
      },
    },
  };

  function tick() {
    if (!preset) return;
    const st = STYLES[preset];
    while (nextBeat < ctx.currentTime + 0.25) {
      const spb = 60 / st.bpm();
      st.beat(beat, nextBeat, spb);
      beat++; nextBeat += spb;
    }
  }
  return {
    get preset() { return preset; },
    get volume() { return volume; },
    play(p) {
      playThroughSilentSwitch(); // 要在使用者點擊的當下呼叫
      if (!ctx) init();
      ctx.resume();
      if (p === preset) return;
      for (const b of beds) b.stop(); beds = [];
      preset = p; beat = 0; nextBeat = ctx.currentTime + 0.1;
      STYLES[p].beds();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.8);
      clearInterval(timer); timer = setInterval(tick, 60); tick();
    },
    stop() {
      if (!ctx || !preset) return;
      preset = null; clearInterval(timer);
      keepAlive?.pause();
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      for (const b of beds) b.stop(); beds = [];
    },
    level() { // 目前輸出的 RMS 音量
      if (!meter) return 0;
      const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
    },
    setVolume(v) { volume = v; if (ctx && preset) master.gain.setTargetAtTime(v, ctx.currentTime, 0.1); },
  };
}
