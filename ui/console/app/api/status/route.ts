import { NextResponse } from "next/server";
import { readStatusPayload } from "../../../lib/bowerbird";

export async function GET(): Promise<NextResponse> {
  try {
    const payload = await readStatusPayload();
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to read status",
      },
      { status: 500 },
    );
  }
}
