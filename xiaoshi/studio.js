// 乾淨風格 3D 棚：尺寸 500×1000×330 cm，家具位置量自影片重建的俯視圖（見 README）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { solar, sunTimes, doyToMD, mdToDoy, compassName } from './sun.js';
import { createMusic } from './music.js';

// 日光小室：台北，窗朝南（秋冬陽光才照得進來）
const LAT = 25.04, LON = 121.53, TZ = 8, FACE = 180;

// 房間：長邊 X（0 = 窗牆 → 1000 = 玻璃隔間），短邊 Z（0 = 廚房那面牆 → 500 = 書櫃那面牆），單位公分
const L = 10, W = 5, H = 3.3, T = 0.2;
const cm = v => v / 100;
const PX = X => cm(X) - L / 2, PZ = Z => cm(Z) - W / 2;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ecebe8');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);

// 光：太陽依日期時間計算（見下方 updateLight），加天光
const hemi = new THREE.HemisphereLight('#fff8ee', '#b9b0a4', 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0dc', 3.2);
sun.castShadow = true;
const MOBILE = matchMedia('(pointer:coarse)').matches;
sun.shadow.mapSize.setScalar(MOBILE ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 50 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.035;
scene.add(sun);

// ---------- 材質與貼圖 ----------
const matCache = {};
function M(color, o = {}) {
  const k = color + JSON.stringify(o);
  return matCache[k] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

const concrete = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#d9d6d1'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '120,115,108'},${rnd() * .07})`;
    const r = rnd() * 18; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill();
  }
}, [4, 2]);
const lace = canvasTex(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 3;
  for (const [x, y] of [[0, 0], [64, 64], [128, 0], [0, 128], [128, 128]]) {
    g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x + 30, y); g.lineTo(x, y + 30); g.lineTo(x - 30, y); g.closePath(); g.stroke();
    g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke();
  }
}, [14, 7]);
const stripes = canvasTex(64, 512, (g, w, h) => {
  const cols = ['#e8e4dc', '#55524d', '#9a958c', '#2f2d2a', '#d0cbc2', '#77736c'];
  for (let y = 0; y < h; y += 8) { g.fillStyle = cols[(y / 8 * 7) % cols.length | 0]; g.fillRect(0, y, w, 8); }
  g.fillStyle = '#f2efe9';
  for (let y = 36; y < h; y += 96) for (let x = 4; x < w; x += 16) g.fillRect(x, y, 6, 6);
}, [5, 1]);
const greyRug = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b9b5ae'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '90,85,80'},.08)`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
}, [2, 3]);
const doormat = canvasTex(128, 96, (g, w, h) => {
  g.fillStyle = '#2f4f3c'; g.fillRect(0, 0, w, h); g.fillStyle = '#6b4a3a';
  for (let y = 8; y < h; y += 16) for (let x = (y / 16 % 2) * 8 + 4; x < w; x += 16) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
});
const checks = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f1efe8'; g.fillRect(0, 0, w, h); g.fillStyle = '#2f4a35';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * 8, y * 8, 8, 8);
});
const heronArt = canvasTex(120, 160, (g, w, h) => {
  g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1e1e1e'; g.beginPath(); g.ellipse(60, 70, 16, 30, -.3, 0, 7); g.fill();
  g.fillRect(52, 98, 3, 40); g.fillRect(64, 98, 3, 40);
  g.beginPath(); g.ellipse(72, 34, 7, 6, 0, 0, 7); g.fill(); g.fillRect(76, 32, 18, 3);
});

const wallWhite = M('#ece7df', { roughness: 0.9 });
const wallOut = M('#4b4b4d', { roughness: 0.9 });
const wood = M('#7d4a28', { roughness: 0.5 });
const darkWood = M('#5e3a20', { roughness: 0.55 });
const counterWood = M('#6e3f22', { roughness: 0.45 });
const whiteCab = M('#f5f4f0', { roughness: 0.5 });
const black = M('#1f1f1f', { roughness: 0.5 });
const steel = M('#c9c9c9', { roughness: 0.3, metalness: 0.8 });
const brass = M('#c5a35a', { roughness: 0.35, metalness: 0.8 });
const leaf = M('#4d7a3e', { roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
const leafDark = M('#2f5a32', { roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
const potWhite = M('#efeee9', { roughness: 0.6 });
const terracotta = M('#b0603a', { roughness: 0.8 });
const windowSky = new THREE.MeshBasicMaterial({ color: '#eef4f7' });
const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff8e6', emissive: '#ffe9b8', emissiveIntensity: 3 });
const lensMat = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#fff1cc', emissiveIntensity: 2 });
const laceMats = [], lamps = [];

// ---------- 小工具 ----------
const colliders = [];
function add(mesh, x, y, z, parent) {
  mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
  (parent || scene).add(mesh); return mesh;
}
// y 都是物件的「底部」高度
const B = (w, h, d, m, x, y, z, p) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y + h / 2, z, p);
const RB = (w, h, d, r, m, x, y, z, p) => add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m), x, y + h / 2, z, p);
const CY = (rt, rb, h, m, x, y, z, p, seg = 24) => add(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), x, y + h / 2, z, p);
// 以公分擺放；rot：0 = 正面朝 +Z，PI = 朝 -Z，PI/2 = 朝 +X
function place(g, X, Z, rot = 0, collide = true) {
  g.position.set(PX(X), 0, PZ(Z)); g.rotation.y = rot; scene.add(g);
  if (collide) { g.updateMatrixWorld(true); colliders.push(new THREE.Box3().setFromObject(g)); }
  return g;
}
// 可以移動、收起的家具道具。id 不要改（分享連結靠它）；def 是官方擺法（公分、度）
// kind：rug 地毯（可以壓在下面）、seat 椅凳、table 桌子（椅凳可以塞進桌下）
const items = [];
let editing = false;
function item(id, name, g, X, Z, rot = 0, kind = '', stored = false) {
  g.updateMatrixWorld(true);
  // 還沒擺之前量外框；盆栽只算花盆（葉子可以伸到別的東西上面）
  const f = g.userData.foot;
  const local = f ? new THREE.Box3(new THREE.Vector3(-f, 0, -f), new THREE.Vector3(f, 1, f)) : new THREE.Box3().setFromObject(g);
  place(g, X, Z, rot, false);
  const it = { id, name, g, kind, local, def: { X, Z, r: Math.round(rot * 180 / Math.PI), stored } };
  Object.assign(it, it.def);
  g.traverse(o => o.userData.item = it);
  g.visible = !stored;
  items.push(it); return it;
}
const G = () => new THREE.Group();

// ---------- 房間 ----------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), M('#d3cec6', { map: concrete, roughness: 0.4 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
B(L + 2 * T + 0.2, 0.115, W + 2 * T + 0.2, M('#d4d1cb'), 0, -0.12, 0).castShadow = false;

// 每面牆一組：solid 會在俯瞰時被切低，decor（門窗等）切低時隱藏
const walls = [];
function wall(name, cx, cz, w, d, inward) {
  // BoxGeometry 面序：+x, -x, +y, -y, +z, -z；朝室內那面白，其餘深灰
  const faces = ['+x', '-x', '+y', '-y', '+z', '-z'].map(f => f === inward ? wallWhite : wallOut);
  const g = G(); g.position.set(cx, 0, cz); scene.add(g);
  const solid = G(); g.add(solid);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), faces);
  m.position.y = H / 2; m.receiveShadow = true; solid.add(m);
  const decor = G(); g.add(decor);
  const n = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[inward];
  const w_ = { name, g, solid, decor, n: new THREE.Vector2(...n), c: new THREE.Vector2(cx, cz) };
  walls.push(w_); return w_;
}
const wWindow = wall('window', -L / 2 - T / 2, 0, T, W + 2 * T, '+x');
const wKitchen = wall('kitchen', 0, -W / 2 - T / 2, L, T, '+z');
const wShelf = wall('shelf', 0, W / 2 + T / 2, L, T, '-z');
const wGlass = wall('glass', L / 2 + T / 2, 0, T, W + 2 * T, '-x');

// 廚房凹槽：窗牆到 X 310 這段，牆往後退 70 cm；右邊那面大白牆是凸出來的
const AX = 313, AD = 70;
function resizeSolid(w, sx, sz, x, z) { const m = w.solid.children[0]; m.geometry.dispose(); m.geometry = new THREE.BoxGeometry(sx, H, sz); m.position.x = x; m.position.z = z; }
resizeSolid(wKitchen, cm(1000 - AX), T, PX((AX + 1000) / 2) + T, 0);
const WINDOWS = [[40, 245], [255, 460]], WY0 = 0.95, WY1 = 2.75;
// 窗牆拆成窗洞以外的幾塊（Z 單位公分；y 公尺）
function windowWallPieces() {
  const zA = -AD - T * 100, zB = 500 + T * 100, out = [];
  let z = zA;
  for (const [z0, z1] of WINDOWS) { out.push([z, z0, 0, H]); out.push([z0, z1, 0, WY0], [z0, z1, WY1, H]); z = z1; }
  out.push([z, zB, 0, H]);
  return out.filter(([a, b]) => b > a);
}
{
  const faces = ['+x', '-x', '+y', '-y', '+z', '-z'].map(f => f === '+x' ? wallWhite : wallOut);
  wWindow.solid.clear();
  for (const [z0, z1, y0, y1] of windowWallPieces()) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(T, y1 - y0, cm(z1 - z0)), faces);
    m.position.set(0, (y0 + y1) / 2, PZ((z0 + z1) / 2)); m.receiveShadow = true; wWindow.solid.add(m);
  }
}
const wAlcove = wall('alcove', PX(AX / 2) - T / 2, PZ(-AD) - T / 2, cm(AX) + T, T, '+z');
const wAlcoveSide = wall('alcoveSide', PX(AX) + T / 2, PZ(-AD / 2) - T / 2, T, cm(AD) + T, '-x');
wAlcoveSide.cutWith = wKitchen; // 跟著廚房那面牆一起切
wAlcoveSide.solid.children[0].material[4] = wallWhite; // 凸牆朝房間的那個側面
{
  const f = new THREE.Mesh(new THREE.PlaneGeometry(cm(AX), cm(AD)), floor.material);
  f.rotation.x = -Math.PI / 2; f.position.set(PX(AX / 2), 0, PZ(-AD / 2)); f.receiveShadow = true; scene.add(f);
  B(cm(AX) + 0.2, 0.115, cm(AD) + 0.2, M('#d4d1cb'), PX(AX / 2), -0.12, PZ(-AD / 2)).castShadow = false;
}

// 影子牆：看不見，但永遠全高，俯瞰時牆被切低也照樣擋光（屋頂也是）
const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const shadowCasters = G(); scene.add(shadowCasters);
function caster(geo, x, y, z, mat = shadowOnly, parent = shadowCasters) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
for (const w of walls) if (w !== wWindow && w !== wGlass) {
  const src = w.solid.children[0];
  caster(src.geometry, w.g.position.x + src.position.x, H / 2, w.g.position.z + src.position.z);
}
caster(new THREE.BoxGeometry(T, H, W + 2 * T), L / 2 + T / 2, H / 2, 0);
for (const [z0, z1, y0, y1] of windowWallPieces())
  caster(new THREE.BoxGeometry(T, y1 - y0, cm(z1 - z0)), -L / 2 - T / 2, (y0 + y1) / 2, PZ((z0 + z1) / 2));
