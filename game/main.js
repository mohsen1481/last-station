/** LAST STATION — bootstrap, loop, player, waves, HUD and menus. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CFG } from "../config.js";
import { T, fa } from "../strings.js";
import { buildWorld, resolveCircle } from "./world.js";
import { AudioSys } from "./audio.js";
import { Effects } from "./effects.js";
import { Zombies } from "./zombies.js";
import { Weapons } from "./weapons.js";

const $ = (s) => document.querySelector(s);
const show = (el, on) => el.classList.toggle("hidden", !on);
const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

/** Seeded generator for gameplay rolls (spawns, types, drops) — visuals use Math.random. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uLow: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uDamage; uniform float uLow; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      float ca = (0.0018 + uDamage * 0.006) * r * 2.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
      col *= mix(0.42, 1.0, smoothstep(0.86, 0.22, r * 1.2));
      col += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * 0.03;
      float edge = smoothstep(0.18, 0.72, r) * clamp(uDamage + uLow, 0.0, 1.0);
      col = mix(col, vec3(0.42, 0.0, 0.0) + col * 0.35, edge * 0.85);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export async function boot(net) {
  const canvas = $("#game");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    if (!renderer.capabilities.isWebGL2) throw new Error("webgl2");
  } catch (e) {
    e.userMessage = T.errWebgl;
    throw e;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  // ── settings ──
  const settings = { ...CFG.defaults };
  try { Object.assign(settings, JSON.parse(localStorage.getItem("ls:settings") || "{}")); } catch {}
  if (!CFG.quality[settings.quality]) settings.quality = "high";
  const saveSettings = () => localStorage.setItem("ls:settings", JSON.stringify(settings));

  const scene = new THREE.Scene();
  const FOG = 0x070a09;
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.034);
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.03, 90);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  // ── loading ──
  const audio = new AudioSys();
  const texNames = ["wall", "floor", "concrete"].flatMap((m) => ["basecolor", "normal", "roughness"].map((k) => `${m}_${k}`)).concat("train");
  const modelNames = ["zombie", "pistol", "rifle", "shotgun"];
  const soundNames = ["music", "shot_pistol", "shot_rifle", "shot_shotgun", "reload", "growl", "flesh"];
  const total = texNames.length + modelNames.length + soundNames.length;
  let done = 0;
  const tick = (msg) => {
    done++;
    $("#load-fill").style.width = `${Math.round((done / total) * 100)}%`;
    $("#load-msg").textContent = msg;
  };
  const tl = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tx = {};
  const models = {};
  const gl = new GLTFLoader();
  await Promise.all([
    ...texNames.map(async (n) => {
      const t = await tl.loadAsync(`./assets/tex/${n}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      if (n.endsWith("basecolor") || n === "train") t.colorSpace = THREE.SRGBColorSpace;
      tx[n] = t;
      tick(T.loadTextures);
    }),
    ...modelNames.map(async (n) => {
      models[n] = await gl.loadAsync(`./assets/models/${n}.glb`);
      tick(T.loadModels);
    }),
    ...soundNames.map(async (n) => {
      await audio.load(n, `./assets/audio/${n}.mp3`);
      tick(T.loadAudio);
    }),
    document.fonts?.load ? document.fonts.load("800 40px Vazirmatn").catch(() => {}) : null,
  ]);
  $("#load-msg").textContent = T.loadReady;

  // ── world ──
  const world = buildWorld(scene, tx);
  // static reflection probe: glossy tiles, the wet floor, blood and steel pick up the lamps
  {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const probe = new THREE.CubeCamera(0.1, 70, rt);
    probe.position.set(-1.5, 1.7, 3);
    probe.update(renderer, scene);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromCubemap(rt.texture).texture;
    scene.environmentIntensity = 0.75;
    pmrem.dispose();
    rt.dispose();
  }

  const fx = new Effects(scene, camera);
  fx.onCasing = (p) => audio.casing(p);
  let rng = mulberry32(1);
  const zombies = new Zombies(scene, models.zombie, world, audio, fx, () => rng());

  const flash = new THREE.SpotLight(0xfff0d8, 3.8, 36, 0.56, 1.0, 0.85);
  flash.position.set(0.1, -0.1, -1.05);
  flash.target.position.set(0, -0.02, -6);
  flash.shadow.bias = -0.0006;
  flash.shadow.normalBias = 0.03;
  flash.shadow.camera.near = 0.15;
  flash.shadow.camera.far = 34;
  camera.add(flash, flash.target);

  // ── state ──
  let state = "loading"; // loading | menu | resuming | playing | paused | over
  let time = 0;
  const input = { fire: false, firePressed: false, ads: false, reloadPressed: false, dx: 0, dy: 0 };
  const keys = new Set();
  const stats = { kills: 0, heads: 0, score: 0 };
  const wave = { n: 0, toSpawn: 0, spawnT: 0, breather: 0, mode: "idle" };
  const pickups = [];
  let localBest = null;
  try { localBest = JSON.parse(localStorage.getItem("ls:best") || "null"); } catch {}

  const player = {
    x: -2, z: 0, yaw: Math.PI, pitch: 0, vx: 0, vz: 0, hp: CFG.player.hp, dead: false,
    speed: 0, moving: false, sprinting: false, stride: 0, kickP: 0, shake: 0, hurt: 0, god: false,
    recoil(p, y, shake) {
      this.kickP += p;
      this.yaw += y;
      if (settings.shake) this.shake = Math.min(1, this.shake + shake * 0.5);
    },
  };

  // ── HUD ──
  const el = {
    hud: $("#hud"), waveN: $("#wave-n"), waveLeft: $("#wave-left"), score: $("#score-n"), kills: $("#kills-n"),
    hp: $("#health-n"), hpFill: $("#health-fill"), hpBox: $("#hud-health"), ammoBox: $("#hud-ammo"), wname: $("#weapon-name"),
    mag: $("#ammo-mag"), res: $("#ammo-res"), slots: $("#weapon-slots"), cross: $("#crosshair"), hit: $("#hitmarker"),
    banner: $("#banner"), bTitle: $("#banner-title"), bSub: $("#banner-sub"), hint: $("#hint"), toasts: $("#toasts"), dev: $("#dev"),
  };
  const cache = new Map();
  const setText = (node, v) => {
    if (cache.get(node) !== v) {
      cache.set(node, v);
      node.textContent = v;
    }
  };
  CFG.order.forEach((id, i) => {
    const s = document.createElement("span");
    s.textContent = fa(i + 1);
    s.dataset.id = id;
    el.slots.append(s);
  });
  for (const [name, key] of T.controls) {
    const li = document.createElement("li");
    const a = document.createElement("span");
    a.textContent = name;
    const k = document.createElement("kbd");
    k.textContent = key;
    li.append(a, k);
    $("#help-list").append(li);
  }
  {
    const li = document.createElement("li");
    li.textContent = T.tips;
    $("#help-list").append(li);
  }

  let bannerT = 0;
  function banner(title, sub, secs = 3) {
    el.bTitle.textContent = title;
    el.bSub.textContent = sub || "";
    el.banner.classList.add("show");
    bannerT = secs;
  }
  let hintT = 0;
  function hint(text, secs = 1.6) {
    setText(el.hint, text);
    hintT = secs;
  }
  function toast(text, cls) {
    const d = document.createElement("div");
    d.className = `toast ${cls || ""}`;
    d.textContent = text;
    el.toasts.prepend(d);
    while (el.toasts.children.length > 5) el.toasts.lastChild.remove();
    setTimeout(() => d.remove(), 2300);
  }
  function hitmarker(kill) {
    el.hit.classList.remove("show", "kill");
    void el.hit.offsetWidth;
    el.hit.classList.add("show");
    if (kill) el.hit.classList.add("kill");
  }
  function refreshHud() {
    const w = weapons.current;
    setText(el.wname, T.weapons[w.id]);
    setText(el.mag, fa(w.mag));
    setText(el.res, w.reserve === Infinity ? T.inf : fa(w.reserve));
    el.ammoBox.classList.toggle("empty", w.mag === 0);
    for (const s of el.slots.children) s.classList.toggle("on", s.dataset.id === w.id);
    setText(el.score, fa(stats.score));
    setText(el.kills, fa(stats.kills));
    setText(el.waveN, fa(wave.n));
    setText(el.waveLeft, fa(wave.toSpawn + zombies.alive));
  }

  // ── shooting ──
  const ray = new THREE.Raycaster();
  ray.far = 80;
  const _pt = new THREE.Vector3();
  const _n = new THREE.Vector3();
  function shoot(origin, dir, dmg) {
    ray.set(origin, dir);
    const wh = ray.intersectObjects(world.solids, false)[0];
    const wt = wh ? wh.distance : 80;
    const zh = zombies.raycast(origin, dir, wt);
    if (zh) {
      _pt.copy(origin).addScaledVector(dir, zh.t);
      const killed = zombies.damage(zh.z, dmg, zh.head, _pt, dir);
      hitmarker(killed);
      if (wh && wt - zh.t < 4.5 && !wh.object.material.isMeshBasicMaterial) {
        _n.copy(wh.face.normal).transformDirection(wh.object.matrixWorld);
        fx.bloodSplat(wh.point, _n, 0.35 + Math.random() * 0.75);
      }
      return { point: _pt, hit: true };
    }
    if (wh) {
      if (!wh.object.material.isMeshBasicMaterial) {
        _n.copy(wh.face.normal).transformDirection(wh.object.matrixWorld);
        fx.bulletHole(wh.point, _n);
        fx.dust(wh.point, _n);
        if (wh.object.material.metalness > 0.5) {
          fx.sparks(wh.point, _n);
          if (Math.random() < 0.5) audio.ricochet(wh.point);
        } else if (Math.random() < 0.35) audio.burst(0.05, 1400, 0.1, "bandpass", wh.point);
      }
      return { point: wh.point, hit: false };
    }
    return { point: _pt.copy(origin).addScaledVector(dir, 80), hit: false };
  }

  const weapons = new Weapons(camera, { pistol: models.pistol, rifle: models.rifle, shotgun: models.shotgun }, {
    shoot, audio, fx,
    onChange: () => state !== "loading" && refreshHud(),
    onEmpty: () => hint(T.noAmmo, 2),
  });

  // ── pickups ──
  const pickGeo = new THREE.BoxGeometry(0.34, 0.2, 0.24);
  const pickMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x3a2c0a, emissive: 0xffa21a, emissiveIntensity: 1.4, roughness: 0.5 }),
    med: new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2a1a, emissiveIntensity: 1.6, roughness: 0.5 }),
  };
  function dropPickup(kind, x, z) {
    const m = new THREE.Mesh(pickGeo, pickMat[kind]);
    m.position.set(x, 0.3, z);
    scene.add(m);
    pickups.push({ m, kind, t: CFG.drops.life });
  }
  function clearPickups() {
    for (const p of pickups) scene.remove(p.m);
    pickups.length = 0;
  }

  zombies.onKill = (z, head) => {
    stats.kills++;
    if (head) stats.heads++;
    stats.score += (z.def.score + (head ? 50 : 0)) * wave.n;
    if (head) toast(T.headshot, "head");
    const r = rng();
    const p = z.root.position;
    if (p.x > world.bounds.minX && p.x < world.bounds.maxX && Math.abs(p.z) < world.bounds.maxZ) {
      if (r < CFG.drops.ammo) dropPickup("ammo", p.x, p.z);
      else if (r < CFG.drops.ammo + CFG.drops.med) dropPickup("med", p.x, p.z);
    }
    refreshHud();
  };
  zombies.onAttack = (z) => {
    if (player.dead || player.god) return;
    player.hp -= z.def.dmg;
    player.hurt = 1;
    if (settings.shake) player.shake = Math.min(1, player.shake + 0.6);
    audio.hurt();
    if (player.hp <= 0) die();
  };

  // ── waves ──
  function startWave(n) {
    wave.n = n;
    wave.toSpawn = Math.min(CFG.wave.cap, CFG.wave.base + CFG.wave.per * n);
    wave.spawnT = 2.2;
    wave.mode = "active";
    banner(T.waveN(fa(n)), T.waveIncoming);
    audio.waveHorn();
    world.surge(time);
    refreshHud();
  }
  function spawnOne() {
    const n = wave.n;
    let zone = null;
    for (let tries = 0; tries < 6; tries++) {
      const z = world.spawns[Math.floor(rng() * world.spawns.length)];
      const cx = (z.x[0] + z.x[1]) / 2, cz = (z.z[0] + z.z[1]) / 2;
      zone = z;
      if (Math.hypot(cx - player.x, cz - player.z) > 9) break;
    }
    const x = zone.x[0] + rng() * (zone.x[1] - zone.x[0]);
    const z = zone.z[0] + rng() * (zone.z[1] - zone.z[0]);
    const r = rng();
    const pBrute = n >= 5 ? Math.min(0.15, 0.03 * (n - 4)) : 0;
    const pRun = n >= 3 ? Math.min(0.35, 0.07 * (n - 2)) : 0;
    const type = r < pBrute ? "brute" : r < pBrute + pRun ? "runner" : "walker";
    zombies.spawn(type, x, z, 1 + CFG.wave.speedPer * (n - 1));
    wave.toSpawn--;
  }
  function stepWaves(dt) {
    if (wave.mode === "active") {
      wave.spawnT -= dt;
      if (wave.toSpawn > 0 && wave.spawnT <= 0 && zombies.alive < CFG.zombie.maxAlive) {
        spawnOne();
        wave.spawnT = Math.max(CFG.wave.spawnMin, CFG.wave.spawnEvery - wave.n * 0.08) * (0.6 + rng() * 0.8);
      }
      if (wave.toSpawn === 0 && zombies.alive === 0) {
        wave.mode = "breather";
        wave.breather = CFG.wave.breather;
        weapons.addAmmo();
        player.hp = Math.min(CFG.player.hp, player.hp + 20);
        banner(T.waveClear, T.waveBonus, 2.6);
        audio.pickup();
      }
    } else if (wave.mode === "breather") {
      wave.breather -= dt;
      hint(T.nextIn(fa(Math.max(1, Math.ceil(wave.breather)))), 0.3);
      if (wave.breather <= 0) startWave(wave.n + 1);
    }
  }

  // ── simulation (fixed step) ──
  const pp = { x: 0, z: 0 };
  function simulate(dt) {
    // player movement
    const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    player.sprinting = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && f > 0 && !input.ads;
    const max = (player.sprinting ? CFG.player.sprint : CFG.player.walk) * (input.ads ? 0.55 : 1);
    const k = Math.min(1, CFG.player.accel * dt);
    player.vx += (wx * max - player.vx) * k;
    player.vz += (wz * max - player.vz) * k;
    pp.x = player.x + player.vx * dt;
    pp.z = player.z + player.vz * dt;
    resolveCircle(pp, CFG.player.radius, world.colliders);
    const b = world.bounds;
    player.x = Math.max(b.minX, Math.min(b.maxX, pp.x));
    player.z = Math.max(b.minZ, Math.min(b.maxZ, pp.z));
    player.speed = Math.hypot(player.vx, player.vz);
    player.moving = player.speed > 1;
    player.stride += player.speed * dt;
    if (player.stride > (player.sprinting ? 2.3 : 1.9)) {
      player.stride = 0;
      audio.step();
    }

    zombies.update(dt, player, time);
    stepWaves(dt);

    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t -= dt;
      p.m.rotation.y += dt * 1.6;
      p.m.position.y = 0.32 + Math.sin(time * 3 + i) * 0.05;
      p.m.visible = p.t > 5 || Math.sin(time * 14) > 0;
      const near = Math.hypot(p.m.position.x - player.x, p.m.position.z - player.z) < 1.15;
      if (near || p.t <= 0) {
        if (near) {
          if (p.kind === "ammo") { weapons.addAmmo(); toast(T.pickAmmo); }
          else { player.hp = Math.min(CFG.player.hp, player.hp + 35); toast(T.pickMed); }
          audio.pickup();
        }
        scene.remove(p.m);
        pickups.splice(i, 1);
      }
    }
    time += dt;
  }

  // ── post-processing ──
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.75, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finalPass = new ShaderPass(FinalShader);
  composer.addPass(finalPass);

  function applyQuality() {
    const q = CFG.quality[settings.quality];
    const pr = settings.quality === "low" ? q.pr : Math.min(window.devicePixelRatio || 1, q.pr);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    bloom.enabled = q.bloom;
    const sh = q.shadows > 0;
    if (renderer.shadowMap.enabled !== sh) {
      renderer.shadowMap.enabled = sh;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
    flash.castShadow = sh;
    if (sh && flash.shadow.mapSize.x !== q.shadows) {
      flash.shadow.mapSize.set(q.shadows, q.shadows);
      flash.shadow.map?.dispose();
      flash.shadow.map = null;
    }
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); }
    }
    resize();
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fx.resize(renderer.domElement.height, camera.fov);
  }
  addEventListener("resize", resize);

  // ── game flow ──
  const bestOf = () => {
    const a = localBest, b = net.best;
    if (a && b) return a.score >= b.score ? a : b;
    return a || b;
  };
  function showRecord() {
    const b = bestOf();
    $("#menu-record").textContent = b && b.score > 0 ? T.recordLine(fa(b.wave), fa(b.score)) : T.noRecord;
  }
  net.onBest(showRecord);

  function resetGame() {
    rng = mulberry32((Date.now() & 0xffffff) || 1);
    zombies.reset();
    fx.reset();
    clearPickups();
    Object.assign(stats, { kills: 0, heads: 0, score: 0 });
    Object.assign(player, { x: -2, z: 0, yaw: Math.PI, pitch: 0, vx: 0, vz: 0, hp: CFG.player.hp, dead: false, kickP: 0, shake: 0, hurt: 0 });
    wave.mode = "breather";
    wave.n = 0;
    wave.toSpawn = 0;
    wave.breather = 3;
    weapons.reset();
    keys.clear();
    input.fire = input.ads = false;
    el.toasts.textContent = "";
    refreshHud();
  }
  const locked = () => DEBUG || document.pointerLockElement === canvas;
  function requestLock() {
    if (DEBUG) return enterPlay();
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }
  function enterPlay() {
    state = "playing";
    setText(el.hint, "");
    audio.resume();
    audio.startMusic();
  }
  function begin(fresh) {
    if (fresh) resetGame();
    for (const id of ["#menu", "#pause", "#over", "#settings", "#help"]) show($(id), false);
    show(el.hud, true);
    state = "resuming";
    hint(T.clickToPlay, 999);
    audio.resume();
    requestLock();
  }
  function pause() {
    if (state !== "playing" && state !== "resuming") return;
    state = "paused";
    show($("#pause"), true);
    audio.suspend();
    input.fire = input.ads = false;
    keys.clear();
  }
  function toMenu() {
    state = "menu";
    if (document.pointerLockElement) document.exitPointerLock();
    for (const id of ["#pause", "#over"]) show($(id), false);
    show(el.hud, false);
    show($("#menu"), true);
    showRecord();
    audio.suspend();
  }
  function die() {
    player.dead = true;
    state = "over";
    if (document.pointerLockElement) document.exitPointerLock();
    const run = { wave: Math.max(1, wave.n), kills: stats.kills, headshots: stats.heads, score: stats.score };
    const prev = bestOf();
    const isRecord = run.score > 0 && (!prev || run.score > prev.score);
    if (!localBest || run.score > localBest.score) {
      localBest = run;
      localStorage.setItem("ls:best", JSON.stringify(run));
    }
    net.record(run);
    $("#o-wave").textContent = fa(run.wave);
    $("#o-kills").textContent = fa(run.kills);
    $("#o-heads").textContent = fa(run.headshots);
    $("#o-acc").textContent = `${fa(weapons.shots ? Math.round((weapons.hits / weapons.shots) * 100) : 0)}٪`;
    $("#o-score").textContent = fa(run.score);
    $("#over-record").textContent = isRecord ? T.newRecord : "";
    setTimeout(() => { if (state === "over") show($("#over"), true); }, 900);
  }

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      if (state === "resuming") enterPlay();
    } else if (state === "playing" || state === "resuming") pause();
  });
  canvas.addEventListener("click", () => { if (state === "resuming") requestLock(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  // ── input ──
  addEventListener("keydown", (e) => {
    if (e.code === "F3") { e.preventDefault(); show(el.dev, el.dev.classList.contains("hidden")); return; }
    if (state !== "playing") return;
    if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "KeyR") input.reloadPressed = true;
    else if (e.code === "Digit1" || e.code === "Numpad1") weapons.select("pistol");
    else if (e.code === "Digit2" || e.code === "Numpad2") weapons.select("rifle");
    else if (e.code === "Digit3" || e.code === "Numpad3") weapons.select("shotgun");
    else if (e.code === "KeyQ") weapons.cycle(1);
    else if (e.code === "KeyF") { flash.visible = !flash.visible; audio.dry(); }
    else if (e.code === "KeyP" && DEBUG) pause();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  document.addEventListener("mousemove", (e) => {
    if (state !== "playing" || !locked()) return;
    const k = 0.0022 * settings.sens * (1 - weapons.ads * 0.45);
    player.yaw -= e.movementX * k;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * k));
    input.dx += e.movementX;
    input.dy += e.movementY;
  });
  canvas.addEventListener("mousedown", (e) => {
    if (state !== "playing") return;
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
    else if (e.button === 2) input.ads = true;
  });
  addEventListener("mouseup", (e) => {
    if (e.button === 0) input.fire = false;
    else if (e.button === 2) input.ads = false;
  });
  addEventListener("contextmenu", (e) => e.preventDefault());
  let wheelAcc = 0;
  addEventListener("wheel", (e) => {
    if (state !== "playing") return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 60) { weapons.cycle(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
  }, { passive: true });

  // ── menus ──
  $("#btn-start").onclick = () => begin(true);
  $("#btn-again").onclick = () => begin(true);
  $("#btn-restart").onclick = () => begin(true);
  $("#btn-resume").onclick = () => begin(false);
  $("#btn-quit").onclick = toMenu;
  $("#btn-over-menu").onclick = toMenu;
  let settingsFrom = null;
  const openSettings = () => show($("#settings"), true);
  $("#btn-settings").onclick = openSettings;
  $("#btn-settings2").onclick = openSettings;
  $("#btn-settings-back").onclick = () => show($("#settings"), false);
  $("#btn-help").onclick = () => show($("#help"), true);
  $("#btn-help-back").onclick = () => show($("#help"), false);

  const bind = (id, key, out, fmt, apply) => {
    const node = $(id);
    const isCheck = node.type === "checkbox";
    if (isCheck) node.checked = settings[key];
    else node.value = settings[key];
    const sync = () => {
      settings[key] = isCheck ? node.checked : node.tagName === "SELECT" ? node.value : parseFloat(node.value);
      if (out) $(out).textContent = fmt(settings[key]);
      apply && apply();
      saveSettings();
    };
    node.addEventListener("input", sync);
    if (out) $(out).textContent = fmt(settings[key]);
  };
  const pct = (v) => `${fa(Math.round(v * 100))}٪`;
  const applyAudio = () => audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
  bind("#set-sens", "sens", "#out-sens", (v) => fa(v.toFixed(2)));
  bind("#set-master", "master", "#out-master", pct, applyAudio);
  bind("#set-music", "music", "#out-music", pct, applyAudio);
  bind("#set-sfx", "sfx", "#out-sfx", pct, applyAudio);
  bind("#set-quality", "quality", null, null, applyQuality);
  bind("#set-fov", "fov", "#out-fov", (v) => fa(v));
  bind("#set-shake", "shake");
  bind("#set-blood", "blood", null, null, () => { fx.bloodOn = settings.blood; });
  applyAudio();
  fx.bloodOn = settings.blood;
  applyQuality();

  // ── frame ──
  const _fwd = new THREE.Vector3();
  let last = performance.now(), acc = 0, devT = 0, frames = 0, cpuMs = 0, fovNow = settings.fov;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t0 = performance.now();

    if (state === "playing") {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) { simulate(STEP); acc -= STEP; n++; }
      if (n === 5) acc = 0;

      weapons.update(dt, input, player);
      input.firePressed = input.reloadPressed = false;
      input.dx = input.dy = 0;
      world.update(time, dt);
      fx.update(dt);

      // camera
      player.kickP += (0 - player.kickP) * Math.min(1, dt * 7);
      player.shake = Math.max(0, player.shake - dt * 2.4);
      player.hurt = Math.max(0, player.hurt - dt * 1.3);
      const bob = Math.sin(player.stride * Math.PI * 1.05) * 0.035 * Math.min(1, player.speed / 4) * (1 - weapons.ads);
      const sh = player.shake * player.shake * 0.03;
      camera.position.set(player.x, CFG.player.eye + bob, player.z);
      camera.rotation.set(player.pitch + player.kickP + (Math.random() - 0.5) * sh, player.yaw + (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.6);
      const wantFov = settings.fov - weapons.ads * (weapons.cur === "rifle" ? 22 : 13) + (player.sprinting ? 4 : 0);
      fovNow += (wantFov - fovNow) * Math.min(1, dt * 10);
      if (Math.abs(camera.fov - fovNow) > 0.01) {
        camera.fov = fovNow;
        camera.updateProjectionMatrix();
        fx.resize(renderer.domElement.height, fovNow);
      }
      camera.getWorldDirection(_fwd);
      audio.setListener(camera.position, _fwd);

      // HUD per frame
      const hp = Math.max(0, Math.ceil(player.hp));
      setText(el.hp, fa(hp));
      el.hpFill.style.width = `${hp}%`;
      el.hpBox.classList.toggle("low", hp <= 30);
      const gap = 5 + weapons.spread(player.moving) * 620 * (74 / camera.fov);
      el.cross.style.setProperty("--gap", `${gap.toFixed(1)}px`);
      el.cross.classList.toggle("ads", weapons.ads > 0.5);
      setText(el.waveLeft, fa(wave.toSpawn + zombies.alive));
      const w = weapons.current;
      if (hintT > 0) { hintT -= dt; if (hintT <= 0) setText(el.hint, ""); }
      else if (weapons.reloading) setText(el.hint, T.reloading);
      else if (w.mag === 0 && w.reserve > 0) setText(el.hint, T.reloadHint);
      else if (w.mag > 0 && w.mag <= Math.ceil(w.def.mag * 0.2) && w.reserve > 0) setText(el.hint, T.lowAmmo);
      else setText(el.hint, "");
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove("show"); }
    } else if (state === "over") {
      // slump to the floor
      camera.position.y += (0.35 - camera.position.y) * Math.min(1, dt * 2.5);
      camera.rotation.z += (0.5 - camera.rotation.z) * Math.min(1, dt * 2);
      zombies.update(dt, player, time);
      fx.update(dt);
      world.update((time += dt), dt);
    }

    finalPass.uniforms.uTime.value = (now / 1000) % 100;
    finalPass.uniforms.uDamage.value = state === "over" ? 1 : player.hurt;
    finalPass.uniforms.uLow.value = player.hp <= 30 && state === "playing" ? 0.35 + 0.2 * Math.sin(now / 180) : 0;

    if (state !== "loading" && state !== "menu") {
      renderer.info.reset();
      composer.render(dt);
    }
    cpuMs += performance.now() - t0;
    frames++;
    devT += dt;
    if (devT >= 0.5) {
      if (!el.dev.classList.contains("hidden")) {
        const fps = frames / devT, cpu = cpuMs / frames;
        el.dev.textContent = `FPS ${fps.toFixed(0)}  draw ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\nCPU ${cpu.toFixed(1)}ms  GPU~ ${Math.max(0, 1000 / fps - cpu).toFixed(1)}ms  zombies ${zombies.alive}`;
      }
      window.__game.fps = frames / devT;
      frames = 0; devT = 0; cpuMs = 0;
    }
  }

  // dev console (design-system §7.3): state dump, teleport-to-situation, tuning
  window.__game = {
    CFG, player, wave, stats, zombies, weapons, fps: 0,
    dump: () => ({ state, time, hp: player.hp, x: player.x, z: player.z, wave: wave.n, left: wave.toSpawn + zombies.alive, alive: zombies.alive, ...stats, weapon: weapons.cur, mag: weapons.current.mag, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    setWave: (n) => { zombies.reset(); startWave(n); },
    god: (on = true) => { player.god = on; },
    start: () => begin(true),
    input, keys,
  };

  // ready
  resize();
  composer.render(0); // warm shaders while the loading screen is still up
  show($("#loading"), false);
  show($("#menu"), true);
  showRecord();
  state = "menu";
  requestAnimationFrame(frame);
}
