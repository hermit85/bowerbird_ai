import { startConsoleServer } from "../console/server";

export async function consoleCommand(): Promise<number> {
  return startConsoleServer();
}