caster(new THREE.BoxGeometry(L + 2 * T, 0.2, cm(500 + AD) + 2 * T), 0, H + 0.1, PZ((500 - AD) / 2));

// 1 米高的白色腰線
function ledge(w, from, to) {
  const len = cm(to - from), mid = cm((from + to) / 2);
  if (w === wKitchen) B(len, 0.04, 0.03, wallWhite, mid - L / 2, 1.0, T / 2 + 0.015, w.decor);
  if (w === wShelf) B(len, 0.04, 0.03, wallWhite, mid - L / 2, 1.0, -T / 2 - 0.015, w.decor);
}
ledge(wKitchen, AX, 660); ledge(wKitchen, 800, 1000); ledge(wShelf, 0, 1000);
// 踢腳
B(cm(1000 - AX), 0.08, 0.012, M('#e2dfd9'), PX((AX + 1000) / 2), 0, T / 2 + 0.006, wKitchen.decor);
B(L, 0.08, 0.012, M('#e2dfd9'), 0, 0, -(T / 2 + 0.006), wShelf.decor);

// 天花板（只在走進去時顯示）＋梁＋軌道燈
const ceiling = G(); scene.add(ceiling);
const trackWhite = M('#eceae4', { roughness: 0.5 }); // 軌道燈跟天花板同色系
{
  const c = new THREE.Mesh(new THREE.PlaneGeometry(L, W), M('#f4f3ef', { roughness: 0.95 }));
  c.rotation.x = Math.PI / 2; c.position.y = H; ceiling.add(c);
  const ca = new THREE.Mesh(new THREE.PlaneGeometry(cm(AX), cm(AD)), c.material);
  ca.rotation.x = Math.PI / 2; ca.position.set(PX(AX / 2), H, PZ(-AD / 2)); ceiling.add(ca);
  B(cm(AX), 0.45, 0.25, wallWhite, PX(AX / 2), H - 0.45, PZ(-8), ceiling); // 凹槽口上方的梁
  for (const X of [250, 500, 750]) { const b = B(0.3, 0.4, W, wallWhite, PX(X), H - 0.4, 0, ceiling); b.castShadow = false; }
  for (const Z of [120, 380]) {
    B(L - 0.6, 0.03, 0.04, trackWhite, 0, H - 0.43, PZ(Z), ceiling);
    for (let X = 100; X < 1000; X += 160) {
      const s = CY(0.04, 0.04, 0.14, trackWhite, PX(X), H - 0.6, PZ(Z), ceiling);
      s.rotation.z = 0.5;
      const lens = CY(0.032, 0.032, 0.005, lensMat, 0, -0.071, 0, s);
    }
  }
}
for (const o of ceiling.children) o.castShadow = false;

// ---------- 窗牆：兩扇大窗、蕾絲、紗簾 ----------
{
  const d = wWindow.decor, x = T / 2 + 0.005; // 牆面在 group 內的 +x 側
  const proxy = G(); proxy.position.copy(wWindow.g.position); shadowCasters.add(proxy);
  for (const [z0, z1] of WINDOWS) {
    const w = cm(z1 - z0), zc = PZ((z0 + z1) / 2), y0 = WY0, h = WY1 - WY0;
    // 窗外的天空（只是發光的面，不擋光）
    const sky = B(0.01, h, w, windowSky, -T / 2 - 0.02, y0, zc, d); sky.castShadow = false;
    for (const t of [0, 1 / 3, 2 / 3, 1]) {
      B(0.05, h, 0.04, whiteCab, x + 0.02, y0, zc - w / 2 + t * w, d).castShadow = false;
      caster(new THREE.BoxGeometry(0.05, h, 0.04), x + 0.02, y0 + h / 2, zc - w / 2 + t * w, shadowOnly, proxy);
    }
    for (const t of [0, 0.5, 1]) {
      B(0.05, 0.04, w, whiteCab, x + 0.02, y0 + t * h - 0.02, zc, d).castShadow = false;
      caster(new THREE.BoxGeometry(0.05, 0.04, w), x + 0.02, y0 + t * h, zc, shadowOnly, proxy);
    }
    const lm = new THREE.MeshStandardMaterial({ map: lace, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.2 });
    laceMats.push(lm);
    const geo = new THREE.PlaneGeometry(w - 0.06, h - 0.06);
    const l = add(new THREE.Mesh(geo, lm), x + 0.05, y0 + h / 2, zc, d);
    l.rotation.y = Math.PI / 2; l.castShadow = false;
  }
  // 紗簾（波浪形）
  const sheer = new THREE.MeshStandardMaterial({ color: '#fbfaf6', transparent: true, opacity: 0.82, side: THREE.DoubleSide, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.1 });
  laceMats.push(sheer);
  for (const [zc, w] of [[30, 0.55], [250, 0.45], [470, 0.55]]) {
    const geo = new THREE.PlaneGeometry(w, 2.85, 28, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 40) * 0.035);
    geo.computeVertexNormals();
    const c = add(new THREE.Mesh(geo, sheer), x + 0.16, 0.05 + 1.425, PZ(zc), d);
    c.rotation.y = Math.PI / 2; c.castShadow = false;
  }
  const rod = CY(0.012, 0.012, W - 0.1, steel, x + 0.16, 2.92, 0, d); rod.rotation.x = Math.PI / 2; rod.position.y = 2.92;
}

// ---------- 廚房牆：廚房、白櫃、仙人掌、梯凳、雙開門 ----------
function kitchen() {
  const g = G(), len = 2.13, d = 0.6;
  RB(len, 0.84, d, 0.01, whiteCab, 0, 0.04, 0, g);
  B(len - 0.04, 0.04, d - 0.06, M('#e4e2dc'), 0, 0, -0.02, g);
  B(len + 0.02, 0.04, d + 0.02, counterWood, 0, 0.88, 0.01, g);
  // 門片與把手
  const doors = 4, dw = len / doors;
  for (let i = 0; i < doors; i++) {
    const xc = -len / 2 + dw * (i + 0.5);
    if (i === 1) continue;
    RB(dw - 0.012, 0.76, 0.02, 0.004, whiteCab, xc, 0.07, d / 2, g);
    CY(0.008, 0.008, 0.02, brass, xc + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), 0.72, d / 2 + 0.015, g).rotation.x = Math.PI / 2;
  }
  // 抽屜＋烤箱那一格
  const ox = -len / 2 + dw * 1.5;
  RB(dw - 0.012, 0.16, 0.02, 0.004, whiteCab, ox, 0.68, d / 2, g);
  B(dw - 0.04, 0.5, 0.02, steel, ox, 0.12, d / 2 + 0.005, g);
  B(dw - 0.1, 0.3, 0.01, M('#151515', { roughness: 0.15 }), ox, 0.2, d / 2 + 0.016, g);
  B(dw - 0.12, 0.015, 0.02, steel, ox, 0.55, d / 2 + 0.03, g);
  // 水槽與龍頭
  B(0.5, 0.012, 0.38, M('#e9e8e4', { roughness: 0.3 }), -len / 2 + 0.45, 0.92, 0, g);
  CY(0.012, 0.014, 0.3, steel, -len / 2 + 0.45, 0.92, -0.22, g);
  const sp = CY(0.01, 0.01, 0.16, steel, -len / 2 + 0.45, 1.2, -0.15, g); sp.rotation.x = Math.PI / 2; sp.position.y = 1.21;
  // 層板、畫、時鐘
  B(0.8, 0.03, 0.2, whiteCab, -0.25, 1.55, -0.2, g);
  B(0.3, 0.4, 0.02, darkWood, -0.42, 1.58, -0.25, g);
  B(0.24, 0.34, 0.005, M('#fff', { map: heronArt }), -0.42, 1.61, -0.237, g);
  const clock = CY(0.11, 0.11, 0.03, M('#fbfbf8'), -0.05, 1.58, -0.22, g); clock.rotation.x = Math.PI / 2; clock.position.y = 1.69;
  // 檯面上的小盆栽、瓶罐
  const p = plant('bush', 0.9, terracotta); scene.remove(p); p.position.set(0.7, 0.92, -0.05); g.add(p);
  return g;
}
function plant(kind, s = 1, potMat = potWhite) {
  const g = G();
  const potH = kind === 'fig' ? 0.34 : 0.24;
  g.userData.foot = 0.14 * s;
  CY(0.13 * s, 0.1 * s, potH * s, potMat, 0, 0, 0, g);
  if (kind === 'bush') {
    const geo = new THREE.SphereGeometry(0.07 * s, 7, 5);
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 6.3, up = rnd(), r = (0.04 + rnd() * 0.13) * s * (1 - up * 0.5);
      const m = add(new THREE.Mesh(geo, rnd() > .45 ? leaf : leafDark), Math.cos(a) * r, (potH + 0.03 + up * 0.3) * s, Math.sin(a) * r, g);
      m.scale.set(1, 0.16, 1.7); m.rotation.set(-0.6 - (1 - up) * 0.6, a + Math.PI / 2, 0, 'YXZ');
    }
  } else if (kind === 'fig') {
    CY(0.012 * s, 0.018 * s, 1.3 * s, darkWood, 0, potH * s, 0, g);
    for (let i = 0; i < 34; i++) {
      const y = (0.6 + rnd() * 1.05) * s, a = rnd() * 6.3, r = (0.08 + rnd() * 0.18) * s;
      const m = add(new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 7, 5), rnd() > .5 ? leaf : leafDark), Math.cos(a) * r, y, Math.sin(a) * r, g);
      m.scale.set(1, 0.18, 1.5); m.rotation.set(rnd() - .5, a, rnd() - .5);
    }
  } else if (kind === 'cactus') {
    const cm_ = M('#4f6f45', { roughness: 0.8, flatShading: true });
    CY(0.05 * s, 0.055 * s, 1.0 * s, cm_, 0, potH * s, 0, g, 8);
    for (const [x, y, h] of [[0.09, 0.55, 0.35], [-0.09, 0.7, 0.3], [0.07, 0.9, 0.25]]) {
      CY(0.035 * s, 0.035 * s, h * s, cm_, x * s, y * s, 0, g, 8);
      const arm = CY(0.03 * s, 0.03 * s, 0.09 * s, cm_, x / 2 * s, y * s, 0, g, 8); arm.rotation.z = Math.PI / 2;
    }
  }
  scene.add(g); return g;
}
{
  // 廚房左端離窗牆 20 cm（長 213 cm → X 20～233）
  const k = kitchen(); place(k, 20 + 106.5, -AD + 30);
  // 廚房吊燈
}
{
  // 白色矮台：在廚房右邊、靠凹槽後牆，和廚房相隔 30 cm（X 263～313）
  const g = G(); B(0.5, 0.85, 0.55, wallWhite, 0, 0, 0, g);
  CY(0.16, 0.13, 0.08, M('#b98f5c'), 0, 0.85, 0, g);
  place(g, 233 + 30 + 25, -AD + 27.5);
  item('cactus', '仙人掌', plant('cactus', 1), 300, 18);
  const st = G();
  for (const [x, z] of [[-0.17, -0.12], [0.17, -0.12], [-0.17, 0.12], [0.17, 0.12]]) {
    const leg = B(0.03, 0.6, 0.03, M('#c9a46a'), x, 0, z, st); leg.rotation.x = z > 0 ? -0.08 : 0.08;
  }
  B(0.4, 0.03, 0.32, M('#c9a46a'), 0, 0.58, 0, st); B(0.4, 0.025, 0.06, M('#c9a46a'), 0, 0.28, 0.08, st);
  item('stepStool', '木梯凳', st, 485, 30, 0, 'seat');
}
// 雙開門、門墊、白門、鞋櫃
{
  const d = wKitchen.decor, z = T / 2 + 0.01, xc = PX(729);
  B(1.3, 2.3, 0.04, M('#2f2b28'), xc, 0, z, d);
  for (const s of [-1, 1]) {
    B(0.6, 2.2, 0.05, M('#3b2420', { roughness: 0.5 }), xc + s * 0.305, 0, z + 0.01, d);
    B(0.02, 0.16, 0.03, steel, xc + s * 0.05, 1.0, z + 0.05, d);
  }
  B(0.06, 0.14, 0.03, black, xc + 0.08, 1.15, z + 0.05, d);
  // 牆上管線與開關
  CY(0.012, 0.012, H - 0.3, wallWhite, PX(640), 0.3, z + 0.02, d);
  B(0.08, 0.1, 0.04, M('#888'), PX(640), 1.3, z + 0.02, d);
  B(0.85, 2.1, 0.04, whiteCab, PX(880), 0, z, d);
  CY(0.01, 0.01, 0.12, steel, PX(880) - 0.33, 1.0, z + 0.06, d).rotation.z = Math.PI / 2;
  const mat = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.012, 0.75), M('#fff', { map: doormat }));
  add(mat, xc, 0.006, PZ(45));
  const cub = G(); RB(0.42, 1.1, 0.32, 0.005, whiteCab, 0, 0, 0, cub);
  for (let i = 0; i < 4; i++) B(0.36, 0.2, 0.01, M(['#355d8a', '#9a3b3b', '#d8d3c8', '#36454f'][i]), 0, 0.1 + i * 0.25, 0.155, cub);
  item('shoeRack', '白色鞋櫃', cub, 960, 25);
}

