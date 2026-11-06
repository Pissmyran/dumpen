# REPO.md

Dumpen is a private image archive for app icons and theme images, running as a Cloudflare Worker with images in R2 and sign-in through Cloudflare Access. It can also run self-hosted in a container.

## Stack

- Plain JavaScript (ES modules) on Node, with no framework and no runtime dependencies; the front end is static files served by the Worker.
- Cloudflare Workers and R2, configured with Wrangler.
- Node's built-in test runner, Prettier for formatting.
- Docker for the self-hosted image; Zensical for the documentation site.

## Commands

- `npm test` – run the tests.
- `npm run check` – syntax-check the source files.
- `node build.mjs` – build the self-contained Worker into `dist/`.
- `npx prettier --check .` – check formatting. There is no lint script.
- `node tools/render.mjs <values.env> <out-dir>` – fill in the placeholders; `npm run dev` and `npm run deploy` need rendered output.

## Layout

- The source holds `__NAME__` placeholders instead of real values. `cloudflare.example.env` lists them all; never commit real values.
- `public/manifest.json` lists which static files the build embeds in the Worker.
- `site-docs/` and `site/` are generated; edit the Markdown sources instead.

## Release

- A merge to `main` that raises the version in `package.json` creates the tag, the GitHub release and the Docker image. Merges without a version bump release nothing.
- Add a matching entry to `CHANGELOG.md` with each version bump.
- The documentation site is published to GitHub Pages from `main`.

## Repo rules

- The user interface is in Swedish; keep it that way.
- No external libraries or CDN in the front end.
