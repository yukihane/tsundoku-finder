import { bookwalkerAdapter } from "../bookwalker/adapter.js";
import { kindleAdapter } from "../kindle/adapter.js";
import type { StoreAdapter } from "./types.js";

export function createStoreRegistry(adapters: readonly StoreAdapter[]) {
	const byId = new Map<string, StoreAdapter>();
	const byCommand = new Map<string, StoreAdapter>();
	for (const adapter of adapters) {
		if (
			!adapter.id ||
			!adapter.command ||
			byId.has(adapter.id) ||
			byCommand.has(adapter.command)
		)
			throw new Error("Duplicate or empty store registration");
		byId.set(adapter.id, adapter);
		byCommand.set(adapter.command, adapter);
	}
	return {
		get(id: string) {
			const value = byId.get(id);
			if (!value) throw new Error("Unknown store");
			return value;
		},
		command(name: string) {
			const value = byCommand.get(name);
			if (!value) throw new Error("Unknown store command");
			return value;
		},
	};
}
export const stores = createStoreRegistry([kindleAdapter, bookwalkerAdapter]);
export type StoreRegistry = ReturnType<typeof createStoreRegistry>;
