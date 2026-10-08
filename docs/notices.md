# Dependency notices

Planner application code is MIT licensed; see the root LICENSE. Third-party components retain their own copyrights and terms. This is a source-level overview, not a replacement for the license files supplied with distribution artifacts.

| Component | License / notice |
| --- | --- |
| Electron | MIT; bundles Chromium and third-party notices in its runtime |
| Node.js companion runtime | Node distribution LICENSE and third-party notices |
| React / React DOM | MIT |
| BlockNote core/react/mantine | MPL-2.0; source is supplied through the pinned packages; no XL modules |
| Mantine | MIT |
| better-sqlite3 | MIT; SQLite is public domain |
| TypeScript MCP SDK | MIT |
| Azure MSAL Node | MIT |
| jose | MIT |
| Luxon | MIT |
| KaTeX | MIT; bundled fonts have their included notices |
| Mammoth | BSD-2-Clause |
| PDF.js | Apache-2.0; font/CMap notices are included in its distribution |
| Radix icons | MIT |
| Zod | MIT |

Development/build tools include TypeScript (Apache-2.0), Electron Forge (MIT), Vite (MIT), Vitest (MIT), esbuild (MIT), and their transitive dependencies. The exact versions are in package-lock.json.

Release packaging must include Electron's LICENSE/LICENSES.chromium.html, Node's distribution LICENSE, and the licenses of bundled production dependencies, including transitive packages. Use package-lock.json as the inventory and inspect actual shipped files. Reassess notices when dependencies change. This repository does not claim a completed legal audit or label all dependencies MIT.
