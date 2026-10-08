# Planner design QA — 2026-10-07

## Reference and evidence

The accepted Space and task-page concept images were opened and inspected during implementation. Public captures of the resulting [Space](docs/screenshots/space.png) and [task page](docs/screenshots/page-insert.png) are included in this repository; the original local concept images are not distributed.

Final implementation captures came from the packaged Apple Silicon app on macOS 26.5.2, using an isolated example profile. Native captures are at 2× density, normalized to 1 CSS pixel per image pixel for comparison. The OS constrained the requested 1586×992 window to a 1586×959–960 content viewport; references are 1586×992. Comparison canvases preserve scale and pad height instead of stretching content.

Artifacts in `test-results/native/` (local, ignored by Git):

- `calendar.png`, `space.png`, `page.png`, `page-insert.png`, `page-narrow.png`
- `space-1x.png`, `page-insert-1x.png`
- `space-comparison.png`, `page-insert-comparison.png`: full reference/capture pairs
- `space-focused.png`, `page-insert-focused.png`: focused content pairs at equal scale
- `results.json`: packaged acceptance and computed layout measurements

## Findings and corrections

The interface retains the reference's flat white surfaces, charcoal type, quiet gray borders, monochrome icons, compact rows, search/filter tabs, and document-oriented task page. The explicit approved 48/176 px sidebar and 13/14/24 px typography take precedence over approximate dimensions in generated mockups.

Native computed measurements: collapsed sidebar 48 px, interface text 13 px, document blocks 14 px, title 24 px. System font resolves to Apple/system UI. The expanded sidebar was also measured at 176 px in the browser UI. Normal and 740×620 narrow native captures were inspected.

The initial wide-layout Insert button overlapped the titlebar. Its position was corrected; final native measurement places it at y=96 px, with menu bottom at y=782 px inside the 959–960 px viewport. The menu scrolls when window height is limited. The native physics tool initially inherited the system dark appearance; the default isolated tool surface now explicitly uses light colors, verified through native computed style and a fresh graph capture. Native tool surfaces are hidden while menus/dialogs are open, so they do not cover the editor's controls.

Reference content and implementation test content differ intentionally: the reference includes many sample tasks and a PDF; native acceptance uses a smaller example plus an independent-deadline test essay, saved flashcards, and the physics tool. The Space reference highlights All items; native capture highlights Focus with the approved section precedence. These are composition/density comparisons, not pixel-identical content snapshots. Dates follow system localization. Native traffic-light controls are OS-drawn and are not included in web-content captures.

Primary UI checks included page creation, Chinese text entry, checklist editing, autosave, navigation/reopening, sidebar expansion, and Insert menu operation in the browser. Native acceptance checked editor loading, tool/menu visibility, narrow layout, pending Chinese title persistence on Quit, and tool state persistence. Calendar keyboard behavior and study assessment/state regressions passed automated tests. The containment notification was dismissed before the final narrow capture. Native physics controls were exercised through the page, checked after sidebar layout changes, and captured separately in physics-tool.png.

## Remaining public-release checks

Real Chinese IME composition, VoiceOver/screen-reader traversal, signed notification permission/delivery, production Keychain identity across signed upgrades, real account/provider flows, and Intel hardware acceptance still require dedicated live checks. Browser typing does not establish IME coverage, and source-level accessibility checks do not establish a full screen-reader audit.

Result: local visual QA completed; public-release accessibility/device/account gates remain explicit.
