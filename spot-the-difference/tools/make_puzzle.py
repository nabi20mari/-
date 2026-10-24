#!/usr/bin/env python3
"""사진 + 편집 명세(JSON) 로 틀린그림 퍼즐을 만든다.

사용법:
  python3 tools/make_puzzle.py tools/specs/market.json      # 퍼즐 하나 만들기
  python3 tools/make_puzzle.py --all                         # 모든 명세 다시 만들기 + 목록 갱신
  python3 tools/make_puzzle.py --grid <사진> <출력.png>      # 좌표 고르기용 격자 이미지

결과물 (photos/<id>/):
  base.jpg   : 원본 사진 (1200x900 또는 900x1200)
  d1.png ... : 틀린 곳 하나하나의 조각 그림 (투명 배경). 게임이 원본 위에 덧그린다.
그리고 js/puzzles.js 에 전체 목록을 적는다.

명세의 각 diff 항목:
  op      : recolor | remove | add | move | flip | scale
  poly    : [[x,y], ...] 바꿀 물건의 외곽선 (작업 해상도 좌표)
  ellipse : [cx, cy, rx, ry]  (poly 대신 쓸 수 있음)
  level   : 1(잘 보임) 2(보통) 3(찾기 어려움)  → 난이도에 따라 골라 쓴다
  desc    : 정답 설명 (예: "빨간 사과가 초록색으로")
  recolor : hue(색상 회전, 도) 또는 color("#hex", 그 색으로 물들이기)
            match {hue, range, minSat} 를 주면 그 색에 가까운 픽셀만 바꾼다
  remove  : from [dx,dy] 를 주면 그만큼 떨어진 곳 무늬로 덮고, 없으면 주변으로 메운다(inpaint)
  add/move: to [dx,dy] 만큼 옮긴 자리에 물건을 놓는다 (move 는 원래 자리를 지움)
  scale   : k (배율)
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LONG = 1200


def load_base(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f'사진을 읽을 수 없어요: {path}')
    h, w = img.shape[:2]
    W, H = (LONG * 3 // 4, LONG) if h > w else (LONG, LONG * 3 // 4)
    s = max(W / w, H / h)
    img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    y0 = (img.shape[0] - H) // 2
    x0 = (img.shape[1] - W) // 2
    return img[y0:y0 + H, x0:x0 + W].copy()


def shape_mask(d, shape, offset=(0, 0)):
    m = np.zeros(shape[:2], np.uint8)
    dx, dy = offset
    if 'poly' in d:
        pts = np.array([[x + dx, y + dy] for x, y in d['poly']], np.int32)
        cv2.fillPoly(m, [pts], 255)
    else:
        cx, cy, rx, ry = d['ellipse']
        cv2.ellipse(m, (int(cx + dx), int(cy + dy)), (int(rx), int(ry)), 0, 0, 360, 255, -1)
    return m


def soft(m, grow=3, blur=5):
    if grow:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1)))
    k = blur * 2 + 1
    return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255


def shift(img, dx, dy):
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_REFLECT)


def blend(base, edited, alpha):
    a = alpha[..., None]
    return (base * (1 - a) + edited * a).astype(np.uint8)


def recolor(base, d):
    m = shape_mask(d, base.shape)
    if 'color' in d:
        # 밝기는 그대로 두고 색(Lab 의 a,b)만 목표 색으로 바꾼다
        hexc = d['color'].lstrip('#')
        tgt = np.uint8([[[int(hexc[4:6], 16), int(hexc[2:4], 16), int(hexc[0:2], 16)]]])
        tl = cv2.cvtColor(tgt, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
        lab = cv2.cvtColor(base, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab[..., 1] = tl[1]
        lab[..., 2] = tl[2]
        if 'light' in d:
            lab[..., 0] = np.clip(lab[..., 0] * d['light'], 0, 255)
        edited = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    else:
        hsv = cv2.cvtColor(base, cv2.COLOR_BGR2HSV).astype(np.int32)
        hsv[..., 0] = (hsv[..., 0] + int(d['hue'] / 2)) % 180
        if 'sat' in d:
            hsv[..., 1] = np.clip(hsv[..., 1] * d['sat'], 0, 255)
        edited = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    a = soft(m, grow=d.get('grow', 1), blur=d.get('blur', 2))
    if 'match' in d:
        # 지정한 색(색상 hue ± range)에 가까운 픽셀만 바꾼다. 예: {"hue": 0, "range": 18}
        hsv = cv2.cvtColor(base, cv2.COLOR_BGR2HSV).astype(np.float32)
        h = hsv[..., 0] * 2
        dist = np.abs(((h - d['match']['hue']) + 180) % 360 - 180)
        rng = d['match'].get('range', 20)
        hm = np.clip((rng * 1.5 - dist) / (rng * 0.5), 0, 1)
        sm = np.clip((hsv[..., 1] - d['match'].get('minSat', 60)) / 40, 0, 1)
        a = a * cv2.GaussianBlur((hm * sm).astype(np.float32), (5, 5), 0)
    return edited, a


def fill_hole(base, m, d):
    if 'from' in d:
        dx, dy = d['from']
        return shift(base, -dx, -dy)
    big = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    return cv2.inpaint(base, big, d.get('radius', 7), cv2.INPAINT_TELEA)


def remove(base, d):
    m = shape_mask(d, base.shape)
    edited = fill_hole(base, m, d)
    return edited, soft(m, grow=d.get('grow', 4), blur=d.get('blur', 6))


def add(base, d):
    dx, dy = d['to']
    m2 = shape_mask(d, base.shape, (dx, dy))
    edited = shift(base, dx, dy)
    return edited, soft(m2, grow=d.get('grow', 1), blur=d.get('blur', 3))


def move(base, d):
    m = shape_mask(d, base.shape)
    holed = fill_hole(base, m, d)
    a_hole = soft(m, grow=d.get('grow', 4), blur=d.get('blur', 6))
    step1 = blend(base, holed, a_hole)
    dx, dy = d['to']
    m2 = shape_mask(d, base.shape, (dx, dy))
    a_obj = soft(m2, grow=1, blur=3)
    final = blend(step1, shift(base, dx, dy), a_obj)
    return final, np.maximum(a_hole, a_obj)


def flip(base, d):
    m = shape_mask(d, base.shape)
    x, y, w, h = cv2.boundingRect(m)
    cx = x + w / 2
    M = np.float32([[-1, 0, 2 * cx], [0, 1, 0]])
    edited = cv2.warpAffine(base, M, (base.shape[1], base.shape[0]), borderMode=cv2.BORDER_REFLECT)
    mf = cv2.warpAffine(m, M, (base.shape[1], base.shape[0]))
    return edited, soft(np.maximum(m, mf), grow=d.get('grow', 2), blur=d.get('blur', 4))


def scale(base, d):
    m = shape_mask(d, base.shape)
    mo = cv2.moments(m)
    cx, cy = mo['m10'] / mo['m00'], mo['m01'] / mo['m00']
    k = d.get('k', 1.3)
    M = np.float32([[k, 0, cx - k * cx], [0, k, cy - k * cy]])
    edited = cv2.warpAffine(base, M, (base.shape[1], base.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    ms = cv2.warpAffine(m, M, (base.shape[1], base.shape[0]))
    return edited, soft(np.maximum(ms, m if k < 1 else ms), grow=d.get('grow', 2), blur=d.get('blur', 4))


OPS = {'recolor': recolor, 'remove': remove, 'add': add, 'move': move, 'flip': flip, 'scale': scale}


CELL = 12


def hit_area(alpha):
    """정답 영역: 바뀐 곳을 12px 칸으로 나눠 행마다 [시작칸, 끝칸] 구간으로 적는다. 그리고 감싸는 상자."""
    m = (alpha > 0.3).astype(np.uint8)
    H, W = m.shape
    gh, gw = (H + CELL - 1) // CELL, (W + CELL - 1) // CELL
    pad = np.zeros((gh * CELL, gw * CELL), np.uint8)
    pad[:H, :W] = m
    cells = pad.reshape(gh, CELL, gw, CELL).max(axis=(1, 3))
    rows = {}
    for gy in range(gh):
        runs, x = [], 0
        while x < gw:
            if cells[gy, x]:
                x0 = x
                while x < gw and cells[gy, x]:
                    x += 1
                runs.append([x0, x - 1])
            else:
                x += 1
        if runs:
            rows[gy] = runs
    ys, xs = np.where(m > 0)
    box = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
    return rows, box


def build(spec_path):
    spec = json.load(open(spec_path, encoding='utf-8'))
    pid = spec['id']
    src = os.path.join(ROOT, spec['source']) if not os.path.isabs(spec['source']) else spec['source']
    base = load_base(src)
    out_dir = os.path.join(ROOT, 'photos', pid)
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.startswith('d') and f.endswith('.png'):
            os.remove(os.path.join(out_dir, f))
    cv2.imwrite(os.path.join(out_dir, 'base.jpg'), base, [cv2.IMWRITE_JPEG_QUALITY, 88])

    diffs = []
    preview = base.copy()
    for n, d in enumerate(spec['diffs'], 1):
        edited, alpha = OPS[d['op']](base, d)
        ys, xs = np.where(alpha > 0.004)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        patch = np.dstack([edited[y0:y1, x0:x1], (alpha[y0:y1, x0:x1] * 255).astype(np.uint8)])
        fname = f'd{n}.png'
        cv2.imwrite(os.path.join(out_dir, fname), patch, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        preview = blend(preview, edited, alpha)
        rows, box = hit_area(alpha)
        diffs.append({
            'file': fname, 'x': int(x0), 'y': int(y0),
            'box': box, 'rows': rows, 'level': d.get('level', 2), 'op': d['op'], 'desc': d.get('desc', ''),
        })

    meta = {
        'id': pid, 'title': spec['title'], 'w': base.shape[1], 'h': base.shape[0],
        'cell': CELL, 'credit': spec.get('credit', ''), 'license': spec.get('license', ''), 'url': spec.get('url', ''),
        'diffs': diffs,
    }
    json.dump(meta, open(os.path.join(out_dir, 'puzzle.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # 확인용: 왼쪽 원본, 오른쪽 전부 바뀐 그림 + 정답 원
    marked = preview.copy()
    for i, d in enumerate(diffs, 1):
        x, y, w, h = d['box']
        cv2.ellipse(marked, (x + w // 2, y + h // 2), (w // 2 + 10, h // 2 + 10), 0, 0, 360, (255, 0, 255), 3)
        cv2.putText(marked, f"{i}{'*' * d['level']}", (x, max(16, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 255), 2)
    check = np.hstack([base, np.full((base.shape[0], 12, 3), 40, np.uint8), preview, np.full((base.shape[0], 12, 3), 40, np.uint8), marked])
    os.makedirs(os.path.join(ROOT, 'tools', 'preview'), exist_ok=True)
    cv2.imwrite(os.path.join(ROOT, 'tools', 'preview', f'{pid}.jpg'), check, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f'{pid}: 틀린 곳 {len(diffs)}개 → photos/{pid}/')
    return meta


def write_manifest():
    metas = []
    pdir = os.path.join(ROOT, 'photos')
    spec_dir = os.path.join(ROOT, 'tools', 'specs')
    order = [json.load(open(os.path.join(spec_dir, f), encoding='utf-8'))['id'] for f in sorted(os.listdir(spec_dir)) if f.endswith('.json')]
    for pid in order:
        f = os.path.join(pdir, pid, 'puzzle.json')
        if os.path.exists(f):
            metas.append(json.load(open(f, encoding='utf-8')))
    with open(os.path.join(ROOT, 'js', 'puzzles.js'), 'w', encoding='utf-8') as fp:
        fp.write('// tools/make_puzzle.py 가 자동으로 만드는 파일입니다. 직접 고치지 마세요.\n')
        fp.write('window.PUZZLES = ' + json.dumps(metas, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'js/puzzles.js: 사진 {len(metas)}장')


def grid(src, out):
    base = load_base(src)
    g = base.copy()
    for x in range(0, g.shape[1], 50):
        cv2.line(g, (x, 0), (x, g.shape[0]), (0, 255, 255) if x % 100 == 0 else (0, 160, 160), 1)
        if x % 100 == 0:
            cv2.putText(g, str(x), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
    for y in range(0, g.shape[0], 50):
        cv2.line(g, (0, y), (g.shape[1], y), (0, 255, 255) if y % 100 == 0 else (0, 160, 160), 1)
        if y % 100 == 0:
            cv2.putText(g, str(y), (2, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
    cv2.imwrite(out, g, [cv2.IMWRITE_JPEG_QUALITY, 90])


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['--grid']:
        grid(args[1], args[2])
    elif args[:1] == ['--all']:
        spec_dir = os.path.join(ROOT, 'tools', 'specs')
        for f in sorted(os.listdir(spec_dir)):
            if f.endswith('.json'):
                build(os.path.join(spec_dir, f))
        write_manifest()
    else:
        for a in args:
            build(a)
        write_manifest()
