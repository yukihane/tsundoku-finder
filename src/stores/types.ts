import type { Page } from "playwright";

// Statically registered adapters. No dynamic plugin loading or credentials here.
export interface StoreAdapter {
	id: string;
	command: string;
	metadataScope: string;
	isProductId(value: string): boolean;
	productUrl(id: string): string;
	isSeriesUrl(value: string): boolean;
	validateMetadataFormat(value: Record<string, unknown>): void;
	readMetadata(page: Page, id: string): Promise<unknown>;
	waitForMetadata(page: Page): Promise<void>;
}
