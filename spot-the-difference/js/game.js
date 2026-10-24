// 게임 진행: 화면 전환, 차례·협동 모드, 점수, 타이머, 정답 판정
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)'];
  const HEX = ['#ff5d5d', '#2f80ff', '#16b364'];
  const TEAM = '#a855f7';
  const COUNT = { easy: 5, normal: 7, hard: 9 };
  const TURN_SEC = { easy: 30, normal: 35, hard: 45 };
  const COOP_SEC_PER = { easy: 25, normal: 30, hard: 35 };
  const HELP_SEC = 15;
  const MAX_MISSES_PER_TURN = 3;
  const COOP_MISS_PENALTY = 5;
  const LOCK_MS = 1300;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('std-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('std-' + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 게임은 된다 */ } },
  };

  const S = {
    mode: store.get('mode', 'turn'),
    count: store.get('count', 2),
    level: store.get('level', 'normal'),
    players: store.get('players', [
      { name: '엄마', help: false },
      { name: '우리 아이', help: true },
      { name: '아빠', help: false },
    ]),
    totals: [0, 0, 0],
    played: new Set(store.get('played', [])),
    lastSource: null,
    round: null,
  };

  // ---------------------------------------------------------------- 화면
  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'game') requestAnimationFrame(layout);
  }

  function segInit(id, key, onChange) {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', String(S[key]) === b.dataset.v);
      b.onclick = () => {
        Sound.unlock();
        S[key] = key === 'count' ? Number(b.dataset.v) : b.dataset.v;
        store.set(key, S[key]);
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        if (onChange) onChange();
      };
    });
  }

  function renderPlayers() {
    const box = $('#players');
    box.innerHTML = '';
    for (let i = 0; i < S.count; i++) {
      const p = S.players[i];
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span>
        <input maxlength="8" value="${p.name.replace(/"/g, '&quot;')}" aria-label="${i + 1}번 이름">
        <button class="help-tog ${p.help ? 'on' : ''}">⭐ 도움 ${p.help ? '켜짐' : '꺼짐'}</button>`;
      row.querySelector('input').oninput = (e) => {
        p.name = e.target.value.trim() || `${i + 1}번`;
        store.set('players', S.players);
      };
      const tog = row.querySelector('.help-tog');
      tog.onclick = () => {
        p.help = !p.help;
        tog.classList.toggle('on', p.help);
        tog.textContent = `⭐ 도움 ${p.help ? '켜짐' : '꺼짐'}`;
        store.set('players', S.players);
      };
      box.appendChild(row);
    }
  }

  function renderPhotoGrid() {
    const grid = $('#photoGrid');
    grid.innerHTML = '';
    const rnd = document.createElement('button');
    rnd.className = 'photo-card random';
    rnd.innerHTML = '🎲<b>아무거나</b>';
    rnd.onclick = () => startCurated(pickNextPuzzle());
    grid.appendChild(rnd);
    (window.PUZZLES || []).forEach((pz) => {
      const b = document.createElement('button');
      b.className = 'photo-card';
      b.innerHTML = `<img loading="lazy" src="photos/${pz.id}/base.jpg" alt=""><span class="cap">${pz.title}</span>${S.played.has(pz.id) ? '<span class="done">✓ 해봤어요</span>' : ''}`;
      b.onclick = () => startCurated(pz);
      grid.appendChild(b);
    });
  }

  function pickNextPuzzle(exceptId) {
    const all = window.PUZZLES || [];
    let pool = all.filter((p) => !S.played.has(p.id) && p.id !== exceptId);
    if (!pool.length) pool = all.filter((p) => p.id !== exceptId);
    if (!pool.length) pool = all;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------------------------------------------------------------- 사진 불러오기
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('사진을 불러오지 못했어요: ' + src));
      im.src = src;
    });
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 난이도에 맞게 틀린 곳을 고른다 (쉬움은 잘 보이는 것부터, 어려움은 작은 것부터)
  function chooseDiffs(list, level) {
    const pref = { easy: { 1: 0, 2: 1, 3: 3 }, normal: { 1: 0.4, 2: 0, 3: 0.8 }, hard: { 1: 1.2, 2: 0.3, 3: 0 } }[level];
    return list
      .map((d) => ({ d, k: pref[d.level] + Math.random() * 0.9 }))
      .sort((a, b) => a.k - b.k)
      .slice(0, COUNT[level])
      .map((x) => x.d);
  }

  // 손으로 만든 퍼즐: 원본 위에 틀린 곳 조각을 왼쪽/오른쪽 중 한쪽에만 덧그린다
  async function buildCurated(pz) {
    const chosen = chooseDiffs(pz.diffs, S.level);
    const [base, ...patches] = await Promise.all([
      loadImage(`photos/${pz.id}/base.jpg`),
      ...chosen.map((d) => loadImage(`photos/${pz.id}/${d.file}`)),
    ]);
    const sides = chosen.map(() => (Math.random() < 0.5 ? 'L' : 'R'));
    const draw = (side) => (g) => {
      g.drawImage(base, 0, 0, pz.w, pz.h);
      chosen.forEach((d, i) => { if (sides[i] === side) g.drawImage(patches[i], d.x, d.y); });
    };
    const diffs = chosen.map((d) => {
      const rows = d.rows;
      const cell = pz.cell;
      return {
        box: d.box,
        desc: d.desc,
        found: false,
        hit(x, y, tol) {
          for (let gy = Math.floor((y - tol) / cell); gy <= Math.floor((y + tol) / cell); gy++) {
            const runs = rows[gy];
            if (!runs) continue;
            const dy = Math.max(gy * cell - y, 0, y - (gy + 1) * cell);
            for (const [a, b] of runs) {
              const dx = Math.max(a * cell - x, 0, x - (b + 1) * cell);
              if (dx * dx + dy * dy <= tol * tol) return true;
            }
          }
          return false;
        },
      };
    });
    return { id: pz.id, title: pz.title, w: pz.w, h: pz.h, drawL: draw('L'), drawR: draw('R'), diffs };
  }

  // 내 사진: 자동으로 틀린 곳을 만든다
  async function buildAuto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const original = PhotoDiff.prepare(img);
      await new Promise((r) => setTimeout(r, 30));
      const g = PhotoDiff.generate(original, S.level);
      const put = (data) => (ctx) => ctx.putImageData(data, 0, 0);
      return {
        id: null,
        title: '내 사진',
        w: g.width,
        h: g.height,
        drawL: put(g.left),
        drawR: put(g.right),
        diffs: g.diffs.map((d) => ({
          box: [d.x - d.r, d.y - d.r, d.r * 2, d.r * 2],
          desc: '',
          found: false,
          hit: (x, y, tol) => Math.hypot(x - d.x, y - d.y) <= d.r + tol,
        })),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------------------------------------------------------------- 라운드
  const boards = () => [$('#boardL'), $('#boardR')];

  async function startCurated(pz) {
    if (!pz) return;
    S.lastSource = { kind: 'curated', pz };
    await startRound(() => buildCurated(pz));
  }

  async function startAuto(file) {
    S.lastSource = { kind: 'auto', file };
    await startRound(() => buildAuto(file));
  }

  async function startRound(builder) {
    Sound.unlock();
    stopTimer();
    show('game');
    $('#loading').classList.add('show');
    clearMarks();
    let puzzle;
    try {
      puzzle = await builder();
    } catch (e) {
      $('#loading').classList.remove('show');
      alert(e.message);
      show('photos');
      return;
    }
    $('#loading').classList.remove('show');
    if (puzzle.diffs.length < 3) {
      alert('이 사진으로는 틀린 곳을 충분히 만들지 못했어요. 물건이 더 많은 사진으로 해 볼까요?');
      show('photos');
      return;
    }

    boards().forEach((b, i) => {
      const cv = b.querySelector('canvas');
      cv.width = puzzle.w;
      cv.height = puzzle.h;
      (i === 0 ? puzzle.drawL : puzzle.drawR)(cv.getContext('2d'));
      b.querySelector('svg').setAttribute('viewBox', `0 0 ${puzzle.w} ${puzzle.h}`);
    });

    const players = S.players.slice(0, S.count).map((p, i) => ({
      name: p.name, help: p.help, color: HEX[i], css: COLORS[i], score: 0,
      hints: S.mode === 'turn' ? 1 + (p.help ? 2 : 0) : 0,
    }));
    const anyHelp = players.some((p) => p.help);
    const n = puzzle.diffs.length;
    S.round = {
      puzzle, players,
      cur: 0,
      locked: true,
      misses: 0,
      teamHints: 3 + players.filter((p) => p.help).length,
      timeTotal: S.mode === 'coop' ? Math.round(n * COOP_SEC_PER[S.level] * (anyHelp ? 1.2 : 1)) : 0,
      timeLeft: 0,
      over: false,
    };
    layout();
    renderHud();

    if (S.mode === 'turn') {
      S.round.cur = Math.floor(Math.random() * players.length);
      beginTurn();
    } else {
      S.round.timeLeft = S.round.timeTotal;
      await banner('다 같이 찾아요!', `${n}개를 ${fmtTime(S.round.timeTotal)} 안에`);
      S.round.locked = false;
      startTimer();
    }
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m}분${s ? ' ' + s + '초' : ''}` : `${s}초`;
  }

  async function beginTurn() {
    const R = S.round;
    const p = R.players[R.cur];
    R.locked = true;
    R.misses = 0;
    R.timeTotal = TURN_SEC[S.level] + (p.help ? HELP_SEC : 0);
    R.timeLeft = R.timeTotal;
    renderHud();
    Sound.turn();
    await banner(`${p.name} 차례!`, `${R.timeTotal}초 안에 하나를 찾아요`);
    if (R.over) return;
    R.locked = false;
    startTimer();
  }

  function nextTurn() {
    const R = S.round;
    R.cur = (R.cur + 1) % R.players.length;
    beginTurn();
  }

  // ---------------------------------------------------------------- 타이머
  let timerId = null;
  let lastTick = 0;
  function startTimer() {
    stopTimer();
    lastTick = performance.now();
    timerId = setInterval(() => {
      const R = S.round;
      if (!R || R.over) return stopTimer();
      const now = performance.now();
      R.timeLeft -= (now - lastTick) / 1000;
      lastTick = now;
      const sec = Math.ceil(R.timeLeft);
      if (sec <= 5 && sec > 0 && sec !== R.lastSec) {
        R.lastSec = sec;
        Sound.tick();
      }
      if (R.timeLeft <= 0) {
        R.timeLeft = 0;
        stopTimer();
        onTimeout();
      }
      renderTimer();
    }, 100);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  async function onTimeout() {
    const R = S.round;
    R.locked = true;
    Sound.timeout();
    if (S.mode === 'turn') {
      await banner('시간 끝!', `${R.players[R.cur].name} 차례가 끝났어요`);
      if (!R.over) nextTurn();
    } else {
      endRound(false);
    }
  }

  // ---------------------------------------------------------------- 터치 판정
  function toImage(board, e) {
    const rect = board.getBoundingClientRect();
    const R = S.round;
    const k = R.puzzle.w / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, k };
  }

  function onTap(e) {
    const R = S.round;
    if (!R || R.locked || R.over) return;
    e.preventDefault();
    const { x, y, k } = toImage(e.currentTarget, e);
    const tol = 16 * k; // 손가락 굵기만큼 여유
    const d = R.puzzle.diffs.find((o) => !o.found && o.hit(x, y, tol));
    if (d) onFound(d);
    else onMiss(x, y, k);
  }

  async function onFound(d) {
    const R = S.round;
    d.found = true;
    const p = S.mode === 'turn' ? R.players[R.cur] : null;
    d.by = p ? R.cur : -1;
    if (p) p.score += 1;
    drawMark(d, p ? p.color : TEAM);
    Sound.found();
    renderHud();
    const left = R.puzzle.diffs.filter((o) => !o.found).length;
    if (!left) return endRound(true);
    if (S.mode === 'turn') {
      R.locked = true;
      stopTimer();
      await banner(`${p.name} 찾았다! +1`, `남은 틀린 곳 ${left}개`);
      if (!R.over) nextTurn();
    }
  }

  function onMiss(x, y, k) {
    const R = S.round;
    Sound.miss();
    const s = 18 * k;
    boards().forEach((b) => {
      const svg = b.querySelector('svg');
      const g = el('path', { class: 'miss', d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}` });
      svg.appendChild(g);
      setTimeout(() => g.remove(), 1000);
    });
    R.locked = true;
    $('#boards').classList.add('locked');
    if (S.mode === 'coop') R.timeLeft = Math.max(0.1, R.timeLeft - COOP_MISS_PENALTY);
    else R.misses += 1;
    renderHud();
    setTimeout(async () => {
      $('#boards').classList.remove('locked');
      if (R.over) return;
      if (S.mode === 'turn' && R.misses >= MAX_MISSES_PER_TURN) {
        stopTimer();
        await banner('세 번 틀렸어요!', '다음 사람 차례예요');
        if (!R.over) nextTurn();
        return;
      }
      R.locked = false;
    }, LOCK_MS);
  }

  // ---------------------------------------------------------------- 힌트
  function useHint() {
    const R = S.round;
    if (!R || R.locked || R.over) return;
    const owner = S.mode === 'turn' ? R.players[R.cur] : null;
    const left = owner ? owner.hints : R.teamHints;
    if (left <= 0) return;
    const pool = R.puzzle.diffs.filter((d) => !d.found);
    if (!pool.length) return;
    if (owner) owner.hints -= 1;
    else R.teamHints -= 1;
    Sound.hint();
    const d = pool[Math.floor(Math.random() * pool.length)];
    const [bx, by, bw, bh] = d.box;
    const size = Math.max(bw, bh);
    const r = Math.max(110, size * 1.1);
    // 정답 위치를 그대로 알려주지 않도록 원의 가운데를 살짝 비튼다
    const j = r * 0.45;
    const cx = bx + bw / 2 + (Math.random() - 0.5) * j;
    const cy = by + bh / 2 + (Math.random() - 0.5) * j;
    boards().forEach((b) => {
      const c = el('circle', { class: 'hint', cx, cy, r });
      b.querySelector('svg').appendChild(c);
      setTimeout(() => c.remove(), 2600);
    });
    renderHud();
  }

  // ---------------------------------------------------------------- 그리기
  function el(tag, attrs) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  }

  function ellipseOf(d, pad) {
    const [x, y, w, h] = d.box;
    return { cx: x + w / 2, cy: y + h / 2, rx: Math.max(30, w / 2 + pad), ry: Math.max(30, h / 2 + pad) };
  }

  function drawMark(d, color) {
    const e = ellipseOf(d, 14);
    boards().forEach((b) => {
      const svg = b.querySelector('svg');
      svg.appendChild(el('ellipse', { class: 'mark-ring', ...e }));
      svg.appendChild(el('ellipse', { class: 'mark', stroke: color, ...e }));
    });
  }

  function clearMarks() {
    boards().forEach((b) => (b.querySelector('svg').innerHTML = ''));
  }

  function revealRest() {
    S.round.puzzle.diffs.filter((d) => !d.found).forEach((d) => {
      const e = ellipseOf(d, 14);
      boards().forEach((b) => b.querySelector('svg').appendChild(el('ellipse', { class: 'reveal', ...e })));
    });
  }

  function renderTimer() {
    const R = S.round;
    const f = $('#timerFill');
    const ratio = R.timeTotal ? R.timeLeft / R.timeTotal : 1;
    f.style.width = `${Math.max(0, ratio * 100)}%`;
    f.classList.toggle('warn', ratio < 0.5 && ratio >= 0.2);
    f.classList.toggle('danger', ratio < 0.2);
  }

  function renderHud() {
    const R = S.round;
    if (!R) return;
    const found = R.puzzle.diffs.filter((d) => d.found).length;
    $('#progress').textContent = `${found} / ${R.puzzle.diffs.length}`;
    if (S.mode === 'turn') {
      const p = R.players[R.cur];
      const miss = R.misses ? ` <small style="opacity:.7">✕${R.misses}</small>` : '';
      $('#turnChip').innerHTML = `<span class="dot" style="background:${p.css}"></span>${escapeHtml(p.name)} 차례${miss}`;
      $('#hintCount').textContent = p.hints;
      $('#hintBtn').disabled = p.hints <= 0;
      $('#scores').innerHTML = R.players.map((q, i) => `<div class="score-chip ${i === R.cur ? 'now' : ''}" style="color:${q.css}"><span class="dot" style="background:${q.css}"></span><span style="color:#fff">${escapeHtml(q.name)}</span> <b style="color:#fff">${q.score}</b></div>`).join('');
    } else {
      $('#turnChip').innerHTML = `<span class="dot" style="background:${TEAM}"></span>다 같이 찾기`;
      $('#hintCount').textContent = R.teamHints;
      $('#hintBtn').disabled = R.teamHints <= 0;
      $('#scores').innerHTML = R.players.map((q) => `<div class="score-chip"><span class="dot" style="background:${q.css}"></span>${escapeHtml(q.name)}</div>`).join('');
    }
    renderTimer();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let bannerTimer = null;
  function banner(title, sub, ms = 1500) {
    const b = $('#banner');
    b.innerHTML = `${escapeHtml(title)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    return new Promise((res) => {
      bannerTimer = setTimeout(() => {
        b.classList.remove('show');
        res();
      }, ms);
    });
  }

  // 두 사진을 화면에 가장 크게 놓는 배치 (가로로 나란히 / 위아래)
  function layout() {
    const R = S.round;
    if (!R) return;
    const wrap = $('#boards');
    const W = wrap.clientWidth - 20;
    const H = wrap.clientHeight - 14;
    const gap = 10;
    const ar = R.puzzle.w / R.puzzle.h;
    const rowW = Math.min((W - gap) / 2, H * ar);
    const colW = Math.min(W, ((H - gap) / 2) * ar);
    const stack = colW > rowW;
    const w = Math.floor(stack ? colW : rowW);
    wrap.classList.toggle('stack', stack);
    boards().forEach((b) => {
      b.style.width = `${w}px`;
      b.style.height = `${Math.floor(w / ar)}px`;
    });
  }

  // ---------------------------------------------------------------- 결과
  async function endRound(allFound) {
    const R = S.round;
    if (R.over) return;
    R.over = true;
    R.locked = true;
    stopTimer();
    if (!allFound) {
      revealRest();
      await banner('시간 끝!', '못 찾은 곳을 보여 줄게요', 2600);
    } else {
      Sound.win();
      confetti();
      await banner('모두 찾았어요! 🎉', '', 1600);
    }
    if (R.puzzle.id) {
      S.played.add(R.puzzle.id);
      store.set('played', [...S.played]);
    }
    showResult(allFound);
  }

  function showResult(allFound) {
    const R = S.round;
    const table = $('#resTable');
    if (S.mode === 'turn') {
      R.players.forEach((p, i) => (S.totals[i] += p.score));
      const ranked = R.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
      const top = ranked[0].score;
      const winners = ranked.filter((p) => p.score === top);
      $('#resTrophy').textContent = winners.length > 1 ? '🤝' : '🏆';
      $('#resTitle').textContent = winners.length > 1 ? '무승부!' : `${ranked[0].name} 승리!`;
      $('#resSub').textContent = R.puzzle.title;
      table.innerHTML = ranked.map((p, k) => `<div class="res-row"><span class="rank">${p.score === top ? '👑' : k + 1}</span><span class="dot" style="background:${p.css}"></span><span class="name">${escapeHtml(p.name)}</span><span class="pts">${p.score}개</span><span class="tot">누적 ${S.totals[p.i]}</span></div>`).join('');
    } else {
      const ratio = R.timeLeft / R.timeTotal;
      const stars = !allFound ? 0 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
      if (!allFound) Sound.lose();
      $('#resTrophy').textContent = allFound ? '🎉' : '⏰';
      $('#resTitle').textContent = allFound ? '우리 팀 성공!' : '아쉬워요!';
      const found = R.puzzle.diffs.filter((d) => d.found).length;
      $('#resSub').textContent = allFound ? `${Math.round(R.timeLeft)}초 남기고 모두 찾았어요` : `${R.puzzle.diffs.length}개 중 ${found}개를 찾았어요`;
      table.innerHTML = `<div class="stars">${'★'.repeat(stars)}<span style="opacity:.25">${'★'.repeat(3 - stars)}</span></div>`;
    }
    const descs = R.puzzle.diffs.filter((d) => d.desc);
    $('#resAnswers').innerHTML = descs.length ? `<b>정답 모음</b><ul>${descs.map((d) => `<li>${d.found ? '✅' : '❌'} ${escapeHtml(d.desc)}</li>`).join('')}</ul>` : '';
    $('#nextBtn').style.display = S.lastSource && S.lastSource.kind === 'curated' && (window.PUZZLES || []).length > 1 ? '' : 'none';
    show('result');
  }

  // ---------------------------------------------------------------- 축하 꽃가루
  function confetti() {
    const cv = $('#confetti');
    const g = cv.getContext('2d');
    cv.width = innerWidth;
    cv.height = innerHeight;
    const cols = ['#ff5d5d', '#2f80ff', '#16b364', '#f5b800', '#a855f7', '#ff8fc0'];
    const ps = Array.from({ length: 160 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
      vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6,
      a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: cols[Math.floor(Math.random() * cols.length)],
    }));
    const t0 = performance.now();
    (function frame(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      ps.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore();
      });
      if (t - t0 < 3200) requestAnimationFrame(frame);
      else g.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }

  // ---------------------------------------------------------------- 연결
  function init() {
    segInit('#modeSeg', 'mode', () => ($('#helpNote').textContent = S.mode === 'turn'
      ? '⭐ 도움을 켜면 시간이 15초 더 길고 힌트를 2번 더 쓸 수 있어요.'
      : '⭐ 도움을 켠 사람이 있으면 제한 시간이 20% 늘고 힌트가 늘어나요.'));
    segInit('#countSeg', 'count', renderPlayers);
    segInit('#levelSeg', 'level');
    renderPlayers();

    const mute = $('#muteBtn');
    mute.textContent = Sound.muted ? '🔇' : '🔊';
    mute.onclick = () => (mute.textContent = Sound.toggle() ? '🔇' : '🔊');

    $('#toPhotos').onclick = () => {
      Sound.unlock();
      S.totals = [0, 0, 0];
      renderPhotoGrid();
      show('photos');
    };
    $$('[data-go]').forEach((b) => (b.onclick = () => show(b.dataset.go)));
    ['#camInput', '#fileInput'].forEach((id) => {
      $(id).onchange = (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) startAuto(f);
      };
    });

    boards().forEach((b) => b.addEventListener('pointerdown', onTap));
    $('#hintBtn').onclick = useHint;
    $('#quitBtn').onclick = () => $('#confirm').classList.add('show');
    $('#confirmNo').onclick = () => $('#confirm').classList.remove('show');
    $('#confirmYes').onclick = () => {
      $('#confirm').classList.remove('show');
      if (S.round) S.round.over = true;
      stopTimer();
      show('home');
    };
    $('#nextBtn').onclick = () => {
      const cur = S.lastSource && S.lastSource.pz;
      startCurated(pickNextPuzzle(cur && cur.id));
    };
    $('#homeBtn').onclick = () => show('home');
    addEventListener('resize', layout);

    // 테스트용 연결고리
    window.__std = { S, startCurated, startAuto };
  }

  init();
})();
