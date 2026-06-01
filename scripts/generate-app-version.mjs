import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve("src/generated/app-version.ts");
const version = new Date().toISOString();

mkdirSync(dirname(outputPath), { recursive: true });

writeFileSync(outputPath, `export const APP_VERSION = ${JSON.stringify(version)};\n`, "utf8");