// ---------- 窗邊：沙發、灰地毯、角落盆栽 ----------
function sofa() {
  const g = G(), w = 2.2, d = 0.9, fab = M('#d6d1c6', { roughness: 0.95 });
  for (const [x, z] of [[-1, -.35], [1, -.35], [-1, .35], [1, .35]]) CY(0.02, 0.015, 0.12, wood, x, 0, z, g, 8);
  RB(w, 0.3, d, 0.05, fab, 0, 0.12, 0, g);
  RB(w, 0.5, 0.22, 0.06, fab, 0, 0.32, -0.34, g);
  for (const s of [-1, 1]) RB(0.2, 0.32, d, 0.06, fab, s * 1.0, 0.36, 0, g);
  for (const s of [-1, 1]) RB(0.9, 0.14, 0.66, 0.06, fab, s * 0.45, 0.42, 0.08, g);
  for (const s of [-1, 1]) { const c = RB(0.88, 0.4, 0.16, 0.07, fab, s * 0.45, 0.5, -0.2, g); c.rotation.x = -0.12; }
  const p1 = RB(0.42, 0.42, 0.12, 0.06, M('#f7f5f0', { roughness: 1 }), -0.55, 0.52, -0.06, g); p1.rotation.set(-0.25, 0.15, 0.1);
  const p2 = RB(0.4, 0.4, 0.12, 0.06, M('#fff', { map: checks, roughness: 1 }), 0.55, 0.52, -0.06, g); p2.rotation.set(-0.25, -0.15, -0.08);
  return g;
}
item('sofa', '沙發', sofa(), 58, 285, Math.PI / 2);
{
  const r = G(); add(new THREE.Mesh(new THREE.BoxGeometry(cm(203), 0.012, cm(303)), M('#fff', { map: greyRug, roughness: 1 })), 0, 0.006, 0, r);
  item('rugGrey', '灰色地毯', r, 205, 280, 0, 'rug');
}
item('plantWin', '盆栽（窗邊）', plant('bush', 1.3), 30, 465);
item('plantKit', '盆栽（廚房旁）', plant('bush', 1.1), 30, 40);

// ---------- 中間：條紋地毯、餐桌、四張椅子 ----------
{
  const r = G(); add(new THREE.Mesh(new THREE.BoxGeometry(cm(274), 0.012, cm(211)), M('#fff', { map: stripes, roughness: 1 })), 0, 0.006, 0, r);
  item('rugStripe', '條紋地毯', r, 500, 254, 0, 'rug');
}
function diningTable() {
  const g = G(), w = 1.6, d = 0.95, r = 0.38;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2); s.lineTo(w / 2 - r, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r); s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2); s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); s.lineTo(-w / 2, -d / 2 + r); s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 16 });
  geo.rotateX(-Math.PI / 2);
  add(new THREE.Mesh(geo, wood), 0, 0.71, 0, g);
  B(w - 0.3, 0.07, d - 0.3, wood, 0, 0.64, 0, g);
  for (const [x, z] of [[-.6, -.3], [.6, -.3], [-.6, .3], [.6, .3]]) CY(0.028, 0.018, 0.71, wood, x, 0, z, g, 10);
  const p = plant('bush', 0.55, potWhite); scene.remove(p); p.position.set(0.05, 0.75, 0); g.add(p);
  CY(0.035, 0.03, 0.14, M('#25483a'), 0.4, 0.75, -0.05, g);
  CY(0.036, 0.036, 0.02, M('#f2f2f2'), 0.4, 0.89, -0.05, g);
  return g;
}
function chair(style, seatColor) {
  const g = G(), seat = M(seatColor, { roughness: 0.9 });
  for (const [x, z] of [[-.19, -.18], [.19, -.18], [-.19, .18], [.19, .18]]) CY(0.015, 0.013, 0.44, wood, x, 0, z, g, 8);
  RB(0.46, 0.06, 0.44, 0.02, style === 'up' ? seat : wood, 0, 0.42, 0, g);
  if (style === 'spindle') RB(0.4, 0.03, 0.38, 0.015, seat, 0, 0.48, 0.01, g);
  if (style === 'up') {
    const b = RB(0.44, 0.4, 0.06, 0.03, seat, 0, 0.55, -0.2, g); b.rotation.x = -0.1;
    for (const x of [-.19, .19]) CY(0.014, 0.014, 0.42, wood, x, 0.46, -0.21, g, 8);
  } else {
    for (const x of [-.2, .2]) CY(0.014, 0.014, 0.5, wood, x, 0.46, -0.2, g, 8);
    for (let i = -2; i <= 2; i++) CY(0.007, 0.007, 0.36, wood, i * 0.07, 0.48, -0.2, g, 6);
    RB(0.46, 0.08, 0.035, 0.015, wood, 0, 0.88, -0.2, g);
  }
  return g;
}
item('table', '餐桌', diningTable(), 515, 255, 0, 'table');
item('chair1', '黃色椅子', chair('up', '#c3a12b'), 470, 180, 0, 'seat');
item('chair2', '藍椅墊木椅', chair('spindle', '#3d5878'), 560, 180, 0, 'seat');
item('chair3', '木椅', chair('spindle', '#7a4e2d'), 470, 332, Math.PI, 'seat');
item('chair4', '黃色椅子 2', chair('up', '#c3a12b'), 560, 332, Math.PI, 'seat');

