/** Zombies: pooled skinned clones, steering, attacks, hit tests, deaths. */
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CFG } from "../config.js";
import { resolveCircle } from "./world.js";

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _head = new THREE.Vector3();

/** Remove horizontal root motion so the game, not the clip, moves the body. */
function inPlace(clip) {
  const c = clip.clone();
  let rootTrack = null;
  for (const t of c.tracks) if (t.name.endsWith(".position") && (!rootTrack || /hips|root|pelvis/i.test(t.name))) rootTrack = rootTrack && !/hips|root|pelvis/i.test(t.name) ? rootTrack : t;
  if (rootTrack) {
    const v = rootTrack.values;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 2] = v[2];
    }
  }
  return c;
}

export class Zombies {
  constructor(scene, gltf, world, audio, fx, rng) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.fx = fx;
    this.rng = rng;
    this.list = [];
    this.pool = [];
    this.alive = 0;
    this.onKill = null;
    this.onAttack = null;

    this.template = gltf.scene;
    this.template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.template);
    const h = box.max.y - box.min.y || 1.8;
    this.baseScale = CFG.zombie.height / h;
    this.footY = -box.min.y * this.baseScale;
    this.headName = null;
    this.template.traverse((o) => {
      if (o.isBone) {
        if (/^head$/i.test(o.name)) this.headName = o.name;
        else if (!this.headName && /head/i.test(o.name) && !/end|top/i.test(o.name)) this.headName = o.name;
      }
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material.roughness = Math.max(0.7, o.material.roughness ?? 0.8);
          o.material.metalness = 0;
          o.material.envMapIntensity = 0.5;
        }
      }
    });

    const find = (re) => gltf.animations.find((a) => re.test(a.name));
    const walk = find(/walk/i) || gltf.animations[0];
    this.clips = {
      walk: walk ? inPlace(walk) : null,
      run: find(/run/i) ? inPlace(find(/run/i)) : null,
      attack: find(/attack|punch|scream/i) ? inPlace(find(/attack|punch|scream/i)) : null,
      death: find(/death|dead|fall|shot/i) || null,
    };
  }

  _make() {
    const root = new THREE.Group();
    const model = cloneSkinned(this.template);
    root.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const k of Object.keys(this.clips)) if (this.clips[k]) actions[k] = mixer.clipAction(this.clips[k]);
    if (actions.attack) {
      actions.attack.setLoop(THREE.LoopOnce, 1);
      actions.attack.clampWhenFinished = true;
      actions.attack.timeScale = this.clips.attack.duration / CFG.zombie.attackTime;
    }
    if (actions.death) {
      actions.death.setLoop(THREE.LoopOnce, 1);
      actions.death.clampWhenFinished = true;
      actions.death.timeScale = CFG.zombie.deathSpeed;
    }
    const head = this.headName ? model.getObjectByName(this.headName) : null;
    this.scene.add(root);
    return { root, model, mixer, actions, head, state: "idle" };
  }

  spawn(type, x, z, waveSpeed) {
    const def = CFG.zombie.types[type];
    const z0 = this.pool.pop() || this._make();
    const s = this.baseScale * def.scale * (0.96 + this.rng() * 0.08);
    Object.assign(z0, {
      type, def, hp: def.hp, state: "walk", t: 0, hit: false, stagger: 0, scale: def.scale,
      speed: def.speed * waveSpeed * (0.9 + this.rng() * 0.2),
      growl: 1 + this.rng() * 5, strafe: 0, strafeDir: this.rng() < 0.5 ? -1 : 1, yaw: 0, fall: 1, lunge: 0,
    });
    z0.root.visible = true;
    z0.root.position.set(x, 0, z);
    z0.model.scale.setScalar(s);
    z0.model.position.set(0, this.footY * def.scale, 0);
    z0.model.rotation.set(0, 0, 0);
    if (z0.head) z0.head.scale.setScalar(1);
    z0.mixer.stopAllAction();
    const key = z0.actions[def.anim] ? def.anim : "walk";
    const act = z0.actions[key];
    if (act) {
      act.reset();
      act.timeScale = z0.speed / (CFG.zombie.animSpeed[key] * def.scale);
      act.time = this.rng() * act.getClip().duration;
      act.play();
    }
    z0.move = act;
    this.list.push(z0);
    this.alive++;
    return z0;
  }

  headPos(z, out) {
    if (z.head) {
      z.head.getWorldPosition(out);
      out.y += 0.07 * z.scale;
    } else out.set(z.root.position.x, 1.63 * z.scale, z.root.position.z);
    return out;
  }

  /** Nearest zombie hit by a ray. Head sphere first, then a body capsule. */
  raycast(o, d, maxT) {
    let best = null;
    for (const z of this.list) {
      if (z.state === "dying" || z.state === "gone") continue;
      const sc = z.scale;
      // quick reject on the vertical axis line
      const px = z.root.position.x, pz = z.root.position.z;
      const tx = px - o.x, tz = pz - o.z;
      const along = tx * d.x + tz * d.z;
      if (along < -1) continue;
      // head
      this.headPos(z, _head);
      const hr = 0.155 * sc;
      _v.subVectors(_head, o);
      const th = _v.dot(d);
      if (th > 0 && th < maxT) {
        const d2 = _v.lengthSq() - th * th;
        if (d2 < hr * hr) {
          const t = th - Math.sqrt(hr * hr - d2);
          if (!best || t < best.t) best = { z, t, head: true };
          continue;
        }
      }
      // body: capsule from the shins to the neck
      const r = 0.27 * sc, y0 = 0.25, y1 = Math.max(0.6, _head.y - 0.2);
      // closest approach between the ray and the vertical segment
      const dy = d.y, denom = 1 - dy * dy;
      let tRay;
      if (denom < 1e-5) tRay = along;
      else {
        const wy = o.y - y0;
        const b = dy, dd = tx * d.x + (y0 - o.y) * d.y + tz * d.z; // d·(P0-o)
        const e = -wy; // u·(o→P0) with u=(0,1,0) → (y0-o.y)
        // solve for s (ray) and u (segment) minimising distance
        let sSeg = (b * dd - e) / denom; // param along segment in metres from y0
        sSeg = Math.max(0, Math.min(y1 - y0, sSeg));
        tRay = dd + b * sSeg;
      }
      if (tRay <= 0 || tRay > maxT) continue;
      const cx = o.x + d.x * tRay, cy = o.y + d.y * tRay, cz = o.z + d.z * tRay;
      const sy = Math.max(y0, Math.min(y1, cy));
      const dist2 = (cx - px) * (cx - px) + (cy - sy) * (cy - sy) + (cz - pz) * (cz - pz);
      if (dist2 < r * r) {
        const t = Math.max(0.01, tRay - Math.sqrt(r * r - dist2));
        if (!best || t < best.t) best = { z, t, head: false };
      }
    }
    return best;
  }

  damage(z, dmg, head, point, dir) {
    if (z.state === "dying") return false;
    z.hp -= dmg * (head ? CFG.zombie.headMult : 1);
    z.stagger = 0.22;
    _v.copy(dir).multiplyScalar(-0.4);
    _v.y += 0.3;
    this.fx.bloodBurst(point, _v, head ? 10 : 7, 0.8); // entry spray, back toward the shooter
    this.fx.bloodBurst(point, dir, head ? 16 : 9, head ? 1.4 : 1); // exit spray
    this.audio.play("flesh", { vol: CFG.mix.flesh, rate: 0.85 + Math.random() * 0.4, pos: point });
    if (z.hp <= 0) {
      this.kill(z, head, dir);
      return true;
    }
    return false;
  }

  kill(z, head, dir) {
    z.state = "dying";
    z.t = 0;
    this.alive--;
    // fall away from the shot
    const fx = Math.sin(z.yaw), fz = Math.cos(z.yaw);
    z.fall = fx * dir.x + fz * dir.z > 0 ? 1 : -1; // +1: pushed onto its face (shot from behind)
    if (z.move) z.move.fadeOut(0.25);
    if (z.actions.attack) z.actions.attack.stop();
    if (z.actions.death) z.actions.death.reset().fadeIn(0.1).play();
    const p = this.headPos(z, _v2);
    if (head) {
      if (z.head) z.head.scale.setScalar(0.001);
      this.fx.bloodBurst(p, new THREE.Vector3(dir.x * 0.3, 1.2, dir.z * 0.3), 46, 1.5);
      this.audio.headPop();
    }
    this.fx.bloodPool(z.root.position, head ? 1.9 : 1.4);
    if (this.onKill) this.onKill(z, head);
  }

  update(dt, player, time) {
    const cfg = CFG.zombie;
    const list = this.list;
    let corpses = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const z = list[i];
      const pos = z.root.position;
      if (z.state === "dying") {
        z.t += dt;
        corpses++;
        if (!z.actions.death) {
          const k = Math.min(1, z.t / 0.65);
          const e = k * k * (3 - 2 * k);
          z.model.rotation.x = z.fall * e * (Math.PI / 2 - 0.06);
          z.model.position.y = this.footY * z.scale + e * 0.14 * z.scale;
        }
        const old = z.t > cfg.corpseTime;
        if (old) {
          pos.y -= dt * 0.35;
          if (pos.y < -0.9) this._recycle(i);
        }
        z.mixer.update(dt);
        continue;
      }
      const dx = player.x - pos.x, dz = player.z - pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const want = Math.atan2(dx, dz);
      let dy = want - z.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      z.yaw += dy * Math.min(1, dt * 6);
      z.root.rotation.y = z.yaw;
      z.stagger = Math.max(0, z.stagger - dt);

      if (z.state === "walk") {
        if (dist < cfg.attackRange * (0.85 + 0.15 * z.scale) && !player.dead) {
          z.state = "attack";
          z.t = 0;
          z.hit = false;
          if (z.actions.attack) { z.actions.attack.reset().fadeIn(0.1).play(); if (z.move) z.move.fadeOut(0.1); }
        } else {
          const sp = z.speed * (z.stagger > 0 ? 0.25 : 1);
          let mx = dx / dist, mz = dz / dist;
          if (z.strafe > 0) {
            z.strafe -= dt;
            const sx = -mz * z.strafeDir, sz = mx * z.strafeDir;
            mx = mx * 0.35 + sx; mz = mz * 0.35 + sz;
            const n = Math.hypot(mx, mz); mx /= n; mz /= n;
          }
          const ox = pos.x, oz = pos.z;
          pos.x += mx * sp * dt;
          pos.z += mz * sp * dt;
          resolveCircle(pos, 0.3 * z.scale, this.world.colliders);
          const moved = Math.hypot(pos.x - ox, pos.z - oz);
          if (moved < sp * dt * 0.35 && z.strafe <= 0) { z.strafe = 0.7; z.strafeDir *= this.rng() < 0.3 ? -1 : 1; }
        }
      } else if (z.state === "attack") {
        z.t += dt;
        const k = z.t / cfg.attackTime;
        if (!z.actions.attack) z.model.rotation.x = Math.sin(Math.min(1, k) * Math.PI) * 0.55;
        if (!z.hit && k >= cfg.hitAt) {
          z.hit = true;
          if (dist < cfg.attackRange + 0.55 && this.onAttack) this.onAttack(z);
        }
        if (k >= 1) {
          z.state = "walk";
          z.model.rotation.x = 0;
          if (z.actions.attack) z.actions.attack.fadeOut(0.15);
          if (z.move) z.move.reset().fadeIn(0.15).play();
        }
      }

      z.growl -= dt;
      if (z.growl <= 0) {
        z.growl = 3.5 + Math.random() * 7;
        if (dist < 26) this.audio.play("growl", { vol: CFG.mix.growl, rate: (z.type === "brute" ? 0.65 : z.type === "runner" ? 1.25 : 0.9) + Math.random() * 0.2, pos: _v.set(pos.x, 1.5, pos.z) });
      }
      z.mixer.update(dt);
    }

    // separation
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === "dying") continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === "dying") continue;
        const dx = b.root.position.x - a.root.position.x, dz = b.root.position.z - a.root.position.z;
        const d2 = dx * dx + dz * dz, min = 0.33 * (a.scale + b.scale);
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = ((min - d) / d) * 0.5;
          a.root.position.x -= dx * push; a.root.position.z -= dz * push;
          b.root.position.x += dx * push; b.root.position.z += dz * push;
        }
      }
      // never stand inside the player
      const dx = a.root.position.x - player.x, dz = a.root.position.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.62 && d > 1e-4) { a.root.position.x = player.x + (dx / d) * 0.62; a.root.position.z = player.z + (dz / d) * 0.62; }
    }

    // keep the corpse count bounded: oldest first
    if (corpses > cfg.maxCorpses) {
      for (const z of list) if (z.state === "dying" && z.t < cfg.corpseTime && corpses-- > cfg.maxCorpses) z.t = cfg.corpseTime;
    }
  }

  _recycle(i) {
    const z = this.list[i];
    z.root.visible = false;
    z.state = "gone";
    z.mixer.stopAllAction();
    this.list.splice(i, 1);
    this.pool.push(z);
  }

  reset() {
    for (let i = this.list.length - 1; i >= 0; i--) this._recycle(i);
    this.alive = 0;
  }
}
