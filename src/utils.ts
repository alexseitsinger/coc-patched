import fs from "fs";
import path from "path";

import which from "which";

function exists(file: string): boolean {
  return fs.existsSync(file);
}

export async function findEslint(rootPath: string): Promise<string> {
  const { platform } = process;
  if (
    platform === "win32" &&
    exists(path.join(rootPath, "node_modules", ".bin", `patched.cmd`))
  ) {
    return path.join(".", "node_modules", ".bin", "patched.cmd");
  }
  if (
    (platform === "linux" || platform === "darwin") &&
    exists(path.join(rootPath, "node_modules", ".bin", "patched"))
  ) {
    return path.join(".", "node_modules", ".bin", "patched");
  }
  if (
    exists(
      path.join(rootPath, ".vscode", "pnpify", "patched", "bin", "patched.js")
    )
  ) {
    return path.join(".", ".vscode", "pnpify", "patched", "bin", "patched.js");
  }
  try {
    return which.sync("patched");
  }
  catch (error) {
    return "";
  }
}
