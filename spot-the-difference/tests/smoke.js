// 브라우저로 게임을 실제로 열어 한 판을 끝까지 해 보는 검사
// 실행: node tests/smoke.js [스크린샷 폴더]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error('실패: ' + msg);
  console.log('  ✓ ' + msg);
}

async function tapDiff(page, side, idx, offset = 0) {
  const pt = await page.evaluate(([side, idx, offset]) => {
    const R = window.__std.S.round;
    const d = R.puzzle.diffs[idx];
    const b = document.querySelector(side === 'L' ? '#boardL' : '#boardR').getBoundingClientRect();
    const k = b.width / R.puzzle.w;
    // 정답 영역 안의 한 점: 상자 가운데에서 가장 가까운 칸을 고른다
    const [x, y, w, h] = d.box;
    let px = x + w / 2, py = y + h / 2;
    if (!d.hit(px, py, 0)) {
      outer: for (let r = 0; r < Math.max(w, h); r += 6) for (let a = 0; a < 6.28; a += 0.3) {
        const qx = x + w / 2 + Math.cos(a) * r, qy = y + h / 2 + Math.sin(a) * r;
        if (d.hit(qx, qy, 0)) { px = qx; py = qy; break outer; }
      }
    }
    return { x: b.left + (px + offset) * k, y: b.top + py * k };
  }, [side, idx, offset]);
  await page.mouse.click(pt.x, pt.y);
}

async function waitUnlocked(page) {
  await page.waitForFunction(() => { const R = window.__std.S.round; return R && (!R.locked || R.over); }, null, { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '1-home.png') });

  console.log('차례 모드 (2명, 보통)');
  await page.click('#toPhotos');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '2-photos.png') });
  await page.click('.photo-card:not(.random)');
  await waitUnlocked(page);
  await page.screenshot({ path: path.join(OUT, '3-game.png') });

  const n = await page.evaluate(() => window.__std.S.round.puzzle.diffs.length);
  assert(n >= 3, `틀린 곳 ${n}개가 준비됨`);
  const first = await page.evaluate(() => window.__std.S.round.cur);

  // 빈 곳을 누르면 틀림 처리
  await page.evaluate(() => {
    const R = window.__std.S.round;
    R.puzzle.diffs.forEach((d) => (d._t = d.hit));
  });
  const missPt = await page.evaluate(() => {
    const R = window.__std.S.round;
    for (let y = 30; y < R.puzzle.h; y += 40) for (let x = 30; x < R.puzzle.w; x += 40) {
      if (!R.puzzle.diffs.some((d) => d.hit(x, y, 60))) {
        const b = document.querySelector('#boardL').getBoundingClientRect();
        const k = b.width / R.puzzle.w;
        return { x: b.left + x * k, y: b.top + y * k };
      }
    }
  });
  await page.mouse.click(missPt.x, missPt.y);
  const misses = await page.evaluate(() => window.__std.S.round.misses);
  assert(misses === 1, '빈 곳을 누르면 틀린 횟수가 1 늘어남');
  await waitUnlocked(page);

  // 정답을 누르면 점수 +1, 차례가 넘어감
  await tapDiff(page, 'R', 0);
  const after = await page.evaluate(() => ({ s: window.__std.S.round.players.map((p) => p.score), f: window.__std.S.round.puzzle.diffs[0].found }));
  assert(after.f && after.s[first] === 1, '정답을 누르면 지금 차례인 사람이 1점');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '4-found.png') });
  await waitUnlocked(page);
  const second = await page.evaluate(() => window.__std.S.round.cur);
  assert(second !== first, '찾은 뒤 다음 사람 차례로 넘어감');

  // 힌트
  await page.click('#hintBtn');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.querySelectorAll('#boardL .hint').length === 1), '힌트를 누르면 표시가 나타남');
  await page.screenshot({ path: path.join(OUT, '5-hint.png') });

  // 나머지 전부 찾기
  for (let i = 1; i < n; i++) {
    await waitUnlocked(page);
    await tapDiff(page, i % 2 ? 'L' : 'R', i);
  }
  await page.waitForSelector('#result.active', { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '6-result.png') });
  const total = await page.evaluate(() => window.__std.S.round.players.reduce((s, p) => s + p.score, 0));
  assert(total === n, `모두 찾으면 점수 합이 ${n}`);

  console.log('협동 모드 (3명, 어려움)');
  await page.click('#homeBtn');
  await page.click('#modeSeg [data-v="coop"]');
  await page.click('#countSeg [data-v="3"]');
  await page.click('#levelSeg [data-v="hard"]');
  await page.click('#toPhotos');
  await page.click('.photo-card.random');
  await waitUnlocked(page);
  const before = await page.evaluate(() => window.__std.S.round.timeLeft);
  await page.mouse.click(missPt.x, missPt.y);
  const t2 = await page.evaluate(() => window.__std.S.round.timeLeft);
  assert(before - t2 >= 4.5, '협동 모드에서 틀리면 5초 줄어듦');
  await page.evaluate(() => (window.__std.S.round.timeLeft = 0.3));
  await page.waitForSelector('#result.active', { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '7-coop-fail.png') });
  assert(await page.evaluate(() => document.querySelector('#resTitle').textContent === '아쉬워요!'), '시간이 끝나면 실패 화면');

  console.log('세로 화면 배치');
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.click('#homeBtn');
  await page.click('#toPhotos');
  await page.click('.photo-card:not(.random)');
  await waitUnlocked(page);
  assert(await page.evaluate(() => document.querySelector('#boards').classList.contains('stack')), '세로 화면에서는 위아래로 놓임');
  await page.screenshot({ path: path.join(OUT, '8-portrait.png') });

  assert(errors.length === 0, '스크립트 오류 없음' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
  console.log('모든 검사 통과');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
