const sharp = require("sharp");
const { spawn } = require("child_process");
const path = require("path");

const SRC =
  "C:\\Users\\DELL\\.cursor\\projects\\c-Users-DELL-OneDrive-Desktop-p2\\assets\\c__Users_DELL_AppData_Roaming_Cursor_User_workspaceStorage_6cb97859cbcb643a4f9c2f499e763125_images_image-bbf4e7e7-814c-4976-80cf-fda598044323.png";
const OUT = path.join(__dirname, "animation videos", "meadow-ride.mp4");

const SCALE = 3;
const FPS = 24;
const SECONDS = 8;
const PREVIEW = process.argv.includes("--preview");

function isStrongGrass(r, g, b) {
  return g > r + 12 && g > b + 6 && g > 90 && r < 215;
}

function isCloudSeed(r, g, b) {
  return r > 214 && g > 214 && b > 200 && g - r < 20;
}

function canGrowCloud(r, g, b) {
  if (isStrongGrass(r, g, b)) return false;
  const lum = (r + g + b) / 3;
  return lum > 148 && g - r < 34;
}

function dilate(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let yy = y0; yy <= y1 && !on; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          if (mask[row + xx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function erode(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  const need = (radius * 2 + 1) * (radius * 2 + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let count = 0;
      let ok = 1;
      for (let dy = -radius; dy <= radius && ok; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) {
          ok = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || !mask[yy * w + xx]) {
            ok = 0;
            break;
          }
          count++;
        }
      }
      out[y * w + x] = ok && count === need ? 1 : 0;
    }
  }
  return out;
}

function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const qx = [];
  const qy = [];
  for (let x = 0; x < w; x++) {
    if (!mask[x]) {
      outside[x] = 1;
      qx.push(x);
      qy.push(0);
    }
    const b = (h - 1) * w + x;
    if (!mask[b]) {
      outside[b] = 1;
      qx.push(x);
      qy.push(h - 1);
    }
  }
  for (let y = 0; y < h; y++) {
    const l = y * w;
    if (!mask[l] && !outside[l]) {
      outside[l] = 1;
      qx.push(0);
      qy.push(y);
    }
    const r = y * w + w - 1;
    if (!mask[r] && !outside[r]) {
      outside[r] = 1;
      qx.push(w - 1);
      qy.push(y);
    }
  }
  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const nbs = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (mask[n] || outside[n]) continue;
      outside[n] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) {
    if (!out[i] && !outside[i]) out[i] = 1;
  }
  return out;
}

function removeSmall(mask, w, h, minSize) {
  const seen = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const qx = [];
  const qy = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      qx.length = 0;
      qy.length = 0;
      qx.push(x);
      qy.push(y);
      seen[start] = 1;
      let head = 0;
      while (head < qx.length) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        const nbs = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (!mask[n] || seen[n]) continue;
          seen[n] = 1;
          qx.push(nx);
          qy.push(ny);
        }
      }
      if (qx.length >= minSize) {
        for (let i = 0; i < qx.length; i++) out[qy[i] * w + qx[i]] = 1;
      }
    }
  }
  return out;
}

function boxBlurMask(mask, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += mask[y * w + x];
      if (x >= radius) sum -= mask[y * w + (x - radius)];
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x);
      const div = x1 - x0 + (x < radius ? 1 : radius);
      tmp[y * w + x] = sum / (x >= radius ? radius + Math.min(radius, w - 1 - (x - radius)) : x + 1);
    }
  }
  // The running-sum above is easy to get wrong. Use a simple clamped box instead.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let xx = x0; xx <= x1; xx++) {
        sum += mask[y * w + xx];
        count++;
      }
      tmp[y * w + x] = sum / count;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let yy = y0; yy <= y1; yy++) {
        sum += tmp[yy * w + x];
        count++;
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

function boxBlurRgb(rgb, w, h, radius) {
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      for (let xx = x0; xx <= x1; xx++) {
        const p = (y * w + xx) * 3;
        r += rgb[p];
        g += rgb[p + 1];
        b += rgb[p + 2];
        count++;
      }
      const o = (y * w + x) * 3;
      tmp[o] = r / count;
      tmp[o + 1] = g / count;
      tmp[o + 2] = b / count;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      for (let yy = y0; yy <= y1; yy++) {
        const p = (yy * w + x) * 3;
        r += tmp[p];
        g += tmp[p + 1];
        b += tmp[p + 2];
        count++;
      }
      const o = (y * w + x) * 3;
      out[o] = r / count;
      out[o + 1] = g / count;
      out[o + 2] = b / count;
    }
  }
  return out;
}