// ---------- 書櫃那面牆：矮櫃、琴葉榕、書櫃、角落書桌組 ----------
function sideboard() {
  const g = G(), w = 1.9, d = 0.45;
  for (const [x, z] of [[-.88, -.18], [.88, -.18], [-.88, .18], [.88, .18]]) CY(0.02, 0.012, 0.16, wood, x, 0, z, g, 8);
  RB(w, 0.6, d, 0.01, wood, 0, 0.16, 0, g);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + w / 4 * (i + 0.5);
    RB(w / 4 - 0.012, 0.54, 0.015, 0.004, M('#93613a', { roughness: 0.5 }), x, 0.19, d / 2, g);
    B(0.08, 0.012, 0.012, brass, x, 0.68, d / 2 + 0.01, g);
  }
  const p = plant('bush', 0.75); scene.remove(p); p.position.set(-0.55, 0.76, 0); g.add(p);
  B(0.32, 0.42, 0.025, darkWood, 0.45, 0.76, -0.15, g).rotation.x = -0.12;
  B(0.26, 0.36, 0.005, M('#fff', { map: heronArt }), 0.45, 0.79, -0.13, g).rotation.x = -0.12;
  return g;
}
// 北歐中古柚木書桌櫃：下方三抽、前凸的書寫桌面、上方開放層架，側板從桌面往上內凹收窄
// 原點在背面中間（貼牆那側），正面朝 +Z
const tambour = canvasTex(64, 16, (g, w, h) => {
  for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? '#9a5a2c' : '#7e4520'; g.fillRect(x, 0, 4, h); }
}, [6, 1]);
function bureau() {
  const g = G(), w = 0.92, teak = M('#a4642f', { roughness: 0.45 }), teakDark = M('#9c5a2a', { roughness: 0.5 });
  const legH = 0.24, chestTop = 0.86, dLow = 0.42, dUp = 0.26, top = 1.92;
  // 外八的錐形腳
  for (const [x, z] of [[-.38, .06], [.38, .06], [-.38, .36], [.38, .36]]) {
    const l = CY(0.022, 0.014, legH + 0.02, teak, x, 0, z, g, 10);
    l.rotation.set((z > .2 ? 1 : -1) * 0.08, 0, (x > 0 ? -1 : 1) * 0.08);
  }
  // 下方抽屜櫃
  RB(w, chestTop - legH, dLow, 0.008, teak, 0, legH, dLow / 2, g);
  const drawerH = [0.15, 0.2, 0.2];
  let y = chestTop - 0.035;
  for (const h of drawerH) {
    y -= h;
    RB(w - 0.04, h - 0.012, 0.014, 0.004, M('#ad6c35', { roughness: 0.45 }), 0, y + 0.006, dLow + 0.007, g);
    for (const x of h === 0.15 ? [-0.3, 0.3] : [0.22]) B(0.08, 0.018, 0.01, M('#2b211b'), x, y + h - 0.045, dLow + 0.016, g);
  }
  // 書寫桌面（往前凸一點）
  RB(w + 0.02, 0.026, dLow + 0.05, 0.008, teak, 0, chestTop, (dLow + 0.05) / 2, g);
  // 上方：側板（內凹曲線）、背板、層板
  const side = new THREE.Shape();
  side.moveTo(0, 0); side.lineTo(dLow - 0.02, 0);
  side.quadraticCurveTo(dUp + 0.01, 0.02, dUp, 0.3);
  side.lineTo(dUp, top - chestTop - 0.03); side.quadraticCurveTo(dUp, top - chestTop, dUp - 0.03, top - chestTop);
  side.lineTo(0, top - chestTop); side.lineTo(0, 0);
  const sideGeo = new THREE.ExtrudeGeometry(side, { depth: 0.022, bevelEnabled: false, curveSegments: 16 });
  sideGeo.rotateY(-Math.PI / 2);
  for (const sx of [-1, 1]) add(new THREE.Mesh(sideGeo, teak), sx * (w / 2 - 0.011) + 0.011, chestTop + 0.026, 0, g);
  B(w - 0.04, top - chestTop, 0.012, teakDark, 0, chestTop, 0.006, g);
  B(w - 0.02, 0.02, dUp - 0.01, teak, 0, top - 0.02, (dUp - 0.01) / 2, g);
  for (const sy of [1.43, 1.66]) B(w - 0.044, 0.018, dUp - 0.03, teak, 0, sy, (dUp - 0.03) / 2, g);
  // 下段的捲簾門（直條紋）和它上面那層比較深的層板
  B(w - 0.044, 0.018, dUp + 0.02, teak, 0, 1.17, (dUp + 0.02) / 2, g);
  B(w - 0.12, 0.26, 0.01, M('#fff', { map: tambour, roughness: 0.5 }), 0.03, chestTop + 0.03, dUp - 0.06, g);
  // 擺飾：書、黃色檯燈、鐵絲籃、杯子
  // 一排排直立的書（最後一本斜靠），x0～x1 是這排的範圍，maxH 是層板間距
  const bookCols = ['#7d2e2e', '#2f4a5e', '#d8cfbf', '#4d5a3a', '#b9893f', '#30302e', '#8c6a4f', '#c4b59a', '#5b6f7f'];
  const bookRow = (x0, x1, y, maxH) => {
    let x = x0;
    while (x < x1 - 0.03) {
      const bw = 0.022 + rnd() * 0.022, bh = maxH * (0.72 + rnd() * 0.22), bd = 0.15 + rnd() * 0.04;
      B(bw, bh, bd, M(bookCols[(rnd() * bookCols.length) | 0], { roughness: 0.8 }), x + bw / 2, y, 0.02 + bd / 2, g);
      x += bw + 0.002;
    }
    const lean = B(0.026, maxH * 0.8, 0.17, M(bookCols[(rnd() * bookCols.length) | 0], { roughness: 0.8 }), x + 0.05, y, 0.105, g);
    lean.rotation.z = -0.32; lean.position.x = x + 0.045;
  };
  bookRow(-0.25, 0.32, 1.688, 0.2);   // 最上層（左邊留給小盆栽）
  bookRow(-0.4, 0.12, 1.448, 0.2);     // 第二層
  B(0.2, 0.035, 0.15, M('#2e2d2b'), 0.27, 1.448, 0.1, g); B(0.18, 0.03, 0.14, M('#6f8a7a'), 0.27, 1.483, 0.1, g); B(0.16, 0.028, 0.13, M('#d8cfbf'), 0.27, 1.513, 0.1, g);
  bookRow(-0.14, 0.07, 1.188, 0.2);    // 第三層，夾在鐵絲籃和黃色檯燈中間
  CY(0.045, 0.045, 0.1, M('#d9c873', { roughness: 0.6 }), 0.22, 1.188, 0.12, g, 16);
  CY(0.06, 0.06, 0.12, M('#e3d27f', { roughness: 0.6 }), 0.22, 1.29, 0.12, g, 16);
  CY(0.07, 0.06, 0.08, M('#3a3a3a', { wireframe: true }), -0.25, 1.188, 0.13, g, 10);
  CY(0.03, 0.03, 0.06, M('#f4f2ec'), -0.15, chestTop + 0.026, 0.33, g, 12);
  B(0.18, 0.015, 0.13, M('#f1ece0'), 0.1, chestTop + 0.026, 0.32, g);
  const cactus = CY(0.018, 0.02, 0.07, M('#4f6f45', { flatShading: true }), -0.32, 1.688, 0.12, g, 8);
  CY(0.03, 0.025, 0.04, potWhite, -0.32, 1.678, 0.12, g, 10);
  return g;
}
item('sideboard', '矮櫃', sideboard(), 195, 475, Math.PI);
item('fig', '琴葉榕', plant('fig', 1.15), 360, 465);
item('bureau', '柚木書桌櫃', bureau(), 528, 499, Math.PI);
{
  // 角落：老式斜面書桌、小圓几、吧檯椅、盆栽
  const desk = G();
  for (const [x, z] of [[-.5, -.2], [.5, -.2], [-.5, .2], [.5, .2]]) CY(0.02, 0.015, 0.45, darkWood, x, 0, z, desk, 8);
  B(1.1, 0.3, 0.48, M('#9a6a3c', { roughness: 0.5 }), 0, 0.45, 0, desk);
  const top = B(1.12, 0.03, 0.5, M('#b07a45', { roughness: 0.45 }), 0, 0.78, 0.0, desk); top.rotation.x = 0.12;
  const pp = plant('bush', 0.6, terracotta); scene.remove(pp); pp.position.set(-0.35, 0.8, -0.12); desk.add(pp);
  item('desk', '斜面書桌', desk, 755, 470, Math.PI, 'table');
  const rt = G(); CY(0.25, 0.25, 0.03, wood, 0, 0.55, 0, rt);
  for (let i = 0; i < 3; i++) { const l = CY(0.014, 0.014, 0.56, wood, Math.cos(i * 2.1) * 0.13, 0, Math.sin(i * 2.1) * 0.13, rt, 8); l.rotation.z = Math.cos(i * 2.1) * 0.15; }
  const rp = plant('bush', 0.6); scene.remove(rp); rp.position.set(0, 0.58, 0); rt.add(rp);
  item('sideTable', '小圓几', rt, 650, 455, 0, 'table');
  const st = G(); CY(0.17, 0.17, 0.04, wood, 0, 0.68, 0, st);
  for (let i = 0; i < 3; i++) { const l = CY(0.012, 0.012, 0.7, black, Math.cos(i * 2.1) * 0.13, 0, Math.sin(i * 2.1) * 0.13, st, 8); l.rotation.z = Math.cos(i * 2.1) * 0.15; }
  add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 24), black), 0, 0.25, 0, st).rotation.x = Math.PI / 2;
  item('barStool', '吧檯椅', st, 900, 420, 0, 'seat');
  item('plantCorner', '盆栽（角落）', plant('bush', 1.2), 860, 470);
}

// ---------- 倉庫裡的家具（一開始收著） ----------
{
  // 一體式單人床：97 × 195 cm，細木腳、床墊一體
  const bed = G(), fabric = M('#ddd6c9', { roughness: 0.95 }), oak = M('#c9a679', { roughness: 0.5 });
  for (const [x, z] of [[-.42, -.88], [.42, -.88], [-.42, .88], [.42, .88]]) CY(0.022, 0.018, 0.2, oak, x, 0, z, bed, 10);
  RB(0.97, 0.26, 1.95, 0.05, fabric, 0, 0.18, 0, bed);
  B(0.95, 0.008, 1.93, M('#cfc7b8', { roughness: 1 }), 0, 0.3, 0, bed);
  RB(0.62, 0.1, 0.38, 0.05, M('#f6f4ef', { roughness: 1 }), 0, 0.44, -0.72, bed);
  RB(0.99, 0.07, 0.6, 0.03, M('#c3c9cf', { roughness: 1 }), 0, 0.44, 0.62, bed);
  item('bed', '一體式單人床', bed, 500, 250, 0, '', true);
  // 懶骨頭：65 × 65 × 43 cm，深咖啡，上面坐出一個凹
  const geo = new RoundedBoxGeometry(0.65, 0.43, 0.65, 5, 0.17);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z);
    if (y > 0.1) pos.setY(i, y - 0.07 * Math.max(0, 1 - r / 0.3) * (y - 0.1) / 0.115);
    pos.setX(i, x * (1 + 0.05 * (0.2 - y))); pos.setZ(i, z * (1 + 0.05 * (0.2 - y)));
  }
  geo.computeVertexNormals();
  const bean = G(); add(new THREE.Mesh(geo, M('#4a3426', { roughness: 0.95 })), 0, 0.215, 0, bean);
  item('beanbag', '深咖啡懶骨頭', bean, 500, 250, 0, 'seat', true);

  // 粉紅摺疊矽膠寵物碗：一圈圈往外擴的碗身、黑色碗緣、裡面幾顆飼料
  const bowl = G(), pinkM = M('#f08aa6', { roughness: 0.55, side: THREE.DoubleSide });
  const prof = [[0, 0.002], [0.075, 0.002], [0.078, 0.014], [0.084, 0.018], [0.088, 0.032], [0.095, 0.036], [0.1, 0.05], [0.104, 0.058]].map(([x, y]) => new THREE.Vector2(x, y));
  add(new THREE.Mesh(new THREE.LatheGeometry(prof, 40), pinkM), 0, 0, 0, bowl);
  const rim = add(new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.009, 8, 40), M('#1c1c1c', { roughness: 0.4 })), 0, 0.06, 0, bowl); rim.rotation.x = Math.PI / 2;
  const tab = B(0.03, 0.012, 0.025, M('#1c1c1c'), 0, 0.054, -0.12, bowl);
  for (let i = 0; i < 12; i++) { const a = rnd() * 6.3, r = rnd() * 0.055; add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.008, 0), M('#8a5528', { flatShading: true })), Math.cos(a) * r, 0.01, Math.sin(a) * r, bowl); }
  item('bowl', '粉紅寵物碗', bowl, 150, 420, 0, 'bowl', true);
}

// ---------- 博美：蓬蓬的橘棕色長毛，尾巴一大團捲在背上 ----------
function fluff(r, jitter = 0.18, detail = 1) {
  let geo = new THREE.IcosahedronGeometry(r, detail);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + (rnd() - 0.5) * 2 * jitter); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); return geo;
}
const dog = (() => {
  const g = G(), rig = G(); g.add(rig);
  const fur = M('#b8662c', { roughness: 0.95, flatShading: true }), furLight = M('#d79a5c', { roughness: 0.95, flatShading: true });
  const furDark = M('#7a3f1c', { roughness: 0.9, flatShading: true }), black = M('#141414', { roughness: 0.3 });
  const body = add(new THREE.Mesh(fluff(0.12, 0.16), fur), 0, 0.19, -0.01, rig); body.scale.set(0.95, 0.9, 1.35);
  const mane = add(new THREE.Mesh(fluff(0.12, 0.2), furLight), 0, 0.22, 0.09, rig); mane.scale.set(1.05, 1, 0.85);
  const headPivot = G(); headPivot.position.set(0, 0.26, 0.14); rig.add(headPivot);
  const head = add(new THREE.Mesh(fluff(0.085, 0.14), fur), 0, 0.04, 0.06, headPivot);
  add(new THREE.Mesh(fluff(0.04, 0.1), furLight), 0, 0.015, 0.13, headPivot).scale.set(1, 0.85, 1.1);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), black), 0, 0.025, 0.172, headPivot);
  const eyes = [-1, 1].map(sx => add(new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), black), sx * 0.037, 0.058, 0.122, headPivot));
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 4), M('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 })), sx * 0.037 + 0.006, 0.066, 0.137, headPivot); // 眼睛反光
  for (const sx of [-1, 1]) { const ear = add(new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.055, 6), furDark), sx * 0.045, 0.12, 0.04, headPivot); ear.rotation.z = -sx * 0.35; }
  const tailPivot = G(); tailPivot.position.set(0, 0.27, -0.15); rig.add(tailPivot);
  const tail = add(new THREE.Mesh(fluff(0.09, 0.22), furLight), 0, 0.07, 0.02, tailPivot); tail.scale.set(0.95, 0.8, 1.3); tail.rotation.x = -0.5;
  const legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
    const pv = G(); pv.position.set(sx * 0.06, 0.13, sz * 0.095); rig.add(pv);
    CY(0.022, 0.02, 0.12, fur, 0, -0.12, 0, pv, 7); add(new THREE.Mesh(fluff(0.024, 0.1, 0), furLight), 0, -0.118, 0.01, pv);
    return pv;
  });
  const it = item('dog', '博美', g, 300, 380, 0, 'pet', true);
  return { it, g, rig, headPivot, tailPivot, legs, eyes, body };
})();

