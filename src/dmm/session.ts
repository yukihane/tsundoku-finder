import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { writeJson } from "../local-files.js";

// Chromium profiles do not retain session cookies reliably across clean exits.
// Keep a local, ignored snapshot as well; never log its contents.
export async function restoreDmmSession(
	context: BrowserContext,
	directory: string,
) {
	try {
		const state = JSON.parse(
			await readFile(join(directory, "session.json"), "utf8"),
		) as Awaited<ReturnType<BrowserContext["storageState"]>>;
		if (!Array.isArray(state.cookies)) throw new Error("Invalid saved session");
		await context.addCookies(state.cookies);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
export async function saveDmmSession(
	context: BrowserContext,
	directory: string,
) {
	const state = await context.storageState();
	// localStorage stays in the persistent profile; the explicit snapshot only needs cookies.
	await writeJson(join(directory, "session.json"), { cookies: state.cookies });
}