function buildCloudMask(rgb, w, h) {
  let mask = new Uint8Array(w * h);
  const qx = [];
  const qy = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 3;
      if (!isCloudSeed(rgb[p], rgb[p + 1], rgb[p + 2])) continue;
      mask[y * w + x] = 1;
      qx.push(x);
      qy.push(y);
    }
  }
  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n]) continue;
        const p = n * 3;
        if (!canGrowCloud(rgb[p], rgb[p + 1], rgb[p + 2])) continue;
        mask[n] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }
  mask = dilate(mask, w, h, 4);
  mask = fillHoles(mask, w, h);
  mask = erode(mask, w, h, 1);
  mask = removeSmall(mask, w, h, 2500);
  const near = dilate(mask, w, h, 6);
  for (let i = 0; i < mask.length; i++) {
    if (!near[i] || mask[i]) continue;
    const p = i * 3;
    const r = rgb[p];
    const g = rgb[p + 1];
    const b = rgb[p + 2];
    if (r > 196 && g > 196 && b > 186 && g - r < 24) mask[i] = 1;
  }
  return fillHoles(mask, w, h);
}

function buildRiderMask(rgb, cloud, w, h) {
  const x0 = Math.floor(178 * SCALE);
  const x1 = Math.floor(236 * SCALE);
  const y0 = Math.floor(436 * SCALE);
  const y1 = Math.floor(520 * SCALE);
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let count = 0;
  for (let y = y0 - 18; y < y1 + 28; y++) {
    for (let x = x0 - 24; x < x1 + 30; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const p = (y * w + x) * 3;
      const r = rgb[p];
      const g = rgb[p + 1];
      const b = rgb[p + 2];
      if (!isStrongGrass(r, g, b)) continue;
      rs += r;
      gs += g;
      bs += b;
      count++;
    }
  }
  const mr = rs / Math.max(1, count);
  const mg = gs / Math.max(1, count);
  const mb = bs / Math.max(1, count);
  const core = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const n = y * w + x;
      if (cloud[n]) continue;
      const p = n * 3;
      const r = rgb[p];
      const g = rgb[p + 1];
      const b = rgb[p + 2];
      const dist = Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb);
      if (dist > 48) core[n] = 1;
    }
  }
  const body = erode(dilate(removeSmall(core, w, h, 40), w, h, 10), w, h, 3);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < body.length; i++) if (body[i]) mask[i] = 1;

  const sx1 = x1 + Math.floor(28 * SCALE);
  const sy1 = y1 + Math.floor(26 * SCALE);
  for (let y = y1 - Math.floor(8 * SCALE); y < sy1; y++) {
    for (let x = x0 + Math.floor(6 * SCALE); x < sx1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const n = y * w + x;
      if (mask[n] || cloud[n]) continue;
      const p = n * 3;
      const r = rgb[p];
      const g = rgb[p + 1];
      const b = rgb[p + 2];
      const lum = (r + g + b) / 3;
      const grassLum = (mr + mg + mb) / 3;
      if (!(g > r && lum < grassLum - 28)) continue;
      let near = false;
      for (let dy = -10; dy <= 4 && !near; dy += 2) {
        for (let dx = -6; dx <= 8; dx += 2) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (body[yy * w + xx]) near = true;
        }
      }
      if (false && near) mask[n] = 2;
    }
  }
  let bodyCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) bodyCount++;
  console.log("Rider body pixels", bodyCount);
  return mask;
}

