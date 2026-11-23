# Last Station — آخرین ایستگاه

**Built with Fable 5.2 — ساخته‌شده با Fable 5.2**

A photoreal horror wave shooter in an abandoned metro station. The train no longer moves — they come from the darkness of the tunnel.

یک بازی تیراندازی اول‌شخص ترسناک در یک ایستگاه متروی متروکه. قطار دیگر حرکت نمی‌کند — آن‌ها از تاریکی تونل می‌آیند.

**Play online:** https://mohsen1481.github.io/last-station/

## About the game

You are the last survivor in the station. Hold the line against endless waves of zombies: walkers, runners, and brutes. Aim for the head — headshots deal 4× damage. Between waves, grab ammo and medkit drops and get ready for the next one.

شما آخرین بازمانده در ایستگاه هستید. جلوی موج‌های بی‌پایان زامبی‌ها بایستید: زامبی‌های عادی، دونده‌ها و غول‌ها. به سر شلیک کنید — هدشات چهار برابر آسیب می‌زند. بین موج‌ها مهمات و جعبه کمک‌های اولیه را بردارید و برای موج بعد آماده شوید.

### Weapons — اسلحه‌ها

| Weapon | Magazine | Notes |
|---|---|---|
| کلت ۹ میلی‌متری (Pistol) | 15 | Unlimited reserve ammo |
| کلاشینکف (Rifle) | 30 + 90 | Fully automatic |
| شاتگان (Shotgun) | 6 + 18 | 8 pellets per shot |

### Enemies — دشمن‌ها

- **Walker** — slow, 100 HP, 100 points
- **Runner** — fast, 70 HP, 150 points
- **Brute** — big and tough, 320 HP, 300 points

## Controls — کنترل‌ها

| Action | Key |
|---|---|
| حرکت (Move) | W A S D |
| دویدن (Sprint) | Shift |
| شلیک (Fire) | Left click |
| نشانه‌گیری دقیق (Aim) | Right click |
| تعویض خشاب (Reload) | R |
| انتخاب اسلحه (Switch weapon) | 1 / 2 / 3 or scroll wheel |
| چراغ‌قوه (Flashlight) | F |
| توقف (Pause) | Esc |
| اطلاعات فنی — FPS (Debug info) | F3 |

## How to run — نحوه اجرا

The game uses JavaScript modules, so it must be served over HTTP — double-clicking `index.html` will not work.

این بازی با ماژول‌های جاوااسکریپت نوشته شده، پس باید روی HTTP اجرا شود — با دابل‌کلیک روی `index.html` کار نمی‌کند.

**Option 1 — Python (easiest):**

```bash
python -m http.server 8000
```

Then open http://localhost:8000 — بعد مرورگر را باز کنید: http://localhost:8000

**Option 2 — Node.js:**

```bash
npx serve .
```

**Option 3 — VS Code:** install the "Live Server" extension, then right-click `index.html` → Open with Live Server.

**Option 4 — Play online:** just open https://mohsen1481.github.io/last-station/ — no install needed.

## Online records

The game can sync your best record to a hosted server over WebSocket (`/ws/<room>`). That server is not part of this repository — when it is not available (for example on GitHub Pages), the game works fully offline and your record is saved in the browser (localStorage).

همگام‌سازی رکورد آنلاین به یک سرور با وب‌سوکت (`/ws/<room>`) نیاز دارد که جزو این ریپو نیست؛ وقتی سرور در دسترس نباشد (مثلاً روی GitHub Pages)، بازی کاملاً آفلاین کار می‌کند و رکورد در مرورگر ذخیره می‌شود.

## Tech — فناوری

- [Three.js](https://threejs.org/) (vendored in `vendor/` — no install, no build step, no CDN needed)
- GLTF models, PBR textures, post-processing bloom, dynamic shadows
- Persian UI with the Vazirmatn font (`vendor/fonts/`)
- All sounds and models are included in `assets/` — the game runs fully offline after download

## Project structure

```
index.html          Entry point (Persian RTL UI)
client.js           Record sync + game bootstrap
config.js           All tunable numbers (weapons, zombies, waves, quality)
strings.js          Every player-visible string (Persian)
game/               main.js, world.js, zombies.js, weapons.js, audio.js, effects.js
assets/             Audio, 3D models (.glb) and textures
vendor/             Three.js + addons + Vazirmatn font
```

## License — لایسنس

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file.

این پروژه تحت لایسنس MIT منتشر شده است — فایل [LICENSE](LICENSE) را ببینید.
