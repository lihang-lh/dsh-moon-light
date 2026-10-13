# dsh-mood-light — Session Mood Light

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A mood-light ring around the DSH web UI edge. It reads the current session
state and automatically switches the light color and rhythm. The **default
effect is soft glow (diffuse)** — borderless, a multi-layer inward-diffusing
scattered light with a subtle organic irregularity. Marquee (rotating band)
and linear gradient (static) remain selectable styles.

| Session state | Light | Signal (host-published) |
| --- | --- | --- |
| Approval pending | 🟡 Amber (highest priority) | `useSessionStatus` → `pendingInteraction.kind === "approval"` |
| Agent asked you a question | 🟣 Purple | same, `kind === "question"` |
| Plan awaiting review | 🔵 Cyan | same, `kind === "plan-review"` |
| Agent is working | 🟢 Green halo + breathing flash | `status.running === true` |
| Done / idle (nothing pending) | 🩷 Pink halo (steady) + one sweep | not running, not blank, nothing pending |
| No session / blank session / disabled | Off | no current session or `blank === true` |

**Multi-session aggregation**: the color is the highest-priority state across
all sessions. Hovering the very top edge of the screen (a 10 px trigger strip)
reveals a capsule with the aggregate result plus an "N other sessions" summary;
clicking it jumps to that session.

The light is purely decorative and never blocks interaction (only the top
trigger strip and the capsule accept mouse events; everything else is
click-through). All animations stop under `prefers-reduced-motion`.

## Interaction & shortcut

| Interaction | Behaviour |
| --- | --- |
| Hover the top edge | Cursor entering the trigger strip (height configurable, 10 px default) fades in a top-centered capsule; it fades out 220 ms after leaving |
| Click the capsule | Jumps to the session the aggregate points at (no-op if that is the current session) |
| Status bar below the composer | A persistent 36 px bar registered on `conversation.composer.dock`, showing state + session title with a one-click toggle |
| Shortcut | `Ctrl/Cmd + Shift + M` toggles the mood light (works inside text inputs too). `defaults` deliberately omits `web:linux`: the host only allows Slash/Comma/Period bindings on Linux, and declaring a letter key there makes `register()` throw before the command table is written, killing the shortcut on every platform. |
| Settings | Settings → Mood Light, all parameters adjustable live |

## Settings

A "氛围灯" (Mood Light) page is registered in the DSH settings panel
(Settings → Mood Light). Every parameter is adjustable live and persisted to
`localStorage`:

- **Enabled** toggle
- **Ring width**: 1–40 px slider
- **Opacity**: 5%–100% slider
- **Style**: `soft glow (diffuse, default)` / `marquee (rotating band)` / `linear gradient (static)`
- **Band style** (marquee only): `segmented marquee (classic)` / `smooth gradient`
- **Rotation speed**: 0–60 s per revolution (0 = static)
- **Glow spread** (glow only): 0–200 px, how far the halo diffuses inward
- **Wobble** (glow only): 0–10, subtle organic distortion of the halo edge
  (**default 0 = off**; enabling it puts an SVG displacement filter on the
  whole full-screen layer, which can drop frames on low-end devices)
- **Ambient light** (glow only): 0–200%, a very faint overall tint at the top
  and bottom edges
- **Grain** (glow only): 0–0.15, a 160 px tiled noise layer that removes the
  plastic look of large gradients
- **Completion sweep** (glow only): toggle; sweeps a bright band along the
  edge when the state becomes "done"
- **Transition duration** (glow only): 0–1500 ms cross-fade between states
- **Flash**: 0–10 s per cycle (0 = steady; per-state override available)
- **State colors**: three color pickers each for running / done / approval /
  plan-review / question
- **Capsule**: toggle + trigger-strip height 4–40 px
- **Composer status bar**: toggle
- **Reset to defaults**

## Install

```sh
dsh plugin --profile web add "github:lihang-lh/dsh-moon-light"
```

Restart `dsh web` after installing — the client plugin catalog is composed at
startup. Settings made in the panel are kept in `localStorage` and survive
restarts.

For development, install from a local checkout with `link:` (symlink — edits
take effect after restart, no reinstall):

```sh
dsh plugin --profile web add "link:/your/local/path/dsh-moon-light"
```

Uninstall:

```sh
dsh plugin --profile web remove dsh-moon-light
```

## Config priority

`localStorage` (settings panel) > plugin row `config` (`cordis.patch.yml` /
profile patch) > built-in defaults. Third-party namespaces are not exposed by
the host settings wire, so user configuration lives in `localStorage` (same
pattern as dsh-skin).

Override deployment defaults via a profile patch without touching the plugin:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: mood-light
  config:
    width: 12
    rotate: 24
    gradientType: 'glow'     # default soft glow; 'conic' | 'linear' | 'glow'
    glowSpread: 40           # glow halo spread (px)
    glowWobble: 0            # glow irregularity (0..10; 0 = no filter, default)
    transitionMs: 700        # state cross-fade duration (ms, glow only)
    grain: 0.035             # grain strength (0..0.3, glow only)
    capsuleTriggerHeight: 10 # top trigger-strip height (px)
    states:
      running:
        colors: ['#22c55e', '#4ade80', '#bbf7d0']
        flash: 0.8
