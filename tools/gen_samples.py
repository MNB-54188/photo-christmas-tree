# -*- coding: utf-8 -*-
"""
生成 public/assets/samples/*.png 内置示例照片。
纯标准库实现（zlib + struct 手写 PNG），无需 Pillow / numpy。
运行：python tools/gen_samples.py
"""
import math
import os
import random
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'samples')

# ---------------- PNG 写出 ----------------
def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

def write_png(path, w, h, px):
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw += px[y * stride:(y + 1) * stride]
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

# ---------------- 像素工具 ----------------
def blend(px, w, h, x, y, c, a=1.0):
    if x < 0 or y < 0 or x >= w or y >= h:
        return
    i = (y * w + x) * 3
    if a >= 1.0:
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]
    else:
        px[i] = int(px[i] * (1 - a) + c[0] * a)
        px[i + 1] = int(px[i + 1] * (1 - a) + c[1] * a)
        px[i + 2] = int(px[i + 2] * (1 - a) + c[2] * a)

def gradient(px, w, h, top, bottom):
    for y in range(h):
        t = y / max(h - 1, 1)
        c = (int(top[0] + (bottom[0] - top[0]) * t),
             int(top[1] + (bottom[1] - top[1]) * t),
             int(top[2] + (bottom[2] - top[2]) * t))
        px[y * w * 3:(y + 1) * w * 3] = bytes(c) * w

def bokeh(px, w, h, rnd, accent, n=26):
    for _ in range(n):
        cx = rnd.uniform(0, w); cy = rnd.uniform(0, h)
        r = rnd.uniform(w * 0.03, w * 0.16)
        a = rnd.uniform(0.09, 0.26)
        t = rnd.uniform(0.35, 1.0)
        c = (int(accent[0] * t + 255 * (1 - t)),
             int(accent[1] * t + 255 * (1 - t)),
             int(accent[2] * t + 255 * (1 - t)))
        x0, x1 = int(cx - r), int(cx + r) + 1
        y0, y1 = int(cy - r), int(cy + r) + 1
        r2 = r * r
        for y in range(max(0, y0), min(h, y1)):
            dy = y - cy
            for x in range(max(0, x0), min(w, x1)):
                dx = x - cx
                d2 = dx * dx + dy * dy
                if d2 < r2:
                    k = 1 - d2 / r2
                    blend(px, w, h, x, y, c, a * k * k)

def vignette(px, w, h, strength=0.55):
    cx, cy = w / 2.0, h / 2.0
    mx = math.hypot(cx, cy)
    for y in range(h):
        dy = (y - cy) / mx
        base = y * w * 3
        for x in range(w):
            dx = (x - cx) / mx
            v = 1.0 - strength * min(1.0, (dx * dx + dy * dy) * 1.9)
            i = base + x * 3
            px[i] = int(px[i] * v)
            px[i + 1] = int(px[i + 1] * v)
            px[i + 2] = int(px[i + 2] * v)

# ---------------- 图案 ----------------
def draw_tree(px, w, h, cx, base_y, height, color):
    top_y = base_y - height
    half = height * 0.34
    for y in range(int(top_y), int(base_y)):
        t = (y - top_y) / max(height, 1)
        hw = half * t
        for x in range(int(cx - hw), int(cx + hw) + 1):
            if 0 <= x < w and 0 <= y < h:
                edge = 1.0 - abs(x - cx) / max(hw, 1)
                shade = 0.72 + 0.28 * edge
                blend(px, w, h, x, y,
                      (int(color[0] * shade), int(color[1] * shade), int(color[2] * shade)))
    # 树干
    tw = max(2, int(height * 0.05))
    for y in range(int(base_y), min(h, int(base_y + height * 0.09))):
        for x in range(int(cx - tw), int(cx + tw) + 1):
            blend(px, w, h, x, y, (74, 48, 32))

def poly_points(cx, cy, R, k=5, inner=0.42):
    pts = []
    for i in range(k * 2):
        r = R if i % 2 == 0 else R * inner
        a = (i / (k * 2)) * math.pi * 2 - math.pi / 2
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts

def inside(poly, x, y):
    c = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-9) + x1):
            c = not c
    return c

def draw_star(px, w, h, cx, cy, R, color):
    poly = poly_points(cx, cy, R)
    for y in range(int(cy - R), int(cy + R) + 1):
        for x in range(int(cx - R), int(cx + R) + 1):
            if 0 <= x < w and 0 <= y < h and inside(poly, x + 0.5, y + 0.5):
                blend(px, w, h, x, y, color)

def draw_snowflake(px, w, h, cx, cy, R, color, arms=6):
    for a in range(arms):
        ang = a * math.pi / arms
        dx, dy = math.cos(ang), math.sin(ang)
        for s in range(int(R)):
            blend(px, w, h, int(cx + dx * s), int(cy + dy * s), color, 0.95)
        for br in (0.45, 0.7):
            bx, by = cx + dx * R * br, cy + dy * R * br
            for s in range(int(R * 0.22)):
                for sign in (-1, 1):
                    a2 = ang + sign * 0.9
                    blend(px, w, h, int(bx + math.cos(a2) * s), int(by + math.sin(a2) * s), color, 0.9)

