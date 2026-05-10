'use strict';

// ── STATE ──
const state = {
  mode: 'auto',
  cutoutImg: null,
  edgeSeed1: 0,
  edgeSeed2: 0,
  lightX: -0.62,
  lightY: -0.72,
  lightCount: 1,
  texType: 'mizu',
  fillType: 'none',
};

// フチは固定比率（画像の短辺の4%）
const BORDER_RATIO = 0.04;
const S = { pukku:70, gloss:80, milky:30, shadow:60, glitter:0 };
let glitterType = 'silver';

function setGlitter(type, el) {
  glitterType = type;
  document.querySelectorAll('.glitter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  scheduleRender();
}

function setLightPreset(x, y, el) {
  state.lightX = x;
  state.lightY = y;
  document.querySelectorAll('.light-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  scheduleRender();
}

function setLightCount(n, el) {
  state.lightCount = n;
  document.querySelectorAll('.lightcount-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  scheduleRender();
}

function setTexType(type, el) {
  state.texType = type;
  document.querySelectorAll('.tex-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  scheduleRender();
}

function setFillType(type, el) {
  state.fillType = type;
  document.querySelectorAll('.fill-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  scheduleRender();
}

/** 光源方向の配列を返す（lightCount に応じて副光源を追加） */
function getLightSources() {
  const lx = state.lightX, ly = state.lightY;
  const sources = [{ x: lx, y: ly, t: 1.0 }];
  if (state.lightCount >= 2) {
    const a2 = Math.atan2(ly, lx) + Math.PI * 0.65;
    sources.push({ x: Math.cos(a2) * 0.72, y: Math.sin(a2) * 0.72, t: 0.46 });
  }
  if (state.lightCount >= 3) {
    const a3 = Math.atan2(ly, lx) - Math.PI * 0.65;
    sources.push({ x: Math.cos(a3) * 0.60, y: Math.sin(a3) * 0.60, t: 0.30 });
  }
  return sources;
}

// ── DOM ──
const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const outCanvas = document.getElementById('out-canvas');
const beforeImg = document.getElementById('before-img');

// ── DRAG & DROP ──
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.type.startsWith('image/')) handleFile(f);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

// ── MODE ──
function setMode(mode, el) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('mode-desc').textContent = mode === 'auto'
    ? '画像をアップロードするとAIが自動で背景を除去します。初回のみモデルのダウンロードで少し時間がかかります。'
    : '背景を透明にしたPNGをアップロードしてください。そのままシール加工します。';
}

// ── SLIDERS ──
function onSlider(key, el) {
  S[key] = parseInt(el.value);
  document.getElementById('v-' + key).textContent = el.value;
  scheduleRender();
}

// ── FILE HANDLING ──
async function handleFile(file) {
  setStatus(true, '画像を準備中...');
  try {
    const objUrl = URL.createObjectURL(file);
    beforeImg.src = objUrl;
    await new Promise((res, rej) => { beforeImg.onload = res; beforeImg.onerror = rej; });

    const pngBlob = await normalizeToPNG(beforeImg);
    if (!pngBlob) throw new Error('PNG変換に失敗しました');

    let cutoutUrl;
    if (state.mode === 'manual') {
      cutoutUrl = URL.createObjectURL(pngBlob);
    } else {
      cutoutUrl = await doBgRemoval(pngBlob);
    }

    let img = await loadImg(cutoutUrl);
    const MAX = 1200;
    if (img.width > MAX || img.height > MAX) {
      const sc = MAX / Math.max(img.width, img.height);
      const c = mk(Math.round(img.width * sc), Math.round(img.height * sc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      img = await loadImg(c.toDataURL());
    }

    state.cutoutImg = img;
    state.edgeSeed1 = Math.random() * Math.PI * 2;
    state.edgeSeed2 = Math.random() * Math.PI * 2;

    setStatus(false);
    document.getElementById('upload-section').style.display = 'none';
    document.getElementById('edit-section').hidden = false;
    scheduleRender();
  } catch (err) {
    console.error(err);
    setStatus(false);
    alert(err.message || '処理に失敗しました。');
  }
}

function normalizeToPNG(imgEl) {
  const c = mk(imgEl.naturalWidth, imgEl.naturalHeight);
  c.getContext('2d').drawImage(imgEl, 0, 0);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

async function doBgRemoval(pngBlob) {
  setStatus(true, 'AIモデルを準備中（初回は時間がかかります）...');
  let mod;
  try {
    mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs');
  } catch (e) {
    console.error('import失敗:', e);
    throw new Error('AIライブラリの読み込みに失敗しました。ネット接続を確認するか「透明PNGをそのまま使う」モードをお試しください。');
  }
  const removeBg = mod.removeBackground ?? mod.default?.removeBackground ?? mod.default;
  if (typeof removeBg !== 'function') {
    throw new Error('背景除去ライブラリを初期化できませんでした。');
  }
  setStatus(true, '背景を除去しています...');
  let blob;
  try {
    blob = await removeBg(pngBlob, {
      output: { format: 'image/png' },
      progress: (key, cur, total) => {
        if (total > 0) setStatus(true, `AI処理中… ${Math.round(cur / total * 100)}%`);
      }
    });
  } catch (e) {
    console.error('背景除去エラー:', e);
    throw new Error('背景除去エラー: ' + (e?.message || String(e)));
  }
  if (!blob) throw new Error('背景除去の結果がありませんでした');
  return blobToDataURL(blob);
}

// ── RENDER ──
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderSticker, 60);
}

async function renderSticker() {
  const img = state.cutoutImg;
  if (!img) return;

  const brd = Math.round(Math.min(img.width, img.height) * BORDER_RATIO);
  const pad = brd + 60;
  const W   = img.width  + pad * 2;
  const H   = img.height + pad * 2;
  const ox  = pad, oy = pad;

  outCanvas.width  = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const s1 = state.edgeSeed1, s2 = state.edgeSeed2;

  // ① ドロップシャドウ（ステッカー全体の影）
  if (S.shadow > 0) {
    const sC  = mk(W, H), sCx = sC.getContext('2d');
    const sil = expandSilOrganic(img, brd, s1, s2);
    sCx.shadowColor   = `rgba(20,8,0,${S.shadow / 100 * 0.58})`;
    sCx.shadowBlur    = 22 + S.shadow / 100 * 32;
    sCx.shadowOffsetX = 3  + S.shadow / 100 * 5;
    sCx.shadowOffsetY = 12 + S.shadow / 100 * 20;
    sCx.drawImage(sil, ox - brd, oy - brd);
    sCx.shadowColor = 'transparent';
    sCx.globalCompositeOperation = 'destination-out';
    sCx.drawImage(sil, ox - brd, oy - brd);
    ctx.drawImage(sC, 0, 0);
  }

  // ② デザイン本体
  ctx.drawImage(img, ox, oy);

  // ②' 中身の質感（デザインの上・ドームの下）
  if (state.fillType !== 'none') {
    drawFill(ctx, img, W, H, ox, oy);
  }

  // ③ ゲルフチの壁がデザイン面に落とす影（空洞感・立体感の核心）
  ctx.drawImage(airCavityShadow(img, brd, W, H, ox, oy, S.shadow), 0, 0);

  // ④ ドーム表面（透明ゲル層）
  // 白いオーバーレイは乗せない。シャープな反射点1つだけ。
  ctx.drawImage(domeLayer(img, brd, W, H, ox, oy, S.pukku, S.gloss), 0, 0);

  // ⑤' ラメ / グリッター（ゲル内に封入された輝き）
  if (S.glitter > 0) {
    drawGlitter(ctx, img, ox, oy, S.glitter, glitterType, s1, s2);
  }

  // ⑥ 透明ゲルフチ（デザインの上に重ねる = 最前面）
  ctx.drawImage(makeFuchi(img, brd, S.gloss, s1, s2), ox - brd, oy - brd);

  // ⑦ フチ内縁グロー（ゲルとデザインの境界線）
  if (S.gloss > 0) {
    ctx.drawImage(innerRimGlow(img, brd, W, H, ox, oy, S.gloss), 0, 0);
  }
}

// ══════════════════════════════
//  CORE EFFECTS
// ══════════════════════════════

/**
 * ドーム歪み（バレル変換）
 *
 * 凸ドームを通して見ると中央が拡大して見える。
 * この「ピクセル自体の変形」がぷっくりの本質。
 * グラデーション重ねるだけでは再現できない立体感。
 *
 * 原理: 出力位置(x,y)のソース位置 = r / (1 + k*r²)
 *   → 中央ほど遠くのピクセルを引っ張ってくる = 拡大
 *   → 周辺ほど圧縮
 */
function applyDomeWarp(img, pukku) {
  const W = img.width, H = img.height;
  const src = mk(W, H);
  src.getContext('2d').drawImage(img, 0, 0);
  const srcData = src.getContext('2d').getImageData(0, 0, W, H).data;

  const dst = mk(W, H);
  const dctx = dst.getContext('2d');
  const dstImg = dctx.getImageData(0, 0, W, H);
  const dstData = dstImg.data;

  // pukku 0-100 → 歪み強度 k: 0 〜 0.55
  const k = (pukku / 100) * 0.55;
  const cxD = W / 2, cyD = H / 2;
  const R   = Math.max(W, H) / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - cxD) / R;
      const ny = (y - cyD) / R;
      const r  = Math.sqrt(nx * nx + ny * ny);

      // バレル歪み: 中央が拡大される
      const rSrc = r < 0.001 ? 0 : r / (1 + k * r * r);
      const angle = r < 0.001 ? 0 : Math.atan2(ny, nx);

      const sx = Math.min(W - 1, Math.max(0, Math.round(rSrc * Math.cos(angle) * R + cxD)));
      const sy = Math.min(H - 1, Math.max(0, Math.round(rSrc * Math.sin(angle) * R + cyD)));

      const di = (y * W + x) * 4;
      const si = (sy * W + sx) * 4;

      dstData[di]     = srcData[si];
      dstData[di + 1] = srcData[si + 1];
      dstData[di + 2] = srcData[si + 2];
      dstData[di + 3] = srcData[di + 3]; // アルファは元のまま（シルエット保持）
    }
  }

  dctx.putImageData(dstImg, 0, 0);
  return dst;
}

/** 有機的ないびつなシルエット膨張 */
function expandSilOrganic(img, exp, seed1, seed2) {
  const W = img.width + exp * 2, H = img.height + exp * 2;
  const c = mk(W, H), cx = c.getContext('2d');

  const N = Math.max(56, Math.floor(exp * 4));
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const perturbAmt = exp * 0.16 + 6;
    const perturb = perturbAmt * (
      Math.sin(a * 3  + seed1) * 0.55 +
      Math.sin(a * 7  + seed2) * 0.30 +
      Math.sin(a * 13 + seed1 * 0.7 + seed2) * 0.15
    );
    const r = Math.max(exp * 0.20, exp + perturb);
    cx.drawImage(img, exp + Math.cos(a) * r, exp + Math.sin(a) * r);
  }
  const N2 = Math.max(28, Math.floor(exp * 2));
  for (let i = 0; i < N2; i++) {
    const a = (i / N2) * Math.PI * 2;
    cx.drawImage(img, exp + Math.cos(a) * exp * 0.5, exp + Math.sin(a) * exp * 0.5);
  }
  cx.drawImage(img, exp, exp);
  return c;
}

