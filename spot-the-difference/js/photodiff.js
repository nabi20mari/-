// 사진 한 장을 받아 "틀린 곳"이 있는 두 장의 사진을 자동으로 만든다.
// 모든 처리는 ImageData(픽셀 배열) 위에서 이루어진다.
(function () {
  // 난이도별 설정 (작업 해상도 긴 변 1200px 기준)
  const LEVELS = {
    easy: { label: '쉬움', count: 5, rMin: 68, rMax: 92, vis: 34, hue: [120, 180], scale: 1.45, eMin: 14 },
    normal: { label: '보통', count: 7, rMin: 50, rMax: 72, vis: 24, hue: [80, 150], scale: 1.32, eMin: 12 },
    hard: { label: '어려움', count: 9, rMin: 36, rMax: 56, vis: 16, hue: [50, 110], scale: 1.24, eMin: 10 },
  };

  const LONG_SIDE = 1200;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 사진을 가로 4:3 또는 세로 3:4 로 가운데를 잘라 작업 크기로 맞춘다
  function prepare(img) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const portrait = ih > iw;
    const W = portrait ? (LONG_SIDE * 3) / 4 : LONG_SIDE;
    const H = portrait ? LONG_SIDE : (LONG_SIDE * 3) / 4;
    const scale = Math.max(W / iw, H / ih);
    const sw = W / scale;
    const sh = H / scale;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
    return g.getImageData(0, 0, W, H);
  }

  // 밝기, 윤곽선 세기, 채도를 계산하고 영역 합을 빨리 구할 수 있게 누적표를 만든다
  function analyze(img) {
    const { width: W, height: H, data } = img;
    const L = new Float32Array(W * H);
    const Sat = new Float32Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      Sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
    }
    const E = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = L[i - W + 1] + 2 * L[i + 1] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - 1] - L[i + W - 1];
        const gy = L[i + W - 1] + 2 * L[i + W] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - W] - L[i - W + 1];
        E[i] = Math.min(255, Math.sqrt(gx * gx + gy * gy) / 4);
      }
    }
    const integ = (A) => {
      const I = new Float64Array((W + 1) * (H + 1));
      for (let y = 1; y <= H; y++) {
        let row = 0;
        for (let x = 1; x <= W; x++) {
          row += A[(y - 1) * W + (x - 1)];
          I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + row;
        }
      }
      return I;
    };
    const ch = (k) => {
      const A = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) A[i] = data[i * 4 + k];
      return integ(A);
    };
    const IE = integ(E), IS = integ(Sat), IL = integ(L), IR = ch(0), IG = ch(1), IB = ch(2);
    // 사각형 영역의 [합, 넓이]
    const sum = (I, cx, cy, r) => {
      const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
      const x1 = Math.min(W, Math.floor(cx + r)), y1 = Math.min(H, Math.floor(cy + r));
      const a = Math.max(0, (x1 - x0) * (y1 - y0));
      if (!a) return [0, 0];
      return [I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0], a];
    };
    const mean = (I, cx, cy, r) => {
      const [t, a] = sum(I, cx, cy, r);
      return a ? t / a : 0;
    };
    // 원 바깥 테두리(r ~ 1.25r) 의 평균
    const ring = (I, cx, cy, r) => {
      const [to, ao] = sum(I, cx, cy, r * 1.25);
      const [ti, ai] = sum(I, cx, cy, r * 0.9);
      return ao - ai > 0 ? (to - ti) / (ao - ai) : 0;
    };
    return {
      W, H, L, E,
      energy: (cx, cy, r) => mean(IE, cx, cy, r),
      ringEnergy: (cx, cy, r) => ring(IE, cx, cy, r),
      sat: (cx, cy, r) => mean(IS, cx, cy, r),
      lum: (cx, cy, r) => mean(IL, cx, cy, r),
      color: (cx, cy, r) => [mean(IR, cx, cy, r), mean(IG, cx, cy, r), mean(IB, cx, cy, r)],
      ringColor: (cx, cy, r) => [ring(IR, cx, cy, r), ring(IG, cx, cy, r), ring(IB, cx, cy, r)],
    };
  }

  // 가장자리가 부드럽게 섞이도록 하는 가중치 (가운데 1 → 바깥 0)
  function feather(d, r) {
    const inner = r * 0.62;
    if (d <= inner) return 1;
    if (d >= r) return 0;
    const t = (r - d) / (r - inner);
    return t * t * (3 - 2 * t);
  }

  function sample(data, W, H, x, y, out) {
    x = Math.max(0, Math.min(W - 1.001, x));
    y = Math.max(0, Math.min(H - 1.001, y));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const p00 = (y0 * W + x0) * 4, p10 = p00 + 4, p01 = p00 + W * 4, p11 = p01 + 4;
    for (let k = 0; k < 3; k++) {
      out[k] = (data[p00 + k] * (1 - fx) + data[p10 + k] * fx) * (1 - fy) + (data[p01 + k] * (1 - fx) + data[p11 + k] * fx) * fy;
    }
    return out;
  }

  // 원 안의 각 픽셀을 fn(x, y, out) 으로 바꾸고 가장자리를 섞는다
  function paint(src, dst, cx, cy, r, fn) {
    const { width: W, height: H } = src;
    const s = src.data, d = dst.data;
    const px = [0, 0, 0];
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, Math.ceil(cx + r)); x++) {
        const a = feather(Math.hypot(x - cx, y - cy), r);
        if (a <= 0) continue;
        fn(x, y, px);
        const p = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) d[p + k] = s[p + k] * (1 - a) + px[k] * a;
      }
    }
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const dd = mx - mn;
    const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    let h;
    if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / dd + 2;
    else h = (r - g) / dd + 4;
    return [h * 60, s, l];
  }

  function hslToRgb(h, s, l, out) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { out[0] = out[1] = out[2] = l * 255; return; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    out[0] = f(h + 1 / 3) * 255; out[1] = f(h) * 255; out[2] = f(h - 1 / 3) * 255;
  }

  // 씨앗 픽셀과 색이 비슷한 이웃을 넓혀 가며 "한 물건(같은 색 덩어리)"을 찾는다
  function segment(img, A, cx, cy, rMax, tol) {
    const W = img.width, H = img.height, d = img.data;
    const x0 = Math.max(0, Math.floor(cx - rMax)), y0 = Math.max(0, Math.floor(cy - rMax));
    const x1 = Math.min(W, Math.ceil(cx + rMax)), y1 = Math.min(H, Math.ceil(cy + rMax));
    const w = x1 - x0, h = y1 - y0;
    const m = new Uint8Array(w * h);
    const seed = A.color(cx, cy, 3);
    const tol2 = tol * tol;
    const stack = [Math.floor(cy) * W + Math.floor(cx)];
    let area = 0, sx = 0, sy = 0, edge = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const li = (y - y0) * w + (x - x0);
      if (m[li]) continue;
      const p = i * 4;
      const dr = d[p] - seed[0], dg = d[p + 1] - seed[1], db = d[p + 2] - seed[2];
      if (dr * dr + dg * dg + db * db > tol2) continue;
      if (Math.hypot(x - cx, y - cy) > rMax - 2) { edge++; continue; }
      m[li] = 1;
      area++; sx += x; sy += y;
      stack.push(i + 1, i - 1, i + W, i - W);
    }
    // 부드러운 가장자리를 위해 두 번 흐리게
    let f = Float32Array.from(m);
    for (let pass = 0; pass < 2; pass++) {
      const g = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let t = 0, n = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) { t += f[yy * w + xx]; n++; }
        g[y * w + x] = t / n;
      }
      f = g;
    }
    return { mask: f, x0, y0, w, h, area, edge, cx: area ? sx / area : cx, cy: area ? sy / area : cy, seed };
  }

  function colorDist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  // 물건이 단순한 바탕 위에 홀로 놓여 있는가 (가운데는 무늬가 많고 테두리는 단순)
  function isolated(A, x, y, r, cfg) {
    const inner = A.energy(x, y, r * 0.55);
    const ring = A.ringEnergy(x, y, r);
    return inner >= cfg.eMin && ring <= Math.max(7, inner * 0.45);
  }

  function isFlat(A, x, y, r) {
    return A.energy(x, y, r) < 7 && A.ringEnergy(x, y, r) < 8;
  }

  // 각 편집은 성공하면 {x, y, r} (찾아야 할 자리) 를, 실패하면 null 을 돌려준다
  const EDITS = {
    // 물건 하나의 색을 통째로 바꾸기
    recolor(src, dst, A, x, y, r, rand, cfg) {
      if (A.sat(x, y, 4) < 0.42) return null;
      const seg = segment(src, A, x, y, r * 2.2, 34);
      const minA = Math.PI * r * r * 0.3, maxA = Math.PI * r * r * 3.2;
      if (seg.area < minA || seg.area > maxA || seg.edge > 0) return null;
      // 가늘게 퍼진 덩어리(무늬 일부)는 색을 바꾸면 얼룩처럼 보이므로 뭉툭한 덩어리만 쓴다
      let bx0 = seg.w, by0 = seg.h, bx1 = 0, by1 = 0;
      for (let yy = 0; yy < seg.h; yy++) for (let xx = 0; xx < seg.w; xx++) {
        if (seg.mask[yy * seg.w + xx] < 0.5) continue;
        if (xx < bx0) bx0 = xx;
        if (xx > bx1) bx1 = xx;
        if (yy < by0) by0 = yy;
        if (yy > by1) by1 = yy;
      }
      if (seg.area / Math.max(1, (bx1 - bx0 + 1) * (by1 - by0 + 1)) < 0.45) return null;
      const shift = (cfg.hue[0] + rand() * (cfg.hue[1] - cfg.hue[0])) * (rand() < 0.5 ? -1 : 1);
      const W = src.width, s = src.data, o = dst.data, px = [0, 0, 0];
      for (let yy = 0; yy < seg.h; yy++) for (let xx = 0; xx < seg.w; xx++) {
        const a = seg.mask[yy * seg.w + xx];
        if (a <= 0.01) continue;
        const p = ((yy + seg.y0) * W + (xx + seg.x0)) * 4;
        const [hh, sa, l] = rgbToHsl(s[p], s[p + 1], s[p + 2]);
        hslToRgb(hh + shift, sa, l, px);
        for (let k = 0; k < 3; k++) o[p + k] = s[p + k] * (1 - a) + px[k] * a;
      }
      return { x: seg.cx, y: seg.cy, r: Math.max(cfg.rMin * 0.8, Math.sqrt(seg.area / Math.PI) * 1.2) };
    },
    // 홀로 놓인 물건 지우기: 비슷한 색의 빈 바닥을 가져와 덮는다
    remove(src, dst, A, x, y, r, rand, cfg) {
      if (!isolated(A, x, y, r, cfg)) return null;
      const rc = A.ringColor(x, y, r);
      for (let t = 0; t < 80; t++) {
        const sx = r + rand() * (A.W - 2 * r), sy = r + rand() * (A.H - 2 * r);
        if (Math.hypot(sx - x, sy - y) < r * 2.2) continue;
        if (!isFlat(A, sx, sy, r) || colorDist(A.color(sx, sy, r), rc) > 20) continue;
        paint(src, dst, x, y, r, (px, py, out) => sample(src.data, A.W, A.H, px - x + sx, py - y + sy, out));
        return { x, y, r: r * 0.8 };
      }
      return null;
    },
    // 빈 바닥에 다른 곳의 물건을 하나 더 놓기
    add(src, dst, A, x, y, r, rand, cfg) {
      if (!isFlat(A, x, y, r)) return null;
      const rc = A.color(x, y, r);
      for (let t = 0; t < 120; t++) {
        const sx = r + rand() * (A.W - 2 * r), sy = r + rand() * (A.H - 2 * r);
        if (Math.hypot(sx - x, sy - y) < r * 2.2) continue;
        if (!isolated(A, sx, sy, r, cfg) || colorDist(A.ringColor(sx, sy, r), rc) > 20) continue;
        paint(src, dst, x, y, r, (px, py, out) => sample(src.data, A.W, A.H, px - x + sx, py - y + sy, out));
        return { x, y, r: r * 0.8 };
      }
      return null;
    },
    // 홀로 놓인 물건 좌우 뒤집기
    mirror(src, dst, A, x, y, r, rand, cfg) {
      if (!isolated(A, x, y, r, cfg)) return null;
      paint(src, dst, x, y, r, (px, py, out) => sample(src.data, A.W, A.H, 2 * x - px, py, out));
      return { x, y, r: r * 0.8 };
    },
    // 홀로 놓인 물건 크게 만들기
    scale(src, dst, A, x, y, r, rand, cfg) {
      if (!isolated(A, x, y, r * 0.8, cfg)) return null;
      const R = r * 1.25;
      paint(src, dst, x, y, R, (px, py, out) => sample(src.data, A.W, A.H, x + (px - x) / cfg.scale, y + (py - y) / cfg.scale, out));
      return { x, y, r: r * 0.85 };
    },
  };

  // 원본과 바뀐 사진이 원 안에서 평균 얼마나 다른지 (0~255)
  function visibility(a, b, cx, cy, r) {
    const W = a.width, H = a.height;
    let sum = 0, n = 0;
    const ri = r * 0.8;
    for (let y = Math.max(0, Math.floor(cy - ri)); y < Math.min(H, cy + ri); y += 2) {
      for (let x = Math.max(0, Math.floor(cx - ri)); x < Math.min(W, cx + ri); x += 2) {
        if (Math.hypot(x - cx, y - cy) > ri) continue;
        const p = (y * W + x) * 4;
        sum += (Math.abs(a.data[p] - b.data[p]) + Math.abs(a.data[p + 1] - b.data[p + 1]) + Math.abs(a.data[p + 2] - b.data[p + 2])) / 3;
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  function generate(original, level, seed = (Math.random() * 1e9) | 0) {
    const cfg = LEVELS[level];
    const rand = rng(seed);
    const A = analyze(original);
    const left = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
    const right = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
    const diffs = [];
    // 'add' 는 물건 조각이 어설프게 붙는 경우가 많아 자동 모드에서는 쓰지 않는다
    const types = ['recolor', 'remove', 'mirror', 'scale'];

    for (let tries = 0; tries < 1500 && diffs.length < cfg.count; tries++) {
      const r = cfg.rMin + rand() * (cfg.rMax - cfg.rMin);
      const x = r + 8 + rand() * (A.W - 2 * r - 16);
      const y = r + 8 + rand() * (A.H - 2 * r - 16);
      if (diffs.some((o) => Math.hypot(o.x - x, o.y - y) < o.r * 1.3 + r * 2.3)) continue;

      // 아직 덜 쓴 종류부터 시도해서 골고루 섞이게 한다
      const counts = {};
      diffs.forEach((o) => (counts[o.type] = (counts[o.type] || 0) + 1));
      const order = types.slice().sort((a, b) => (counts[a] || 0) - (counts[b] || 0) + (rand() - 0.5) * 0.9);
      for (const type of order) {
        const side = rand() < 0.5 ? right : left;
        const backup = new Uint8ClampedArray(side.data);
        const hit = EDITS[type](original, side, A, x, y, r, rand, cfg);
        if (!hit) continue;
        const v = visibility(original, side, hit.x, hit.y, hit.r);
        const clash = diffs.some((o) => Math.hypot(o.x - hit.x, o.y - hit.y) < o.r + hit.r + 20);
        if (v >= cfg.vis && !clash) {
          diffs.push({ ...hit, type, vis: Math.round(v), found: false });
          break;
        }
        side.data.set(backup);
      }
    }
    return { left, right, diffs, level, seed, width: original.width, height: original.height };
  }

  window.PhotoDiff = { LEVELS, prepare, generate, analyze };
})();
