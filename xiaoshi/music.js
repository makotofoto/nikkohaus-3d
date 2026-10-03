// 背景音樂：全部用 Web Audio 即時合成，沒有音樂檔、沒有版權問題
// 四種氛圍：light 光線連動（跟著日期時間天氣變）、cafe 咖啡廳、market 市集、morning 假日清晨
export const PRESETS = { light: '光線連動', cafe: '咖啡廳', market: '市集', morning: '假日清晨' };

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const pick = a => a[(Math.random() * a.length) | 0];
const chance = p => Math.random() < p;

export function createMusic(getLight) {
  let ctx = null, master, musicBus, ambBus, comp, meter, timer = null, preset = null, volume = 0.6;
  let beds = [], nextBeat = 0, beat = 0, white, pink, ksCache = new Map(), brightness;

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
  function ksBuf(m) {
    if (ksCache.has(m)) return ksCache.get(m);
    const sr = ctx.sampleRate, n = Math.floor(sr * 1.6), N = Math.round(sr / mtof(m)), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const ring = new Float32Array(N).map(() => Math.random() * 2 - 1);
    for (let i = 0, k = 0; i < n; i++, k = (k + 1) % N) { const a = ring[k]; ring[k] = (a + ring[(k + 1) % N]) * 0.5 * 0.996; d[i] = a; }
    ksCache.set(m, b); return b;
  }
  function pluck(m, t, v = 0.1) {
    const s = ctx.createBufferSource(); s.buffer = ksBuf(m);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    s.connect(lp).connect(gainAt(v, musicBus)); s.start(t);
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
    let chain = s, layers = null;
    if (type === 'rain') { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 700; const l = ctx.createBiquadFilter(); l.frequency.value = 7000; chain = s.connect(h).connect(l); }
    if (type === 'wind') { const l = ctx.createBiquadFilter(); l.frequency.value = 380; chain = s.connect(l); }
    if (type === 'murmur') {
      // 幾層不同音高的人聲嗡嗡聲，各自忽大忽小，聽起來像很多人在遠處聊天
      layers = [380, 650, 1050].map(fr => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fr; b.Q.value = 1.4; const lg = ctx.createGain(); lg.gain.value = 0.5; s.connect(b).connect(lg).connect(g); return lg; });
    } else chain.connect(g);
    g.connect(ambBus); s.start();
    const b = { type, g, s, layers, level, set(v) { b.level = v; g.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 1.5); },
      stop() { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); s.stop(ctx.currentTime + 2); } };
    beds.push(b); return b;
  }
  const bedOf = type => beds.find(b => b.type === type);
  function murmurWobble(t) { const m = bedOf('murmur'); if (m) for (const l of m.layers) l.gain.setTargetAtTime(0.25 + Math.random() * 0.75, t, 0.25); }
  function bird(t, v = 0.03) {
    const base = 2600 + Math.random() * 2400, n = 2 + ((Math.random() * 5) | 0), up = chance(0.5);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.08 + Math.random() * 0.06), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(base * (up ? 0.8 : 1.3), tt); o.frequency.exponentialRampToValueAtTime(base * (up ? 1.4 : 0.85), tt + 0.06);
      env(g, tt, 0.008, v, 0.07); o.connect(g).connect(ambBus); o.start(tt); o.stop(tt + 0.1);
    }
  }
  const clink = (t) => bell(96 + ((Math.random() * 8) | 0), t, 0.012, 0.5, ambBus);
  function espresso(t) {
    const s = ctx.createBufferSource(); s.buffer = white; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.012, t + 0.4);
    g.gain.setValueAtTime(0.012, t + 2.2); g.gain.linearRampToValueAtTime(0.0001, t + 2.8);
    s.connect(f).connect(g).connect(ambBus); s.start(t); s.stop(t + 3);
  }
  const bikeBell = t => { bell(98, t, 0.02, 0.8, ambBus); bell(98, t + 0.14, 0.018, 0.8, ambBus); };
  const raindrop = t => noiseHit(t, 3000 + Math.random() * 3000, 2, 0.03, 0.02, ambBus);

  // ---------- 四種氛圍：每拍呼叫一次 ----------
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
    cafe: {
      // F 大調的 ii–V–I–VI 爵士循環，搖擺節奏、刷子鼓、走路貝斯；背景是聊天聲、杯盤聲、偶爾打奶泡
      beds: () => { bed('murmur', 0.2); },
      bpm: () => 84,
      beat(i, t, spb) {
        const ch = [[58, 62, 65, 69], [58, 62, 64, 69], [57, 60, 64, 67], [54, 57, 60, 63]], roots = [43, 48, 41, 50];
        const bar = Math.floor(i / 4) % 4, b = i % 4, sw = spb * 2 / 3, r = roots[bar], next = roots[(bar + 1) % 4];
        brightness.frequency.setTargetAtTime(3600, t, 1);
        bass([r, r + 7, r + 12, next - 1][b], t, spb * 0.9, 0.12);
        if (b === 1 || b === 3) ch[bar].forEach(m => piano(m, t + sw, 0.035, 0.7));
        if (b === 0 && chance(0.5)) ch[bar].forEach(m => piano(m, t, 0.03, 1.2));
        if (chance(0.3)) piano(pick(ch[bar]) + 12, t + (chance(0.5) ? sw : 0), 0.05, 1.4);
        noiseHit(t, 5500, 0.6, 0.18, b % 2 ? 0.02 : 0.012); noiseHit(t + sw, 5500, 0.6, 0.1, 0.008);
        murmurWobble(t);
        if (chance(0.07)) clink(t + Math.random() * spb);
        if (chance(0.006)) espresso(t);
      },
    },
    market: {
      // G 大調 I–V–vi–IV，撥弦吉他、沙鈴；背景是比較熱鬧的人聲、腳踏車鈴、遠處鳥叫
      beds: () => { bed('murmur', 0.38); bed('wind', 0.05); },
      bpm: () => 100,
      beat(i, t, spb) {
        const ch = [[55, 59, 62, 67], [54, 57, 62, 66], [52, 55, 59, 64], [52, 55, 60, 64]], roots = [43, 38, 40, 36];
        const bar = Math.floor(i / 4) % 4, b = i % 4, c = ch[bar];
        brightness.frequency.setTargetAtTime(4800, t, 1);
        if (b === 0 || b === 2) pluck(roots[bar], t, 0.16);
        pluck(c[(b * 2) % 4], t, 0.07); pluck(c[(b * 2 + 1) % 4] + (b === 3 ? 12 : 0), t + spb / 2, 0.06);
        if (bar === 3 && b === 3 && chance(0.6)) pluck(c[3] + 12, t + spb * 0.75, 0.05);
        noiseHit(t + spb / 2, 7000, 0.8, 0.05, 0.012, musicBus, 'highpass'); noiseHit(t, 7000, 0.8, 0.04, 0.006, musicBus, 'highpass');
        murmurWobble(t);
        if (chance(0.012)) bikeBell(t + Math.random() * spb);
        if (chance(0.05)) bird(t, 0.018);
      },
    },
    morning: {
      // F 大調、很慢：柔和的鋪底和音樂盒般的鈴聲，很多鳥叫，一點風
      beds: () => { bed('wind', 0.07); },
      bpm: () => 48,
      beat(i, t, spb) {
        const ch = [[53, 57, 60, 67], [58, 62, 65, 69], [50, 53, 57, 64], [48, 55, 60, 62]], penta = [65, 67, 69, 72, 74, 77, 79, 81];
        const bar = Math.floor(i / 4) % 4, b = i % 4;
        brightness.frequency.setTargetAtTime(4200, t, 1);
        if (b === 0) { pad(ch[bar], t, spb * 4, 0.02); bass(ch[bar][0] - 12, t, 4, 0.06); }
        if (chance(0.5)) bell(pick(penta), t + (chance(0.3) ? spb / 2 : 0), 0.035, 2.8);
        if (chance(0.45)) bird(t + Math.random() * spb, 0.028);
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