/** リング = 有機膨張シルエット - 元画像 */
function makeRing(img, exp, s1, s2) {
  const W = img.width + exp * 2, H = img.height + exp * 2;
  const c = mk(W, H), cx = c.getContext('2d');
  cx.drawImage(expandSilOrganic(img, exp, s1, s2), 0, 0);
  cx.globalCompositeOperation = 'destination-out';
  cx.drawImage(img, exp, exp);
  return c;
}

/** リング領域にマスクしてレイヤーを合成 */
function applyToRing(cx, ring, W, H, drawFn) {
  const b = mk(W, H), bc = b.getContext('2d');
  drawFn(bc);
  bc.globalCompositeOperation = 'destination-in';
  bc.drawImage(ring, 0, 0);
  cx.drawImage(b, 0, 0);
}

/**
 * フチの壁がデザイン内側に落とす影
 *
 * ドームは中心が最も高く、フチに向かって下がる。
 * フチの壁の高さ分だけデザイン面に影が落ちる。
 * これが「空気が詰まっている」感の核心。
 *
 * 光源: 左上。中心の明るい「天井」から
 * 外周の暗い「壁の影」へと変化する。
 */
function airCavityShadow(img, brd, W, H, ox, oy, shadow) {
  const c = mk(W, H), cx = c.getContext('2d');
  const str = shadow / 100;

  // ── 外周の暗い影リング（フチ壁の落とす影）──
  // 画像の中心から同心円状に外周へ向かって暗くなる
  // 中心は明るい（ドームの頂上、フチから遠い）
  // 外周は暗い（フチの壁が光を遮る）
  {
    const layer = mk(W, H), lx = layer.getContext('2d');
    lx.drawImage(img, ox, oy);
    lx.globalCompositeOperation = 'source-in';

    const cxC = ox + img.width  * 0.50;
    const cyC = oy + img.height * 0.50;
    // 中心を明るい焦点とした放射グラジエント
    const r1 = Math.max(img.width, img.height) * 0.10;  // 明るい中核
    const r2 = Math.max(img.width, img.height) * 0.62;  // 影リングの始まり

    const g = lx.createRadialGradient(cxC, cyC, r1, cxC, cyC, r2 * 1.3);
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.32, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, `rgba(0,0,0,${str * 0.22})`);
    g.addColorStop(0.75, `rgba(0,0,0,${str * 0.52})`);
    g.addColorStop(0.90, `rgba(0,0,0,${str * 0.72})`);
    g.addColorStop(1,    `rgba(0,0,0,${str * 0.85})`);
    lx.fillStyle = g;
    lx.fillRect(0, 0, W, H);
    cx.drawImage(layer, 0, 0);
  }

  // ── 光源方向バイアス（右下が特に暗い）──
  {
    const layer = mk(W, H), lx = layer.getContext('2d');
    lx.drawImage(img, ox, oy);
    lx.globalCompositeOperation = 'source-in';
    // 左上→右下の対角線グラジエント
    const g = lx.createLinearGradient(
      ox, oy,
      ox + img.width, oy + img.height
    );
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, `rgba(0,0,0,${str * 0.10})`);
    g.addColorStop(1,    `rgba(0,0,0,${str * 0.28})`);
    lx.fillStyle = g;
    lx.fillRect(0, 0, W, H);
    cx.drawImage(layer, 0, 0);
  }

  return c;
}

