import { NextRequest, NextResponse } from "next/server";
import { updateWhitelistedUser } from "@/server/utils/queries/userQueries";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { wallet, email, username } = body ?? {};
    const resp = await updateWhitelistedUser(id, { wallet, email, username });
    const statusCode = resp.status === "success" ? 200 : 400;
    return NextResponse.json(resp, { status: statusCode });
  } catch (e) {
    console.error("update whitelist user error", e);
    return NextResponse.json({ status: "error", message: "Server error" }, { status: 500 });
  }
} 