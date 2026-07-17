# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-07-17

### Changed

- Cava: removed the tiny status-row cava viz; live spectrum is a **2-row strip under the shortcut footer** (slightly larger, content-width).
- Help (`?` / `h`): regrouped into minimal sections — play · seek · sound · more.
- Pause glyph remains `⏸`; richer click targets from 0.2.1 kept.

### Notes

- Cava still **off by default** (`--cava` or `v`).



## [0.2.1] - 2026-07-17

### Added

- **Cava spectrum strip** — optional discreet greyscale spectrum (requires `cava` on PATH).
  - Off by default; enable with `--cava` or toggle with `v` (click the strip to toggle too).
- **Richer mouse UI** — scrub progress; click `◂` / `⏸`/`▶` / `▸` for prev / pause / next; click volume (mute), spd, ptch, eq; click playlist rows to jump; scroll wheel seeks ±5s.
- **Pause glyph** — clearer `⏸` when paused.
- `AGENTS.md` — agent workflow (build + install to PATH after changes).
- `LICENSE` — Apache License 2.0.

### Changed

- README updated for cava (opt-in), mouse hits, Apache-2.0.
- Package license: MIT → **Apache-2.0**.

### Removed

- `ROADMAP.md` (tracked in issues / chat instead).



## [0.2.0] - 2026-07-17

### Added

- **MPV audio engine** via `libmpv2` — replaces rodio for broader format support and stronger control surface.
- **Mute** (`m`) during playback.
- **Long seek** `{` / `}` ±60s (short seek remains ← / → ±5s).
- **Equalizer presets** (`e`) — cycle: off → bass+ → treble+ → rock → vocal → lofi.
- **Crossfade** — CLI `-c` / `--crossfade SECONDS` maps to MPV `audio-fade`.
- **Speed & pitch** — `[` / `]` speed, `,` / `.` pitch, `0` resets both.
- **Default music dir** — global `-m` / `--music-dir` (default `~/Music` when `play` has no paths).
- **Zero-leak UI** — alternate-screen session with absolute redraw; scrollback restored cleanly on quit.
- **Unit tests** for playlist, EQ presets, MPV config clamps, music-dir resolution, CLI parsing, UI helpers.
- **CHANGELOG.md**.



### Changed

- Version bumped to **0.2.0**.
- `info` probes duration via a short-lived MPV instance (ao/video off).
- Keyboard help and README updated for the new controls.
- Dependency: `rodio` removed; `libmpv2` and `dirs` added.



### Notes

- Requires system **libmpv** (and pkg-config `mpv` on most distros). See README.



## [0.1.0] - 2026-07-17



### Added

- Initial release: dual bins `optmusic` / `msc`, rodio playback, alternate-screen B&W UI, play / list / info / version.
