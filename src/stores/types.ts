import type { Page } from "playwright";
import type { OwnershipImport } from "../library/ownership.js";

// Statically registered adapters. No dynamic plugin loading or credentials here.
export interface StoreAdapter {
	id: string;
	command: string;
	metadataScope: string;
	validateOwnership(input: OwnershipImport): void;
	isProductId(value: string): boolean;
	productUrl(id: string): string;
	isSeriesUrl(value: string): boolean;
	validateMetadataFormat(value: Record<string, unknown>): void;
	readMetadata(page: Page, id: string): Promise<unknown>;
	waitForMetadata(page: Page): Promise<void>;
}
