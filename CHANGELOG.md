# Changelog

All notable project changes should be documented in this file.

Maintained by **Tabica**. Originally created by Rakjsu.

## Unreleased

### Removed

- The Favorites page and its sidebar entry. Favorite channels live in Live TV: the "Favoritos"
  category filters the grid, and the ★ panel lists them with what's on now. Styles My List was
  borrowing from Favorites.css moved into MyList.css (computed styles checked, unchanged).

### Added

- Live TV: the channel preview plays with sound, with a mute button next to "Assistir"
  (remembered). If the device blocks autoplay with sound, the preview plays muted.

### Fixed

- Live TV: channels that played in the preview failed when opened on 1-connection accounts
  ("Maximum number of connections reached"). The player now takes over the preview's running
  `<video>` + hls.js pipeline (no new request, continues from the buffer); the session URL
  (`?token=`) remains as fallback.
- Live player: a frame/buffer watchdog switches source (session → normal URL → next variant) as
  soon as the feed stops delivering, including streams that never start (the old watchdog skipped
  paused video).
- Connection-limit refusals (`500 Maximum number of connections`, or `403`/`500` right after
  another stream) are retried on the same source for up to 30 s with "Aguardando o provedor
  liberar a conexão…", instead of being treated as "channel not found" and burning variants.
- Home: with something in "Continuar Assistindo", its progress bar was drawn as a line across the
  whole screen — the poster box wasn't positioned, so the bar anchored to the page.

## 1.1.3 - 2026-10-10

### Fixed

- The focused card in the first grid column/row was clipped by the grid edge: cards are now
  centered in their cell, so the focus zoom fits.

### Changed

- Settings → TMDB shows the attribution required by the TMDB API terms.
- Removed the original author's Tizen signature files from the repo (now ignored);
  `tizen package` regenerates them with the packager's certificate.

## 1.1.2 - 2026-10-10

### Fixed

- Desktop (Linux/WebKitGTK): Movies/Series grids scrolled at ~13 fps — the frosted-glass
  (`backdrop-filter`) badge on every card was re-blurred each frame. Removed from the cards
  (~55 fps now).
- Cards vanished while scrolling: the per-card fade-in replayed on every virtualized mount.
  Removed from all grid cards.
- Desktop (Linux): the web process crashed (SIGBUS in GStreamer GL on Mesa radeonsi) when the
  Home live preview played. The app now sets `WEBKIT_GST_DISABLE_GL_SINK=1` unless already set.
- Images without a URL no longer render `<img src="">`.
- Grids no longer show a horizontal scrollbar.

### Performance

- TV builds (webOS/Tizen): always-on decorative animations (sidebar glow, waving hand, live dot,
  pulses) are off via `html.tv-lite`. Home idle CPU went from 23% to ~3% in a 6x-throttled run.
- Card posters from TMDB load at `w342` instead of `w600_and_h900` (~60% smaller, 1/3 the
  pixels to decode).

## 1.1.1 - 2026-10-10

### Changed

- Favorites is now a channels-only page (star icon in the sidebar). The heart/"Favoritar" action
  was removed from movie and series screens; existing movie/series favorites are kept and still
  feed Home recommendations and the new-episode badge. "Limpar Tudo" clears only channels.
- Home live channel row: favorite channels first, filled with other visible channels up to at
  least 10.
- Detail screen: cast comes only from the provider (names only, no TMDB request); movies fetch it
  via `get_vod_info`. "Assistir Depois" renamed to "Adicionar à Lista".
- Wider spacing between the detail screen action buttons.
- Clicking an episode (mouse / Magic Remote) plays it, same as OK on the D-pad.
- Episodes without a thumbnail, or with a broken one, show the series poster instead.
- webOS: `requiredACG: []` in `appinfo.json` for store eligibility.
- Package identity moved to Tabica: webOS `com.tabica.zapptv` (vendor Tabica), Tizen
  `TabicaZapp.ZappTV` (widget `http://tabica.zapp.tv`). Installs under the old ids are separate
  apps on the TV.

## 1.1.0 - 2026-10-10

### Added

- Live TV: HD is now the default variant of a channel group (plays first and provides the logo);
  other qualities follow as fallback (HD → FHD → 4K → untagged → SD).
- Quality failover: when another variant exists, the player gives up after one reconnect (~2 s)
  instead of four (~30 s), and the same failover now works from Favorites and Global Search.
- LG webOS 4.x support (Chromium 53, 2018 TVs): lower build target plus `AbortController` and
  `ResizeObserver` fallbacks in `src/legacyPolyfills.ts`. Verified on a real device.