// ---------- 盡頭：玻璃隔間＋門口 ----------
{
  const d = wGlass.decor;
  const x = 0, frame = whiteCab;
  const glassM = new THREE.MeshPhysicalMaterial({ color: '#dfe8ea', transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, side: THREE.DoubleSide });
  const solid = wGlass.solid; solid.clear(); // 這面改由隔間組成
  // 門口上方與兩側實牆
  const wm = ['+x', '-x', '+y', '-y', '+z', '-z'].map(f => f === '-x' ? wallWhite : wallOut);
  const piece = (z0, z1, y0, y1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(T, y1 - y0, cm(z1 - z0)), wm); m.position.set(x, (y0 + y1) / 2, PZ((z0 + z1) / 2)); m.castShadow = m.receiveShadow = true; solid.add(m); };
  piece(-20, 25, 0, H); piece(135, 150, 0, H); piece(25, 135, 2.2, H); piece(150, 520, 2.6, H); piece(150, 520, 0, 0.9);
  B(T, 0.04, cm(370), frame, x, 0.9, PZ(335), solid);
  B(0.02, 1.7, cm(370), glassM, x, 0.9, PZ(335), solid).castShadow = false;
  for (let Z = 150; Z <= 520; Z += 92.5) B(0.06, 1.7, 0.05, frame, x, 0.9, PZ(Z), solid);
  B(0.06, 0.05, cm(370), frame, x, 2.2, PZ(335), solid);
  // 門口外：另一個房間的暗面
  B(0.02, 2.2, 1.1, M('#6d655c', { roughness: 1 }), 0.9, 0, PZ(80), d);
}

// ---------- 吊燈 ----------
function pendant(X, Z, drop, kind) {
  const g = G(); g.position.set(PX(X), H, PZ(Z));
  CY(0.004, 0.004, drop, black, 0, -drop, 0, g, 6).castShadow = false;
  const bulb = bulbMat;
  if (kind === 'black') {
    const s = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.13, 0.16, 24, 1, true), M('#1d1d1d', { side: THREE.DoubleSide, roughness: 0.4 })), 0, -drop - 0.08, 0, g);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), bulb), 0, -drop - 0.13, 0, g);
  } else {
    const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 28, 12, 0, 6.3, 0, 1.2), M('#d9dbdd', { metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide })), 0, -drop - 0.28, 0, g);
    CY(0.05, 0.05, 0.12, steel, 0, -drop - 0.12, 0, g);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), bulb), 0, -drop - 0.32, 0, g);
  }
  g.traverse(o => o.castShadow = false);
  const l = new THREE.PointLight('#ffd9a0', 1.2, 4, 2); l.position.y = -drop - 0.25; g.add(l); lamps.push(l);
  scene.add(g); return g;
}
pendant(155, -15, 1.0, 'black');
pendant(250, 300, 1.05, 'black');
pendant(515, 255, 0.75, 'silver');

// ---------- 光線（日期、時間、天氣） ----------
const WEATHER = {
  clear: { sun: 1, sky: 1, ext: 1, overcast: 0 },
  haze: { sun: 0.5, sky: 1.15, ext: 1.8, overcast: 0.45 },
  overcast: { sun: 0, sky: 0.9, ext: 2, overcast: 1 },
};
const D2R = Math.PI / 180, today = new Date();
const q = new URLSearchParams(location.search);
const state = {
  doy: +q.get('d') || mdToDoy(today.getMonth() + 1, today.getDate()),
  t: q.has('t') ? +q.get('t') : 10.5,
  w: WEATHER[q.get('w')] ? q.get('w') : 'clear',
  face: q.has('f') ? +q.get('f') : FACE,
  ev: +q.get('ev') || 0,
  lamps: q.get('l') || 'auto',
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sunDir = new THREE.Vector3(), OUT = new THREE.Vector3(-1, 0, 0);
const SKY_DAY = new THREE.Color('#e8f0f6'), SKY_LOW = new THREE.Color('#ffd9b5'), SKY_TWI = new THREE.Color('#5a6894'), SKY_GREY = new THREE.Color('#e4e6e8');
const HEMI_DAY = new THREE.Color('#fff8ee'), HEMI_NIGHT = new THREE.Color('#8e97b8');
let light = { el: 0, az: 0, enters: false, lampsOn: false }, skyN = 1;

function updateLight() {
  const { el, az } = solar(state.doy, state.t, LAT, LON, TZ);
  const Wt = WEATHER[state.w];
  // 窗牆朝外（-X）就是 state.face 這個方位；太陽方位換成場景方向
  const phi = (az - state.face + 270) * D2R, e = el * D2R;
  sunDir.set(Math.cos(e) * Math.sin(phi), Math.sin(e), -Math.cos(e) * Math.cos(phi));
  // 太陽越低，穿過的大氣越厚：越暖、越暗
  const eC = Math.max(el, 0.5), am = 1 / (Math.sin(eC * D2R) + 0.50572 * Math.pow(eC + 6.07995, -1.6364));
  const tr = [0.05, 0.095, 0.21].map(v => Math.exp(-v * Wt.ext * (am - 1)));
  const lum = 0.2126 * tr[0] + 0.7152 * tr[1] + 0.0722 * tr[2], mx = Math.max(...tr);
  sun.color.setRGB(tr[0] / mx, tr[1] / mx, tr[2] / mx);
  sun.intensity = 6 * Wt.sun * lum * smooth(-0.8, 2, el);
  sun.visible = sun.intensity > 0.002;
  sun.position.copy(sunDir).multiplyScalar(20);
  // 天光
  const facing = Math.max(0, sunDir.dot(OUT)) * smooth(0, 5, el);
  skyN = Math.pow(Math.max(0, Math.sin(e)), 0.6) * Wt.sky + 0.05 * smooth(-8, 2, el);
  const skyCol = SKY_DAY.clone().lerp(SKY_LOW, smooth(25, 2, el) * 0.7).lerp(SKY_TWI, smooth(2, -5, el)).lerp(SKY_GREY, Wt.overcast * smooth(-4, 3, el));
  windowSky.color.copy(skyCol).multiplyScalar(Math.min(1, 0.25 + skyN * (1 + 0.5 * facing * Wt.sun)));
  hemi.intensity = 0.12 + 0.42 * skyN + 0.15 * Wt.overcast * skyN;
  hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, smooth(0.05, 0.5, skyN));
  scene.environmentIntensity = 0.1 + 0.32 * skyN;
  for (const m of laceMats) { m.emissive.copy(skyCol).lerp(sun.color, facing * 0.5); m.emissiveIntensity = 0.05 + 0.3 * skyN * (1 + facing * Wt.sun); }
  // 室內燈
  const lampsOn = state.lamps === 'on' || (state.lamps === 'auto' && skyN < 0.3);
  for (const l of lamps) l.visible = lampsOn;
  bulbMat.emissiveIntensity = lampsOn ? 3 : 0; lensMat.emissiveIntensity = lampsOn ? 2 : 0;
  light = { el, az, enters: el > 0 && facing > 0.02 && Wt.sun > 0, lampsOn };
  updateInfo();
}

const $ = id => document.getElementById(id);
const hm = h => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const season = doy => ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'][doyToMD(doy)[0] - 1];
function updateInfo() {
  const [m, d] = doyToMD(state.doy);
  $('vDate').textContent = `${m} 月 ${d} 日 · ${season(state.doy)}`;
  $('vTime').textContent = hm(state.t);
  $('vFace').textContent = `${compassName(state.face)} ${state.face}°`;
  $('vEv').textContent = (state.ev > 0 ? '+' : '') + state.ev.toFixed(1) + ' EV';
  const { rise, set } = sunTimes(state.doy, LAT, LON, TZ);
  const { el, az, enters, lampsOn } = light;
  let status;
  if (el < -6) status = '夜間';
  else if (el < 0) status = '日落後／日出前的藍調時刻';
  else if (state.w === 'overcast') status = '陰天：整片柔和的散射光，沒有影子';
  else if (enters) status = '<span class="hit">☀ 陽光直射進窗</span>';
  else status = '太陽不在窗這一側：只有窗外天光';
  $('info').innerHTML = `太陽高度 ${el.toFixed(0)}° · 方位 ${compassName(az)} ${az.toFixed(0)}°<br>日出 ${rise ? hm(rise) : '—'} · 日落 ${set ? hm(set) : '—'}${lampsOn ? ' · 室內燈開' : ''}<br>${status}`;
  for (const b of document.querySelectorAll('#weather button')) b.classList.toggle('on', b.dataset.w === state.w);
  for (const b of document.querySelectorAll('#lamps button')) b.classList.toggle('on', b.dataset.l === state.lamps);
  $('date').value = state.doy; $('time').value = state.t; $('face').value = state.face; $('ev').value = state.ev;
}
let playing = false;
$('date').oninput = e => { state.doy = +e.target.value; updateLight(); };
$('time').oninput = e => { state.t = +e.target.value; updateLight(); };
$('face').oninput = e => { state.face = +e.target.value; updateLight(); };
$('ev').oninput = e => { state.ev = +e.target.value; updateInfo(); };
for (const b of document.querySelectorAll('[data-doy]')) b.onclick = () => {
  state.doy = b.dataset.doy === 'today' ? mdToDoy(today.getMonth() + 1, today.getDate()) : +b.dataset.doy; updateLight();
};
for (const b of document.querySelectorAll('#weather button')) b.onclick = () => { state.w = b.dataset.w; updateLight(); };
for (const b of document.querySelectorAll('#lamps button')) b.onclick = () => { state.lamps = b.dataset.l; updateLight(); };
$('now').onclick = () => { const d = new Date(); state.doy = mdToDoy(d.getMonth() + 1, d.getDate()); state.t = Math.min(20, Math.max(4.5, d.getHours() + d.getMinutes() / 60)); updateLight(); };
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚ 暫停' : '▶ 播放一天'; if (playing && state.t >= 19.9) state.t = 5; };
$('panelBtn').onclick = () => document.body.classList.toggle('panelClosed');
$('panelClose').onclick = () => document.body.classList.add('panelClosed');
if (matchMedia('(max-width:700px)').matches) document.body.classList.add('panelClosed');
updateLight();

