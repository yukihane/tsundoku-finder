import { importOwnership, libraryPath } from "../library/database.js";
export async function importKindleCollection(
	directory: string,
	dbPath = libraryPath,
) {
	const { readKindleImport } = await import("./import-data.js");
	const { kindleOwnership } = await import("./ownership.js");
	return importOwnership(
		kindleOwnership(await readKindleImport(directory)),
		dbPath,
	);
}
