// Regenerates packages/api-client from the FastAPI OpenAPI schema (single source of truth).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const api = resolve(root, "services/api");
const py = process.env.PYTHON ?? resolve(api, ".venv/bin/python");
const json = execFileSync(py, ["-c", "import json; from app.main import app; print(json.dumps(app.openapi(), indent=1, sort_keys=True))"], {
  cwd: api,
  encoding: "utf8",
  env: { ...process.env, DARNA_ENV: "development" },
});
writeFileSync(resolve(root, "packages/api-client/openapi.json"), json);
execFileSync("npx", ["openapi-typescript", "openapi.json", "-o", "src/schema.ts"], { cwd: resolve(root, "packages/api-client"), stdio: "inherit" });
