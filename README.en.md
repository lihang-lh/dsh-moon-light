# dsh-mood-light — Session Mood Light (Marquee)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A marquee-style mood-light ring around the DSH web UI edge. It reads the
current session state and automatically switches the light color and rhythm:

| Session state | Light | Signal (host-published session summary) |
| --- | --- | --- |
| Agent is working | 🟢 Green flowing band + flash | `summary.running === true` |
| Done / idle (nothing pending) | 🩷 Pink band (steady) | not running, not blank, nothing pending |
| Needs attention (approval / plan review / question) | 🟡 Yellow band (slow pulse, highest priority) | `summary.pendingInteraction` set |
| No session / blank session / disabled | Off | no current session or `blank === true` |

The ring is purely decorative (`pointer-events: none`) and never blocks
interaction; animations stop automatically under `prefers-reduced-motion`.

## Settings

A "氛围灯" (Mood Light) page is registered in the DSH settings panel
(Settings → Mood Light). Every parameter is adjustable live and persisted to
`localStorage`:

- **Enabled** toggle
- **Ring width**: 1–40 px slider
- **Opacity**: 5%–100% slider
- **Style**: `marquee (rotating band)` / `linear gradient (static)`
- **Band style** (marquee only): `segmented marquee (classic)` / `smooth gradient`
- **Rotation speed**: 0–60 s per revolution (0 = static)
- **Flash**: 0–10 s per cycle (0 = steady; per-state override available)
- **State colors**: three color pickers each for running / done / pending
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
    gradientType: 'linear'
    states:
      running:
        colors: ['#22c55e', '#4ade80', '#bbf7d0']
        flash: 0.8
```

## How it works

- Hand-written client bundle following the DSH client-modules protocol
  (`window.__ModuleLoader__.load({ id, factory })`); depends only on the
  platform seed module `react` and collaborates through the `slots` service.
  No build step.
- Renders into `shell.overlay` (frame-level overlay, click-through) and
  `settings.section` (settings page), both registered under id `mood-light`.
- Session state comes from the `useSessions` snapshot selector standard prop:
  `SessionSummary.running` / `blank` / `pendingInteraction` map to the
  running / success / warning modes (`resolveMode` in `client.js`).
- The ring is a `position: fixed; inset: 0` layer with `padding` +
  `mask-composite: exclude` carving out the outer band; an inner
  `inset: -50%` rotating `conic-gradient` disc is clipped into the band by
  the mask (`rotate` controls the marquee speed; segmented mode uses hard
  color stops, smooth mode uses a continuous gradient; `flash` pulses the
  overall brightness).

## Development

```sh
node --check client.js        # bundle syntax
node scripts/test.cjs         # state mapping / config merge / persistence tests
```

A standalone preview is available at `docs/preview.html` — open it in a
browser to see the marquee effect and tune the parameters without installing
anything.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Host entry (empty apply, satisfies the Cordis loader) |
| `client.js` | Browser-side marquee mood light + settings page (core) |
| `cordis.patch.yml` | Plugin row + deployment default config |
| `docs/preview.html` | Standalone effect preview (no install needed) |
| `scripts/test.js` | Logic tests (state mapping / config / persistence) |
| `.github/workflows/ci.yml` | Syntax + test CI |
| `package.json` | `dsh.bundle` / `dsh.client` declarations |