// ---------- 視角控制 ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0.3, 0.6, 0);
orbit.minDistance = 4; orbit.maxDistance = 34; orbit.maxPolarAngle = 1.35;
const ORBIT_DIR = new THREE.Vector3(5.2, 9.5, 9.2);
// 直式螢幕要退遠一點才看得到整個棚
const orbitStart = () => ORBIT_DIR.clone().multiplyScalar(Math.max(1, 1.45 / camera.aspect) ** 0.85);

const EYE = 1.5, R = 0.22;
const pos = new THREE.Vector3(PX(720), EYE, PZ(150));
let yaw = Math.PI * 0.62, pitch = -0.05, mode = 'orbit';
const keys = new Set(), stick = { x: 0, y: 0 };
let tourT = 0.3, snap = true;

// 導覽路線：影片重建的相機位置換算成棚內公分（俯視圖旋轉 -17°、477 px/單位、原點與比例見 README）
const PATH = await fetch('path.json').then(r => r.json());
const ROT = -17 * Math.PI / 180;
const pathPts = [], pathQ = [];
const qRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ROT);
for (const r of PATH) {
  const xr = r[1] * Math.cos(ROT) + r[3] * Math.sin(ROT), zr = -r[1] * Math.sin(ROT) + r[3] * Math.cos(ROT);
  const X = (700 + xr * 477.5 - 185) * 0.926, Z = (500 + zr * 477.5 - 205) * 1.01;
  pathPts.push(new THREE.Vector3(PX(X), EYE, PZ(Z)));
  pathQ.push(qRot.clone().multiply(new THREE.Quaternion(r[4], r[5], r[6], r[7])));
}
const curve = new THREE.CatmullRomCurve3(pathPts.filter((_, i) => i % 4 === 0), false, 'centripetal');
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function setCut(on) {
  // 俯瞰：靠鏡頭這側的牆切低、藏天花板
  for (const w of walls) {
    const toCam = new THREE.Vector2(camera.position.x - w.c.x, camera.position.z - w.c.y);
    w.cut = on && toCam.dot(w.n) < 0;
  }
  for (const w of walls) {
    const cut = w.cutWith ? w.cutWith.cut : w.cut;
    w.g.scale.y = cut ? 0.12 : 1;
    w.decor.visible = !cut;
  }
  ceiling.visible = !on;
}
function setMode(m) {
  if (m !== 'orbit' && editing) exitEdit();
  if (mode === 'tour' && m === 'walk') {
    pos.copy(camera.position); euler.setFromQuaternion(camera.quaternion, 'YXZ'); yaw = euler.y; pitch = euler.x;
  }
  if (m === 'orbit' && mode !== 'orbit') { camera.position.copy(orbitStart()); orbit.target.set(0.3, 0.6, 0); }
  mode = m;
  camera.fov = m === 'orbit' ? 40 : 72; camera.updateProjectionMatrix();
  for (const [id, k] of [['mOrbit', 'orbit'], ['mWalk', 'walk'], ['mTour', 'tour']]) document.getElementById(id).classList.toggle('on', m === k);
  orbit.enabled = m === 'orbit';
  document.body.classList.toggle('walk', m !== 'orbit');
  document.getElementById('hOrbit').hidden = m !== 'orbit';
  document.getElementById('hWalk').hidden = m === 'orbit';
  const help = document.getElementById('help'); help.style.opacity = 1;
  clearTimeout(setMode.t); setMode.t = setTimeout(() => help.style.opacity = 0, 8000);
  setCut(m === 'orbit');
}
document.getElementById('mOrbit').onclick = () => setMode('orbit');
document.getElementById('mWalk').onclick = () => setMode('walk');
document.getElementById('mTour').onclick = () => { tourT = 0.3; snap = true; setMode('tour'); };

const el = renderer.domElement;
let drag = null;
// 手機：點一下畫面空白處就開／關光線面板；拖曳照常轉視角
// 導覽中要真的拖動才接手變成自由走，單純點一下不會打斷導覽
const narrow = () => matchMedia('(max-width:700px)').matches;
let pet = null; // 博美的行為，下面「小狗」那段建立
let tap = null, tourPress = null;
el.addEventListener('pointerdown', e => {
  tap = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (mode === 'tour') tourPress = { id: e.pointerId, x: e.clientX, y: e.clientY };
  if (mode === 'walk') { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); }
});
el.addEventListener('pointerup', e => {
  const isTap = tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && performance.now() - tap.t < 500;
  if (isTap && !editing && pet?.tapped(e)) { tap = tourPress = null; return; }
  if (isTap && narrow() && !editing) document.body.classList.toggle('panelClosed');
  tap = tourPress = null;
});
el.addEventListener('pointermove', e => {
  if (tourPress && e.pointerId === tourPress.id && Math.hypot(e.clientX - tourPress.x, e.clientY - tourPress.y) >= 10) {
    setMode('walk'); tourPress = null;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId);
  }
  if (!drag || e.pointerId !== drag.id) return;
  const k = e.pointerType === 'touch' ? 0.006 : 0.004;
  yaw -= (e.clientX - drag.x) * k; pitch = Math.max(-1.3, Math.min(1.3, pitch - (e.clientY - drag.y) * k));
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
el.addEventListener('pointerup', endDrag); el.addEventListener('pointercancel', endDrag);
el.addEventListener('wheel', e => { if (mode === 'walk') { e.preventDefault(); move(0, -Math.sign(e.deltaY) * 0.3); } }, { passive: false });
addEventListener('keydown', e => { keys.add(e.code); if (mode === 'tour' && /^(Key[WASD]|Arrow)/.test(e.code)) setMode('walk'); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
let stickId = null;
const stickMove = e => {
  const r = stickEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(dx, dy), max = r.width / 2 - 10;
  if (len > max) { dx *= max / len; dy *= max / len; }
  stick.x = dx / max; stick.y = -dy / max; knob.style.transform = `translate(${dx}px,${dy}px)`;
};
stickEl.addEventListener('pointerdown', e => { if (mode !== 'walk') setMode('walk'); stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); });
stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = e => { if (e.pointerId === stickId) { stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; } };
stickEl.addEventListener('pointerup', stickEnd); stickEl.addEventListener('pointercancel', stickEnd);

// 走路碰撞：房間邊界＋家具外框
function move(strafe, fwd) {
  pos.x += -Math.sin(yaw) * fwd + Math.cos(yaw) * strafe;
  pos.z += -Math.cos(yaw) * fwd - Math.sin(yaw) * strafe;
  for (const b of colliders) {
    if (pos.x > b.min.x - R && pos.x < b.max.x + R && pos.z > b.min.z - R && pos.z < b.max.z + R) {
      const dx1 = pos.x - (b.min.x - R), dx2 = (b.max.x + R) - pos.x, dz1 = pos.z - (b.min.z - R), dz2 = (b.max.z + R) - pos.z;
      const m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) pos.x = b.min.x - R; else if (m === dx2) pos.x = b.max.x + R; else if (m === dz1) pos.z = b.min.z - R; else pos.z = b.max.z + R;
    }
  }
  pos.x = Math.max(-L / 2 + R, Math.min(L / 2 - R, pos.x));
  pos.z = Math.max(-W / 2 + R, Math.min(W / 2 - R, pos.z));
}

// ---------- 擺設：移動、旋轉、收起、倉庫、分享擺法、拍照 ----------
const KEY = 'nikko3d.xiaoshi.layout';
const fixedColliders = colliders.slice(); // 廚房、矮台這些固定的
const D = Math.PI / 180;
function rebuildColliders() {
  colliders.length = 0; colliders.push(...fixedColliders);
  for (const it of items) if (!it.stored && it.kind !== 'rug' && it.kind !== 'pet') { it.g.updateMatrixWorld(true); colliders.push(new THREE.Box3().setFromObject(it.g)); }
  pet?.obstaclesChanged();
}
function applyItem(it) {
  it.g.position.set(PX(it.X), 0, PZ(it.Z)); it.g.rotation.y = it.r * D; it.g.visible = !it.stored;
}
// 家具在地上佔的範圍（公尺，外框；縮 1 cm 讓貼齊的東西不算撞到）
function footprint(it, X, Z, r) {
  const c = Math.cos(r * D), sn = Math.sin(r * D), b = it.local;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z]]) {
    const x = PX(X) + lx * c + lz * sn, z = PZ(Z) - lx * sn + lz * c;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0: x0 + 0.01, x1: x1 - 0.01, z0: z0 + 0.01, z1: z1 - 0.01 };
}
const ROOMS = [[-L / 2, L / 2, -W / 2, W / 2], [-L / 2, PX(AX), PZ(-AD), W / 2]]; // 主空間、含廚房凹槽那一段
const inside = (f, [a, b, c, d]) => f.x0 >= a && f.x1 <= b && f.z0 >= c && f.z1 <= d;
const hit = (f, g) => f.x0 < g.x1 && f.x1 > g.x0 && f.z0 < g.z1 && f.z1 > g.z0;
const tucks = (a, b) => (a.kind === 'seat' && b.kind === 'table') || (a.kind === 'table' && b.kind === 'seat');
function valid(it, X, Z, r) {
  const f = footprint(it, X, Z, r);
  if (!ROOMS.some(R => inside(f, R))) return false;
  if (it.kind === 'rug') return true;
  for (const b of fixedColliders) if (hit(f, { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z })) return false;
  for (const o of items) if (o !== it && !o.stored && o.kind !== 'rug' && o.kind !== 'pet' && !tucks(it, o)
    && !(it.kind === 'pet' && (o.kind === 'table' || o.kind === 'bowl')) && hit(f, footprint(o, o.X, o.Z, o.r))) return false;
  return true;
}

// 擺法 ↔ 文字：只記跟官方擺法不同的家具
function layoutDiff() {
  const d = {};
  for (const it of items) {
    if (it.kind === 'pet') { if (it.stored !== it.def.stored) d[it.id] = [it.def.X, it.def.Z, it.def.r, it.stored ? 1 : 0]; continue; }
    if (it.X !== it.def.X || it.Z !== it.def.Z || it.r !== it.def.r || it.stored !== it.def.stored) d[it.id] = [it.X, it.Z, it.r, it.stored ? 1 : 0];
  }
  return d;
}
const enc = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dec = t => JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/')))));
function applyLayout(d) {
  for (const it of items) {
    const v = d[it.id];
    Object.assign(it, v ? { X: v[0], Z: v[1], r: v[2], stored: !!v[3] } : it.def);
    applyItem(it);
  }
  rebuildColliders(); refreshStore();
  pet?.place();
}
function saveLayout() {
  try { localStorage.setItem(KEY, JSON.stringify(layoutDiff())); } catch {}
  if (location.hash.startsWith('#L=')) history.replaceState(null, '', location.pathname + location.search);
}

