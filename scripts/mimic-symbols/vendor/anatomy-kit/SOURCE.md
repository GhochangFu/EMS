# Vendored: anatomy kit (two files)

- Upstream: https://github.com/wheresryan22/anatomy — `kit/iso-kit.mjs` and `kit/lathe.mjs`
- Licence: MIT, © 2026 Ryan (`LICENSE`, copied unchanged)
- Taken: 2026-11-09, from the skill installed with `npx skills add wheresryan22/anatomy -g -a claude-code`
  (CHANGELOG at "Unreleased"; the install carries no git commit)
- Files are unchanged. SHA-256:
  - `iso-kit.mjs` 6d3ecc725d30c3b0346da309cf61dfa5a65017c23620bbd4093009d4fb104018
  - `lathe.mjs` a4e7e974b1a37e603ad2b76363b6f9815cc101dfff0ad277a5d4e8f1dc56fccb
- Used only by the offline glyph build (`scripts/mimic-symbols/sources/iso/build.mjs`); nothing under `apps/*` imports it.
- `lathe.mjs` is 1,184 lines; it is vendored unchanged, so AGENTS.md §4.5's 1,000-line cap (a
  rule for code this repository writes) does not apply to it.
