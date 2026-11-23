/** Visual effects: bullet-hole and blood decals, particles, tracers, casings. Visual RNG only. */
import * as THREE from "three";
import { CFG } from "../config.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function canvasTex(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const holeTex = () =>
  canvasTex(128, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, "rgba(0,0,0,1)");
    grd.addColorStop(0.16, "rgba(0,0,0,1)");
    grd.addColorStop(0.24, "rgba(34,30,26,0.95)");
    grd.addColorStop(0.42, "rgba(60,56,50,0.55)");
    grd.addColorStop(0.75, "rgba(70,66,60,0.14)");
    grd.addColorStop(1, "rgba(70,66,60,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(8,8,8,0.8)";
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      let r = s * 0.1, x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      g.lineWidth = rnd(0.8, 2);
      g.beginPath();
      g.moveTo(x, y);
      const n = 2 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) {
        r += rnd(5, 12);
        const aa = a + rnd(-0.35, 0.35);
        g.lineTo(c + Math.cos(aa) * r, c + Math.sin(aa) * r);
      }
      g.stroke();
    }
    // chipped light rim
    g.strokeStyle = "rgba(190,184,170,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, s * 0.2, rnd(0, 3), rnd(3.5, 6));
    g.stroke();
  });

const bloodTex = () =>
  canvasTex(256, (g, s) => {
    const c = s / 2;
    g.fillStyle = "#fff";
    const blob = (x, y, r) => {
      g.beginPath();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * rnd(0.72, 1.15);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
    };
    blob(c, c, s * 0.2);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = rnd(0.12, 0.44) * s;
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d, rnd(2, 15) * (1 - d / s));
    }
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = rnd(1.5, 5);
      g.strokeStyle = "#fff";
      g.beginPath();
      g.moveTo(c + Math.cos(a) * s * 0.12, c + Math.sin(a) * s * 0.12);
      g.lineTo(c + Math.cos(a) * s * rnd(0.3, 0.47), c + Math.sin(a) * s * rnd(0.3, 0.47));
      g.stroke();
    }
  });

const flashTex = () =>
  canvasTex(128, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, "rgba(255,255,235,1)");
    grd.addColorStop(0.2, "rgba(255,214,120,0.95)");
    grd.addColorStop(0.5, "rgba(255,120,30,0.35)");
    grd.addColorStop(1, "rgba(255,80,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgba(255,230,160,0.8)";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(-0.2, 0.2), r = s * rnd(0.3, 0.5);
      g.beginPath();
      g.moveTo(c + Math.cos(a - 0.14) * 6, c + Math.sin(a - 0.14) * 6);
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      g.lineTo(c + Math.cos(a + 0.14) * 6, c + Math.sin(a + 0.14) * 6);
      g.fill();
    }
  });

