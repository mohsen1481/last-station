/** The station: geometry, materials, lights, colliders, spawn zones. */
import * as THREE from "three";
import { T } from "../strings.js";

const H = 4.2; // ceiling height
const XB = -6; // back wall
const XE = 4; // platform edge
const XF = 9.5; // far tunnel wall
const PIT = -1.2;
const L = 30; // half platform length
const HALF_PI = Math.PI / 2;

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

function signTexture(text, w, h, bg, fg, sub) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = Math.max(4, h * 0.03);
  g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.direction = "rtl";
  g.font = `800 ${Math.round(h * (sub ? 0.42 : 0.56))}px Vazirmatn, Tahoma, sans-serif`;
  g.fillText(text, w / 2, h * (sub ? 0.4 : 0.54));
  if (sub) {
    g.font = `600 ${Math.round(h * 0.2)}px Vazirmatn, Tahoma, sans-serif`;
    g.fillText(sub, w / 2, h * 0.78);
  }
  // grime
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 40, 1 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildWorld(scene, tx) {
  const solids = []; // meshes bullets can hit
  const colliders = []; // XZ boxes that block bodies
  const lamps = [];

  const std = (set, opts = {}) =>
    new THREE.MeshStandardMaterial({
      map: tx[set + "_basecolor"],
      normalMap: tx[set + "_normal"],
      roughnessMap: tx[set + "_roughness"],
      ...opts,
    });

  const M = {
    wall: std("wall", { roughness: 0.55, normalScale: new THREE.Vector2(1.1, 1.1) }),
    floor: std("floor", { roughness: 0.42, metalness: 0.05, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xdddddd }),
    conc: std("concrete", { roughness: 1.0, color: 0x9a9a9a }),
    concDark: std("concrete", { roughness: 1.0, color: 0x4a4a4a }),
    train: new THREE.MeshStandardMaterial({ map: tx.train, roughness: 0.38, metalness: 0.65, color: 0xcfcfcf }),
    metal: new THREE.MeshStandardMaterial({ color: 0x1b1d1e, roughness: 0.45, metalness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6d7275, roughness: 0.35, metalness: 0.9 }),
    black: new THREE.MeshBasicMaterial({ color: 0x010202 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0x9c8418, roughness: 0.7 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xdff0ff, emissiveIntensity: 3.2 }),
    red: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a10, emissiveIntensity: 3 }),
  };

  const plane = (w, h, mat, rep, pos, rot, solid = true) => {
    const geo = scaleUV(new THREE.PlaneGeometry(w, h), w / rep, h / rep);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.receiveShadow = true;
    scene.add(m);
    if (solid) solids.push(m);
    return m;
  };
  const box = (w, h, d, mat, pos, opts = {}) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (opts.rep) {
      // side faces share one metric so tiles keep their size on every face
      const uv = geo.attributes.uv;
      const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++)
        for (let i = 0; i < 4; i++) {
          const k = f * 4 + i;
          uv.setXY(k, (uv.getX(k) * dims[f][0]) / opts.rep, (uv.getY(k) * dims[f][1]) / opts.rep);
        }
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    scene.add(m);
    if (opts.solid !== false) solids.push(m);
    if (opts.collide) colliders.push({ minX: pos[0] - w / 2, maxX: pos[0] + w / 2, minZ: pos[2] - d / 2, maxZ: pos[2] + d / 2 });
    return m;
  };
  const wallBox = (minX, maxX, minZ, maxZ) => colliders.push({ minX, maxX, minZ, maxZ });

  const WALL_REP = 2.2;
  const FLOOR_REP = 2.4;
  const CONC_REP = 3.2;

  // ── floors, ceiling, big walls ──
  plane(10, 76, M.floor, FLOOR_REP, [-1, 0, 0], [-HALF_PI, 0, 0]);
  plane(6, 3, M.floor, FLOOR_REP, [-9, 0, 0], [-HALF_PI, 0, 0]);
  plane(21.5, 76, M.conc, CONC_REP, [-1.25, H, 0], [HALF_PI, 0, 0]);
  plane(5.5, 76, M.concDark, CONC_REP, [6.75, PIT, 0], [-HALF_PI, 0, 0]);
  plane(76, 1.2, M.conc, CONC_REP, [XE, PIT / 2, 0], [0, HALF_PI, 0]);
  plane(76, 5.4, M.conc, CONC_REP, [XF, 1.5, 0], [0, -HALF_PI, 0]);
  plane(0.3, 60, M.yellow, 1, [3.45, 0.006, 0], [-HALF_PI, 0, 0], false);

  // back wall (two segments around the side passage) + lintel
  plane(28.5, H, M.wall, WALL_REP, [XB, H / 2, -15.75], [0, HALF_PI, 0]);
  plane(28.5, H, M.wall, WALL_REP, [XB, H / 2, 15.75], [0, HALF_PI, 0]);
  plane(3, 1.4, M.wall, WALL_REP, [XB, 3.5, 0], [0, HALF_PI, 0]);
  // side passage
  plane(6, H, M.wall, WALL_REP, [-9, H / 2, -1.5], [0, 0, 0]);
  plane(6, H, M.wall, WALL_REP, [-9, H / 2, 1.5], [0, Math.PI, 0]);
  plane(3, H, M.black, 1, [-12, H / 2, 0], [0, HALF_PI, 0]);
  wallBox(-13, XB, -30.5, -1.5);
  wallBox(-13, XB, 1.5, 30.5);
  wallBox(-13.5, -12.2, -2, 2);

  // platform ends: wall with an archway, a short corridor into the dark
  for (const s of [1, -1]) {
    const ry = s > 0 ? Math.PI : 0;
    plane(1.5, H, M.wall, WALL_REP, [-5.25, H / 2, s * L], [0, ry, 0]);
    plane(2.5, H, M.wall, WALL_REP, [2.75, H / 2, s * L], [0, ry, 0]);
    plane(6, 1.4, M.wall, WALL_REP, [-1.5, 3.5, s * L], [0, ry, 0]);
    plane(8, H, M.wall, WALL_REP, [-4.5, H / 2, s * 34], [0, HALF_PI, 0]);
    plane(8, H, M.wall, WALL_REP, [1.5, H / 2, s * 34], [0, -HALF_PI, 0]);
    plane(6, H, M.black, 1, [-1.5, H / 2, s * 38], [0, ry, 0]);
    if (s > 0) {
      wallBox(-7, -4.5, L, 39);
      wallBox(1.5, 5, L, 39);
      wallBox(-5, 2, 38.2, 39.5);
    } else {
      wallBox(-7, -4.5, -39, -L);
      wallBox(1.5, 5, -39, -L);
      wallBox(-5, 2, -39.5, -38.2);
    }
    const exit = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissiveMap: signTexture(T.signExit, 512, 144, "#0b3a1c", "#b9ffc8"), emissive: 0xffffff, emissiveIntensity: 1.3 }),
    );
    exit.position.set(-1.5, 3.12, s * (L - 0.03));
    exit.rotation.y = ry;
    scene.add(exit);
    const red = new THREE.PointLight(0xff2a1a, 9, 13, 2);
    red.position.set(-1.5, 3.2, s * 33);
    scene.add(red);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M.red);
    bulb.position.copy(red.position).setY(3.9);
    scene.add(bulb);
    lamps.push({ light: red, mat: null, base: 9, mode: "pulse", phase: s });
  }
  // platform edge blocks everybody
  wallBox(XE - 0.1, 12, -40, 40);

  // ── train ──
  const TRAIN_LEN = 44.35;
  const TZ = -12.2;
  const trainSide = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(TRAIN_LEN, 3.8), 5, 1), M.train);
  trainSide.position.set(4.25, 1.0, TZ);
  trainSide.rotation.y = -HALF_PI;
  trainSide.receiveShadow = true;
  scene.add(trainSide);
  solids.push(trainSide);
  box(3, 3.8, TRAIN_LEN, M.metal, [5.77, 1.0, TZ], { cast: false });
  box(2.4, 0.5, TRAIN_LEN - 1, M.black, [5.77, -0.95, TZ], { solid: false, cast: false });
  for (const x of [5.0, 6.5]) {
    box(0.08, 0.14, 76, M.steel, [x, PIT + 0.07, 0], { solid: false, cast: false });
    const tail = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), M.red);
    tail.position.set(x, 0.55, TZ + TRAIN_LEN / 2 + 0.01);
    scene.add(tail);
  }
  const tailLight = new THREE.PointLight(0xff2010, 5, 9, 2);
  tailLight.position.set(5.75, 0.6, TZ + TRAIN_LEN / 2 + 1.2);
  scene.add(tailLight);

  // ── pillars, benches, bins, pipes ──
  for (let z = -24; z <= 24; z += 8) box(0.8, H, 0.8, M.wall, [0, H / 2, z], { rep: WALL_REP, collide: true });
  for (const z of [11, -13, 22, -21]) {
    box(0.55, 0.07, 2.2, M.steel, [-5.6, 0.47, z], { collide: true });
    box(0.06, 0.5, 2.2, M.steel, [-5.9, 0.75, z], { solid: false });
    for (const dz of [-0.95, 0.95]) box(0.5, 0.45, 0.07, M.metal, [-5.6, 0.225, z + dz], { solid: false });
  }
  for (const [x, z] of [[-0.75, 8], [0.75, -16], [-5.55, 4.2], [-5.55, -5.2]]) {
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.75, 14), M.metal);
    bin.position.set(x, 0.375, z);
    bin.castShadow = bin.receiveShadow = true;
    scene.add(bin);
    solids.push(bin);
    colliders.push({ minX: x - 0.22, maxX: x + 0.22, minZ: z - 0.22, maxZ: z + 0.22 });
  }
  for (const [x, y, r] of [[-5.75, 3.85, 0.07], [-5.55, 3.95, 0.04], [3.2, 4.05, 0.09]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 60, 8), M.metal);
    pipe.rotation.x = HALF_PI;
    pipe.position.set(x, y, 0);
    scene.add(pipe);
  }

  // ── signs ──
  for (const z of [-14, 14, -26, 26]) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshStandardMaterial({ map: signTexture(T.signStation, 1024, 256, "#0d2238", "#e9e6df", T.signLine), roughness: 0.4, emissive: 0x223344, emissiveIntensity: 0.25 }),
    );
    sign.position.set(XB + 0.03, 2.55, z);
    sign.rotation.y = HALF_PI;
    scene.add(sign);
  }

  // ── fluorescent fixtures ──
  const hazeGeo = new THREE.CylinderGeometry(0.35, 2.7, 3.8, 20, 1, true);
  const hazeMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float a = pow(vUv.y, 1.7) * rim * 0.085 * uK; gl_FragColor = vec4(vec3(0.78, 0.9, 1.0) * a, 1.0); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
  });
  let i = 0;
  for (let z = -28; z <= 28; z += 8, i++) {
    const mode = i === 2 ? "dead" : i === 5 || i === 0 ? "flicker" : "on";
    const mat = mode === "on" ? M.tube : M.tube.clone();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 1.6), M.metal);
    housing.position.set(-2.5, H - 0.04, z);
    scene.add(housing);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 1.45), mat);
    tube.position.set(-2.5, H - 0.1, z);
    scene.add(tube);
    const haze = new THREE.Mesh(hazeGeo, mode === "on" ? hazeMat : hazeMat.clone());
    haze.position.set(-2.5, H - 0.1 - 1.9, z);
    haze.renderOrder = 2;
    scene.add(haze);
    const light = new THREE.PointLight(0xd4e8ff, 26, 17, 2);
    light.position.set(-2.5, H - 0.45, z);
    scene.add(light);
    if (mode === "dead") {
      light.intensity = 0;
      mat.emissiveIntensity = 0.02;
    }
    if (mode === "dead") haze.visible = false;
    lamps.push({ light, mat, haze: haze.material, base: 26, mode, phase: i * 1.7, next: 0, on: true });
  }
  // dim lamp deep inside the side passage so silhouettes read before they arrive
  const passage = new THREE.PointLight(0xff3a1a, 12, 12, 2);
  passage.position.set(-9, 3.3, 0);
  scene.add(passage);
  lamps.push({ light: passage, mat: null, base: 12, mode: "pulse", phase: 0.4 });

  scene.add(new THREE.HemisphereLight(0x8fa3b0, 0x16120e, 0.32));

  const spawns = [
    { x: [-3.8, 0.8], z: [35, 37], weight: 1 },
    { x: [-3.8, 0.8], z: [-37, -35], weight: 1 },
    { x: [-11.4, -10], z: [-0.8, 0.8], weight: 0.8 },
  ];
  const bounds = { minX: XB + 0.4, maxX: XE - 0.45, minZ: -L + 0.5, maxZ: L - 0.5 };

  function update(time, dt) {
    for (const l of lamps) {
      if (l.mode === "flicker") {
        if (time > l.next) {
          l.on = Math.random() > 0.28;
          l.next = time + (l.on ? 0.05 + Math.random() * 1.6 : 0.03 + Math.random() * 0.16);
        }
        const k = l.on ? 0.8 + Math.random() * 0.2 : 0.04;
        l.light.intensity = l.base * k;
        l.mat.emissiveIntensity = 3.2 * k;
        l.haze.uniforms.uK.value = k;
      } else if (l.mode === "pulse") {
        l.light.intensity = l.base * (0.7 + 0.3 * Math.sin(time * 2.2 + l.phase));
      }
    }
  }

  /** A blackout pulse used when a wave starts. */
  function surge(time) {
    for (const l of lamps) if (l.mode === "flicker") l.next = time;
  }

  return { solids, colliders, spawns, bounds, update, surge, H };
}

/** Push a circle out of every collider box. Mutates and returns `p` ({x,z}). */
export function resolveCircle(p, r, colliders) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(p.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    let dx = p.x - nx;
    let dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    } else {
      // centre is inside the box: leave through the nearest face
      const l = p.x - c.minX, rr = c.maxX - p.x, b = p.z - c.minZ, f = c.maxZ - p.z;
      const m = Math.min(l, rr, b, f);
      if (m === l) p.x = c.minX - r;
      else if (m === rr) p.x = c.maxX + r;
      else if (m === b) p.z = c.minZ - r;
      else p.z = c.maxZ + r;
    }
  }
  return p;
}
