/** First-person weapons: view models, firing, recoil, reload, switching. */
import * as THREE from "three";
import { CFG } from "../config.js";

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _to = new THREE.Vector3();

export class Weapons {
  /**
   * @param camera   the player camera (view models are parented to it)
   * @param models   { pistol: gltf, rifle: gltf, shotgun: gltf }
   * @param hooks    { shoot(origin, dir) -> {point, hit}, audio, fx, onChange() }
   */
  constructor(camera, models, hooks) {
    this.camera = camera;
    this.hooks = hooks;
    this.rig = new THREE.Group();
    camera.add(this.rig);
    this.w = {};
    for (const id of CFG.order) {
      const def = CFG.weapons[id];
      const holder = new THREE.Group();
      const pivot = new THREE.Group();
      const inner = models[id].scene;
      inner.rotation.y = def.yaw;
      pivot.add(inner);
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const s = def.length / size.z;
      inner.position.sub(center);
      pivot.scale.setScalar(s);
      holder.add(pivot);
      inner.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          o.castShadow = false;
          o.receiveShadow = false;
          if (o.material) {
            o.material.envMapIntensity = 0.55;
          }
        }
      });
      const half = size.clone().multiplyScalar(s / 2);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, half.y * (def.muzzleY * 2 - 1), -half.z - 0.01);
      holder.add(muzzle);
      const eject = new THREE.Object3D();
      eject.position.set(0.02, half.y * (def.muzzleY * 2 - 1), id === "pistol" ? 0.02 : 0.05);
      holder.add(eject);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: hooks.fx.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, color: new THREE.Color(2.4, 2, 1.4) }));
      flash.visible = false;
      muzzle.add(flash);
      holder.visible = false;
      this.rig.add(holder);
      // sights sit at the top of the model: ADS raises the gun so they meet the screen centre
      const adsY = -half.y * (id === "pistol" ? 0.98 : 0.62);
      this.w[id] = { id, def, holder, muzzle, eject, flash, mag: def.mag, reserve: def.reserve, adsY, flashT: 0 };
    }
    this.light = new THREE.PointLight(0xffc27a, 0, 18, 1.6);
    this.light.position.set(0.12, 0.0, -1.5);
    camera.add(this.light);

    this.cur = "pistol";
    this.next = null;
    this.switchT = 0;
    this.reloadT = 0;
    this.cd = 0;
    this.kick = 0; // viewmodel recoil
    this.kickRot = 0;
    this.ads = 0;
    this.bloom = 0; // spread that builds while firing
    this.swayX = 0;
    this.swayY = 0;
    this.bob = 0;
    this.shots = 0;
    this.hits = 0;
    this.w.pistol.holder.visible = true;
  }

  get current() { return this.w[this.cur]; }
  get reloading() { return this.reloadT > 0; }

  reset() {
    for (const id of CFG.order) {
      const w = this.w[id];
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
      w.holder.visible = id === "pistol";
    }
    this.cur = "pistol";
    this.next = null;
    this.switchT = this.reloadT = this.cd = this.kick = this.kickRot = this.ads = this.bloom = 0;
    this.shots = this.hits = 0;
    this.hooks.onChange();
  }

  select(id) {
    if (!this.w[id] || id === this.cur || this.next === id) return;
    this.next = id;
    this.switchT = 0.44;
    this.reloadT = 0;
    this.hooks.audio.switchWeapon();
  }
  cycle(dir) {
    const i = CFG.order.indexOf(this.next || this.cur);
    this.select(CFG.order[(i + dir + CFG.order.length) % CFG.order.length]);
  }

  reload() {
    const w = this.current;
    if (this.reloadT > 0 || this.switchT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
    this.reloadT = w.def.reload;
    this.hooks.audio.play("reload", { vol: 0.55, rate: 2.06 / w.def.reload > 1.4 ? 1.35 : 1 });
    this.hooks.onChange();
    return true;
  }

  addAmmo() {
    this.w.rifle.reserve += 30;
    this.w.shotgun.reserve += 6;
    this.hooks.onChange();
  }

  /** Spread in radians right now (also drives the crosshair gap). */
  spread(moving) {
    const d = this.current.def;
    const adsK = d.pellets > 1 ? 1 - this.ads * 0.25 : 1 - this.ads * 0.72;
    return (d.spread * (moving ? 1.7 : 1) + this.bloom) * adsK;
  }

  _fire(player) {
    const w = this.current, d = w.def, cam = this.camera;
    w.mag--;
    this.cd = 60 / d.rpm;
    this.shots++;
    cam.getWorldDirection(_dir);
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    const origin = cam.getWorldPosition(_v);
    w.muzzle.getWorldPosition(_muzzle);
    const sp = this.spread(player.moving);
    let any = false;
    for (let i = 0; i < d.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sp;
      _to.copy(_dir).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      const res = this.hooks.shoot(origin, _to, d.dmg);
      if (res.hit) any = true;
      if (i < 3 || Math.random() < 0.4) this.hooks.fx.tracer(_muzzle, res.point);
    }
    if (any) this.hits++;

    // feedback
    this.kick = Math.min(0.16, this.kick + d.kick);
    this.kickRot = Math.min(0.5, this.kickRot + d.kick * 2.2);
    this.bloom = Math.min(0.05, this.bloom + d.spread * 0.55);
    player.recoil(d.recoil * (1 - this.ads * 0.3), (Math.random() - 0.5) * d.recoil * 0.7, d.shake);
    w.flashT = 0.05;
    w.flash.visible = true;
    w.flash.material.rotation = Math.random() * Math.PI * 2;
    w.flash.scale.setScalar((d.pellets > 1 ? 0.5 : 0.3) * (0.8 + Math.random() * 0.5));
    this.light.intensity = d.pellets > 1 ? 16 : 10;
    this.hooks.audio.play(d.sound, { vol: d.vol * CFG.mix.shot, rate: 0.96 + Math.random() * 0.08 });
    w.eject.getWorldPosition(_to);
    this.hooks.fx.casing(_to, _v.copy(_right).multiplyScalar(1.6 + Math.random()).addScaledVector(_up, 1.6 + Math.random()).addScaledVector(_dir, -0.3 + Math.random() * 0.6));
    this.hooks.onChange();
  }

  update(dt, input, player) {
    const w = this.current, d = w.def;
    this.cd = Math.max(0, this.cd - dt);

    // weapon switch: lower, swap, raise
    let lower = 0;
    if (this.switchT > 0) {
      const before = this.switchT;
      this.switchT -= dt;
      if (before > 0.22 && this.switchT <= 0.22 && this.next) {
        this.w[this.cur].holder.visible = false;
        this.cur = this.next;
        this.next = null;
        this.w[this.cur].holder.visible = true;
        this.hooks.onChange();
      }
      lower = 1 - Math.abs(this.switchT - 0.22) / 0.22;
    }

    // reload
    let reloadK = 0;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const k = 1 - this.reloadT / d.reload;
      reloadK = Math.sin(Math.min(1, k) * Math.PI);
      if (this.reloadT <= 0) {
        const need = d.mag - w.mag, take = Math.min(need, w.reserve);
        w.mag += take;
        if (w.reserve !== Infinity) w.reserve -= take;
        this.hooks.onChange();
      }
    }

    const busy = this.switchT > 0 || this.reloadT > 0;
    const trigger = d.auto ? input.fire : input.firePressed;
    if (trigger && !busy && this.cd <= 0) {
      if (w.mag > 0) this._fire(player);
      else if (input.firePressed) {
        this.hooks.audio.dry();
        if (!this.reload()) this.hooks.onEmpty();
      }
    }
    if (!busy && w.mag === 0 && w.reserve > 0 && this.cd <= 0 && !input.fire) this.reload();
    if (input.reloadPressed) this.reload();

    // springs
    this.kick += (0 - this.kick) * Math.min(1, dt * 13);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 11);
    this.bloom = Math.max(0, this.bloom - dt * 0.07);
    const wantAds = input.ads && !busy && !player.sprinting ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 12);
    this.swayX += (-input.dx * 0.00035 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (input.dy * 0.00035 - this.swayY) * Math.min(1, dt * 9);
    this.bob += dt * player.speed * 1.9;
    const bobK = Math.min(1, player.speed / 4) * (1 - this.ads * 0.85);
    const bx = Math.cos(this.bob) * 0.006 * bobK, by = Math.abs(Math.sin(this.bob)) * 0.007 * bobK;

    const cw = this.current, cd = cw.def, h = cw.holder;
    const a = this.ads;
    const sprint = player.sprinting ? 1 : 0;
    h.position.set(
      cd.pos[0] * (1 - a) + cd.ads[0] * a + bx + this.swayX + sprint * 0.03,
      cd.pos[1] * (1 - a) + cw.adsY * a - by + this.swayY - lower * 0.3 - reloadK * 0.16 - sprint * 0.04,
      cd.pos[2] * (1 - a) + cd.ads[2] * a + this.kick,
    );
    h.rotation.set(this.kickRot * 0.5 - lower * 0.9 - reloadK * 0.5 + this.swayY * 2, this.swayX * 3 + reloadK * 0.35 + sprint * 0.35 * (1 - a), reloadK * 0.5 - this.swayX * 4);

    for (const id of CFG.order) {
      const x = this.w[id];
      if (x.flashT > 0) {
        x.flashT -= dt;
        if (x.flashT <= 0) x.flash.visible = false;
      }
    }
    this.light.intensity *= Math.max(0, 1 - dt * 28);
    if (this.light.intensity < 0.05) this.light.intensity = 0;
  }
}
