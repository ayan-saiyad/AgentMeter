import { NextResponse } from "next/server";
import { isAdmin } from "../../../lib/auth";
import { getDashboardData } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.json(await getDashboardData());
}
