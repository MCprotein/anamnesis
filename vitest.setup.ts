import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll } from "vitest";

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-test-home-"));
process.env.ANAMNESIS_HOME = testHome;

afterAll(() => {
	fs.rmSync(testHome, { recursive: true, force: true });
});
