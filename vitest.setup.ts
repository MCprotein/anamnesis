import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.ANAMNESIS_HOME = fs.mkdtempSync(
	path.join(os.tmpdir(), "anamnesis-test-home-"),
);
