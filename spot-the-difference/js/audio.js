// 효과음: 음원 파일 없이 브라우저에서 바로 소리를 만든다
(function () {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('std-muted') === '1'; } catch (e) { /* 저장소 없음 */ }

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type = 'sine', vol = 0.18, slide) {
    const a = ac();
    if (!a || muted) return;
    const t = a.currentTime + start;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const Sound = {
    unlock: ac,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('std-muted', muted ? '1' : '0'); } catch (e) { /* 무시 */ }
      return muted;
    },
    found() { tone(660, 0, 0.12, 'triangle'); tone(880, 0.09, 0.14, 'triangle'); tone(1320, 0.18, 0.22, 'triangle', 0.14); },
    miss() { tone(220, 0, 0.22, 'square', 0.07, 140); },
    turn() { tone(523, 0, 0.1, 'sine', 0.12); tone(784, 0.1, 0.16, 'sine', 0.12); },
    tick() { tone(1000, 0, 0.05, 'sine', 0.06); },
    timeout() { tone(392, 0, 0.18, 'sawtooth', 0.07, 300); tone(300, 0.18, 0.3, 'sawtooth', 0.07, 200); },
    hint() { tone(988, 0, 0.1, 'sine', 0.1); tone(1319, 0.08, 0.18, 'sine', 0.1); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.15)); tone(1568, 0.5, 0.6, 'triangle', 0.12); },
    lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, 'triangle', 0.12)); },
  };

  window.Sound = Sound;
})();
