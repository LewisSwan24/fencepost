import { handleWildlifeHelp } from "../../../lib/wildlife-help-server.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  return handleWildlifeHelp(request);
}