- Desktop (Tauri): provider requests go through Rust (`tauri-plugin-http`), so the provider's
  CORS-less redirect no longer breaks login ("Load failed"); `scripts/install-arch.sh` installs
  the app natively on Arch Linux. App identifier is now `com.tabica-tabica.zapptv`.

### Changed

- Home: removed the stats and quick-access cards; translated the Home strings (pt/en/es).

### Fixed

- Home: card click opens the detail modal; preview row scrolls with focus; one failed endpoint no
  longer empties every row (Chrome 69-safe `settle`); focus clamps when a row shrinks.
- TV CSS: flex `gap` / `aspect-ratio` fallbacks for the live-channel preview, zap preview and
  dialogs, which had broken the Chromium 69 CSS check in CI.
- Dev server: API and stream-redirect proxies for the provider's CORS-less first redirect.

## Unreleased

### Added

- `react-window` virtualization on every large grid (Live TV, Movies, Series, My List, Favorites):
  only the visible window mounts, instead of the whole catalog. Landed alongside a shared
  `useVirtualGridNavigation` hook that centralizes the D-pad row/column math five pages used to
  duplicate, and `useMeasuredColumns`, which replaces the hardcoded 6-column grids with a column
  count computed from the real container width.
- `React.memo` card components (`CatalogCard`, `SeriesCard`, `ChannelCard`, `MovieCard`, `HomeCard`)
  extracted from inline JSX that used to live in each page's `.map()`. Memoization only works because
  the per-item `onClick` closures became stable `useCallback`s and the old per-index inline
  `animationDelay` style objects became fixed `stagger-N` CSS classes — either alone would have made
  the `memo` a no-op.
- `useBrokenImages`: the `Set<number>` + fallback-icon pattern that Live TV, Movies, and Series each
  copy-pasted is now one hook.
- `loading="lazy"` on the Live TV channel grid and all seven Home rows, which had no lazy-loading hint
  at all.
- LG webOS build pipeline: `vite.webos.config.ts`, `scripts/build-webos.mjs` (mirrors
  `build-tizen.mjs`'s clean-copy-then-validate steps), `webos/appinfo.json` + `webos/index.html`,
  `src/services/webosApp.ts`, and a `platformApp.ts` dispatcher so `useExitPrompt` and the trailer
  button in `ContentDetailModal` work on both TV platforms without an `if` at every call site. Targets
  webOS 5.x (Chromium ~68+), not the spec's literal webOS 3.x floor — that engine predates the
  Proxy/ES2015 baseline React 19 assumes. `npm run build:webos` and a new `webos` CI job mirror the
  existing Tizen ones. Store submission itself (LG account, physical-device testing, signed `.ipk`)
  is not part of this — see `docs/CHECKLIST_WEBOS.md`, `docs/LG_UX_SCENARIO.md`, and
  `docs/LG_SELF_CHECKLIST.md`.
- `rollup-plugin-visualizer`, opt-in via `ANALYZE=true npm run build:web`, for ad-hoc bundle
  inspection alongside the existing (and stricter) `check-bundle-budget.mjs` gate.
- Genre filter on the movie and series catalogs, derived from the provider's own category names.
  TMDB is deliberately not used for this: the key is optional and most people do not have one, and
  the metadata cache holds 120 entries against catalogs of thousands. Only genres the provider
  actually carries are offered — a genre that returns an empty grid is indistinguishable from a bug
  on a TV.
- Collection row in the content detail modal: the other films of the saga that exist in *your*
  catalog, matched by TMDB id first and then by name plus year.
- Cast strip with photos, falling back to the cast string the provider already sends.
- Per-episode synopsis and thumbnail, from data `get_series_info` already returned and nobody read.
  Zero extra network. The episode list only grows when there is something to show.
- Trailer button. In the browser it opens an embed; on the TV it hands the URL to the system's own
  app, because a cross-origin iframe inside a `file://` widget would swallow the remote's keys.
- "Because you watched X" row on Home, seeded by an explicit, named title.
- Named personal lists alongside the default one, with suggestion-based naming (no free typing on a
  D-pad) and a per-item "add to…" picker on the yellow key.
- `eslint-plugin-compat` pinned to Chrome 69, catching browser APIs the build cannot polyfill. The
  list of APIs the lint is allowed to ignore is verified against the produced bundle during
  `build:tizen`, so it cannot silently become a lie.

### Changed

- TMDB responses are now projected before being cached instead of stored whole. Cache keys were
  bumped to `_v2` once, for all the new fields at the same time.
- `credits` and `videos` ride along in the existing `append_to_response`, so cast and trailer cost no
  extra request.
- Collections get their own cache store with a smaller cap: a saga is an object with N films inside
  and weighs far more than a single title's metadata.
- Toolbar focus on the catalog pages is anchored by id instead of position, because the genre button
  is conditional.

### Fixed

- `useMeasuredColumns` measured the grid container through a plain `useRef`, whose identity never
  changes — so on pages where the grid only mounts after an async fetch (Live TV, Movies, Series),
  the very first (and only) measurement ran against a container that didn't exist yet, and the column
  count silently stuck at its 3-column fallback forever. Fixed by having the hook own a callback ref
  instead of accepting a `RefObject`, so a newly-attached DOM node reliably re-triggers the
  measurement. My List and Favorites happened not to trigger it, since their grid is present on the
  very first render.
- Home's mixed-type rows ("because you watched X", Top 10, Recommendations) keyed cards by
  `getId(item)` alone — a movie and a series can share the same numeric id, since they're independent
  id spaces on the provider, and React warned about duplicate keys the moment a mixed row actually hit
  one. The "Continue Watching" row already prefixed its keys by kind; the other three now do too.
- The minimum-rating filter was dead: `matchesFilters` filtered by it and no screen ever wrote it,
  behind a comment promising that left/right adjusted it. It now has its own button.
- The content detail modal had no race guard on its TMDB fetch, so switching versions could let the
  previous title's response overwrite the new one — wrong poster and synopsis on screen.
- Focus in the modal reset only when it opened, not when the content changed underneath it.
- The episode list scrolled by child index, so anything added inside the list would have scrolled to
  the wrong episode.
- The "Recommended for you" row on Home rendered unconditionally but only joined the focus list when
  it had items, drawing an empty titled row that the D-pad skipped.
- `neostream_scope_migrated_v2` was missing from the storage key inventory.

### Added

- Multi-channel program guide: channels as rows, time as columns, opened with the new toolbar button
  on the Live TV screen. EPG is fetched lazily per visible row (at most three requests in flight),
  and OK plays the on-air show, opens the archive for a past program, or sets a reminder for a
  future one.
- Test suite (Vitest): 226 tests covering the pure catalog layer, the storage layer with a real
  quota, per-profile scoping and migrations, the player's three decisions (error classification,
  reconnect backoff, quality cap), the parental PIN lockout, provider URL normalization, playback
  progress, catalog caching, reminder timers, QR backup, and every remote key code the app answers.
