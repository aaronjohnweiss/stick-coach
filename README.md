# Stick Coach

Desktop app (Windows and Linux) for analysing GameCube controller sticks and walking through PhobGCC calibration.
It reads the official Nintendo GameCube adapter directly over USB, records guided tests, measures drift, notch
accuracy, snapback and flick reach, and drives step-by-step calibration walkthroughs for a selectable firmware version.

## Status

- Core logic (analysis, guide-stick tracking, firmware profiles, walkthrough engine) is unit tested: `npm test`.
- The UI module is smoke-tested against a fake DOM (boot, demo recording, full calibration walkthrough with a simulated guide stick).
- Built with Tauri 2: the Rust side (`src-tauri`) reads the adapter over USB (`rusb`) and the packet parser has Rust tests
  (`npm run test:rust`). The Linux `.deb` builds and the app starts.
- **Not yet verified:** reading a real adapter, the AppImage and Windows installers, and the deb's udev post-install script.

## Run from source

```
npm install
npm start
```

Requires Node 20+, Rust (stable), and on Linux `webkit2gtk-4.1` and `libusb-1.0` dev packages. No data leaves the machine, except the optional "Ask Claude" box, which sends your
problem text, the selected firmware's command list and summary numbers to the Anthropic API using a key you paste in.

## Build installers

```
npm run dist:win     # Windows: NSIS installer  (run on Windows)
npm run dist:linux   # Linux: AppImage + deb                   (run on Linux)
```

`.github/workflows/release.yml` builds both on GitHub Actions on every push to `main` (pushes that only change docs, the license or `.gitignore` are skipped), publishes a GitHub release (keeping only the latest 3)
with the Windows installer, AppImage and deb attached. Notes:

- The workflow uses `npm ci` and `cargo --locked`, so keep `package-lock.json` and `src-tauri/Cargo.lock` committed and in sync.
- Windows builds are unsigned, so SmartScreen will warn. Code signing needs a certificate and is not configured.
- Pick a license before publishing; `package.json` is marked `private` for now.

## Adapter setup

- **Windows:** the adapter must use the WinUSB driver (Zadig, device "WUP-028"). This is the same driver Dolphin uses.
- **Linux:** the `.deb` installs `/etc/udev/rules.d/51-gcadapter.rules` automatically. For the AppImage, copy
  `build/linux/51-gcadapter.rules` to `/etc/udev/rules.d/` and run `sudo udevadm control --reload-rules && sudo udevadm trigger`.
- Only one program can use the adapter at a time. Close Dolphin first.
- The adapter protocol used: send `0x13` to the OUT endpoint, then read 37-byte packets (`0x21` + 4 x 9 bytes:
  status, buttons1, buttons2, stickX, stickY, cStickX, cStickY, L, R).

## Layout

```
src-tauri/                 Tauri shell + Rust adapter reader (057e:0337, emits `adapter-sample` events)
src/index.html, app.js     UI (tabs: Live & Tests, Guided Setup, Reference, History, Help)
src/core/analysis.js       Rest / rotation / release / flick analysis, check evaluation, history diffs
src/core/guide.js          Combo parsing, live guide-stick tracker, firmware detection
src/core/walkthrough.js    Walkthrough runner + automatic step readiness
src/core/coach.js          Rule-based advice (text comes from the firmware profile)
src/core/sources.js        adapter (Tauri events; WebUSB fallback in Chrome/Edge), browser gamepad, mouse demo
src/data/firmware/         One module per firmware profile
test/                      node:test suites
```

## Firmware profiles

Each profile lists the commands (`settings`) and walkthroughs (`procedures`) for one firmware version.

| Profile | Basis | Confidence |
|---|---|---|
| 0.31 (latest) | Official Calibration Guide (Latest) | official |
| 0.29, 0.28, 0.27, 0.26 | Official per-version guides (`Phob_Calibration_Guide_v0.NN.md`) | official |
| 0.25 | Official v0.25 guide (older, L/R-only advance, 16 presses) | official; a few steps flagged `unverified` |

Not included: 0.30 (the project skipped it) and anything below 0.25 (unsupported).

### Choosing your firmware version

On first launch a dialog asks which version your Phob runs. Either **pick it manually**, or **auto-detect**: connect the
adapter, hold `A + Z` and press D-pad Up on the Phob. The app sees those button presses on the adapter, then reads the
two-digit version the controller shows on the C-stick Y axis (the 127/127 freeze during the command is ignored) and
offers to switch. No response usually means 0.23 or older (unsupported); try turning Safe Mode off (`AXY + Start`) first.
The **Detect** button in the header reopens the dialog. In Demo mode the keyboard stands in for the pad
(A B X Y Z L R, S = Start, arrow keys = D-pad).

### Adding or correcting a firmware version

1. In the app, select the closest profile and click **Export** to get a JSON template, or copy a file in `src/data/firmware/`.
2. Edit it. Key fields: `id`, `label`, `tier` (`current | legacy | custom`), `versionNumbers` (what the version
   command shows), `settings[]` (name, combo, range, default, display), `coach{}` (advice text), `procedures[]`.
3. Step kinds: `manual`, `rest` (waits for centered sticks), `guide` (tracks the guide stick during calibration),
   `test` (records `rest | rotate | release | flick` and evaluates `checks`), `readVersion`.
4. Check specs are `{label, path, op, value}` against the analysis result, e.g. `releases.worstOpp <= 20`.
5. Either **Import** the JSON in the app (stored locally), or add it to `src/data/firmware/index.js` and ship it.
6. Mark anything you could not confirm with `"unverified": true`. `npm test` validates every bundled profile.

When the official guide changes, update `fw031.js` (or add a new file) and keep the old one for older firmware.
Combos always use physical buttons; "Du/Dd" means D-pad up/down.

## How the calibration walkthrough works

During Phob calibration the controller freezes the stick being calibrated and the *other* stick shows a guide position
(center, then a notch, then center...). The app watches that guide stick, names the position it is on, and counts guide
presses. The adapter reports buttons, so the app counts real L/R/A presses (Z goes back, Start jumps ahead) and uses guide
movements as a cross-check, warning if the two disagree. If a controller does not report buttons during calibration the
guide-movement count is used instead. You can always continue manually. After calibrating, the verification step records a gate rotation and
checks diagonal angle, cardinal reach and off-axis bleed; snapback walkthroughs check release overshoot against the
guide's 20-unit goal. Results are saved to History with before/after comparison.

## Known limitations

- Thresholds (deadzone 23, smash 64, full tilt 80) are Melee-style approximations; edit `CFG` in `src/core/analysis.js`.
- Stick values are raw adapter bytes minus 128. Notch positions can differ slightly from tools that use other origins.
- Notch detection assumes a roughly octagonal gate with corners at 8 directions; modder notches are not analysed.
- Snapback analysis needs the adapter's ~125 Hz sample rate.
- Not affiliated with the PhobGCC project. Confirm combos against the official guide before changing settings.
