import { MOBILE_MAX_ATOMS } from "@/src/domain/molecules";

export const MAX_IMPORTED_XYZ_BYTES = 2_000_000;
export const MAX_IMPORTED_XYZ_ATOMS = MOBILE_MAX_ATOMS;
export const MAX_XYZ_COORDINATE_ABS = 1_000_000;
const MAX_XYZ_COORDINATE_TOKEN_LENGTH = 32;

export interface ValidatedXyzDocument {
  atomCount: number;
  comment: string;
  text: string;
}

export function validateXyzDocument(text: string): ValidatedXyzDocument {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) throw new Error("This file is empty.");
  if (utf8ByteLength(normalized) > MAX_IMPORTED_XYZ_BYTES) {
    throw new Error(
      "Choose an XYZ file smaller than 2 MB for this mobile preview.",
    );
  }

  const lines = normalized.split("\n");
  const atomCount = Number(lines[0]?.trim());
  if (!Number.isSafeInteger(atomCount) || atomCount < 1) {
    throw new Error("The first XYZ line must be a positive atom count.");
  }
  if (atomCount > MAX_IMPORTED_XYZ_ATOMS) {
    throw new Error(
      `This mobile preview supports up to ${MAX_IMPORTED_XYZ_ATOMS.toLocaleString()} atoms.`,
    );
  }
  if (lines.length < atomCount + 2) {
    throw new Error(
      `The file declares ${atomCount.toLocaleString()} atoms but does not contain that many rows.`,
    );
  }

  for (let index = 0; index < atomCount; index += 1) {
    const row = lines[index + 2]?.trim().split(/\s+/) ?? [];
    const [element, x, y, z] = row;
    const coordinates = [x, y, z];
    if (
      !element ||
      !/^[A-Za-z][A-Za-z0-9]*$/.test(element) ||
      !coordinates.every(
        (coordinate) =>
          coordinate !== undefined &&
          coordinate.length <= MAX_XYZ_COORDINATE_TOKEN_LENGTH &&
          Number.isFinite(Number(coordinate)) &&
          Math.abs(Number(coordinate)) <= MAX_XYZ_COORDINATE_ABS,
      )
    ) {
      throw new Error(`Atom row ${index + 1} is not valid XYZ data.`);
    }
  }

  const comment = lines[1]?.trim() || "Imported XYZ structure";
  lines[1] = comment;
  return {
    atomCount,
    comment,
    text: lines.join("\n"),
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}
