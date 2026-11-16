# AGENTS.md — instructions for AI coding assistants

This repo is **Drift**: a relaxing endless drift game. The game runs in a desktop browser
(Three.js); an iPhone is the steering wheel (Expo app). A small Node server relays input.

## First thing when this repo is opened: set it up automatically

If `node_modules/` does not exist, run the setup without asking — it only installs this
project's npm dependencies, runs the tests and builds the game:

- Windows: `powershell -ExecutionPolicy Bypass -File setup.ps1`
- macOS/Linux: `bash setup.sh`

Requirements: Node.js 22+. If Node is missing or older, tell the user to install it from
https://nodejs.org and stop — do not try to install Node yourself.

After setup succeeds, tell the user (in their language) how to play:

1. `npm start` — builds and serves the game; open the printed `http://<ip>:8080` in Chrome.
   On Windows, allow Node.js on **private networks** if the firewall asks.
2. `npm run controller` — starts Expo; scan the QR with the iPhone camera (needs **Expo Go**
   from the App Store, same SDK as `controller/package.json`). If Expo Go says it is signed in
   but the dev server is not, either sign out in Expo Go or run `npx expo login` in `controller/`.
3. In the controller app, scan the QR shown on the game screen (or type the PC's IP).
   Phone and PC must be on the same Wi-Fi.
4. No phone? Arrow keys drive, **E** toggles extreme mode, **M** mutes.

Do not start long-running servers (`npm start`, `npm run controller`) unless the user asks.

## Layout

| Path | What |
|---|---|
| `shared/` | Message protocol and steering math (pure TS) |
| `server/` | HTTP + WebSocket relay; serves `game/dist` on port 8080. `hub.ts` = pairing codes + multiplayer rooms (pure, tested) |
| `game/src/sim/` | Pure game logic: road, car physics, score, recovery, crowd, police, pause |
| `game/src/render/`, `game/src/ui/`, `game/src/audio/` | Three.js scene, HUD, Web Audio synthesis |
| `controller/` | Expo (React Native) steering-wheel app |
| `game/src/net/session.ts`, `ui/lobby.ts` | Multiplayer client: room state, lobby/results UI, remote-car interpolation (`net/remote.ts`) |
| `Dockerfile`, `deploy/` | Production image and Traefik/Coolify compose (`deploy/deploy.sh`) |
| `docs/superpowers/` | Design spec and implementation plan |

## Working on it

- `npm test` runs all Vitest suites (logic is tested; rendering/audio are checked by playing).
- Feel/tuning constants: `game/src/sim/tuning.ts`.
- Debug: `?biome=N` in the game URL starts in biome N (0 desert, 1 city, 2 snow, 3 autumn).
- In `controller/`, use `npx expo install <pkg>` (not plain npm) so versions match the SDK.
