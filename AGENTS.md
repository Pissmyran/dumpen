# AGENTS.md – dumpen

An image gallery for app icons and themes on Cloudflare R2, plus a Docker image for self-hosting.

Read the shared rules at the start of every session: [GOVERNANCE.md](https://raw.githubusercontent.com/pissmyran/.github/main/GOVERNANCE.md) and [SERVICES.md](https://raw.githubusercontent.com/pissmyran/.github/main/SERVICES.md). Read `README.md` before larger changes.

## Commands

```bash
npm test && npm run check
```

## Rules

- **Work autonomously:** do the task yourself instead of handing steps back to the user. Ask only about decisions that are genuinely theirs. If something is blocked, say plainly what and why; never tell the user to do the work or to check things you can check yourself.
- **Entry:** `src/index.js`, built by `build.mjs`. Bindings: R2, Secrets Store.
- **The build:** `src/index.js` is written for Workers Static Assets. What gets deployed is `dist/worker.js`, which `build.mjs` builds with `public/` embedded. Change the source, never `dist/`.
- **Access:** only `/bilder/*` is public. Everything else requires a Cloudflare Access JWT, or `AUTH_MODE=password` when self-hosting. Never set `AUTH_MODE` or `LOCAL_DEV` in production.
- **R2 is scanned incrementally:** metadata is saved on write, the edge cache is used, and a range read happens only once per object version. No full rescan per request.
- **Docker image:** published as `docker.io/pissmyran/dumpen` by `.github/workflows/docker.yml`. The workflow takes the namespace from the repository variable `DOCKERHUB_USERNAME` and the repository name from GitHub; keep names and values out of the workflow. `docker-compose.yml` pins it by tag and digest; keep the tag, the digest, `docker/README.md` and `README.md` in sync. The publish job pushes the exact version first, then tries every moving tag (`minor`, `major`, `latest`); a failed moving-tag push does not stop the others but fails the job, and a re-run pushes all tags again. All releases share one concurrency group.
- **Release:** the version is in `package.json`.
- **Language:** the app's interface is Swedish; change its language only as its own task. Comments are English.
- **Documentation:** the app sits behind Access, so the documentation is published only on GitHub.
- **Extra care:** access control, R2 scanning and ZIP import.
- **Review:** `.coderabbit.yaml` inherits `pissmyran/coderabbit`, adds the Swedish-interface exception, and references shared guidelines and sibling service repositories. Cross-repository context requires eligible CodeRabbit access.
