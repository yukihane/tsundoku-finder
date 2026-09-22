import { randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJson(filename: string, value: unknown) {
	await mkdir(dirname(filename), { recursive: true });
	const temporary = `${filename}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
		});
		await rename(temporary, filename);
	} finally {
		await unlink(temporary).catch(() => {});
	}
}

// A crashed process leaves a lock. Only a demonstrably dead owner can be replaced.
export async function lockFile(filename: string) {
	await mkdir(dirname(filename), { recursive: true });
	try {
		const existing = JSON.parse(await readFile(filename, "utf8")) as {
			pid: number;
		};
		if (!Number.isSafeInteger(existing.pid) || existing.pid < 1)
			throw new Error("Invalid lock");
		try {
			process.kill(existing.pid, 0);
			throw new Error("Another process owns the lock");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
		await unlink(filename);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const handle = await open(filename, "wx");
	await handle.writeFile(JSON.stringify({ pid: process.pid }));
	await handle.close();
	return () => unlink(filename);
}