/** Ring-buffer of oriented quads in one draw call. */
class DecalPool {
  constructor(scene, cap, material) {
    this.cap = cap;
    this.i = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, cap);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    for (let k = 0; k < cap; k++) this.mesh.setMatrixAt(k, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }
  add(pos, normal, size, lift = 0.006) {
    const idx = this.i;
    this.i = (this.i + 1) % this.cap;
    this.set(idx, pos, normal, size, Math.random() * Math.PI * 2, lift);
    return idx;
  }
  set(idx, pos, normal, size, spin, lift = 0.006) {
    _q.setFromUnitVectors(_z, normal);
    _q2.setFromAxisAngle(_z, spin);
    _q.multiply(_q2);
    _p.copy(pos).addScaledVector(normal, lift + idx * 0.00002);
    _s.set(size, size, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(idx, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    for (let k = 0; k < this.cap; k++) this.mesh.setMatrixAt(k, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.bloodOn = true;
    const decalOpts = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
    this.holes = new DecalPool(scene, CFG.fx.decals, new THREE.MeshStandardMaterial({ map: holeTex(), roughness: 0.95, ...decalOpts }));
    const bt = bloodTex();
    this.blood = new DecalPool(
      scene,
      CFG.fx.blood,
      // wet: low roughness so lamps and the muzzle flash glint off it
      new THREE.MeshStandardMaterial({ color: 0x3c0204, alphaMap: bt, roughness: 0.1, metalness: 0.0, ...decalOpts }),
    );
    this.pools = []; // growing blood pools

    // ── particles ──
    const N = (this.N = CFG.fx.particles);
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 4);
    this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pGrav = new Float32Array(N);
    this.pKind = new Uint8Array(N); // 1 = blood drop (leaves a floor splat)
    this.pi = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute("pcolor", new THREE.BufferAttribute(this.pCol, 4));
    geo.setAttribute("psize", new THREE.BufferAttribute(this.pSize, 1));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec4 pcolor; attribute float psize; uniform float uScale; varying vec4 vC;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d);
          if (r > 0.25) discard; float a = smoothstep(0.25, 0.08, r) * vC.a; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // ── tracers ──
    this.tracers = [];
    const tGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
    tGeo.translate(0, 0, 0.5);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ m, t: 0 });
    }
    this.ti = 0;

    // ── casings ──
    this.casings = [];
    const cGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.022, 6);
    const cMat = new THREE.MeshStandardMaterial({ color: 0xc9992e, metalness: 1, roughness: 0.28 });
    for (let i = 0; i < CFG.fx.casings; i++) {
      const m = new THREE.Mesh(cGeo, cMat);
      m.visible = false;
      scene.add(m);
      this.casings.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0, rest: false });
    }
    this.ci = 0;

    this.flashTex = flashTex();
    this.floorN = new THREE.Vector3(0, 1, 0);
    this.onCasing = null;
  }

  resize(h, fovDeg) {
    this.pMat.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  _spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav, kind = 0) {
    const i = this.pi;
    this.pi = (this.pi + 1) % this.N;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 4] = r; this.pCol[i * 4 + 1] = g; this.pCol[i * 4 + 2] = b; this.pCol[i * 4 + 3] = a;
    this.pSize[i] = size;
    this.pLife[i] = this.pMax[i] = life;
    this.pGrav[i] = grav;
    this.pKind[i] = kind;
  }

  /** Blood spray leaving a body along `dir`. */
  bloodBurst(p, dir, n = 12, power = 1) {
    if (!this.bloodOn) return;
    n = Math.round(n * 1.8);
    for (let i = 0; i < n; i++) {
      const sp = rnd(1, 4.5) * power;
      const k = rnd(0.16, 0.34);
      this._spawn(p.x, p.y, p.z, dir.x * sp + rnd(-1.3, 1.3), dir.y * sp + rnd(-0.3, 2.2) * power, dir.z * sp + rnd(-1.3, 1.3),
        k, 0.0, 0.005, 1, rnd(0.008, 0.026), rnd(0.5, 1.1), 9.8, Math.random() < 0.17 ? 1 : 0);
    }
    // fine red mist
    for (let i = 0; i < 4; i++)
      this._spawn(p.x, p.y, p.z, dir.x * rnd(0.3, 1.2) + rnd(-0.4, 0.4), rnd(-0.1, 0.6), dir.z * rnd(0.3, 1.2) + rnd(-0.4, 0.4), 0.22, 0.01, 0.01, 0.22, rnd(0.09, 0.18), rnd(0.2, 0.4), 0.6);
  }

  dust(p, n, count = 9) {
    for (let i = 0; i < count; i++) {
      const sp = rnd(0.4, 2.2), c = rnd(0.32, 0.5);
      this._spawn(p.x, p.y, p.z, n.x * sp + rnd(-0.7, 0.7), n.y * sp + rnd(-0.2, 0.9), n.z * sp + rnd(-0.7, 0.7), c, c * 0.97, c * 0.9, 0.22, rnd(0.12, 0.3), rnd(0.4, 0.9), 1.2);
    }
    for (let i = 0; i < 4; i++) {
      const c = rnd(0.25, 0.4);
      this._spawn(p.x, p.y, p.z, n.x * rnd(1, 4) + rnd(-1.5, 1.5), n.y * rnd(1, 4) + rnd(0, 2), n.z * rnd(1, 4) + rnd(-1.5, 1.5), c, c, c, 1, rnd(0.008, 0.02), rnd(0.4, 0.8), 9.8);
    }
  }

  sparks(p, n, count = 8) {
    for (let i = 0; i < count; i++) {
      const sp = rnd(2, 8);
      this._spawn(p.x, p.y, p.z, n.x * sp + rnd(-2.5, 2.5), n.y * sp + rnd(-1, 3), n.z * sp + rnd(-2.5, 2.5), 5, 2.8, 0.8, 1, rnd(0.005, 0.012), rnd(0.12, 0.35), 9.8);
    }
  }

  bulletHole(p, n, size = 0.11) {
    this.holes.add(p, n, size * rnd(0.85, 1.3));
  }
  bloodSplat(p, n, size) {
    if (this.bloodOn) this.blood.add(p, n, size, 0.009);
  }
  /** A pool that keeps spreading under a corpse. */
  bloodPool(p, target = 1.5) {
    if (!this.bloodOn) return;
    const pos = new THREE.Vector3(p.x, 0, p.z);
    const spin = Math.random() * Math.PI * 2;
    const idx = this.blood.add(pos, this.floorN, 0.2, 0.011);
    this.pools.push({ idx, pos, spin, size: 0.2, target: target * rnd(0.8, 1.25) });
  }

  tracer(from, to) {
    const t = this.tracers[this.ti];
    this.ti = (this.ti + 1) % this.tracers.length;
    t.m.position.copy(from);
    t.m.lookAt(to);
    t.m.scale.set(1, 1, Math.max(0.1, from.distanceTo(to)));
    t.m.material.opacity = 0.55;
    t.m.visible = true;
    t.t = 0.055;
  }

  casing(pos, vel) {
    const c = this.casings[this.ci];
    this.ci = (this.ci + 1) % this.casings.length;
    c.m.position.copy(pos);
    c.v.copy(vel);
    c.w.set(rnd(-20, 20), rnd(-20, 20), rnd(-20, 20));
    c.t = 5;
    c.rest = false;
    c.bounced = 0;
    c.m.visible = true;
  }

  update(dt) {
    // particles
    const P = this.pPos, V = this.pVel, C = this.pCol;
    for (let i = 0; i < this.N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const j = i * 3;
      if (this.pLife[i] <= 0) {
        C[i * 4 + 3] = 0;
        this.pSize[i] = 0;
        continue;
      }
      V[j + 1] -= this.pGrav[i] * dt;
      const drag = this.pGrav[i] < 5 ? 1 - 2.2 * dt : 1 - 0.3 * dt;
      V[j] *= drag; V[j + 2] *= drag;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (P[j + 1] < 0.02 && this.pGrav[i] > 5) {
        if (this.pKind[i] === 1 && P[j] > -6 && P[j] < 4) {
          _p.set(P[j], 0, P[j + 2]);
          this.bloodSplat(_p, this.floorN, rnd(0.12, 0.42));
        }
        this.pLife[i] = 0;
        C[i * 4 + 3] = 0;
        this.pSize[i] = 0;
        continue;
      }
      if (this.pGrav[i] < 5) C[i * 4 + 3] *= 1 - 2.4 * dt; // dust and mist fade
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.psize.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.t -= dt;
      t.m.material.opacity = Math.max(0, t.t / 0.055) * 0.55;
      if (t.t <= 0) t.m.visible = false;
    }

    for (const c of this.casings) {
      if (!c.m.visible) continue;
      c.t -= dt;
      if (c.t <= 0) { c.m.visible = false; continue; }
      if (c.rest) continue;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      if (c.m.position.y < 0.012) {
        c.m.position.y = 0.012;
        if (c.bounced < 2 && this.onCasing) this.onCasing(c.m.position);
        c.bounced++;
        if (Math.abs(c.v.y) < 0.6) { c.rest = true; c.m.rotation.set(Math.PI / 2, 0, Math.random() * 6); }
        else { c.v.y *= -0.38; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.6); }
      }
    }

    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.size += (p.target - p.size) * Math.min(1, dt * 0.55);
      this.blood.set(p.idx, p.pos, this.floorN, p.size, p.spin, 0.011);
      if (p.target - p.size < 0.02) this.pools.splice(i, 1);
    }
  }

  reset() {
    this.holes.clear();
    this.blood.clear();
    this.pools.length = 0;
    this.pLife.fill(0);
    this.pSize.fill(0);
    for (const c of this.casings) c.m.visible = false;
  }
}
