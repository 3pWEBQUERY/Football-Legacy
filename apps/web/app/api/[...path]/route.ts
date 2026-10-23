import type { NextRequest } from "next/server";
import { dispatch } from "@/lib/server/router";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return dispatch(req, path);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