// ---------- 介面 ----------
const toastEl = $('toast');
function toast(html, ms = 2600) {
  toastEl.innerHTML = html; toastEl.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.hidden = true, ms);
}
let selected = null, outline = null;
function select(it) {
  if (outline) { outline.parent.remove(outline); outline = null; }
  selected = it;
  $('selBar').hidden = !it;
  if (!it) return;
  $('selName').textContent = it.name;
  // 選取框：貼在地上的四條橘線，跟著家具一起轉
  const b = it.local, o = G(), m = new THREE.MeshBasicMaterial({ color: '#e0a63a' });
  const w = b.max.x - b.min.x + 0.08, d = b.max.z - b.min.z + 0.08, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, t = 0.025;
  for (const [sx, sz, x, z] of [[w, t, cx, cz - d / 2], [w, t, cx, cz + d / 2], [t, d, cx - w / 2, cz], [t, d, cx + w / 2, cz]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.006, sz), m); bar.position.set(x, 0.02, z); o.add(bar);
  }
  it.g.add(outline = o);
}
function refreshStore() {
  const stored = items.filter(i => i.stored);
  $('storeCount').textContent = stored.length ? `（${stored.length}）` : '';
  $('storeItems').innerHTML = stored.length
    ? stored.map(i => `<button data-id="${i.id}">${i.name}<span>拿出來</span></button>`).join('')
    : '<p>倉庫是空的。選取家具後按「收起」就會放到這裡。</p>';
  for (const b of $('storeItems').querySelectorAll('button')) b.onclick = () => takeOut(items.find(i => i.id === b.dataset.id));
}
function takeOut(it) {
  // 從房間中間往外找一個放得下的空位
  for (let rad = 0; rad <= 500; rad += 25) for (let a = 0; a < 360; a += rad ? 30 : 360) {
    const X = Math.round(500 + rad * Math.cos(a * D)), Z = Math.round(250 + rad * Math.sin(a * D) * 0.5);
    for (const r of [it.r, it.r + 90]) if (valid(it, X, Z, r % 360)) {
      Object.assign(it, { X, Z, r: r % 360, stored: false }); applyItem(it);
      if (it.kind === 'pet') { rebuildColliders(); pet.place(); }
      rebuildColliders(); saveLayout(); refreshStore(); $('storeList').hidden = true; select(it);
      toast(`已拿出「${it.name}」，拖曳到想放的位置`);
      return;
    }
  }
  toast('棚裡已經沒有空位放這個了，先收起一些家具');
}
function enterEdit() {
  setMode('orbit'); editing = true; document.body.classList.add('edit');
  $('mEdit').classList.add('on'); $('editBar').hidden = false;
  document.getElementById('help').style.opacity = 1;
}
function exitEdit() {
  editing = false; select(null); document.body.classList.remove('edit');
  $('mEdit').classList.remove('on'); $('editBar').hidden = true; $('storeList').hidden = true;
  rebuildColliders();
}
$('mEdit').onclick = () => editing ? exitEdit() : enterEdit();
$('doneBtn').onclick = exitEdit;
$('storeBtn').onclick = () => { refreshStore(); $('storeList').hidden = !$('storeList').hidden; };
$('storeClose').onclick = () => $('storeList').hidden = true;
const rotate = deg => {
  if (!selected) return;
  const r = (selected.r + deg + 360) % 360;
  if (!valid(selected, selected.X, selected.Z, r)) { toast('這裡轉不開，先拖到空一點的地方再轉'); return; }
  selected.r = r; applyItem(selected); saveLayout();
};
$('rot90').onclick = () => rotate(90);
$('rot15').onclick = () => rotate(15);
$('storeIt').onclick = () => {
  if (!selected) return;
  const it = selected; it.stored = true; applyItem(it); select(null);
  rebuildColliders(); saveLayout(); refreshStore(); toast(`「${it.name}」已收進倉庫`);
};
$('resetBtn').onclick = () => {
  const b = $('resetBtn');
  if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = '確定還原？'; setTimeout(() => { delete b.dataset.armed; b.textContent = '還原'; }, 3000); return; }
  delete b.dataset.armed; b.textContent = '還原';
  select(null); applyLayout({}); saveLayout(); toast('已還原成官方擺法');
};

// 拖曳家具：在視窗的捕捉階段先處理，點到家具時就暫停轉視角
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), fp = new THREE.Vector3();
const aim = e => { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); };
let edrag = null, etap = null;
addEventListener('pointerdown', e => {
  if (!editing || e.target !== el) return;
  aim(e);
  let it = null;
  for (const h of ray.intersectObjects(items.filter(i => !i.stored).map(i => i.g), true)) {
    const u = h.object.userData.item; if (!u) continue;
    if (!it) it = u;
    if (u.kind !== 'rug') { it = u; break; }
  }
  if (!it || !ray.ray.intersectPlane(floorPlane, fp)) { etap = { x: e.clientX, y: e.clientY }; return; }
  if (it !== selected) select(it);
  orbit.enabled = false;
  edrag = { id: e.pointerId, it, dx: it.g.position.x - fp.x, dz: it.g.position.z - fp.z, moved: false };
  el.setPointerCapture(e.pointerId);
}, true);
addEventListener('pointermove', e => {
  if (!edrag || e.pointerId !== edrag.id) return;
  aim(e);
  if (!ray.ray.intersectPlane(floorPlane, fp)) return;
  const it = edrag.it;
  const X = Math.round(((fp.x + edrag.dx) + L / 2) * 20) * 5, Z = Math.round(((fp.z + edrag.dz) + W / 2) * 20) * 5; // 5 cm 一格
  // 撞到就沿著能走的那個方向滑
  for (const [x, z] of [[X, Z], [X, it.Z], [it.X, Z]]) if ((x !== it.X || z !== it.Z) && valid(it, x, z, it.r)) {
    it.X = x; it.Z = z; applyItem(it); edrag.moved = true; break;
  }
}, true);
addEventListener('pointerup', e => {
  if (edrag && e.pointerId === edrag.id) {
    if (edrag.moved) { saveLayout(); rebuildColliders(); }
    edrag = null; orbit.enabled = mode === 'orbit';
  } else if (etap && Math.hypot(e.clientX - etap.x, e.clientY - etap.y) < 10) select(null);
  etap = null;
}, true);

