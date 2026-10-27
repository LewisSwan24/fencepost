import { handleBoothFeed } from "../../../lib/booth-feed-server.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handleBoothFeed();
}
