/* The table's sound: one Web Audio engine and ONE set of sound definitions.
   Plain script (no modules) shared by app.js, which plays them, and
   soundlab.html, which edits them live and exports the layer JSON. */
(function (global) {
  let audioCtx = null;
  document.addEventListener(
    "pointerdown",
    () => {
      // browsers only allow audio after a user gesture
      if (!audioCtx) audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    },
    { capture: true }
  );

  // shared convolution reverb (synthesized decaying-noise impulse response);
  // layers opt in with verb: 0..1 (wet send amount)
  let sfxVerb = null;
  function getVerb() {
    if (!sfxVerb) {
      sfxVerb = audioCtx.createConvolver();
      const dur = 1.4;
      const len = Math.ceil(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
      sfxVerb.buffer = buf;
      sfxVerb.connect(audioCtx.destination);
    }
    return sfxVerb;
  }

  function sfxOut(g, verb) {
    g.connect(audioCtx.destination);
    if (verb > 0) {
      const w = audioCtx.createGain();
      w.gain.value = verb;
      g.connect(w).connect(getVerb());
    }
  }

  function sfxTone(freq, { t = 0, dur = 0.15, type = "sine", vol = 0.1, slide = null, verb = 0, atk = 0.004 } = {}) {
    if (!audioCtx || audioCtx.state !== "running") return;
    const now = audioCtx.currentTime + t;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, now + dur);
    // short attack ramp: an instant-on envelope clicks, and on low tones the
    // click is all small speakers reproduce — it reads as a high tick
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(dur, atk + 0.01));
    o.connect(g);
    sfxOut(g, verb);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  function sfxNoise({ t = 0, dur = 0.08, vol = 0.15, freq = 1000, q = 1, slide = null, verb = 0, atk = 0 } = {}) {
    if (!audioCtx || audioCtx.state !== "running") return;
    const now = audioCtx.currentTime + t;
    const len = Math.ceil(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, now);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, now + dur);
    f.Q.value = q;
    const g = audioCtx.createGain();
    if (atk > 0) {
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(vol, now + atk);
    } else {
      g.gain.value = vol;
    }
    src.connect(f).connect(g);
    sfxOut(g, verb);
    src.start(now);
  }

  // The sounds themselves, as data: each is a stack of tone/noise layers.
  // Values tuned by Artem in the sound lab — the lab edits these objects in
  // place, so what you hear there is what the table plays.
  const SOUNDS = {
    stack: {
      desc: "item goes on the stack — magical notification",
      layers: [
        { kind: "tone", freq: 880, dur: 0.12, vol: 0.07, t: 0, type: "sine", slide: 0 },
        { kind: "tone", freq: 1320, dur: 0.18, vol: 0.06, t: 0.07, type: "sine", slide: 0 },
        { kind: "tone", freq: 1760, dur: 0.28, vol: 0.045, t: 0.13, type: "sine", slide: 0 },
      ],
    },
    thump: {
      desc: "card resolves onto the field — a clean reverberant THUD",
      layers: [{ kind: "tone", freq: 95, dur: 0.22, vol: 0.32, t: 0, type: "sine", slide: 48, verb: 0.24 }],
    },
    glimmer: {
      desc: "turn is over — magical glimmer",
      layers: [660, 880, 1174, 1568, 2093].map((f, i) => ({
        kind: "tone", freq: f, dur: 0.5, vol: 0.045, t: +(i * 0.09).toFixed(2), type: "sine", slide: 0,
      })),
    },
    hit: {
      desc: "creature dies",
      layers: [
        { kind: "noise", freq: 430, dur: 0.84, vol: 0.06, t: 0, q: 2.5, slide: 1400, verb: 0.13 },
        { kind: "tone", freq: 262, dur: 0.1, vol: 0.13, t: 0, type: "sine", slide: 926, verb: 0.32 },
      ],
    },
    tap: {
      desc: "card taps",
      layers: [
        { kind: "noise", freq: 130, dur: 0.15, vol: 0.095, t: 0, q: 1.5, slide: 1170, verb: 0.23 },
        { kind: "tone", freq: 84, dur: 0.15, vol: 0.1, t: 0, type: "sine", slide: 0 },
      ],
    },
  };

  function play(name) {
    for (const l of SOUNDS[name].layers) {
      // slide 0 means "no slide" — the lab's sliders bottom out there
      const opts = { ...l, slide: l.slide > 0 ? l.slide : null };
      if (l.kind === "tone") sfxTone(l.freq, opts);
      else sfxNoise(opts);
    }
  }

  global.SFX = { SOUNDS, play, tone: sfxTone, noise: sfxNoise };
})(window);
