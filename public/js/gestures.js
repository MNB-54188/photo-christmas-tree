/* ============================================================
 *  gestures.js —— 摄像头 + MediaPipe HandLandmarker 手势控制
 *
 *  对外事件（挂在实例上即可）：
 *    onReady()                     模型加载完成
 *    onError(err)                  出错（权限 / 模型 / 无摄像头）
 *    onStatus(text)                状态文案
 *    onHands(hands)                每帧原始手势数据
 *    onGesture(name)               离散手势：open/fist/point/peace/three/four/pinch
 *    onPointer(nx, ny)             手掌位置（0~1，已镜像）
 *    onZoom(factor)                相对缩放（<1 拉近）
 *    getRadius() / setRadius(r)    缩放状态读写（由调用方提供）
 * ============================================================ */

const MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/../../hand_landmarker.task',
];

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

const GESTURE_LABEL = {
  open: '🖐 张开手掌 · 旋转',
  fist: '✊ 握拳 · 收回圣诞树',
  point: '☝️ 食指 · 关闭照片',
  peace: '✌️ 比耶 · 下一张照片',
  three: '🤟 三指 · 上一个造型',
  four: '🖖 四指 · 下一个造型',
  pinch: '🤏 捏合 · 缩放',
  pinch2: '🤏🤏 双手 · 无级缩放',
  none: '未识别到手势',
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class GestureController {
  constructor({ video, canvas }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.running = false;
    this.stream = null;

    /* 外部回调 */
    this.onReady = null;
    this.onError = null;
    this.onStatus = null;
    this.onHands = null;
    this.onGesture = null;
    this.onPointer = null;
    this.onZoom = null;
    this.getRadius = () => 48;
    this.setRadius = () => {};

    /* 内部状态 */
    this._stable = { name: 'none', count: 0 };
    this._fired = 'none';
    this._lastFire = 0;
    this._pinch = null;
    this._two = null;
    this._videoTime = -1;
    this._prev = null;          // 上一帧平滑后的关键点（用于 EMA 降噪）
    this._prevNames = [];       // 上一帧各手的名称（用于捏合滞后判定）

    /* 捏合阈值：进入要小、退出要大，避免边界抖动 */
    this.PINCH_ENTER = 0.42;
    this.PINCH_EXIT = 0.62;
    this.SMOOTH = 0.55;         // 关键点 EMA 系数（越小越稳、越迟钝）
    /* 食指尖位置分界（相对食指根）：
     *   > TIP_SPLIT = 指尖伸在掌外 → 才可能是捏合
     *   <= TIP_SPLIT = 指尖缩回掌心 → 只能算握拳
     * 这是区分"握拳"与"捏合"的关键：两者都是手指收拢、拇指尖贴着食指尖，
     * 唯一稳定差别就是食指尖有没有伸出去。 */
    this.TIP_SPLIT = 1.0;

    this.onDebug = null;        // 调试信息回调
    this._debug = typeof location !== 'undefined' && /[?&]debug=1/.test(location.search);
  }

  label(name) { return GESTURE_LABEL[name] || '未识别到手势'; }

  async start() {
    if (this.running) return true;
    try {
      this._status('正在打开摄像头…');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await new Promise((res) => {
        if (this.video.readyState >= 2) return res();
        this.video.onloadeddata = () => res();
      });
      await this.video.play().catch(() => {});

      this._status('正在加载手势模型…');
      const vision = await import('tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);

      let landmarker = null;
      let lastErr = null;
      for (const url of MODEL_URLS) {
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: url, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
          });
          break;
        } catch (e) {
          try {
            landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: url, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numHands: 2,
            });
            break;
          } catch (e2) { lastErr = e2; }
        }
      }
      if (!landmarker) throw lastErr || new Error('手势模型加载失败');

      this.landmarker = landmarker;
      this.running = true;
      this._status('手势已就绪');
      this.onReady && this.onReady();
      this._loop();
      return true;
    } catch (err) {
      this.stop();
      const msg = err && err.name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请在浏览器地址栏允许摄像头后重试'
        : (err && err.name === 'NotFoundError')
          ? '没有检测到摄像头设备'
          : '手势功能启动失败：' + (err && err.message ? err.message : err);
      this._status(msg);
      this.onError && this.onError(new Error(msg));
      return false;
    }
  }

  stop() {
    this.running = false;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.video) this.video.srcObject = null;
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._pinch = null;
    this._two = null;
    this._status('摄像头已关闭');
  }

  _status(t) { this.onStatus && this.onStatus(t); }

  /* ---------------- 主循环 ---------------- */

  _loop() {
    if (!this.running) return;
    const tick = () => {
      if (!this.running) return;
      try { this._detect(); } catch (e) { /* 忽略单帧异常 */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _detect() {
    const v = this.video;
    if (!v || v.readyState < 2 || !this.landmarker) return;
    if (v.currentTime === this._videoTime) return;
    this._videoTime = v.currentTime;

    if (this.canvas) {
      if (this.canvas.width !== v.videoWidth) this.canvas.width = v.videoWidth || 640;
      if (this.canvas.height !== v.videoHeight) this.canvas.height = v.videoHeight || 480;
    }

    const res = this.landmarker.detectForVideo(v, performance.now());
    const lms = (res && res.landmarks) || [];
    const handed = (res && res.handedness) || [];

    const hands = lms.map((lm, i) => this._analyze(lm, handed[i], i));

    /* 记住本帧平滑后的关键点与名称，供下一帧做 EMA / 滞后判定 */
    this._prev = hands.map((h) => h.lm);
    this._prevNames = hands.map((h) => h.name);

    this._draw(hands);
    this.onHands && this.onHands(hands);

    this._dispatch(hands);
  }

  /* ---------------- 单手分析 ---------------- */

  _analyze(rawLm, handedness, idx) {
    /* 1) 关键点 EMA 平滑，显著降低 MediaPipe 抖动带来的误判 */
    const prev = this._prev && this._prev[idx];
    const lm = rawLm.map((p, i) => {
      const q = prev && prev[i];
      if (!q) return { x: p.x, y: p.y, z: p.z || 0 };
      const a = this.SMOOTH;
      return {
        x: q.x + (p.x - q.x) * a,
        y: q.y + (p.y - q.y) * a,
        z: (q.z || 0) + ((p.z || 0) - (q.z || 0)) * a,
      };
    });

    const wrist = lm[0];
    const scale = Math.max(dist(wrist, lm[9]), 1e-5);

    /* 2) 手指伸直判定 */
    const ext = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.13;
    const fingers = [ext(8, 6), ext(12, 10), ext(16, 14), ext(20, 18)];
    const count = fingers.filter(Boolean).length;
    /* 宽松版：小指又短又容易被判不准，张开手掌时给一点余量 */
    const soft = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.02;
    const countSoft = [soft(8, 6), soft(12, 10), soft(16, 14), soft(20, 18)].filter(Boolean).length;

    /* 拇指：用"拇指尖↔小指根距离 / 手掌尺度"衡量（与手离摄像头远近无关）。
     * 旧判据 dist(4,17) > dist(3,17)*1.12 过于苛刻——手掌稍侧、拇指外展小一点
     * 就会判定失败，导致张开手掌被误判成"四指"。
     * 现在：只有拇指明确折向掌心(thumbFolded)才算"没有拇指"。 */
    const thumbRatio = dist(lm[4], lm[17]) / scale;
    const thumbFolded = thumbRatio < 0.85;
    const thumbStraight = dist(lm[4], lm[2]) > dist(lm[3], lm[2]) * 1.35;
    const thumb = thumbRatio > 1.15 || thumbStraight;

    /* 3) 捏合判定
     *   主判据：拇指尖↔食指尖距离 / 手掌尺度（越小捏得越紧）
     *   辅助判据：食指尖相对 PIP 的回勾程度（伸食指时 >1.13，捏合时 <1）
     *   滞后：已进入捏合用较松的退出阈值，避免在临界点来回跳
     */
    const pinchRatio = dist(lm[4], lm[8]) / scale;
    const indexCurl = dist(lm[8], wrist) / Math.max(dist(lm[6], wrist), 1e-5);
    /* 食指尖相对食指根的位置：捏合时指尖伸在掌外(>1)，握拳时收回掌心(<1)。
     * 用来把"握拳"和"捏合"区分开——两者都是手指收拢，几何上很接近。 */
    const indexTipOut = dist(lm[8], wrist) / Math.max(dist(lm[5], wrist), 1e-5);
    const wasPinch = this._prevNames[idx] === 'pinch';
    const threshold = wasPinch ? this.PINCH_EXIT : this.PINCH_ENTER;
    const near = pinchRatio < threshold;
    const strongNear = pinchRatio < 0.3;             // 强证据：两指尖几乎贴住
    /* 捏合必须满足"食指尖伸在掌外"，否则就是握拳。
     * 容错：若捏得极紧(两指尖几乎重合)且其他手指是伸开的，则不再苛求指尖位置
     * ——握拳时其他手指必然是收拢的，不会误放行。 */
    const tipOut = indexTipOut > this.TIP_SPLIT;
    const veryTight = pinchRatio < 0.25 && count >= 2;
    const pinching = near && (tipOut || veryTight) && (strongNear || indexCurl < 1.12);

    /* 握拳优先判定：食指尖缩回掌心 + 几乎没有伸直的手指 + 拇指没有大幅外展。
     * 不再强求 count===0 / thumb===false，避免单根手指误判就漏掉握拳。 */
    const fistLike = !tipOut && count <= 1 && thumbRatio < 1.35;

    let name = 'none';
    if (fistLike) name = 'fist';
    else if (pinching) name = 'pinch';
    /* 四指全伸直就是张开手掌——除非拇指明确折向掌心 */
    else if (countSoft === 4 && !thumbFolded) name = 'open';
    else if (!tipOut && count <= 1) name = 'fist';
    else if (count === 1 && fingers[0]) name = 'point';
    else if (count === 2 && fingers[0] && fingers[1]) name = 'peace';
    else if (count === 3 && fingers[0] && fingers[1] && fingers[2]) name = 'three';
    else if (count === 4 && thumbFolded) name = 'four';

    /* 掌心（食指根 + 小指根的中点），并镜像 x */
    const cx = 1 - (lm[5].x + lm[17].x) / 2;
    const cy = (lm[5].y + lm[17].y) / 2;

    return {
      lm, name, fingers, thumb, thumbRatio, thumbFolded,
      pinchRatio, indexCurl, indexTipOut, pinching, cx, cy, handedness,
    };
  }

  /* ---------------- 事件派发 ---------------- */

  _dispatch(hands) {
    /* 捏合刚松开时加一段冷却，避免手指回弹被判成"食指"而误开灯箱 */
    const nowPinch = hands.length >= 2 || hands.some((h) => h.name === 'pinch');
    const wasPinch = this._prevNames.includes('pinch') || this._wasTwo;
    if (wasPinch && !nowPinch) this._pinchReleaseAt = performance.now();
    this._wasTwo = hands.length >= 2;

    /* ---- 双手：无级缩放（掌心距离） ---- */
    if (hands.length >= 2) {
      const [a, b] = hands;
      const d = Math.max(Math.hypot(a.cx - b.cx, a.cy - b.cy), 0.02);

      /* 只在"从非双手 → 双手"的那一刻建立基准，之后一直沿用。
       * （旧实现用 sign 字段比较手势名，但该字段从未赋值，导致每帧重置基准、
       *   base/d 恒等于 1，缩放完全不生效） */
      if (!this._two || this._two.hands !== hands.length) {
        this._two = { base: d, r: this.getRadius(), hands: hands.length };
      }

      const target = clamp(this._two.r * (this._two.base / d), this.minR || 14, this.maxR || 96);
      /* 平滑逼近目标，避免单帧跳变 */
      const cur = this.getRadius();
      this.setRadius(cur + (target - cur) * 0.25);

      this._pinch = null;
      this._fireStable('pinch2');
      this._status(this.label('pinch2'));
      this._debugInfo(hands, '双手距离 ' + d.toFixed(3) + ' · 基准 ' + this._two.base.toFixed(3));
      return;
    }
    this._two = null;

    /* ---- 单手 ---- */
    if (hands.length === 1) {
      const h = hands[0];

      if (h.name === 'pinch') {
        if (!this._pinch) this._pinch = { ratio: h.pinchRatio };
        const delta = h.pinchRatio - this._pinch.ratio;
        if (Math.abs(delta) > 0.0025) {
          /* 手指张开(delta>0) → 拉近放大；捏紧(delta<0) → 推远缩小 */
          const f = clamp(1 - delta * 1.8, 0.9, 1.1);
          this.setRadius(this.getRadius() * f);
          this._pinch.ratio = h.pinchRatio;
        }
        /* 捏合时手掌移动仍可旋转，但灵敏度减半，避免"边缩放边乱转" */
        this.onPointer && this.onPointer(h.cx, h.cy, 0.5);
      } else {
        this._pinch = null;
      }

      if (h.name === 'open') {
        this.onPointer && this.onPointer(h.cx, h.cy, 1);
      }

      this._fireStable(h.name);
      this._status(this.label(h.name));
      this._debugInfo(hands, '');
      return;
    }

    /* ---- 无手 ---- */
    this._pinch = null;
    this._fireStable('none');
    this._status(this.label('none'));
    this._debugInfo(hands, '');
  }

  _debugInfo(hands, extra) {
    if (!this._debug || !this.onDebug) return;
    const h = hands[0];
    const parts = [
      h ? `${h.name} 指=${h.fingers.filter(Boolean).length} pinch=${h.pinchRatio.toFixed(2)} 尖=${h.indexTipOut.toFixed(2)} 拇=${h.thumbRatio.toFixed(2)}` : '无手',
      `r=${this.getRadius().toFixed(1)}`,
    ];
    if (extra) parts.push(extra);
    this.onDebug(parts.join('  ·  '));
  }

  /** 稳定 N 帧后才触发离散手势，避免抖动误触 */
  _fireStable(name) {
    if (name === this._stable.name) this._stable.count++;
    else { this._stable = { name, count: 1 }; }

    if (this._stable.count < 5) return;
    if (name === this._fired) return;
    if (name === 'none' || name === 'pinch' || name === 'pinch2') { this._fired = name; return; }

    const now = performance.now();
    if (now - this._lastFire < 700) return;
    if (now - (this._pinchReleaseAt || 0) < 700) return;   // 捏合松手后的冷却
    this._lastFire = now;
    this._fired = name;
    this.onGesture && this.onGesture(name);
  }

  /* ---------------- 骨架绘制 ---------------- */

  _draw(hands) {
    if (!this.ctx) return;
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);

    const CONN = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
    ];

    hands.forEach((h) => {
      g.lineWidth = Math.max(2, W / 300);
      g.strokeStyle = 'rgba(120, 230, 170, 0.85)';
      CONN.forEach(([a, b]) => {
        g.beginPath();
        g.moveTo(h.lm[a].x * W, h.lm[a].y * H);
        g.lineTo(h.lm[b].x * W, h.lm[b].y * H);
        g.stroke();
      });
      h.lm.forEach((p, i) => {
        const hot = i === 4 || i === 8;
        g.fillStyle = hot ? '#ffcf5c' : '#ffffff';
        g.beginPath();
        g.arc(p.x * W, p.y * H, hot ? W / 110 : W / 200, 0, Math.PI * 2);
        g.fill();
      });
    });
  }
}