function buildShadowMask(rgb, cloud, rider, w, h) {
  const rough = new Uint8Array(w * h);
  const hist = new Uint16Array(256);
  const rowMedian = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    let count = 0;
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      if (cloud[n] || rider[n]) continue;
      const p = n * 3;
      const r = rgb[p];
      const g = rgb[p + 1];
      const b = rgb[p + 2];
      if (!isStrongGrass(r, g, b)) continue;
      const lum = Math.max(0, Math.min(255, (r + g + b) / 3));
      hist[lum]++;
      count++;
    }
    let need = Math.floor(count * 0.55);
    let median = 150;
    if (count > 20) {
      let run = 0;
      for (let v = 0; v < 256; v++) {
        run += hist[v];
        if (run >= need) {
          median = v;
          break;
        }
      }
    } else if (y > 0) median = rowMedian[y - 1];
    rowMedian[y] = median;
  }
  for (let y = 0; y < h; y++) {
    const median = rowMedian[y];
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      if (cloud[n] || rider[n]) continue;
      const p = n * 3;
      const r = rgb[p];
      const g = rgb[p + 1];
      const b = rgb[p + 2];
      const lum = (r + g + b) / 3;
      if (g > r + 4 && lum < median - 28) rough[n] = 1;
    }
  }
  const soft = boxBlurMask(rough, w, h, 6);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (soft[i] > 0.45 && !cloud[i] && !rider[i]) mask[i] = 1;
  }
  return removeSmall(mask, w, h, 1800);
}

function fillLand(rgb, valid, w, h) {
  const left = new Int32Array(w * h);
  const right = new Int32Array(w * h);
  left.fill(-1);
  right.fill(-1);
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      if (valid[n]) last = x;
      left[n] = last;
    }
    last = -1;
    for (let x = w - 1; x >= 0; x--) {
      const n = y * w + x;
      if (valid[n]) last = x;
      right[n] = last;
    }
  }

  const base = Buffer.alloc(w * h * 3);
  const unresolved = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      const o = n * 3;
      if (valid[n]) {
        base[o] = rgb[o];
        base[o + 1] = rgb[o + 1];
        base[o + 2] = rgb[o + 2];
        continue;
      }
      const L = left[n];
      const R = right[n];
      if (L >= 0 && R >= 0 && R !== L) {
        const t = (x - L) / (R - L);
        const lp = (y * w + L) * 3;
        const rp = (y * w + R) * 3;
        base[o] = rgb[lp] * (1 - t) + rgb[rp] * t;
        base[o + 1] = rgb[lp + 1] * (1 - t) + rgb[rp + 1] * t;
        base[o + 2] = rgb[lp + 2] * (1 - t) + rgb[rp + 2] * t;
      } else if (L >= 0) {
        const lp = (y * w + L) * 3;
        base[o] = rgb[lp];
        base[o + 1] = rgb[lp + 1];
        base[o + 2] = rgb[lp + 2];
      } else if (R >= 0) {
        const rp = (y * w + R) * 3;
        base[o] = rgb[rp];
        base[o + 1] = rgb[rp + 1];
        base[o + 2] = rgb[rp + 2];
      } else {
        unresolved[n] = 1;
      }
    }
  }

  for (let x = 0; x < w; x++) {
    let prev = -1;
    const next = new Int32Array(h);
    next.fill(-1);
    for (let y = 0; y < h; y++) {
      if (!unresolved[y * w + x]) prev = y;
    }
    prev = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (!unresolved[y * w + x]) prev = y;
      next[y] = prev;
    }
    prev = -1;
    for (let y = 0; y < h; y++) {
      const n = y * w + x;
      if (!unresolved[n]) {
        prev = y;
        continue;
      }
      const up = prev;
      const down = next[y];
      const o = n * 3;
      if (up >= 0 && down >= 0) {
        const t = (y - up) / (down - up);
        const upP = (up * w + x) * 3;
        const downP = (down * w + x) * 3;
        base[o] = base[upP] * (1 - t) + base[downP] * t;
        base[o + 1] = base[upP + 1] * (1 - t) + base[downP + 1] * t;
        base[o + 2] = base[upP + 2] * (1 - t) + base[downP + 2] * t;
      } else if (up >= 0) {
        const upP = (up * w + x) * 3;
        base[o] = base[upP];
        base[o + 1] = base[upP + 1];
        base[o + 2] = base[upP + 2];
      } else if (down >= 0) {
        const downP = (down * w + x) * 3;
        base[o] = base[downP];
        base[o + 1] = base[downP + 1];
        base[o + 2] = base[downP + 2];
      }
    }
  }
  return base;
}

