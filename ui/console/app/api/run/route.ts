import { NextResponse } from "next/server";
import { startRepairLoopProcess } from "../../../lib/bowerbird";

export async function POST(): Promise<NextResponse> {
  try {
    const result = await startRepairLoopProcess();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to start run",
      },
      { status: 500 },
    );
  }
}