def draw_ornament(px, w, h, cx, cy, R, color):
    r2 = R * R
    for y in range(int(cy - R), int(cy + R) + 1):
        for x in range(int(cx - R), int(cx + R) + 1):
            dx, dy = x - cx, y - cy
            d2 = dx * dx + dy * dy
            if d2 <= r2:
                nz = math.sqrt(max(r2 - d2, 0)) / R
                lx = (dx / R) * 0.55 - 0.32
                ly = (dy / R) * 0.55 - 0.32
                nz2 = math.sqrt(max(1 - lx * lx - ly * ly, 0))
                spec = max(0.0, lx * 0.42 + ly * 0.42 + nz2 * 0.8) ** 3
                shade = 0.62 + 0.38 * nz
                c = (min(255, int(color[0] * shade + 255 * spec)),
                     min(255, int(color[1] * shade + 255 * spec)),
                     min(255, int(color[2] * shade + 255 * spec)))
                blend(px, w, h, x, y, c)
    # 挂绳 + 顶盖
    for y in range(int(cy - R * 1.28), int(cy - R * 0.94)):
        blend(px, w, h, int(cx), y, (200, 210, 230))
    for x in range(int(cx - R * 0.26), int(cx + R * 0.26) + 1):
        for y in range(int(cy - R * 1.05), int(cy - R * 0.86)):
            blend(px, w, h, x, y, (214, 176, 96))

def draw_gift(px, w, h, cx, cy, S, color, ribbon):
    x0, y0 = int(cx - S), int(cy - S * 0.85)
    x1, y1 = int(cx + S), int(cy + S * 0.85)
    for y in range(y0, y1):
        t = (y - y0) / max(y1 - y0, 1)
        shade = 0.72 + 0.28 * (1 - t)
        for x in range(x0, x1):
            blend(px, w, h, x, y, (int(color[0] * shade), int(color[1] * shade), int(color[2] * shade)))
    bw = max(2, int(S * 0.13))
    for y in range(y0, y1):
        for x in range(int(cx - bw), int(cx + bw) + 1):
            blend(px, w, h, x, y, ribbon)
    for x in range(x0, x1):
        for y in range(int(cy - bw), int(cy + bw) + 1):
            blend(px, w, h, x, y, ribbon)

# ---------------- 配方 ----------------
PALETTES = [
    ((26, 54, 96), (12, 26, 54), (255, 207, 92)),
    ((84, 30, 48), (40, 20, 48), (255, 170, 90)),
    ((16, 74, 56), (10, 34, 50), (120, 235, 170)),
    ((64, 28, 92), (22, 22, 60), (255, 150, 200)),
    ((16, 70, 100), (10, 30, 56), (120, 200, 255)),
    ((54, 62, 82), (16, 18, 30), (255, 110, 110)),
    ((24, 56, 48), (12, 28, 38), (255, 214, 120)),
    ((80, 38, 26), (32, 16, 16), (255, 196, 96)),
    ((22, 36, 84), (8, 16, 40), (170, 210, 255)),
    ((44, 72, 40), (16, 34, 24), (255, 232, 160)),
    ((72, 20, 64), (28, 12, 36), (255, 140, 170)),
    ((24, 48, 72), (10, 20, 40), (140, 255, 220)),
]

ACCENTS = [
    (255, 92, 108), (255, 207, 92), (79, 224, 141), (90, 169, 255),
    (255, 138, 212), (235, 245, 255), (120, 220, 190), (255, 168, 92),
]

SIZES = [
    (420, 525), (460, 460), (560, 420), (420, 525),
    (520, 460), (460, 460), (400, 520), (560, 420),
    (460, 460), (420, 525), (540, 440), (500, 500),
]

def build(idx):
    rnd = random.Random(2025_12_25 + idx * 977)
    w, h = SIZES[idx % len(SIZES)]
    top, bottom, accent = PALETTES[idx % len(PALETTES)]
    px = bytearray(w * h * 3)

    gradient(px, w, h, top, bottom)
    bokeh(px, w, h, rnd, accent, n=36)

    motif = idx % 6
    col = ACCENTS[idx % len(ACCENTS)]
    cx, cy = w / 2.0, h * 0.54
    if motif == 0:
        draw_tree(px, w, h, cx, h * 0.86, h * 0.58, (36, 150, 92))
        draw_star(px, w, h, cx, h * 0.26, h * 0.055, (255, 214, 110))
    elif motif == 1:
        draw_star(px, w, h, cx, cy, min(w, h) * 0.30, col)
        draw_star(px, w, h, w * 0.20, h * 0.22, min(w, h) * 0.055, (255, 236, 180))
        draw_star(px, w, h, w * 0.82, h * 0.78, min(w, h) * 0.04, (255, 236, 180))
    elif motif == 2:
        draw_snowflake(px, w, h, cx, cy, min(w, h) * 0.34, col)
    elif motif == 3:
        draw_ornament(px, w, h, w * 0.40, h * 0.58, min(w, h) * 0.22, (220, 60, 76))
        draw_ornament(px, w, h, w * 0.66, h * 0.34, min(w, h) * 0.14, (250, 200, 90))
    elif motif == 4:
        draw_gift(px, w, h, w * 0.42, h * 0.60, min(w, h) * 0.24, (200, 54, 70), (255, 214, 120))
        draw_gift(px, w, h, w * 0.70, h * 0.74, min(w, h) * 0.14, (60, 150, 110), (255, 240, 200))
    else:
        draw_tree(px, w, h, w * 0.30, h * 0.88, h * 0.44, (30, 130, 84))
        draw_star(px, w, h, w * 0.66, h * 0.38, min(w, h) * 0.20, (255, 222, 140))

    vignette(px, w, h, 0.38)
    return w, h, px

def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for i in range(12):
        w, h, px = build(i)
        path = os.path.join(OUT, '%02d.png' % (i + 1))
        write_png(path, w, h, px)
        size = os.path.getsize(path)
        total += size
        print('  ✓ %02d.png  %dx%d  %.1f KB' % (i + 1, w, h, size / 1024))
    print('完成：12 张，共 %.1f KB' % (total / 1024))

if __name__ == '__main__':
    main()
