import { fail, ok, warn } from "../core/reporter";
import { diagnoseProject } from "../doctor/projectDoctor";

export async function doctor(): Promise<number> {
  let report;
  try {
    report = await diagnoseProject();
  } catch (error) {
    fail("Doctor failed", error instanceof Error ? error.message : "Unknown diagnostics error.");
    console.log("");
    console.log("Summary: OK 0 | WARN 0 | BLOCKER 1");
    console.log("Next action: fix doctor blockers, then run `bowerbird doctor` again.");
    return 1;
  }

  let okCount = 0;
  let warnCount = 0;
  let blockerCount = 0;

  for (const check of report.checks) {
    if (check.status === "ok") {
      ok(check.message);
      okCount += 1;
      continue;
    }
    if (check.status === "warn") {
      warn(check.message, check.detail);
      warnCount += 1;
      continue;
    }
    fail(check.message, check.detail);
    blockerCount += 1;
  }

  console.log("");
  console.log(`Summary: OK ${okCount} | WARN ${warnCount} | BLOCKER ${blockerCount}`);

  if (blockerCount > 0) {
    console.log("Next action: resolve BLOCKER items first, then re-run `bowerbird doctor`.");
    return 1;
  }

  if (warnCount > 0) {
    console.log("Next action: review WARN items to avoid deployment/setup issues.");
    return 0;
  }

  console.log("Next action: environment looks good. Continue with project setup.");
  return 0;
}