- Continuous integration on GitHub Actions running the type-check, lint, tests, the Tizen build, and
  two new guards.
- `scripts/check-tizen-css.mjs`: fails the build on CSS features Chromium 69 ignores. Features that
  have a fallback (`gap` in flexbox, `aspect-ratio`) are allowed only while the selector is covered
  by the corresponding fallback file.
- `scripts/check-bundle-budget.mjs`: size budget for the built bundle, measured rather than guessed.
- Rate limiting on the parental PIN: five wrong attempts trigger a wait of 30 s, 2 min, 10 min, and
  30 min. The counter lives in storage, so closing and reopening the app does not reset it.

### Changed

- The Back key now follows one chain across the whole app: content, then the sidebar, then Home,
  then the exit prompt, then exit. Favorites, My List and the Live TV root did not handle Back at
  all; Movies and Series only closed the context menu.
- The exit prompt now expires after four seconds. It used to stay armed indefinitely, so pressing
  Back on Home, watching a film, and pressing Back again closed the app without warning.
- The player's error classification, reconnect backoff and quality cap moved to
  `src/services/playerDecisions.ts`, where they can be tested outside a TV.

### Fixed

- `neostream_scope_migrated_v2` was missing from the storage key inventory, so an account reset
  cleared the v1 migration flag and left the v2 flag behind. Found by the new contract test.

### Changed

- Removed the bundled TMDB API key from source code.
- Added local TMDB key storage through the Settings screen for device/browser testing.
- Split production builds into `build:web` for modern browsers and `build:tizen` for Samsung Tizen.
- Added a dedicated Tizen Vite config for legacy output and expected single-bundle packaging.
- Finalized the Samsung Tizen package identity as `RakjsuNeo1.NeoStreamTV`.
- Improved Xtream server URL handling with normalization and HTTP/HTTPS fallback.
- Improved login remote-control behavior when leaving TV keyboard input fields.

### Documentation

- Rewrote the README to remove broken encoding artifacts.
- Updated the documented stack to React 19, TypeScript 5, and Vite 7.
- Added creator attribution for Rakjsu.
- Added clearer disclaimer and security notes for IPTV credentials, TMDB usage, generated Tizen artifacts, and local logs.
- Added a TMDB API key tutorial explaining that each user must provide their own key.
- Documented the current Tizen package identity and install/run commands.
- Added current maintenance notes for build, lint, and Tizen packaging state.

### Known Follow-ups

- Complete Live TV playback from the channel preview action.
- Clean or ignore generated Tizen workspace metadata and install/debug logs.
- Improve remote-control navigation consistency across screens.