function addTexture(base, valid, rgb, w, h) {
  const patchX = Math.floor(30 * SCALE);
  const patchY = Math.floor(590 * SCALE);
  const patchW = Math.floor(280 * SCALE);
  const patchH = Math.floor(80 * SCALE);
  const patch = Buffer.alloc(patchW * patchH * 3);
  for (let y = 0; y < patchH; y++) {
    for (let x = 0; x < patchW; x++) {
      const sp = ((patchY + y) * w + (patchX + x)) * 3;
      const dp = (y * patchW + x) * 3;
      patch[dp] = rgb[sp];
      patch[dp + 1] = rgb[sp + 1];
      patch[dp + 2] = rgb[sp + 2];
    }
  }
  const blurred = boxBlurRgb(patch, patchW, patchH, 8);
  const out = Buffer.from(base);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      if (valid[n]) continue;
      const sx = (x * 3) % patchW;
      const sy = (y * 2) % patchH;
      const sp = (sy * patchW + sx) * 3;
      const o = n * 3;
      const gain = 0.8;
      out[o] = clamp(base[o] + (patch[sp] - blurred[sp]) * gain);
      out[o + 1] = clamp(base[o + 1] + (patch[sp + 1] - blurred[sp + 1]) * gain);
      out[o + 2] = clamp(base[o + 2] + (patch[sp + 2] - blurred[sp + 2]) * gain);
    }
  }
  return out;
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function featherAlpha(mask, w, h, radius) {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      if (!mask[n]) continue;
      let edge = radius;
      for (let dy = -radius; dy <= radius && edge === radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) {
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            if (dist < edge) edge = dist;
          }
        }
      }
      const t = edge / radius;
      alpha[n] = Math.max(0, Math.min(255, Math.round(255 * t * t * (3 - 2 * t))));
    }
  }
  return alpha;
}

function blitNormal(frame, sprite, alpha, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    const srcY = y - dy;
    const y0 = Math.floor(srcY);
    if (y0 < 0 || y0 >= h - 1) continue;
    const ty = srcY - y0;
    const row0 = y0 * w;
    const row1 = row0 + w;
    const dest = y * w;
    for (let x = 0; x < w; x++) {
      const srcX = x - dx;
      const x0 = Math.floor(srcX);
      if (x0 < 0 || x0 >= w - 1) continue;
      const i00 = row0 + x0;
      const a00 = alpha[i00];
      const a10 = alpha[i00 + 1];
      const a01 = alpha[row1 + x0];
      const a11 = alpha[row1 + x0 + 1];
      if (!(a00 | a10 | a01 | a11)) continue;
      const tx = srcX - x0;
      const wa00 = a00 * (1 - tx) * (1 - ty);
      const wa10 = a10 * tx * (1 - ty);
      const wa01 = a01 * (1 - tx) * ty;
      const wa11 = a11 * tx * ty;
      const asum = wa00 + wa10 + wa01 + wa11;
      if (asum < 1) continue;
      const a = asum / 255;
      const p00 = i00 * 3;
      const p10 = p00 + 3;
      const p01 = (row1 + x0) * 3;
      const p11 = p01 + 3;
      const o = (dest + x) * 3;
      const sr = (sprite[p00] * wa00 + sprite[p10] * wa10 + sprite[p01] * wa01 + sprite[p11] * wa11) / asum;
      const sg = (sprite[p00 + 1] * wa00 + sprite[p10 + 1] * wa10 + sprite[p01 + 1] * wa01 + sprite[p11 + 1] * wa11) / asum;
      const sb = (sprite[p00 + 2] * wa00 + sprite[p10 + 2] * wa10 + sprite[p01 + 2] * wa01 + sprite[p11 + 2] * wa11) / asum;
      frame[o] = frame[o] * (1 - a) + sr * a;
      frame[o + 1] = frame[o + 1] * (1 - a) + sg * a;
      frame[o + 2] = frame[o + 2] * (1 - a) + sb * a;
    }
  }
}

