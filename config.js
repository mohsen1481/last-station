/** All tunable numbers (design/plan.md §5). Tweak at runtime via window.__game.CFG. */
export const CFG = {
  player: { hp: 100, walk: 4.2, sprint: 6.6, eye: 1.65, radius: 0.35, accel: 14 },
  order: ["pistol", "rifle", "shotgun"],
  weapons: {
    pistol: {
      length: 0.21, yaw: -Math.PI / 2, muzzleY: 0.62, pos: [0.15, -0.155, -0.36], ads: [0, -0.085, -0.3],
      mag: 15, reserve: Infinity, dmg: 34, rpm: 330, auto: false, pellets: 1,
      spread: 0.007, recoil: 0.03, kick: 0.05, reload: 1.3, sound: "shot_pistol", vol: 0.5, shake: 0.25,
    },
    rifle: {
      length: 0.9, yaw: -Math.PI / 2, muzzleY: 0.42, pos: [0.15, -0.2, -0.5], ads: [0, -0.115, -0.42],
      mag: 30, reserve: 90, dmg: 30, rpm: 600, auto: true, pellets: 1,
      spread: 0.012, recoil: 0.021, kick: 0.035, reload: 2.1, sound: "shot_rifle", vol: 0.5, shake: 0.3,
    },
    shotgun: {
      length: 0.95, yaw: -Math.PI / 2, muzzleY: 0.5, pos: [0.15, -0.2, -0.52], ads: [0, -0.11, -0.44],
      mag: 6, reserve: 18, dmg: 16, rpm: 75, auto: false, pellets: 8,
      spread: 0.055, recoil: 0.085, kick: 0.11, reload: 2.4, sound: "shot_shotgun", vol: 0.6, shake: 0.7,
    },
  },
  zombie: {
    height: 1.8,
    types: {
      walker: { hp: 100, speed: 1.2, dmg: 12, scale: 1.0, anim: "walk", score: 100 },
      runner: { hp: 70, speed: 3.8, dmg: 9, scale: 0.95, anim: "run", score: 150 },
      brute: { hp: 320, speed: 1.55, dmg: 25, scale: 1.28, anim: "walk", score: 300 },
    },
    animSpeed: { walk: 0.9, run: 4.6 }, // metres per second the clip covers at timeScale 1
    deathSpeed: 1.7,
    headMult: 4, attackRange: 1.35, attackTime: 1.2, hitAt: 0.5, maxAlive: 24, maxCorpses: 10, corpseTime: 14,
  },
  wave: { base: 4, per: 3, cap: 60, breather: 6, speedPer: 0.04, spawnEvery: 1.5, spawnMin: 0.45 },
  drops: { ammo: 0.16, med: 0.07, life: 28 },
  audio: { master: 0.5, music: 0.5, sfx: 0.8 }, // user-facing sliders (0..1)
  mix: { music: 0.16, shot: 1, growl: 0.55, flesh: 0.5, step: 0.16 }, // internal gains
  fx: { decals: 180, blood: 240, particles: 700, casings: 24 },
  quality: {
    low: { pr: 0.75, bloom: false, shadows: 0, msaa: 0 },
    medium: { pr: 1, bloom: true, shadows: 0, msaa: 0 },
    high: { pr: 1.5, bloom: true, shadows: 1024, msaa: 4 },
    ultra: { pr: 2, bloom: true, shadows: 2048, msaa: 4 },
  },
  defaults: { sens: 1, master: 0.5, music: 0.5, sfx: 0.8, quality: "high", fov: 74, shake: true, blood: true },
};
