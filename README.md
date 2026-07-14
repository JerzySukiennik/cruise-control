# CRUISE CONTROL

You ARE the missile. Launch, steer through walls, rings and giant furniture, and slam into the target for a big voxel explosion.

**Play:** https://jerzysukiennik.github.io/cruise-control/v1/

## Controls

- **Mouse** — steer (click the canvas for pointer lock)
- **SPACE / LMB** — thrust
- **SHIFT** — slow-mo
- **R** — restart, **ESC** — pause, **M** — mute
- Mobile: left joystick steers, THRUST / SLO-MO buttons

## Levels

1. LAUNCH PAD — vertical launch tutorial
2. SALMON MAZE — scorched holes, fuel is scored
3. FURNITURE ROOM — weave under giant furniture, hit the sedan
4. CITY RUN — full-speed slalom, dive into the skyscraper roof
5. bOSS FACTORY — pipe gauntlet, take out the bOSS

## Tech

- three.js 0.160 (ES modules from CDN, no build step)
- Custom arcade flight model + custom collision (no physics engine)
- Instanced voxel flame trail and debris explosions
- Pixelated look: low-res internal buffer + `image-rendering: pixelated`

## Credits

All models, textures and sounds are CC0 assets by [Kenney](https://kenney.nl) (Prototype Textures, Furniture Kit, Car Kit, Nature Kit, Blocky Characters, Sci-Fi Sounds, Impact Sounds, Interface Sounds, Digital Audio, Particle Pack). Missile model is procedural three.js geometry.