function blitShadow(frame, factor, alpha, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    const srcY = y - dy;
    const y0 = Math.floor(srcY);
    if (y0 < 0 || y0 >= h - 1) continue;
    const ty = srcY - y0;
    const row0 = y0 * w;
    const row1 = row0 + w;
    const dest = y * w;
    for (let x = 0; x < w; x++) {
      const srcX = x - dx;
      const x0 = Math.floor(srcX);
      if (x0 < 0 || x0 >= w - 1) continue;
      const i00 = row0 + x0;
      const a00 = alpha[i00];
      const a10 = alpha[i00 + 1];
      const a01 = alpha[row1 + x0];
      const a11 = alpha[row1 + x0 + 1];
      if (!(a00 | a10 | a01 | a11)) continue;
      const tx = srcX - x0;
      const a = (a00 * (1 - tx) * (1 - ty) + a10 * tx * (1 - ty) + a01 * (1 - tx) * ty + a11 * tx * ty) / 255;
      if (a < 0.004) continue;
      const f = (factor[i00] * (1 - tx) * (1 - ty) + factor[i00 + 1] * tx * (1 - ty) + factor[row1 + x0] * (1 - tx) * ty + factor[row1 + x0 + 1] * tx * ty) / 255;
      const shade = 1 - a + a * f;
      const o = (dest + x) * 3;
      frame[o] *= shade;
      frame[o + 1] *= shade;
      frame[o + 2] *= shade;
    }
  }
}

function blitRider(frame, sprite, kind, bounds, w, h, dx, dy, scale) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const destCx = cx + dx;
  const destCy = cy + dy;
  const halfW = ((bounds.maxX - bounds.minX) / 2) * scale + 3;
  const halfH = ((bounds.maxY - bounds.minY) / 2) * scale + 3;
  const yStart = Math.max(1, Math.floor(destCy - halfH));
  const yEnd = Math.min(h - 2, Math.ceil(destCy + halfH));
  const xStart = Math.max(1, Math.floor(destCx - halfW));
  const xEnd = Math.min(w - 2, Math.ceil(destCx + halfW));
  for (let y = yStart; y <= yEnd; y++) {
    const sy = cy + (y - destCy) / scale;
    const y0 = Math.floor(sy);
    const ty = sy - y0;
    if (y0 < bounds.minY || y0 + 1 > bounds.maxY) continue;
    for (let x = xStart; x <= xEnd; x++) {
      const sx = cx + (x - destCx) / scale;
      const x0 = Math.floor(sx);
      const tx = sx - x0;
      if (x0 < bounds.minX || x0 + 1 > bounds.maxX) continue;
      const i00 = y0 * w + x0;
      const i10 = i00 + 1;
      const i01 = i00 + w;
      const i11 = i01 + 1;
      const k00 = kind[i00];
      const k10 = kind[i10];
      const k01 = kind[i01];
      const k11 = kind[i11];
      if (!(k00 | k10 | k01 | k11)) continue;
      const body =
        (k00 === 1 ? (1 - tx) * (1 - ty) : 0) +
        (k10 === 1 ? tx * (1 - ty) : 0) +
        (k01 === 1 ? (1 - tx) * ty : 0) +
        (k11 === 1 ? tx * ty : 0);
      const shade =
        (k00 === 2 ? (1 - tx) * (1 - ty) : 0) +
        (k10 === 2 ? tx * (1 - ty) : 0) +
        (k01 === 2 ? (1 - tx) * ty : 0) +
        (k11 === 2 ? tx * ty : 0);
      const o = (y * w + x) * 3;
      if (shade > 0.02) {
        const p00 = i00 * 3;
        const p10 = i10 * 3;
        const p01 = i01 * 3;
        const p11 = i11 * 3;
        const sr = sprite[p00] * (1 - tx) * (1 - ty) + sprite[p10] * tx * (1 - ty) + sprite[p01] * (1 - tx) * ty + sprite[p11] * tx * ty;
        const sg = sprite[p00 + 1] * (1 - tx) * (1 - ty) + sprite[p10 + 1] * tx * (1 - ty) + sprite[p01 + 1] * (1 - tx) * ty + sprite[p11 + 1] * tx * ty;
        const sb = sprite[p00 + 2] * (1 - tx) * (1 - ty) + sprite[p10 + 2] * tx * (1 - ty) + sprite[p01 + 2] * (1 - tx) * ty + sprite[p11 + 2] * tx * ty;
        const lum = (sr + sg + sb) / 3;
        const f = Math.max(0.42, Math.min(1, lum / 168));
        const amount = Math.min(0.85, shade);
        const m = 1 - amount + amount * f;
        frame[o] *= m;
        frame[o + 1] *= m;
        frame[o + 2] *= m;
      }
      if (body > 0.02) {
        const p00 = i00 * 3;
        const p10 = i10 * 3;
        const p01 = i01 * 3;
        const p11 = i11 * 3;
        const sr = sprite[p00] * (1 - tx) * (1 - ty) + sprite[p10] * tx * (1 - ty) + sprite[p01] * (1 - tx) * ty + sprite[p11] * tx * ty;
        const sg = sprite[p00 + 1] * (1 - tx) * (1 - ty) + sprite[p10 + 1] * tx * (1 - ty) + sprite[p01 + 1] * (1 - tx) * ty + sprite[p11 + 1] * tx * ty;
        const sb = sprite[p00 + 2] * (1 - tx) * (1 - ty) + sprite[p10 + 2] * tx * (1 - ty) + sprite[p01 + 2] * (1 - tx) * ty + sprite[p11 + 2] * tx * ty;
        frame[o] = frame[o] * (1 - body) + sr * body;
        frame[o + 1] = frame[o + 1] * (1 - body) + sg * body;
        frame[o + 2] = frame[o + 2] * (1 - body) + sb * body;
      }
    }
  }
}

