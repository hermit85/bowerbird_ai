import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { bowerbirdDir, ensureBowerbirdDir, sanitizePatchInBowerbird } from "../../../lib/bowerbird";

type PatchBody = {
  patch?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as PatchBody;
    const patch = body.patch ?? "";
    await ensureBowerbirdDir();
    await writeFile(path.resolve(bowerbirdDir(), "repair_patch.diff"), patch, "utf8");
    const sanitize = await sanitizePatchInBowerbird();
    if (!sanitize.ok) {
      return NextResponse.json({ ok: false, message: sanitize.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: "Patch saved and sanitized",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to save patch",
      },
      { status: 500 },
    );
  }
}
