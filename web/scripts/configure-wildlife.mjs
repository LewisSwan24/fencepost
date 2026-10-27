import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
// prebuild runs before Next loads any .env file, so on a machine configured by file (the booth
// laptop: web/.env.production.local) nothing below would see the values. Load them the way
// next build will.
nextEnv.loadEnvConfig(fileURLToPath(new URL("..", import.meta.url)));
const target = new URL("../public/wildlife/shared/config.js", import.meta.url);
const boundary = "\n// Deployment public configuration\n";
let text = (await readFile(target, "utf8")).split(boundary)[0];
const overrides = {};
for (const [field, key] of Object.entries({
  supabaseUrl: "NEXT_PUBLIC_WN_SUPABASE_URL",
  supabaseAnonKey: "NEXT_PUBLIC_WN_SUPABASE_ANON_KEY",
  fencepostBaseUrl: "NEXT_PUBLIC_WN_FENCEPOST_URL",
  boothJoinUrl: "NEXT_PUBLIC_WN_BOOTH_JOIN_URL",
})) {
  const value = process.env[key];
  if (!value) continue;
  if (field === "supabaseAnonKey") {
    let role = "";
    try {
      role = JSON.parse(Buffer.from(value.split(".")[1], "base64url")).role;
    } catch {}
    if (role === "service_role" || value.startsWith("sb_secret_"))
      throw Error(
        "Never put a service-role or secret key in public configuration.",
      );
  }
  // https, except a server on this machine, which is how the booth setup is tested.
  if (
    field.endsWith("Url") &&
    !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(value)
  )
    throw Error("Public deployment URLs must use HTTPS.");
  overrides[field] = value;
}
if (Object.keys(overrides).length)
  text +=
    boundary + "Object.assign(config, " + JSON.stringify(overrides) + ");\n";
await writeFile(target, text);
console.log("Configured public wildlife backend bindings (values not logged).");