async function writePng(file, rgb, w, h) {
  await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(file);
}

function downsampleLevel(color, weight, w, h) {
  const nw = Math.floor(w / 2);
  const nh = Math.floor(h / 2);
  const nextColor = new Float32Array(nw * nh * 3);
  const nextWeight = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let wt = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const si = (y * 2 + dy) * w + (x * 2 + dx);
          const sw = weight[si];
          if (!sw) continue;
          r += color[si * 3] * sw;
          g += color[si * 3 + 1] * sw;
          b += color[si * 3 + 2] * sw;
          wt += sw;
        }
      }
      const di = y * nw + x;
      if (wt) {
        nextColor[di * 3] = r / wt;
        nextColor[di * 3 + 1] = g / wt;
        nextColor[di * 3 + 2] = b / wt;
        nextWeight[di] = 1;
      }
    }
  }
  return { color: nextColor, weight: nextWeight, w: nw, h: nh };
}

function diffuse(color, weight, w, h, hole, iters) {
  const next = new Float32Array(color.length);
  const nextWeight = new Float32Array(weight.length);
  for (let iter = 0; iter < iters; iter++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) {
          next[i * 3] = color[i * 3];
          next[i * 3 + 1] = color[i * 3 + 1];
          next[i * 3 + 2] = color[i * 3 + 2];
          nextWeight[i] = weight[i];
          continue;
        }
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!weight[j]) continue;
            r += color[j * 3];
            g += color[j * 3 + 1];
            b += color[j * 3 + 2];
            count++;
          }
        }
        if (count) {
          next[i * 3] = r / count;
          next[i * 3 + 1] = g / count;
          next[i * 3 + 2] = b / count;
          nextWeight[i] = 1;
        } else {
          next[i * 3] = color[i * 3];
          next[i * 3 + 1] = color[i * 3 + 1];
          next[i * 3 + 2] = color[i * 3 + 2];
          nextWeight[i] = 0;
        }
      }
    }
    color.set(next);
    weight.set(nextWeight);
  }
}

function upsampleIntoHoles(fine, parent) {
  const { color, weight, w, h } = fine;
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) * parent.h) / h - 0.5;
    const y0 = Math.max(0, Math.min(parent.h - 1, Math.floor(fy)));
    const y1 = Math.min(parent.h - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (weight[i]) continue;
      const fx = ((x + 0.5) * parent.w) / w - 0.5;
      const x0 = Math.max(0, Math.min(parent.w - 1, Math.floor(fx)));
      const x1 = Math.min(parent.w - 1, x0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      const i00 = (y0 * parent.w + x0) * 3;
      const i10 = (y0 * parent.w + x1) * 3;
      const i01 = (y1 * parent.w + x0) * 3;
      const i11 = (y1 * parent.w + x1) * 3;
      color[i * 3] = colorAt(parent.color, i00, i10, i01, i11, 0, tx, ty);
      color[i * 3 + 1] = colorAt(parent.color, i00, i10, i01, i11, 1, tx, ty);
      color[i * 3 + 2] = colorAt(parent.color, i00, i10, i01, i11, 2, tx, ty);
      weight[i] = 1;
    }
  }
}

