import { readFileSync } from "node:fs";
import { validateWorkflow } from "../src/shared/validate-workflow";

const file = process.argv[2];

if (!file) {
  console.error("Usage: npm run validate-workflow -- <file>");
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

try {
  validateWorkflow(raw);
  console.log("ok");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
