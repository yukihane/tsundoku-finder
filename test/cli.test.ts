import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("help exits successfully and identifies unimplemented features", () => {
	const result = spawnSync(
		process.execPath,
		["--import", "tsx", entrypoint, "--help"],
		{
			encoding: "utf8",
		},
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /tsundoku-finder/);
	assert.match(result.stdout, /未実装/);
	assert.equal(result.stderr, "");
});

test("unsupported commands fail instead of reporting a successful sync", () => {
	const result = spawnSync(
		process.execPath,
		["--import", "tsx", entrypoint, "sync"],
		{
			encoding: "utf8",
		},
	);
	assert.ifError(result.error);
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /未対応/);
});