function colorAt(color, i00, i10, i01, i11, channel, tx, ty) {
  return (
    color[i00 + channel] * (1 - tx) * (1 - ty) +
    color[i10 + channel] * tx * (1 - ty) +
    color[i01 + channel] * (1 - tx) * ty +
    color[i11 + channel] * tx * ty
  );
}

function chamferFromHole(hole, w, h) {
  const dist = new Uint16Array(w * h);
  dist.fill(4000);
  for (let i = 0; i < hole.length; i++) if (hole[i]) dist[i] = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = dist[i];
      if (x > 0) best = Math.min(best, dist[i - 1] + 3);
      if (y > 0) best = Math.min(best, dist[i - w] + 3);
      if (x > 0 && y > 0) best = Math.min(best, dist[i - w - 1] + 4);
      if (x + 1 < w && y > 0) best = Math.min(best, dist[i - w + 1] + 4);
      dist[i] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let best = dist[i];
      if (x + 1 < w) best = Math.min(best, dist[i + 1] + 3);
      if (y + 1 < h) best = Math.min(best, dist[i + w] + 3);
      if (x + 1 < w && y + 1 < h) best = Math.min(best, dist[i + w + 1] + 4);
      if (x > 0 && y + 1 < h) best = Math.min(best, dist[i + w - 1] + 4);
      dist[i] = best;
    }
  }
  return dist;
}

function buildLandPlate(rgb, hole, w, h) {
  const color = new Float32Array(w * h * 3);
  const weight = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 3;
    color[p] = rgb[p];
    color[p + 1] = rgb[p + 1];
    color[p + 2] = rgb[p + 2];
    weight[i] = hole[i] ? 0 : 1;
  }
  const levels = [{ color, weight, w, h, hole }];
  while (levels[levels.length - 1].w > 28 && levels[levels.length - 1].h > 28) {
    const prev = levels[levels.length - 1];
    const next = downsampleLevel(prev.color, prev.weight, prev.w, prev.h);
    const nextHole = new Uint8Array(next.w * next.h);
    for (let i = 0; i < nextHole.length; i++) nextHole[i] = next.weight[i] ? 0 : 1;
    next.hole = nextHole;
    levels.push(next);
  }
  const coarse = levels[levels.length - 1];
  diffuse(coarse.color, coarse.weight, coarse.w, coarse.h, coarse.hole, 48);
  for (let level = levels.length - 2; level >= 0; level--) {
    const fine = levels[level];
    upsampleIntoHoles(fine, levels[level + 1]);
    if (level > 0) diffuse(fine.color, fine.weight, fine.w, fine.h, fine.hole, 2);
  }

  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const p = i * 3;
    if (!hole[i]) {
      out[p] = rgb[p];
      out[p + 1] = rgb[p + 1];
      out[p + 2] = rgb[p + 2];
    } else {
      out[p] = clamp(color[p]);
      out[p + 1] = clamp(color[p + 1]);
      out[p + 2] = clamp(color[p + 2]);
    }
  }
  return out;
}

function buildStillLand(rgb, cloud, rider, w, h, rim) {
  const srcX = new Int16Array(w * h);
  const srcY = new Int16Array(w * h);
  srcX.fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cloud[i] && !rider[i]) {
        srcX[i] = x;
        srcY[i] = y;
      }
    }
  }
  const relax = (yStart, yEnd, yStep, xStart, xEnd, xStep) => {
    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep) {
        const i = y * w + x;
        let bestX = srcX[i];
        let bestY = srcY[i];
        let bestD = bestX < 0 ? 1e15 : (bestX - x) * (bestX - x) + (bestY - y) * (bestY - y);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (srcX[j] < 0) continue;
            const ddx = srcX[j] - x;
            const ddy = srcY[j] - y;
            const d = ddx * ddx + ddy * ddy;
            if (d < bestD) {
              bestD = d;
              bestX = srcX[j];
              bestY = srcY[j];
            }
          }
        }
        srcX[i] = bestX;
        srcY[i] = bestY;
      }
    }
  };
  relax(0, h, 1, 0, w, 1);
  relax(h - 1, -1, -1, w - 1, -1, -1);

  const out = Buffer.from(rgb);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (srcX[i] < 0) continue;
      const dx = srcX[i] - x;
      const dy = srcY[i] - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const p = i * 3;
      if (rider[i]) {
        const spots = [
          [x - 190, y + 8],
          [x + 170, y + 6],
          [x - 160, y - 30],
        ];
        let placed = false;
        for (const [sx, sy] of spots) {
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const si = sy * w + sx;
          if (rider[si] || cloud[si]) continue;
          const sp = si * 3;
          out[p] = rgb[sp];
          out[p + 1] = rgb[sp + 1];
          out[p + 2] = rgb[sp + 2];
          placed = true;
          break;
        }
        if (!placed) {
          out[p] = rgb[p];
          out[p + 1] = rgb[p + 1];
          out[p + 2] = rgb[p + 2];
        }
        continue;
      }
      if (!(cloud[i] && dist > 0 && dist <= rim)) continue;
      if (dist > rim) continue;
      const sp = (srcY[i] * w + srcX[i]) * 3;
      out[p] = rgb[sp];
      out[p + 1] = rgb[sp + 1];
      out[p + 2] = rgb[sp + 2];
    }
  }
  return out;
}