// ---------- 拍照、分享擺法 ----------
function snapshot() {
  const keep = outline; if (keep) keep.visible = false;
  renderer.render(scene, camera);
  const src = renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'), k = c.width / innerWidth;
  g.drawImage(src, 0, 0);
  if (keep) keep.visible = true;
  // 浮水印：棚名＋當下的日期、時間、天氣
  const [m, d] = doyToMD(state.doy), wName = { clear: '晴', haze: '薄雲', overcast: '陰天' }[state.w];
  g.fillStyle = 'rgba(255,255,255,.82)'; g.strokeStyle = 'rgba(0,0,0,.08)';
  const bx = 14 * k, by = c.height - 62 * k, bw = 230 * k, bh = 48 * k;
  g.beginPath(); g.roundRect(bx, by, bw, bh, 10 * k); g.fill(); g.stroke();
  g.fillStyle = '#2a2826'; g.font = `600 ${15 * k}px -apple-system, "PingFang TC", sans-serif`;
  g.fillText('nikkohaus 日光小室', bx + 12 * k, by + 20 * k);
  g.fillStyle = 'rgba(42,40,38,.65)'; g.font = `${12 * k}px -apple-system, "PingFang TC", sans-serif`;
  g.fillText(`${m} 月 ${d} 日 ${hm(state.t)} · ${wName}`, bx + 12 * k, by + 38 * k);
  // 同步轉成檔案，分享時才不會因為等待而失去「使用者剛點過」的權限
  const url = c.toDataURL('image/jpeg', 0.9), bin = atob(url.split(',')[1]), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return { url, file: new File([arr], `nikkohaus-日光小室-${m}${String(d).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }) };
}
function showPhoto(url, name) {
  $('photoImg').src = url; $('photoDl').href = url; $('photoDl').download = name; $('photo').hidden = false;
}
$('photo').onclick = e => { if (e.target.id !== 'photoDl') $('photo').hidden = true; };
$('mPhoto').onclick = async () => {
  const shot = snapshot();
  if (narrow() && navigator.canShare?.({ files: [shot.file] })) {
    try { await navigator.share({ files: [shot.file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  showPhoto(shot.url, shot.file.name);
};
$('shareBtn').onclick = async () => {
  const d = layoutDiff();
  const link = location.origin + location.pathname + (Object.keys(d).length ? '#L=' + enc(d) : '');
  const text = `日光小室的擺法：${link}`;
  const shot = snapshot();
  if (navigator.canShare?.({ files: [shot.file], text })) {
    try { await navigator.share({ files: [shot.file], text, title: '日光小室的擺法' }); return; } catch (err) { if (err.name === 'AbortError') return; }
  } else if (navigator.share) {
    try { await navigator.share({ text, url: link, title: '日光小室的擺法' }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(link); toast('已複製擺法連結，貼到 LINE 或訊息就能分享'); }
  catch { toast(`擺法連結：<input value="${link}" readonly onclick="this.select()">`, 12000); }
};

// ---------- 小狗：自己走動、暴衝、轉圈、坐、趴、睡、去碗那邊吃飯；點牠會汪汪叫 ----------
pet = (() => {
  const it = dog.it, bubble = $('dogBubble');
  const P = { y: 0, pitch: 0, front: 0, back: 0, head: 0, headYaw: 0, wagAmp: 0.4, wagSpd: 8, eye: 1, gait: 0 }; // 目前姿勢
  let T = { ...P }, state = 'idle', timer = 2, target = null, speed = 0, phase = 0, time = 0, after = null, spinLeft = 0;
  let obstacles = [], sleepZ = 0;
  const R_ = 0.16; // 小狗佔地半徑（公尺）
  function obstaclesChanged() {
    obstacles = fixedColliders.map(b => ({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }));
    for (const o of items) if (!o.stored && !['rug', 'pet', 'table', 'bowl'].includes(o.kind)) obstacles.push(footprint(o, o.X, o.Z, o.r));
  }
  const box = (x, z) => ({ x0: x - R_, x1: x + R_, z0: z - R_, z1: z + R_ });
  const free = (x, z) => { const f = box(x, z); return ROOMS.some(r => inside(f, r)) && !obstacles.some(o => hit(f, o)); };
  const posX = () => PX(it.X), posZ = () => PZ(it.Z);
  function randomSpot(minDist = 0.6) {
    for (let k = 0; k < 40; k++) {
      const x = -L / 2 + 0.3 + Math.random() * (L - 0.6), z = -W / 2 + 0.3 + Math.random() * (W - 0.6);
      if (free(x, z) && Math.hypot(x - posX(), z - posZ()) > minDist) return { x, z };
    }
    return null;
  }
  const bowl = () => items.find(i => i.id === 'bowl');
  // 姿勢樣板
  const POSE = {
    stand: { y: 0, pitch: 0, front: 0, back: 0, head: 0, eye: 1 },
    sit: { y: -0.025, pitch: -0.42, front: 0.42, back: -1.25, head: -0.25, eye: 1 },
    lie: { y: -0.085, pitch: 0, front: -1.45, back: 1.5, head: 0.3, eye: 1 }, // 照片那種後腿往後攤平的青蛙趴
    sleep: { y: -0.09, pitch: 0, front: -1.45, back: 1.5, head: 0.42, eye: 0.12 },
    eat: { y: 0, pitch: 0.12, front: 0, back: 0, head: 0.85, eye: 1 },
  };
  function go(s, dur) {
    state = s; timer = dur;
    const pose = { idle: 'stand', walk: 'stand', run: 'stand', spin: 'stand', happy: 'stand', toBowl: 'stand' }[s] || s;
    Object.assign(T, POSE[pose] || POSE.stand);
    T.wagAmp = { sleep: 0, lie: 0.1, eat: 0.5, happy: 0.9, run: 0.6 }[s] ?? 0.35;
    T.wagSpd = s === 'happy' ? 22 : 9;
  }
  function decide() {
    if (state === 'lie' && Math.random() < 0.55) return go('sleep', 10 + Math.random() * 14);
    const b = bowl(), opts = [['walk', 0.32], ['run', 0.1], ['sit', 0.14], ['lie', 0.16], ['spin', 0.08], ['idle', 0.12]];
    if (b && !b.stored) opts.push(['toBowl', 0.16]);
    let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), s = 'idle';
    for (const [k, w] of opts) if ((r -= w) <= 0) { s = k; break; }
    if (s === 'walk' || s === 'run') {
      target = randomSpot(s === 'run' ? 2 : 0.8); if (!target) return go('idle', 2);
      speed = s === 'run' ? 1.5 : 0.42; after = s === 'run' && Math.random() < 0.6 ? 'run' : null;
      return go(s, 12);
    }
    if (s === 'toBowl') {
      const bx = PX(b.X), bz = PZ(b.Z), a = Math.random() * Math.PI * 2;
      for (let k = 0; k < 8; k++) { const ox = Math.cos(a + k) * 0.3, oz = Math.sin(a + k) * 0.3; if (free(bx + ox, bz + oz)) { target = { x: bx + ox, z: bz + oz, ox, oz }; speed = 0.5; return go('toBowl', 15); } }
      return go('idle', 2);
    }
    if (s === 'spin') { spinLeft = Math.PI * 4; return go('spin', 3); }
    go(s, { sit: 3 + Math.random() * 4, lie: 5 + Math.random() * 6, idle: 2 + Math.random() * 3 }[s]);
  }
  const turnTo = (yaw, dt, rate) => {
    let d = yaw - it.r * D; d = Math.atan2(Math.sin(d), Math.cos(d));
    it.r = (it.r * D + Math.sign(d) * Math.min(Math.abs(d), rate * dt)) / D;
    return Math.abs(d);
  };
  let sfx = null;
  function bark() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    sfx ||= new (window.AudioContext || window.webkitAudioContext)(); sfx.resume();
    const t0 = sfx.currentTime + 0.02;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.21, pitch = 1 + (Math.random() - 0.5) * 0.1;
      const o = sfx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(980 * pitch, t); o.frequency.exponentialRampToValueAtTime(520 * pitch, t + 0.1);
      const g = sfx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      for (const [f, q, a] of [[1300, 2.2, 1], [2700, 3, 0.5]]) { const bp = sfx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const ga = sfx.createGain(); ga.gain.value = a; o.connect(bp).connect(ga).connect(g); }
      g.connect(sfx.destination); o.start(t); o.stop(t + 0.16);
    }
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), head = new THREE.Vector3();
  function tapped(e) {
    if (it.stored) return false;
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    if (!ray.intersectObject(dog.g, true).length) return false;
    bark(); go('happy', 1.6); showBubble('汪汪！', 1.4);
    return true;
  }
  let bubbleUntil = 0;
  function showBubble(text, sec) { bubble.textContent = text; bubble.className = 'bark'; bubbleUntil = time + sec; }
  function place() { // 拿出來時：從原本位置附近找空位
    if (free(posX(), posZ())) return;
    for (let r = 0.3; r < 6; r += 0.3) for (let a = 0; a < 6.3; a += 0.5) { const x = posX() + Math.cos(a) * r, z = posZ() + Math.sin(a) * r; if (free(x, z)) { it.X = (x + L / 2) * 100; it.Z = (z + W / 2) * 100; return; } }
  }
  function update(dt) {
    time += dt;
    if (it.stored) { bubble.hidden = true; return; }
    if (editing && (selected === it)) { timer = Math.max(timer, 0.5); } // 擺設時被選取就乖乖不動
    else {
      timer -= dt;
      if (state === 'toBowl') { const b = bowl(); if (!b || b.stored) go('idle', 1); else { target.x = PX(b.X) + target.ox; target.z = PZ(b.Z) + target.oz; } } // 碗被搬走就跟過去
      if (state === 'walk' || state === 'run' || state === 'toBowl') {
        const dx = target.x - posX(), dz = target.z - posZ(), dist = Math.hypot(dx, dz);
        const off = turnTo(Math.atan2(dx, dz), dt, state === 'run' ? 7 : 4);
        const v = speed * (off > 1 ? 0.25 : 1);
        const nx = posX() + Math.sin(it.r * D) * v * dt, nz = posZ() + Math.cos(it.r * D) * v * dt;
        if (free(nx, nz) || !free(posX(), posZ())) { it.X = (nx + L / 2) * 100; it.Z = (nz + W / 2) * 100; phase += v * dt * 26; T.gait = state === 'run' ? 0.9 : 0.55; }
        else timer = 0; // 擋住了就換個主意
        if (dist < 0.08) {
          T.gait = 0;
          if (state === 'toBowl') { turnTo(Math.atan2(PX(bowl().X) - posX(), PZ(bowl().Z) - posZ()), 1, 9); go('eat', 4 + Math.random() * 4); }
          else if (after === 'run') { after = null; target = randomSpot(2); if (target) timer = 10; else go('idle', 2); }
          else go('idle', 1 + Math.random() * 2);
        }
      } else T.gait = state === 'spin' ? 0.6 : 0;
      if (state === 'spin') { const s = Math.min(spinLeft, dt * 7); spinLeft -= s; it.r += s / D; phase += dt * 14; if (spinLeft <= 0) go('idle', 1.5); }
      if (state === 'happy') turnTo(Math.atan2(camera.position.x - posX(), camera.position.z - posZ()), dt, 8);
      if (state === 'eat') { const b = bowl(); if (!b || b.stored || Math.hypot(PX(b.X) - posX(), PZ(b.Z) - posZ()) > 0.45) go('idle', 1); } // 碗不見了或被搬走就不吃了
      if (timer <= 0) decide();
    }
    // 姿勢往目標平滑靠近
    const k = 1 - Math.exp(-dt * 6);
    for (const key of ['y', 'pitch', 'front', 'back', 'head', 'wagAmp', 'wagSpd', 'eye', 'gait']) P[key] += (T[key] - P[key]) * k;
    const sw = Math.sin(phase) * P.gait;
    dog.rig.position.y = P.y + Math.abs(Math.sin(phase)) * 0.018 * P.gait + (state === 'happy' ? Math.abs(Math.sin(time * 9)) * 0.04 : 0);
    dog.rig.rotation.x = P.pitch;
    dog.legs[0].rotation.x = P.front + sw; dog.legs[3].rotation.x = P.back + sw;
    dog.legs[1].rotation.x = P.front - sw; dog.legs[2].rotation.x = P.back - sw;
    const idleLook = state === 'idle' || state === 'sit' ? Math.sin(time * 0.8) * 0.6 : 0;
    dog.headPivot.rotation.set(P.head + (state === 'eat' ? Math.sin(time * 10) * 0.12 : 0), idleLook, 0);
    dog.tailPivot.rotation.z = Math.sin(time * P.wagSpd) * P.wagAmp;
    for (const e of dog.eyes) e.scale.y = P.eye;
    dog.body.scale.y = 0.9 * (1 + (state === 'sleep' ? Math.sin(time * 2.2) * 0.04 : 0));
    dog.g.position.set(posX(), 0, posZ()); dog.g.rotation.y = it.r * D;
    // 頭上的對話泡泡：叫的時候「汪汪！」，睡覺時「Zzz」
    if (time > bubbleUntil) {
      if (state === 'sleep') { bubble.textContent = 'z z z'; bubble.className = 'zzz'; } else bubble.className = '';
    }
    const show = !!bubble.className && dog.g.visible;
    bubble.hidden = !show;
    if (show) {
      dog.headPivot.getWorldPosition(head); head.y += 0.22; head.project(camera);
      if (head.z > 1) bubble.hidden = true;
      else bubble.style.transform = `translate(${(head.x + 1) / 2 * innerWidth}px, ${(1 - head.y) / 2 * innerHeight}px) translate(-50%, -100%)`;
    }
  }
  go('idle', 1);
  return { update, tapped, obstaclesChanged, place, get state() { return state; }, go };
})();
pet.obstaclesChanged();

// 開啟時：分享連結的擺法 > 自己上次的擺法 > 官方擺法
{
  let d = null;
  if (location.hash.startsWith('#L=')) { try { d = dec(location.hash.slice(3)); toast('這是別人分享的擺法，你可以按「擺設」再調整'); } catch {} }
  if (!d) { try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {} }
  applyLayout(d || {});
}

// ---------- 背景音樂：預設關，按右上角「♪ 音樂」才開，再按一次關 ----------
// 在按鈕的點擊裡直接開始播，iPhone 才允許出聲；music.js 會把網頁設成「播放音樂」，靜音模式下也照播
const music = createMusic(() => ({ el: light.el, t: state.t, w: state.w, enters: light.enters }));
$('mMusic').onclick = () => {
  music.preset ? music.stop() : music.play('light');
  $('mMusic').classList.toggle('on', !!music.preset); // 播放中跟其他按鈕選中時一樣：黑底白字
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
camera.position.copy(orbitStart());
setMode('orbit');

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (playing) {
    state.t += dt * 1.2;
    if (state.t > 20) { state.t = 20; playing = false; $('play').textContent = '▶ 播放一天'; }
    updateLight();
  }
  // 夜裡稍微拉亮，像相機自動曝光
  renderer.toneMappingExposure = 1.15 * Math.pow(2, state.ev) * (1 + 0.7 * (1 - Math.min(1, skyN / 0.6)));
  if (mode === 'walk') {
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA')) s -= 1;
    if (keys.has('KeyD')) s += 1;
    if (keys.has('ArrowLeft')) yaw += 1.6 * dt;
    if (keys.has('ArrowRight')) yaw -= 1.6 * dt;
    f += stick.y; s += stick.x;
    if (f || s) move(s * 1.4 * dt, f * 1.4 * dt);
    camera.position.copy(pos);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  } else if (mode === 'tour') {
    tourT = (tourT + dt / 40) % 1;
    camera.position.copy(curve.getPointAt(tourT));
    const fi = tourT * (pathQ.length - 1), i = Math.floor(fi);
    const q = pathQ[Math.max(0, i - 3)].clone().slerp(pathQ[Math.min(pathQ.length - 1, i + 4)], 0.5);
    euler.setFromQuaternion(q, 'YXZ'); euler.z = 0; euler.x *= 0.6;
    camera.quaternion.slerp(new THREE.Quaternion().setFromEuler(euler), snap ? 1 : Math.min(1, dt * 2.5));
    snap = false;
  } else {
    orbit.update();
    setCut(true);
  }
  pet?.update(dt);
  renderer.render(scene, camera);
});
window.__view = { get pet() { return pet; }, music, THREE, scene, camera, pos, setMode, colliders, walls, state, updateLight, items, valid, applyLayout, layoutDiff, enc, select, enterEdit,
  set yaw(v) { yaw = v; }, set pitch(v) { pitch = v; }, setTour: t => { tourT = t; snap = true; } };
