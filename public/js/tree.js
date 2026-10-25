/* ============================================================
 *  tree.js —— 照片圣诞树 3D 场景
 *  照片 → 螺旋锥体圣诞树 / 水晶球 / 螺旋塔 / 爱心 / 星云 / 照片墙
 * ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ------------------------------------------------------------------ */
/*  工具                                                               */
/* ------------------------------------------------------------------ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 确定性伪随机（同一张照片每次布局抖动一致） */
function seededRandom(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 生成一张"带白边框 + 圆角"的照片贴图 */
function framedTexture(image, maxSide = 320) {
  const ar = image.width / image.height;
  let w, h;
  if (ar >= 1) { w = maxSide; h = Math.round(maxSide / ar); }
  else { h = maxSide; w = Math.round(maxSide * ar); }

  const bw = 11, br = 9;
  const c = document.createElement('canvas');
  c.width = w + bw * 2;
  c.height = h + bw * 2;
  const g = c.getContext('2d');

  roundRectPath(g, 0, 0, c.width, c.height, br + bw);
  g.fillStyle = '#ffffff';
  g.fill();

  g.save();
  roundRectPath(g, bw, bw, w, h, br);
  g.clip();
  g.drawImage(image, bw, bw, w, h);
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: c.width / c.height };
}

/** 圆形柔光贴图 */
function glowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function starShape(outer, inner, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/* ------------------------------------------------------------------ */
/*  造型布局                                                           */
/* ------------------------------------------------------------------ */

export const SHAPES = ['tree', 'sphere', 'spiral', 'heart', 'scatter', 'wall'];
export const SHAPE_NAMES = {
  tree: '圣诞树', sphere: '水晶球', spiral: '螺旋塔',
  heart: '爱心', scatter: '星云散开', wall: '照片墙',
};
/** 需要始终正对摄像机的造型 */
const BILLBOARD = { scatter: true, heart: true, wall: true };

const _v = new THREE.Vector3();

function layout(shape, i, n, rnd, dim) {
  const t = n > 1 ? i / (n - 1) : 0;
  const R = dim.R, H = dim.H, baseY = dim.baseY;
  let x = 0, y = 0, z = 0;

  switch (shape) {
    case 'tree': {
      const ty = Math.pow(t, 0.88);
      y = baseY + ty * H;
      const rad = (R - 0.45) * Math.pow(1 - ty, 0.86) + 0.45;
      const a = ty * Math.PI * 2 * 7.2 + i * 0.62;
      x = Math.cos(a) * rad + (rnd() - 0.5) * 0.3;
      z = Math.sin(a) * rad + (rnd() - 0.5) * 0.3;
      y += (rnd() - 0.5) * 0.22;
      return { x, y, z, faceOut: true, tilt: (rnd() - 0.5) * 0.14 };
    }
    case 'sphere': {
      const k = i + 0.5;
      const phi = Math.acos(clamp(1 - (2 * k) / n, -1, 1));
      const theta = Math.PI * (1 + Math.sqrt(5)) * k;
      const r = R * 1.28;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.cos(phi) + 1.5;
      z = r * Math.sin(phi) * Math.sin(theta);
      return { x, y, z, faceOut: true, tilt: 0 };
    }
    case 'spiral': {
      const a = t * Math.PI * 2 * 3.4;
      const rad = R * (0.42 + 0.58 * (1 - t));
      x = Math.cos(a) * rad;
      z = Math.sin(a) * rad;
      y = baseY + 2 + t * (H - 1);
      return { x, y, z, faceOut: true, tilt: 0 };
    }
    case 'heart': {
      const u = (i / n) * Math.PI * 2;
      const s = 0.1 + 0.9 * Math.sqrt(((i * 0.6180339887) % 1));
      const hx = 16 * Math.pow(Math.sin(u), 3);
      const hy = 13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u);
      x = hx * 0.52 * s;
      y = hy * 0.52 * s + 1.6;
      z = (rnd() - 0.5) * 4.5 * (1 - s * 0.45);
      return { x, y, z, faceOut: false, tilt: (rnd() - 0.5) * 0.28 };
    }
    case 'scatter': {
      if (i === 0) {
        /* 星云中心放一张大图（对应原版的金框主照片） */
        return { x: 0, y: 0.8, z: 0, faceOut: false, tilt: 0 };
      }
      const r = 9 + rnd() * 23;
      const phi = Math.acos(2 * rnd() - 1);
      const th = rnd() * Math.PI * 2;
      x = r * Math.sin(phi) * Math.cos(th);
      y = r * Math.cos(phi) * 0.62 + 1;
      z = r * Math.sin(phi) * Math.sin(th);
      return { x, y, z, faceOut: false, tilt: (rnd() - 0.5) * 0.9 };
    }
    case 'wall': {
      const nu = Math.max(1, Math.min(dim.nUnique || n, n));
      const cols = Math.max(3, Math.ceil(Math.sqrt(nu * 1.5)));
      const rows = Math.ceil(nu / cols);
      const gw = R * 2.6, gh = gw * 0.64;
      const slot = i < nu ? i : i % nu;
      const col = slot % cols, row = Math.floor(slot / cols);
      const x = (col - (cols - 1) / 2) * (gw / cols) * 1.06;
      const y = ((rows - 1) / 2 - row) * (gh / Math.max(rows, 1)) * 1.06 + 1;
      const z = i < nu ? (rnd() - 0.5) * 0.6 : -3.2 - rnd() * 3.5;
      return { x, y, z, faceOut: false, tilt: (rnd() - 0.5) * 0.05 };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  灯光 / 雪 / 星空 的自定义着色器                                      */
/* ------------------------------------------------------------------ */

const LIGHT_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aScale;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vColor = aColor;
    vTwinkle = 0.45 + 0.55 * sin(uTime * 2.1 + aPhase * 6.2831);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aScale * uPixelRatio * 950.0 / max(-mv.z, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

const LIGHT_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    float a = t.a * vTwinkle;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.6 + vTwinkle * 0.9), a);
  }
`;

/* ------------------------------------------------------------------ */
/*  主类                                                               */
/* ------------------------------------------------------------------ */

export class PhotoTree {
  constructor(canvas) {
    this.canvas = canvas;
    this.items = [];
    this.shape = 'tree';
    this.autoRotate = true;
    this.snowOn = true;
    this.bloomOn = true;
    this.hoverIndex = -1;
    this._pointer = new THREE.Vector2(-10, -10);
    this._raycaster = new THREE.Raycaster();
    this._clock = new THREE.Clock();
    this._anim = null;          // 造型过渡状态
    this._disposed = false;

    /* --- 轨道参数 --- */
    this.orbit = {
      theta: 0.4, phi: 1.28, radius: 48,
      target: new THREE.Vector3(0, 0.5, 0),
      vTheta: 0, vPhi: 0,
      minR: 14, maxR: 96,
    };
    this._initRenderer();
    this._initScene();
    this._buildEnvironment();
    this._bindInput();
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  /* ------------------------- 初始化 ------------------------- */

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.0075);

    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 1200);
    this._applyCamera();

    this.scene.add(new THREE.AmbientLight(0x5f7bb0, 0.85));

    const key = new THREE.DirectionalLight(0xfff0d0, 1.15);
    key.position.set(14, 24, 18);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x66a8ff, 0.7);
    rim.position.set(-18, 6, -14);
    this.scene.add(rim);

    this.starLight = new THREE.PointLight(0xffc94d, 3.2, 60, 2);
    this.starLight.position.set(0, 13.5, 0);
    this.scene.add(this.starLight);

    this.photoGroup = new THREE.Group();
    this.scene.add(this.photoGroup);

    /* 后处理 */
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.62, 0.6
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  _buildEnvironment() {
    const env = new THREE.Group();
    this.env = env;
    this.scene.add(env);

    /* 树干（大部分被照片遮住，只在底部露出一点） */
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.85, 6.4, 14),
      new THREE.MeshStandardMaterial({ color: 0x3a2517, roughness: 0.95, metalness: 0.05 })
    );
    trunk.position.y = -11.6;
    this.trunk = trunk;
    env.add(trunk);

    /* 树顶星星 */
    const starGeo = new THREE.ExtrudeGeometry(starShape(1.85, 0.78, 5), {
      depth: 0.42, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.16, bevelSegments: 2,
    });
    starGeo.center();
    this.star = new THREE.Mesh(
      starGeo,
      new THREE.MeshStandardMaterial({
        color: 0xffd76a, emissive: 0xffa726, emissiveIntensity: 1.5,
        metalness: 0.85, roughness: 0.22,
      })
    );
    this.star.position.y = 13.6;
    env.add(this.star);

    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc866, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    glowSprite.scale.set(9, 9, 1);
    glowSprite.position.y = 13.6;
    this.starGlow = glowSprite;
    env.add(glowSprite);

    /* 彩灯 / 飘雪 / 星空 */
    this._buildLights();
    this._buildSnow();
    this._buildStars();
  }

  _buildLights() {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const ph = new Float32Array(N);
    const sc = new Float32Array(N);
    const palette = [
      new THREE.Color(0xff4d5e), new THREE.Color(0xffd166),
      new THREE.Color(0x4fe08d), new THREE.Color(0x5aa9ff),
      new THREE.Color(0xff8ad4), new THREE.Color(0xfff3d0),
    ];
    const rnd = seededRandom(20251225);
    for (let i = 0; i < N; i++) {
      const ty = Math.pow(rnd(), 0.82);
      const y = -12.6 + ty * 25.6;
      const rad = (9.2 - 0.4) * Math.pow(1 - ty, 0.86) + 0.4;
      const a = rnd() * Math.PI * 2;
      const rr = rad * (0.8 + rnd() * 0.26);
      pos[i * 3] = Math.cos(a) * rr;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * rr;
      const c = palette[(rnd() * palette.length) | 0];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      ph[i] = rnd();
      sc[i] = 0.22 + rnd() * 0.42;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(sc, 1));

    this.lightUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uMap: { value: glowTexture() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.lightUniforms,
      vertexShader: LIGHT_VERT,
      fragmentShader: LIGHT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,   // 让彩灯光斑穿透照片，营造"满树灯光"的氛围
    });
    this.lights = new THREE.Points(geo, mat);
    this.lights.frustumCulled = false;
    this.env.add(this.lights);
  }

  _buildSnow() {
    const N = 2000;
    const pos = new Float32Array(N * 3);
    const spd = new Float32Array(N);
    const ph = new Float32Array(N);
    const rnd = seededRandom(1225);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 90;
      pos[i * 3 + 1] = (rnd() - 0.5) * 70;
      pos[i * 3 + 2] = (rnd() - 0.5) * 90;
      spd[i] = 1.1 + rnd() * 2.4;
      ph[i] = rnd() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.3, map: glowTexture(), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
      color: 0xdfeaff, sizeAttenuation: true, toneMapped: false,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this._snowSpeed = spd;
    this._snowPhase = ph;
    this.scene.add(this.snow);
  }

  _buildStars() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const rnd = seededRandom(777);
    for (let i = 0; i < N; i++) {
      const r = 220 + rnd() * 260;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.7 + 40;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      const w = 0.6 + rnd() * 0.4;
      col[i * 3] = w; col[i * 3 + 1] = w; col[i * 3 + 2] = 1.0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.5, vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true, toneMapped: false,
      map: glowTexture(), blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  _buildGifts() { /* 已移除：保持纯黑星空的简洁构图 */ }

  /* ------------------------- 照片 ------------------------- */

  /**
   * @param {Array<{id:string,name:string,url:string}>} photos
   * @param {(loaded:number,total:number)=>void} onProgress
   */
  async setPhotos(photos, onProgress) {
    this.disposePhotos();
    const n = photos.length;
    if (!n) return;

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    let done = 0;
    const results = await Promise.all(photos.map((p) => new Promise((resolve) => {
      loader.load(
        p.url,
        (img) => { done++; onProgress && onProgress(done, n); resolve({ photo: p, img, ok: true }); },
        undefined,
        () => { done++; onProgress && onProgress(done, n); resolve({ photo: p, img: null, ok: false }); }
      );
    })));

    if (this._disposed) return;

    const ok = results.filter((r) => r.ok);
    if (!ok.length) return;

    /* 照片少时自动重复成密集"瓦片"，贴近原版效果 */
    this.uniqueCount = ok.length;
    const repeat = clamp(Math.round(420 / ok.length), 1, 40);
    const tiles = Math.min(ok.length * repeat, 520);

    this.dim = {
      R: 5.8 + Math.min(tiles, 320) * 0.008,
      H: 20 + Math.min(tiles, 320) * 0.011,
      baseY: -12.6,
      nUnique: ok.length,
    };
    this.photoSize = clamp(31 / Math.sqrt(tiles), 1.0, 3.2);

    /* 共享纹理，避免重复解码 */
    const texCache = ok.map((r) => framedTexture(r.img.image || r.img, 320));

    for (let t = 0; t < tiles; t++) {
      const pi = t % ok.length;
      const r = ok[pi];
      const { tex, aspect } = texCache[pi];
      const h = this.photoSize;
      const w = h * aspect;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide,
          toneMapped: false, depthWrite: true,
          color: new THREE.Color(0xffedcf),
        })
      );
      mesh.userData.index = t;
      mesh.userData.photoIndex = pi;
      this.photoGroup.add(mesh);
      this.items.push({
        mesh, aspect, photoIndex: pi, baseScale: 1, hover: 0,
        pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
        fromP: new THREE.Vector3(), fromQ: new THREE.Quaternion(),
        toP: new THREE.Vector3(), toQ: new THREE.Quaternion(),
        delay: 0, billboard: false,
      });
    }

    this._layout(this.shape, true);
  }

  disposePhotos() {
    this.items.forEach((it) => {
      this.photoGroup.remove(it.mesh);
      it.mesh.geometry.dispose();
      if (it.mesh.material.map) it.mesh.material.map.dispose();
      it.mesh.material.dispose();
    });
    this.items = [];
    this.hoverIndex = -1;
  }

  /** 计算并应用造型（animate=false 时立即到位） */
  _layout(shape, immediate = false) {
    const n = this.items.length;
    if (!n) return;
    this.shape = shape;
    const bb = !!BILLBOARD[shape];

    this.items.forEach((it, i) => {
      const rnd = seededRandom(i * 7919 + shape.length * 131 + 17);
      const L = layout(shape, i, n, rnd, this.dim);

      it.fromP.copy(immediate ? _v.set(L.x, L.y, L.z) : it.pos);
      it.toP.set(L.x, L.y, L.z);

      const e = new THREE.Euler();
      if (L.faceOut) {
        e.set(0, Math.atan2(L.x, L.z) + (L.tilt || 0), 0);
      } else {
        e.set(0, 0, L.tilt || 0);
      }
      const q = new THREE.Quaternion().setFromEuler(e);
      it.fromQ.copy(immediate ? q : it.quat);
      it.toQ.copy(q);

      it.billboard = bb;
      it.delay = (i / n) * 0.42;
      it.targetScale = (shape === 'scatter' && i === 0) ? 2.2 : 1;
      it.mesh.material.color.setHex(
        (shape === 'scatter' && i === 0) ? 0xffffff : (shape === 'wall' ? 0xffffff : 0xffedcf)
      );

      if (immediate) {
        it.pos.copy(it.toP);
        it.quat.copy(it.toQ);
        it.mesh.position.copy(it.pos);
        it.mesh.quaternion.copy(it.quat);
      }
    });

    if (!immediate) this._anim = { t: 0, dur: 1.5 };
  }

  setShape(shape) {
    if (!SHAPES.includes(shape)) return;
    this._layout(shape, false);
  }

  /* ------------------------- 交互 ------------------------- */

  _bindInput() {
    const el = this.canvas;
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    this._pointers = new Map();
    this._pinchStart = 0;

    const down = (e) => {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        this._pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        this._pinchR = this.orbit.radius;
        dragging = false;
        return;
      }
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    };

    const move = (e) => {
      if (this._pointers.has(e.pointerId)) {
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (this._pointers.size === 2 && this._pinchStart) {
        const [a, b] = [...this._pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 4) this.setRadius((this._pinchR * this._pinchStart) / d);
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.rotateBy(-dx * 0.0052, -dy * 0.0042);
    };

    const up = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinchStart = 0;
      if (this._pointers.size === 0) {
        if (dragging && moved < 6) this._onClick(e.clientX, e.clientY);
        dragging = false;
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { this.hoverIndex = -1; });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setRadius(this.orbit.radius * (1 + Math.sign(e.deltaY) * 0.09));
    }, { passive: false });

    /* hover 放大 */
    el.addEventListener('pointermove', (e) => {
      if (dragging) return;
      this._pointer.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
    });
  }

  _onClick(cx, cy) {
    this._raycaster.setFromCamera(
      new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1),
      this.camera
    );
    const hits = this._raycaster.intersectObjects(this.photoGroup.children, false);
    if (hits.length && this.onPhotoClick) {
      this.onPhotoClick(hits[0].object.userData.photoIndex ?? hits[0].object.userData.index);
    }
  }

  rotateBy(dTheta, dPhi) {
    const o = this.orbit;
    o.theta += dTheta;
    o.phi = clamp(o.phi + dPhi, 0.42, 2.55);
    o.vTheta = dTheta * 0.55;
    o.vPhi = dPhi * 0.35;
  }

  setRadius(r) { this.orbit.radius = clamp(r, this.orbit.minR, this.orbit.maxR); }
  zoomBy(f) { this.setRadius(this.orbit.radius * f); }

  /** 手势：绝对旋转（0~1 归一化屏幕坐标，weight 为灵敏度权重）
   *  ny: 0 = 手掌在画面最上方，1 = 手掌在画面最下方
   *  phi 是球坐标极角 —— 0 在正上方(俯视)，π/2 水平(正视)，π 在正下方(仰视)
   *  所以：手举到最上 → 俯视；手放中间 → 正视；手压到最下 → 仰视
   */
  setRotationFromPointer(nx, ny, weight = 1) {
    const o = this.orbit;
    const targetTheta = (nx - 0.5) * Math.PI * 2.2;

    /* 中间留一点死区，手抖不会让视角一直晃，也更容易停在"正视" */
    const dy = ny - 0.5;
    const dead = 0.06;
    const dz = Math.abs(dy) <= dead ? 0 : dy - Math.sign(dy) * dead;
    const targetPhi = clamp(Math.PI / 2 + dz * 2.35, 0.42, 2.55);

    o.theta = lerp(o.theta, targetTheta, 0.16 * weight);
    o.phi = lerp(o.phi, targetPhi, 0.12 * weight);
    this._gestureAt = (this._gestureAt || 0) + 1;
    this._gestureTime = performance.now();
  }

  /** 返回屏幕中心附近最近的照片下标（指向其源照片） */
  getCenterIndex() {
    if (!this.items.length) return -1;
    const center = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best = -1, bestDot = -2;
    this.items.forEach((it, i) => {
      _v.copy(it.mesh.position).sub(this.camera.position).normalize();
      const d = _v.dot(center);
      if (d > bestDot) { bestDot = d; best = i; }
    });
    return best >= 0 ? this.items[best].photoIndex : -1;
  }

  /* ------------------------- 开关 ------------------------- */

  setAutoRotate(v) { this.autoRotate = !!v; }
  setSnow(v) { this.snowOn = !!v; this.snow.visible = !!v; }
  setBloom(v) { this.bloomOn = !!v; }

  /* ------------------------- 循环 ------------------------- */

  _applyCamera() {
    const o = this.orbit;
    const sp = Math.sin(o.phi);
    this.camera.position.set(
      o.target.x + o.radius * sp * Math.sin(o.theta),
      o.target.y + o.radius * Math.cos(o.phi),
      o.target.z + o.radius * sp * Math.cos(o.theta)
    );
    this.camera.lookAt(o.target);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.lightUniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
  }

  update() {
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const t = this._clock.elapsedTime;

    /* 造型过渡 */
    if (this._anim) {
      this._anim.t += dt / this._anim.dur;
      const p = clamp(this._anim.t, 0, 1);
      this.items.forEach((it) => {
        const lp = clamp((p - it.delay) / (1 - 0.42), 0, 1);
        const e = easeInOutCubic(lp);
        it.pos.lerpVectors(it.fromP, it.toP, e);
        it.quat.slerpQuaternions(it.fromQ, it.toQ, e);
      });
      if (p >= 1) this._anim = null;
    }

    /* 轨道（含惯性 + 自动旋转） */
    const o = this.orbit;
    o.theta += o.vTheta;
    o.phi = clamp(o.phi + o.vPhi, 0.42, 2.55);
    o.vTheta *= 0.92; o.vPhi *= 0.9;
    /* 手势正在控制时让位给手势，手离开约 1.2 秒后自动旋转再接管，
     * 否则会出现"手停住了、树还在自己转"的打架感 */
    const held = this._gestureTime && performance.now() - this._gestureTime < 1200;
    if (this.autoRotate && !held && Math.abs(o.vTheta) < 0.0016) o.theta += dt * 0.11;
    this._applyCamera();

    /* 照片朝向 / hover 缩放 */
    const camQ = this.camera.quaternion;
    this.items.forEach((it, i) => {
      const m = it.mesh;
      if (this._anim) { m.position.copy(it.pos); m.quaternion.copy(it.quat); }
      else {
        if (it.billboard) m.quaternion.copy(camQ);
        else m.quaternion.copy(it.quat);
        m.position.copy(it.pos);
      }
      if (!it.billboard && it.pos.y > this.dim.baseY) {
        /* 静态造型下轻微上下浮动，像挂在树上的挂饰 */
        m.position.y += Math.sin(t * 0.9 + i * 0.7) * 0.09;
      }
      const target = i === this.hoverIndex ? 1.28 : 1;
      it.hover = lerp(it.hover, target, 0.14);
      it.baseScale = lerp(it.baseScale, it.targetScale || 1, 0.06);
      m.scale.setScalar(it.baseScale * it.hover);
    });

    /* hover 命中检测（限流） */
    if (!this._rayTick || t - this._rayTick > 0.08) {
      this._rayTick = t;
      this._raycaster.setFromCamera(this._pointer, this.camera);
      const hits = this._raycaster.intersectObjects(this.photoGroup.children, false);
      this.hoverIndex = hits.length ? hits[0].object.userData.index : -1;
    }

    /* 星星（只在树形/螺旋造型出现） */
    const starOn = this.shape === 'tree' || this.shape === 'spiral';
    if (this.trunk) this.trunk.visible = starOn;
    if (this.star) {
      this.star.visible = starOn;
      this.starGlow.visible = starOn;
      this.starLight.visible = starOn;
      if (starOn) {
        this.star.rotation.y += dt * 0.7;
        this.star.position.y = 13.6 + Math.sin(t * 1.4) * 0.16;
        this.starGlow.position.y = this.star.position.y;
        this.starGlow.material.opacity = 0.72 + Math.sin(t * 2.6) * 0.22;
        this.starLight.position.y = this.star.position.y;
        this.starLight.intensity = 3.0 + Math.sin(t * 2.6) * 0.9;
      }
    }

    /* 彩灯闪烁 */
    this.lightUniforms.uTime.value = t;
    /* 树形以外造型时彩灯收进树里/淡出 */
    const lv = this.shape === 'tree' ? 1 : this.shape === 'spiral' ? 0.5 : 0.0;
    this.lights.visible = lv > 0.01;
    this.lights.material.opacity = lv;

    /* 飘雪 */
    if (this.snowOn) {
      const arr = this.snow.geometry.attributes.position.array;
      const sp = this._snowSpeed, ph = this._snowPhase;
      for (let i = 0; i < sp.length; i++) {
        arr[i * 3 + 1] -= sp[i] * dt * 1.6;
        arr[i * 3] += Math.sin(t * 0.7 + ph[i]) * dt * 0.55;
        if (arr[i * 3 + 1] < -28) {
          arr[i * 3 + 1] = 42;
          arr[i * 3] = (Math.random() - 0.5) * 90;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 90;
        }
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    /* 星空缓慢自转 */
    this.stars.rotation.y += dt * 0.006;
    if (this.gifts) this.gifts.rotation.y += dt * 0.05;

    /* 平面造型（爱心 / 照片墙）整体跟随相机朝向，保证不看成一条线 */
    const planar = this.shape === 'heart' || this.shape === 'wall';
    const targetRot = planar ? o.theta : 0;
    this.photoGroup.rotation.y = lerp(this.photoGroup.rotation.y, targetRot, 0.12);
  }

  render() {
    if (this.bloomOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this.disposePhotos();
    this.renderer.dispose();
  }
}