function stampRider(land, rgb, rider, hole, w, h) {
  const offsets = [
    [-26, 8],
    [24, -6],
    [-18, 22],
    [18, 16],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!rider[i]) continue;
      for (const [dx, dy] of offsets) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (hole[yy * w + xx]) continue;
        const sp = (yy * w + xx) * 3;
        const p = i * 3;
        land[p] = rgb[sp];
        land[p + 1] = rgb[sp + 1];
        land[p + 2] = rgb[sp + 2];
        break;
      }
    }
  }
}

async function main() {
  const meta = await sharp(SRC).metadata();
  const w = meta.width * SCALE;
  const h = meta.height * SCALE;
  console.log(`Working resolution ${w}x${h}`);
  const { data } = await sharp(SRC)
    .resize(w, h, { kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = Buffer.from(data);

  console.log("Masking clouds");
  const cloud = buildCloudMask(rgb, w, h);
  console.log("Masking rider");
  const rider = buildRiderMask(rgb, cloud, w, h);
  console.log("Rebuilding still ground");
  const rim = 16 * SCALE + 8;
  const land = buildStillLand(rgb, cloud, rider, w, h, rim);
  const cloudAlpha = featherAlpha(cloud, w, h, 7);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = y * w + x;
      if (!rider[n]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const bounds = { minX, minY, maxX, maxY };
  console.log("Rider bounds", bounds);

  const cloudTravel = 14 * SCALE;
  const bikeTravel = 46 * SCALE;
  const bikeDirX = 0.38;
  const bikeDirY = -0.925;

  function renderFrame(t) {
    const frame = Buffer.from(land);
    const cdx = cloudTravel * t * 0.72;
    const cdy = cloudTravel * t * 0.69;
    blitNormal(frame, rgb, cloudAlpha, w, h, cdx, cdy);
    const ease = t;
    blitRider(
      frame,
      rgb,
      rider,
      bounds,
      w,
      h,
      bikeDirX * bikeTravel * ease,
      bikeDirY * bikeTravel * ease,
      1 - 0.16 * ease
    );
    return frame;
  }

  if (PREVIEW) {
    console.log("Writing previews");
    await writePng(path.join(__dirname, "preview-land.png"), land, w, h);
    await writePng(path.join(__dirname, "preview-start.png"), renderFrame(0), w, h);
    await writePng(path.join(__dirname, "preview-mid.png"), renderFrame(0.55), w, h);
    await writePng(path.join(__dirname, "preview-end.png"), renderFrame(1), w, h);
    console.log("Previews ready");
    return;
  }

  console.log("Encoding video");
  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-s", `${w}x${h}`,
      "-r", String(FPS),
      "-i", "-",
      "-vf", "scale=1172:2100",
      "-an",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", "17",
      "-preset", "medium",
      "-movflags", "+faststart",
      OUT,
    ]);
    ff.stderr.on("data", (chunk) => process.stderr.write(chunk));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));

    const frames = FPS * SECONDS;
    let index = 0;
    const writeNext = () => {
      while (index < frames) {
        const t = index / (frames - 1);
        const frame = renderFrame(t);
        index++;
        const ok = ff.stdin.write(frame);
        if (!ok) {
          ff.stdin.once("drain", writeNext);
          return;
        }
      }
      ff.stdin.end();
    };
    writeNext();
  });
  console.log(OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