```

## How it works

- Hand-written client bundle following the DSH client-modules protocol
  (`window.__ModuleLoader__.load({ id, factory })`); depends only on the
  platform seed module `react` and collaborates through the `slots`,
  `shortcuts` and `uiWorkspace` services. No build step.
- Registers three slots, all under id `mood-light`: `shell.overlay`
  (frame-level overlay, click-through), `conversation.composer.dock` (the
  status bar below the composer card) and `settings.section`. The
  `mood-light.toggle` shortcut is registered via
  `ctx.inject(["shortcuts"], ...)`. Every registration is wrapped in
  `ctx.effect(...)` so the host disposes them on unload.
- **Session state is read in two layers** (the key v0.4.0 fix):
  - `useSessions` snapshot → `SessionSummary` (`running` / `blank` / `title`)
  - `useSessionStatus` → `Map<sessionId, { running, pendingInteraction, completionUnread }>`
  - `pendingInteraction` (approval / plan review / question) **only exists in
    the second layer**. v0.3.0 read it off `SessionSummary`, so the pending
    warning never lit up; v0.4.0 resolves it in
    `resolveSessionState(status, summary, config)` from `useSessionStatus`,
    falling back to approval for unknown `kind` values.
  - `aggregateState(byId, statusMap, config)` walks every session and picks the
    highest priority via `STATE_PRIORITY = { warning: 0, question: 1,
    planReview: 2, running: 3, success: 4 }`; ties keep the first walked
    (stable result).
- **Cross-fade**: on a state change `renderLayers(mode, previousMode, config)`
  returns two layers (outgoing first, incoming last), each carrying a snapshot
  of its own shadow string; the wrapper `opacity` transitions over
  `--ml-transition`. **No transition on `box-shadow`** — multi-layer blurred
  shadow interpolation is unreliable across browsers. The flash animation lives
  on the inner `dsh-mood-light-glow-core` so it does not fight the wrapper's
  `opacity` transition.
- **Dark/light adaptation**: the host projects the theme as
  `body[data-ds-dark-theme]`; the plugin maps it to `--ml-theme-scale`
  (`0.85` dark — light blows out; `1.35` light — light washes out) and all
  opacity formulas are `calc(var(--ml-opacity) * var(--ml-theme-scale))`.
- The marquee style is a `position: fixed; inset: 0` layer with `padding` +
  `mask-composite: exclude` carving out the outer band; an inner
  `inset: -50%` rotating `conic-gradient` disc is clipped into the band by
  the mask (`rotate` controls the marquee speed; segmented mode uses hard
  color stops, smooth mode uses a continuous gradient; `flash` pulses the
  overall brightness).
- The soft-glow (glow) style is a full-screen `position: fixed; inset: 0`
  layer (no background, no mask) whose shadow is built in JS from the state
  primary/secondary colors + `width` + `glowSpread` as a chain of **multi-layer
  blurred inset box-shadows** (no zero-blur solid core layer — spread grows
  from `width` to `width+glowSpread` while alpha falls, so light fades in
  smoothly from the screen edge with no crisp border) injected into
  `--ml-glow-shadow`.
- Other visual layers: ambient `dsh-mood-light-fill` (radial gradients at the
  top/bottom edges, strength `opacity × 0.16 × theme scale`), grain
  `dsh-mood-light-grain` (a 160 px `data:image/svg+xml` tile with
  `mix-blend-mode: overlay` — **no full-screen SVG filter**), and sweep
  `dsh-mood-light-sweep` (a 115° bright band with its own
  `padding + mask-composite` so it only sweeps the edge).
- The default effect style is **soft glow (diffuse)** — soft and borderless
  out of the box; `conic`/`linear` can still be selected in the settings page
  or via row config, but they **only share the new state core** (so pending
  colors are correct there too) and do not take part in the visual/interaction
  upgrade.

## Development

```sh
node --check client.js        # bundle syntax
node scripts/test.cjs         # state core / config merge / persistence / render / interaction-regression tests (130 assertions)
```

A standalone preview is available at `docs/preview.html` — open it in a
browser to see the five states, tune every parameter, switch dark/light and
demo the capsule and status bar without installing anything.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Host entry (empty apply, satisfies the Cordis loader) |
| `client.js` | Browser-side mood light + status bar + settings page (core) |
| `cordis.patch.yml` | Plugin row + deployment default config |
| `docs/preview.html` | Standalone effect preview (no install needed) |
| `scripts/test.cjs` | Logic tests (state mapping / config / persistence / render) |
| `.github/workflows/ci.yml` | Syntax + test CI |
| `specs/proposals/t_moodlight_v04/` | v0.4.0 design spec, task list, [delivery notes](specs/proposals/t_moodlight_v04/delivery.md) and E2E screenshots |
| `package.json` | `dsh.bundle` / `dsh.client` declarations |
