import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

import { createServer } from "vite";

const WEB = resolve(import.meta.dirname, "..");
const ROOT = resolve(WEB, "../..");
const SIGNER_PORT = 8799;
const WEB_PORT = 5199;
const PAGES_PORT = 5198;
/** The subpath GitHub Pages serves this repository's site under. */
const PAGES_BASE = "/Spact/";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** Serves `dir` under PAGES_BASE only, the way GitHub Pages serves a project site. */
function servePages(dir: string): Promise<Server> {
  const server = createHttpServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = path.startsWith(PAGES_BASE) ? resolve(dir, path.slice(PAGES_BASE.length) || "index.html") : null;
    if (!file || !file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      // like GitHub Pages: the site's own 404.html, with a 404 status
      const notFound = join(dir, "404.html");
      if (path.startsWith(PAGES_BASE) && existsSync(notFound)) res.writeHead(404, { "content-type": "text/html" }).end(readFileSync(notFound));
      else res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((done) => server.listen(PAGES_PORT, "127.0.0.1", () => done(server)));
}

function waitForOutput(child: ChildProcess, marker: string, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${marker}"`)), timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(marker)) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`process exited with ${code} before "${marker}"`));
    });
  });
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null) return done();
    child.once("exit", () => done());
    child.kill("SIGINT");
  });
}

export default async function globalSetup() {
  // The site as CI publishes it to GitHub Pages: the same `vite build`, with no vault, so only the
  // Security Lab works. A child process, so the build's env and NODE_ENV stay out of the dev server.
  const pagesDir = mkdtempSync(join(tmpdir(), "spact-pages-"));
  execFileSync("pnpm", ["exec", "vite", "build", "--outDir", pagesDir, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: WEB,
    env: {
      ...process.env,
      VITE_NEAR_NETWORK: "testnet",
      VITE_NEAR_RPC_URL: "https://rpc.invalid",
      VITE_VAULT_ID: "",
      VITE_DEV_SIGNER_URL: "",
      VITE_SITE_URL: "https://example.test/Spact",
      VITE_REPO_URL: "https://example.test/repo",
    },
    stdio: "inherit",
  });
  // a report from a local run (public/) must not stand in for the one each test serves
  rmSync(join(pagesDir, "security-report.json"), { force: true });
  const pages = await servePages(pagesDir);

  const fixturePath = join(mkdtempSync(join(tmpdir(), "spact-e2e-")), "fixture.json");

  // Builds the contracts on first run, so allow a while.
  const sandbox = spawn(join(ROOT, "scripts/start-demo-sandbox.sh"), [fixturePath], { stdio: ["ignore", "pipe", "inherit"] });
  await waitForOutput(sandbox, "READY", 900_000);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { rpc_url: string; vault_id: string };

  const signer = spawn(process.execPath, ["--experimental-strip-types", "dev/dev-signer.ts", fixturePath], {
    cwd: WEB,
    env: { ...process.env, DEV_SIGNER_PORT: String(SIGNER_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await waitForOutput(signer, "dev signer for", 30_000);

  // Vite exposes VITE_* variables from the environment to the page.
  Object.assign(process.env, {
    SPACT_FIXTURE: fixturePath,
    VITE_NEAR_NETWORK: "sandbox",
    VITE_NEAR_RPC_URL: fixture.rpc_url,
    VITE_VAULT_ID: fixture.vault_id,
    VITE_DEV_SIGNER_URL: `http://127.0.0.1:${SIGNER_PORT}`,
    // a second network for the network switch; network.spec.ts keeps its hosts offline
    VITE_TESTNET_VAULT_ID: "vault.e2e.testnet",
    VITE_TESTNET_RPC_URL: "https://testnet-rpc.invalid",
  });
  const server = await createServer({
    root: WEB,
    configFile: join(WEB, "vite.config.ts"),
    server: { host: "127.0.0.1", port: WEB_PORT, strictPort: true },
    logLevel: "warn",
  });
  await server.listen();

  return async () => {
    await server.close();
    await new Promise((done) => pages.close(done));
    await Promise.all([stop(signer), stop(sandbox)]);
  };
}
