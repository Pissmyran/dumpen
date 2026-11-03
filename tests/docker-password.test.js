import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test(
  "container passes literal credentials to Wrangler and revokes old sessions",
  { timeout: 60000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "dumpen-container-test-"));
    let child;
    const stop = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        process.kill(-child.pid, "SIGTERM");
        await exited;
      }
      child = undefined;
    };
    try {
      await mkdir(join(dir, "src"));
      await mkdir(join(dir, "public"));
      await writeFile(join(dir, "public/index.html"), "ok");
      await copyFile(join(root, "src/index.js"), join(dir, "src/worker.js"));
      await copyFile(join(root, "docker/wrangler.jsonc"), join(dir, "wrangler.jsonc"));
      await symlink(join(root, "node_modules"), join(dir, "node_modules"));
      await writeFile(join(dir, ".dev.vars"), "ADMIN_PASSWORD=incorrect\n");
      await writeFile(join(dir, ".env"), "ADMIN_PASSWORD=incorrect\n");
      // Expose the synthetic binding only in this test wrapper, then use the real Worker.
      await writeFile(
        join(dir, "src/index.js"),
        `import worker from './worker.js';
       export default { fetch(request, env, ctx) {
         if (new URL(request.url).pathname === '/__test_binding')
           return Response.json({ password: env.ADMIN_PASSWORD, token: env.WORKERS_API_TOKEN,
             unrelated: 'DUMPEN_UNRELATED' in env, mode: env.AUTH_MODE,
             team: env.CF_ACCESS_TEAM_DOMAIN, aud: env.CF_ACCESS_AUD });
         return worker.fetch(request, env, ctx);
       } };`,
      );
      const port = await unusedPort();
      const base = `http://127.0.0.1:${port}`;
      const password = "abcdefgh#suffix$HOME\\n'\"`\r\n ";
      const token = "token#$HOME\\value";
      const start = async (value, mode = "password") => {
        child = spawn(join(root, "docker/run-worker.sh"), [dir, join(dir, "data")], {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            PORT: String(port),
            PUBLIC_URL: base,
            AUTH_MODE: mode,
            ADMIN_PASSWORD: value,
            WORKERS_API_TOKEN: token,
            CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
            CF_ACCESS_AUD: "example-audience",
            DUMPEN_UNRELATED: "not a binding",
            CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
            WRANGLER_SEND_METRICS: "false",
          },
        });
        for (let i = 0; i < 120; i++) {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error("Wrangler exited before readiness");
          try {
            const response = await fetch(`${base}/__test_binding`);
            if (response.ok) return response.json();
          } catch {}
          await delay(250);
        }
        throw new Error("Wrangler did not become ready");
      };
      const login = (value) =>
        fetch(`${base}/auth/login`, {
          method: "POST",
          body: new URLSearchParams({ password: value }),
          redirect: "manual",
        });
      assert.deepEqual(await start(password), {
        password,
        token,
        unrelated: false,
        mode: "password",
        team: "example.cloudflareaccess.com",
        aud: "example-audience",
      });
      assert.equal((await login("abcdefgh")).status, 401);
      const response = await login(password);
      assert.equal(response.status, 303);
      const cookie = response.headers.get("set-cookie").split(";")[0];
      assert.equal((await fetch(base, { headers: { cookie }, redirect: "manual" })).status, 200);
      await stop();
      const changed = password.replace("suffix", "changed");
      assert.equal((await start(changed)).password, changed);
      assert.equal((await fetch(base, { headers: { cookie }, redirect: "manual" })).status, 303);
      assert.equal((await login(changed)).status, 303);
      await stop();
      assert.equal((await start("", "cloudflare-access")).mode, "cloudflare-access");
      assert.equal((await fetch(base, { redirect: "manual" })).status, 403);
    } finally {
      await stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