/**
 * 透明ゲルフチ
 * 空気が詰まったような大きな光沢ブロブ
 * 最前面に描画してデザインを覆う
 */
function makeFuchi(img, brd, gloss, s1, s2) {
  const W = img.width + brd * 2, H = img.height + brd * 2;
  const ring = makeRing(img, brd, s1, s2);
  const c = mk(W, H), cx = c.getContext('2d');

  // ① ベース：ほぼ透明なクリアゲル（白濁させない）
  applyToRing(cx, ring, W, H, bc => {
    bc.fillStyle = 'rgba(255,252,248,0.12)';
    bc.fillRect(0, 0, W, H);
  });

  // ② 内側エッジの白グロー（ゲルの内壁）
  {
    const b = mk(W, H), bc = b.getContext('2d');
    bc.shadowColor = 'rgba(255,255,255,0.95)';
    bc.shadowBlur  = Math.max(12, brd * 0.70);
    bc.drawImage(img, brd, brd);
    bc.shadowColor = 'transparent';
    bc.globalCompositeOperation = 'destination-out';
    bc.drawImage(img, brd, brd);
    bc.globalCompositeOperation = 'destination-in';
    bc.drawImage(ring, 0, 0);
    cx.globalAlpha = 0.50 + gloss / 100 * 0.38;
    cx.drawImage(b, 0, 0);
    cx.globalAlpha = 1;
  }

  // ③ 風船のような大きな光沢ブロブ（膨らんだ空気感）
  const blobs = [
    { rx: 0.14, ry: 0.08, r: 0.65, a: 0.92 },  // 左上メイン（最大・最明・風船ハイライト）
    { rx: 0.03, ry: 0.52, r: 0.50, a: 0.62 },  // 左サイド（大きく）
    { rx: 0.82, ry: 0.84, r: 0.38, a: 0.42 },  // 右下
    { rx: 0.68, ry: 0.05, r: 0.34, a: 0.35 },  // 右上
    { rx: 0.46, ry: 0.96, r: 0.32, a: 0.26 },  // 下中央
  ];
  blobs.forEach(({ rx, ry, r, a }) => {
    applyToRing(cx, ring, W, H, bc => {
      const gx = W * rx, gy = H * ry, gr = W * r;
      const g = bc.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0,    `rgba(255,255,255,${gloss / 100 * a})`);
      g.addColorStop(0.22, `rgba(255,255,255,${gloss / 100 * a * 0.55})`);  // より緩やかに
      g.addColorStop(0.55, `rgba(255,255,255,${gloss / 100 * a * 0.14})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      bc.fillStyle = g;
      bc.fillRect(0, 0, W, H);
    });
  });

  // ③' 風船の内側縁ハイライト（膨らみの縁の光）
  applyToRing(cx, ring, W, H, bc => {
    const gx = W * 0.5, gy = H * 0.5;
    const gr = Math.max(W, H) * 0.52;
    // 外から内側へ向かって白くなる → 縁が光って膨らんで見える
    const g = bc.createRadialGradient(gx, gy, gr * 0.55, gx, gy, gr);
    g.addColorStop(0,    'rgba(255,255,255,0)');
    g.addColorStop(0.60, 'rgba(255,255,255,0)');
    g.addColorStop(0.82, `rgba(255,255,255,${gloss / 100 * 0.30})`);
    g.addColorStop(1,    `rgba(255,255,255,${gloss / 100 * 0.55})`);
    bc.fillStyle = g;
    bc.fillRect(0, 0, W, H);
  });

  // ④ 外周エッジの暗み（ゲルの厚みと張り）
  applyToRing(cx, ring, W, H, bc => {
    const gx = W * 0.5, gy = H * 0.5;
    const gr = Math.max(W, H) * 0.55;
    const g = bc.createRadialGradient(gx, gy, gr * 0.58, gx, gy, gr);
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(0,0,0,0)');
    g.addColorStop(0.85, 'rgba(0,0,0,0.20)');
    g.addColorStop(1,    'rgba(0,0,0,0.40)');
    bc.fillStyle = g;
    bc.fillRect(0, 0, W, H);
  });

  return c;
}

/**
 * 透明ドーム層
 * texType に応じてハイライト質感を変える。
 * lightCount に応じて副光源ハイライトを追加。
 */
function domeLayer(img, brd, W, H, ox, oy, pukku, gloss) {
  const c = mk(W, H), cx = c.getContext('2d');
  const gs = gloss / 100;
  const pk = pukku / 100;
  const lights = getLightSources();

  // ── ① リム暗化（光源非依存・質感共通）──
  if (state.texType !== 'matte') {
    const layer = mk(W, H), lx = layer.getContext('2d');
    lx.drawImage(img, ox, oy);
    lx.globalCompositeOperation = 'source-in';
    const cxC = ox + img.width  * 0.50;
    const cyC = oy + img.height * 0.50;
    const r1  = Math.max(img.width, img.height) * (0.20 + pk * 0.15);
    const r2  = Math.max(img.width, img.height) * 0.60;
    const g = lx.createRadialGradient(cxC, cyC, r1, cxC, cyC, r2);
    const rimStr = state.texType === 'churutto' ? 0.55 : state.texType === 'mizu' ? 0.28 : 1.0;
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, `rgba(0,0,0,${pk * 0.28 * rimStr})`);
    g.addColorStop(0.85, `rgba(0,0,0,${pk * 0.52 * rimStr})`);
    g.addColorStop(1,    `rgba(0,0,0,${pk * 0.68 * rimStr})`);
    lx.fillStyle = g;
    lx.fillRect(0, 0, W, H);
    cx.drawImage(layer, 0, 0);
  }

  // ── ② ハイライト（質感・光源数に応じて）──
  for (const light of lights) {
    const layer = mk(W, H), lx = layer.getContext('2d');
    lx.drawImage(img, ox, oy);
    lx.globalCompositeOperation = 'source-in';

    const cxH = ox + img.width  * 0.5;
    const cyH = oy + img.height * 0.5;

    if (state.texType === 'mizu') {
      // 水: 細い鋭いハイライト帯（水滴・ガラスのような）
      const hx = cxH + light.x * img.width  * 0.28;
      const hy = cyH + light.y * img.height * 0.32;
      const rw = img.width  * (0.48 + pk * 0.10);
      const rh = img.height * (0.06 + pk * 0.03);  // 極細
      lx.save();
      lx.translate(hx, hy);
      lx.scale(1, rh / rw);
      const g = lx.createRadialGradient(0, 0, 0, 0, 0, rw);
      g.addColorStop(0,    `rgba(255,255,255,${gs * 0.98 * light.t})`);
      g.addColorStop(0.10, `rgba(255,255,255,${gs * 0.72 * light.t})`);
      g.addColorStop(0.30, `rgba(255,255,255,${gs * 0.20 * light.t})`);
      g.addColorStop(0.60, `rgba(255,255,255,${gs * 0.04 * light.t})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g;
      lx.fillRect(-rw * 1.5, -rw * 1.5, rw * 3, rw * 3);
      lx.restore();
    } else if (state.texType === 'churutto') {
      // ゼリー: 広い帯状の光沢（ぷるぷるゼリーのような）
      const hx = cxH + light.x * img.width  * 0.22;
      const hy = cyH + light.y * img.height * 0.30;
      const rw = img.width  * (0.55 + pk * 0.15);  // 広め
      const rh = img.height * (0.28 + pk * 0.08);
      lx.save();
      lx.translate(hx, hy);
      lx.scale(1, rh / rw);
      const g = lx.createRadialGradient(0, 0, 0, 0, 0, rw);
      g.addColorStop(0,    `rgba(255,255,255,${gs * 0.88 * light.t})`);
      g.addColorStop(0.18, `rgba(255,255,255,${gs * 0.60 * light.t})`);
      g.addColorStop(0.42, `rgba(255,255,255,${gs * 0.22 * light.t})`);
      g.addColorStop(0.70, `rgba(255,255,255,${gs * 0.06 * light.t})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g;
      lx.fillRect(-rw * 1.5, -rw * 1.5, rw * 3, rw * 3);
      lx.restore();
    } else if (state.texType === 'matte') {
      // マット: ハイライトなし（リム暗化のみ）
    } else {
      // ぷっくり（デフォルト）: 集中した楕円ハイライト
      const hx = cxH + light.x * img.width  * 0.38;
      const hy = cyH + light.y * img.height * 0.38;
      const rw = img.width  * (0.18 + pk * 0.14) * (light.t < 1 ? 0.80 : 1);
      const rh = img.height * (0.08 + pk * 0.06) * (light.t < 1 ? 0.80 : 1);
      lx.save();
      lx.translate(hx, hy);
      lx.scale(1, rh / rw);
      const g = lx.createRadialGradient(0, 0, 0, 0, 0, rw);
      g.addColorStop(0,    `rgba(255,255,255,${gs * 0.90 * light.t})`);
      g.addColorStop(0.25, `rgba(255,255,255,${gs * 0.55 * light.t})`);
      g.addColorStop(0.55, `rgba(255,255,255,${gs * 0.18 * light.t})`);
      g.addColorStop(0.80, `rgba(255,255,255,${gs * 0.04 * light.t})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g;
      lx.fillRect(-rw * 2, -rw * 2, rw * 4, rw * 4);
      lx.restore();
    }

    cx.drawImage(layer, 0, 0);
  }

  // ── ③ 点スペキュラー（光源ごと）──
  if (state.texType !== 'matte') {
    for (const light of lights) {
      const layer = mk(W, H), lx = layer.getContext('2d');
      lx.drawImage(img, ox, oy);
      lx.globalCompositeOperation = 'source-in';

      const rx = (ox + img.width  * 0.5) + light.x * img.width  * 0.42;
      const ry = (oy + img.height * 0.5) + light.y * img.height * 0.42;
      // ちゅるっとはスペキュラーをやや大きく柔らかく
      const specScale = state.texType === 'churutto' ? 1.8 : state.texType === 'mizu' ? 0.7 : 1.0;
      const rSpec = Math.max(img.width, img.height) * (0.025 + pk * 0.04) * specScale;

      const g = lx.createRadialGradient(rx, ry, 0, rx, ry, rSpec);
      g.addColorStop(0,    `rgba(255,255,255,${Math.min(gs * light.t, 0.98)})`);
      g.addColorStop(0.20, `rgba(255,255,255,${gs * 0.60 * light.t})`);
      g.addColorStop(0.50, `rgba(255,255,255,${gs * 0.12 * light.t})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g;
      lx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = 'screen';
      cx.drawImage(layer, 0, 0);
      cx.globalCompositeOperation = 'source-over';
    }
  }

  return c;
}

/** 被写体形状マスクの単色オーバーレイ */
function subjectOverlay(img, W, H, ox, oy, color) {
  const c = mk(W, H), cx = c.getContext('2d');
  cx.drawImage(img, ox, oy);
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = color;
  cx.fillRect(0, 0, W, H);
  return c;
}

/**
 * フチ内縁グロー（ゲルとデザインの境界の白い輝き）
 */
function innerRimGlow(img, brd, W, H, ox, oy, gloss) {
  const hb = Math.max(4, Math.floor(brd * 0.28));
  const c = mk(W, H), cx = c.getContext('2d');

  cx.save();
  cx.shadowColor = `rgba(255,255,255,${gloss / 100 * 0.88})`;
  cx.shadowBlur  = 4 + gloss / 100 * 10;
  cx.drawImage(img, ox, oy);
  cx.restore();
  cx.globalCompositeOperation = 'destination-out';
  cx.drawImage(img, ox, oy);

  const ring = makeRing(img, hb, 0, 0);
  const rc = mk(W, H), rcx = rc.getContext('2d');
  rcx.drawImage(ring, ox - hb, oy - hb);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(rc, 0, 0);

  return c;
}

/**
 * 中身の質感オーバーレイ
 * デザイン画像の上・ドーム層の下に重ねる。
 * 水/ゼリー/ソーダ/樹脂/メタリック の5種。
 */
function drawFill(ctx, img, W, H, ox, oy) {
  const type = state.fillType;
  if (type === 'none') return;

  const cxI = ox + img.width  * 0.5;
  const cyI = oy + img.height * 0.5;
  const R   = Math.max(img.width, img.height);

  // デザイン形状にクリップした単色レイヤーを生成
  function makeColorLayer(fillFn) {
    const l = mk(W, H), lx = l.getContext('2d');
    lx.drawImage(img, ox, oy);
    lx.globalCompositeOperation = 'source-in';
    fillFn(lx);
    return l;
  }

  if (type === 'water') {
    // ① 青みをmultiplyで自然に乗算
    const tint = makeColorLayer(lx => {
      lx.fillStyle = 'rgb(90,170,255)';
      lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.48;
    ctx.drawImage(tint, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ② 水面の白い光彩（screen）
    const shine = makeColorLayer(lx => {
      const g = lx.createRadialGradient(ox + img.width*0.36, oy + img.height*0.18, 0, cxI, cyI*0.8, R*0.55);
      g.addColorStop(0,    'rgba(255,255,255,0.85)');
      g.addColorStop(0.25, 'rgba(200,235,255,0.40)');
      g.addColorStop(0.55, 'rgba(160,215,255,0.12)');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g; lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.80;
    ctx.drawImage(shine, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  } else if (type === 'jelly') {
    // ① ほんのりピンク〜白の半透明ベース（ゼリーの濁り感）
    const milky = makeColorLayer(lx => {
      const g = lx.createRadialGradient(cxI, cyI, 0, cxI, cyI, R * 0.7);
      g.addColorStop(0,   'rgba(255,245,250,0.52)');
      g.addColorStop(0.6, 'rgba(255,235,245,0.38)');
      g.addColorStop(1,   'rgba(255,220,240,0.20)');
      lx.fillStyle = g; lx.fillRect(0, 0, W, H);
    });
    ctx.drawImage(milky, 0, 0);

    // ② メインのぷるん楕円ハイライト（大・明るめ）
    const shine = makeColorLayer(lx => {
      const hx = ox + img.width * 0.36, hy = oy + img.height * 0.18;
      const rw = img.width * 0.58, rh = img.height * 0.32;
      lx.save(); lx.translate(hx, hy); lx.scale(1, rh / rw);
      const g = lx.createRadialGradient(0, 0, 0, 0, 0, rw);
      g.addColorStop(0,    'rgba(255,255,255,0.95)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.60)');
      g.addColorStop(0.52, 'rgba(255,255,255,0.18)');
      g.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g; lx.fillRect(-rw * 2, -rw * 2, rw * 4, rw * 4);
      lx.restore();

      // サブハイライト（右下の反射・ゼリーの丸み感）
      const hx2 = ox + img.width * 0.68, hy2 = oy + img.height * 0.72;
      const rw2 = img.width * 0.28, rh2 = img.height * 0.16;
      lx.save(); lx.translate(hx2, hy2); lx.scale(1, rh2 / rw2);
      const g2 = lx.createRadialGradient(0, 0, 0, 0, 0, rw2);
      g2.addColorStop(0,    'rgba(255,255,255,0.55)');
      g2.addColorStop(0.40, 'rgba(255,255,255,0.18)');
      g2.addColorStop(1,    'rgba(255,255,255,0)');
      lx.fillStyle = g2; lx.fillRect(-rw2 * 2, -rw2 * 2, rw2 * 4, rw2 * 4);
      lx.restore();
    });
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.92;
    ctx.drawImage(shine, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ③ エッジの光の回り込み（ゼリーの側面が透けて光る感）
    const edge = makeColorLayer(lx => {
      const g = lx.createRadialGradient(cxI, cyI, R * 0.30, cxI, cyI, R * 0.72);
      g.addColorStop(0,    'rgba(255,220,240,0)');
      g.addColorStop(0.65, 'rgba(255,200,230,0.08)');
      g.addColorStop(0.85, 'rgba(255,180,220,0.28)');
      g.addColorStop(1,    'rgba(255,160,210,0.42)');
      lx.fillStyle = g; lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.70;
    ctx.drawImage(edge, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  } else if (type === 'soda') {
    // ① シアン系のmultiply（控えめに）
    const tint = makeColorLayer(lx => {
      lx.fillStyle = 'rgb(60,195,230)';
      lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.22;
    ctx.drawImage(tint, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ② 光スポット
    const shine = makeColorLayer(lx => {
      const spots = [
        [0.28, 0.10, 0.52, 0.88], [0.68, 0.22, 0.40, 0.74],
        [0.16, 0.50, 0.32, 0.64], [0.76, 0.62, 0.28, 0.54],
        [0.46, 0.80, 0.36, 0.48], [0.86, 0.36, 0.22, 0.42],
      ];
      for (const [rx, ry, rs, op] of spots) {
        const g = lx.createRadialGradient(
          ox + img.width*rx, oy + img.height*ry, 0,
          ox + img.width*rx, oy + img.height*ry, R*rs
        );
        g.addColorStop(0,    `rgba(230,250,255,${op})`);
        g.addColorStop(0.25, `rgba(190,235,255,${op*0.40})`);
        g.addColorStop(0.60, `rgba(210,245,255,${op*0.10})`);
        g.addColorStop(1,    'rgba(255,255,255,0)');
        lx.fillStyle = g; lx.fillRect(0, 0, W, H);
      }
    });
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.88;
    ctx.drawImage(shine, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ③ 極細炭酸気泡（別レイヤーで描いてからクリップ）
    {
      const bubL = mk(W, H), bx = bubL.getContext('2d');
      const s1 = state.edgeSeed1, s2 = state.edgeSeed2;
      function brng(i) {
        const v = Math.sin(s1 * 3.7 + s2 * 2.1 + i * 31.9) * 15423.7;
        return v - Math.floor(v);
      }
      for (let i = 0; i < 600; i++) {
        const px = ox + brng(i * 3)     * img.width;
        const py = oy + brng(i * 3 + 1) * img.height;
        const sr  = brng(i * 3 + 2);
        const br  = sr < 0.75 ? 0.25 + sr * 0.80 : 0.90 + (sr - 0.75) * 3.0;
        const ba  = 0.50 + brng(i * 5) * 0.45;

        bx.beginPath();
        bx.arc(px, py, br, 0, Math.PI * 2);
        bx.strokeStyle = `rgba(255,255,255,${ba})`;
        bx.lineWidth   = Math.max(0.3, br * 0.5);
        bx.stroke();

        if (br > 0.65) {
          bx.beginPath();
          bx.arc(px - br * 0.22, py - br * 0.25, br * 0.30, 0, Math.PI * 2);
          bx.fillStyle = `rgba(255,255,255,${ba * 0.75})`;
          bx.fill();
        } else {
          bx.beginPath();
          bx.arc(px, py, br, 0, Math.PI * 2);
          bx.fillStyle = `rgba(255,255,255,${ba * 0.40})`;
          bx.fill();
        }
      }
      // デザイン形状でクリップ
      bx.globalCompositeOperation = 'destination-in';
      bx.drawImage(img, ox, oy);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.95;
      ctx.drawImage(bubL, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

  } else if (type === 'resin') {
    // ① 琥珀色をmultiplyで深みよく乗算
    const tint = makeColorLayer(lx => {
      const g = lx.createRadialGradient(cxI, cyI, 0, cxI, cyI, R*0.72);
      g.addColorStop(0,   'rgb(255,195,55)');
      g.addColorStop(0.6, 'rgb(235,155,20)');
      g.addColorStop(1,   'rgb(190,100,5)');
      lx.fillStyle = g; lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(tint, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ② 中央の温かい光（エポキシの奥行き感）
    const glow = makeColorLayer(lx => {
      const g = lx.createRadialGradient(ox + img.width*0.44, oy + img.height*0.36, 0, cxI, cyI, R*0.60);
      g.addColorStop(0,    'rgba(255,240,180,0.60)');
      g.addColorStop(0.40, 'rgba(255,210,80,0.22)');
      g.addColorStop(1,    'rgba(255,180,0,0)');
      lx.fillStyle = g; lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.70;
    ctx.drawImage(glow, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  } else if (type === 'metallic') {
    // ① まずグレーでdesaturation気味に
    const gray = makeColorLayer(lx => {
      lx.fillStyle = 'rgb(160,165,175)';
      lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(gray, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // ② クロームのハイライト帯（複数の斜め光）
    const chrome = makeColorLayer(lx => {
      const angle = Math.PI * 0.35;
      const d = R;
      const g = lx.createLinearGradient(
        cxI - Math.cos(angle)*d, cyI - Math.sin(angle)*d,
        cxI + Math.cos(angle)*d, cyI + Math.sin(angle)*d
      );
      g.addColorStop(0,    'rgba(30,30,35,1)');
      g.addColorStop(0.15, 'rgba(190,192,200,1)');
      g.addColorStop(0.28, 'rgba(255,255,255,1)');
      g.addColorStop(0.40, 'rgba(210,212,220,1)');
      g.addColorStop(0.52, 'rgba(80,82,90,1)');
      g.addColorStop(0.65, 'rgba(180,182,190,1)');
      g.addColorStop(0.78, 'rgba(255,255,255,1)');
      g.addColorStop(0.90, 'rgba(150,152,160,1)');
      g.addColorStop(1,    'rgba(25,25,30,1)');
      lx.fillStyle = g; lx.fillRect(0, 0, W, H);
    });
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.72;
    ctx.drawImage(chrome, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
}

/**
 * ラメ / グリッター描画
 * ゲルの中に封入された輝く粒子
 * シード固定で画像ごとに同じ配置
 */
function drawGlitter(ctx, img, ox, oy, strength, type, s1, s2) {
  const sc = mk(img.width, img.height);
  sc.getContext('2d').drawImage(img, 0, 0);
  const px = sc.getContext('2d').getImageData(0, 0, img.width, img.height).data;

  // シード固定の疑似乱数
  function rng(i) {
    const v = Math.sin(s1 * 4.1 + s2 * 2.7 + i * 37.3) * 43758.5;
    return v - Math.floor(v);
  }

  const count = Math.floor(strength / 100 * 1800) + 20;
  ctx.save();

  for (let i = 0; i < count * 3; i++) {
    const lx = Math.floor(rng(i * 4)     * img.width);
    const ly = Math.floor(rng(i * 4 + 1) * img.height);
    if (px[(ly * img.width + lx) * 4 + 3] < 60) continue;

    const x     = ox + lx;
    const y     = oy + ly;
    const size  = 0.75 + rng(i * 4 + 2) * (strength / 100 * 8 + 2);
    const alpha = 0.45 + rng(i * 4 + 3) * 0.55;
    const angle = rng(i * 7) * Math.PI;

    let rgb;
    if (type === 'silver') {
      const v = Math.floor(220 + rng(i * 11) * 35);
      rgb = [v, v, Math.min(255, v + 10)];
    } else if (type === 'gold') {
      rgb = [
        Math.floor(220 + rng(i * 11) * 35),
        Math.floor(155 + rng(i * 13) * 55),
        Math.floor(20  + rng(i * 17) * 30),
      ];
    } else {
      const hue = rng(i * 19);
      rgb = hslToRgb(hue, 0.95, 0.72);
    }

    drawOneSparkle(ctx, x, y, size, alpha, rgb, angle);
    if (i >= count) break;  // 有効配置がcountに達したら終了
  }

  ctx.restore();
}

function drawOneSparkle(ctx, x, y, r, alpha, [cr, cg, cb], angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 4点星（細い十字＋斜め十字）
  for (let pass = 0; pass < 2; pass++) {
    ctx.save();
    ctx.rotate(pass * Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.10,  0, 0,  r);
    ctx.quadraticCurveTo(-r * 0.10, 0, 0, -r);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * (pass === 0 ? 0.90 : 0.55)})`;
    ctx.fill();
    ctx.restore();
  }

  // 中心の白い輝き
  const cGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.55);
  cGrad.addColorStop(0,   `rgba(255,255,255,${alpha})`);
  cGrad.addColorStop(0.4, `rgba(${cr},${cg},${cb},${alpha * 0.6})`);
  cGrad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = cGrad;
  ctx.fill();

  // 外側のソフトグロー
  const gGrad = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.5);
  gGrad.addColorStop(0,   `rgba(${cr},${cg},${cb},${alpha * 0.22})`);
  gGrad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fillStyle = gGrad;
  ctx.fill();

  ctx.restore();
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 1/6) { r=c; g=x; b=0; }
  else if (h < 2/6) { r=x; g=c; b=0; }
  else if (h < 3/6) { r=0; g=c; b=x; }
  else if (h < 4/6) { r=0; g=x; b=c; }
  else if (h < 5/6) { r=x; g=0; b=c; }
  else              { r=c; g=0; b=x; }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

// ── UTILITIES ──
function mk(w, h) { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; }
function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
}
function blobToDataURL(blob) {
  return new Promise(res => { const fr=new FileReader(); fr.onload=e=>res(e.target.result); fr.readAsDataURL(blob); });
}

// ── ACTIONS ──
function downloadSticker() {
  const a = document.createElement('a');
  a.download = 'pukku-sticker.png';
  a.href = outCanvas.toDataURL('image/png');
  a.click();
}
function resetImage() {
  state.cutoutImg = null;
  document.getElementById('edit-section').hidden = true;
  document.getElementById('upload-section').style.display = '';
  fileInput.value = '';
}

// ── STATUS ──
function setStatus(show, text = '') {
  const el = document.getElementById('status');
  el.classList.toggle('visible', show);
  if (text) document.getElementById('status-text').textContent = text;
}
