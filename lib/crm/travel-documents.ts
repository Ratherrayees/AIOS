export const MAX_TRAVEL_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const TRAVEL_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function travelDocumentDisplayName(fileName: string) {
  const withoutControlCharacters = Array.from(fileName.normalize("NFKC"))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const cleaned = withoutControlCharacters
    .trim()
    .slice(0, 300);
  return cleaned || "travel-document";
}

export function travelDocumentStorageName(fileName: string) {
  const cleaned = travelDocumentDisplayName(fileName)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 180);
  return cleaned || "travel-document";
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/** Rejects a renamed executable or arbitrary blob before private storage. */
export function matchesTravelDocumentSignature(
  mimeType: string,
  bytes: Uint8Array,
) {
  if (mimeType === "application/pdf")
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (mimeType === "image/jpeg")
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png")
    return startsWith(bytes, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  if (mimeType === "image/webp")
    return (
      bytes.length >= 12 &&
      ascii(bytes, 0, 4) === "RIFF" &&
      ascii(bytes, 8, 4) === "WEBP"
    );
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    const brand = ascii(bytes, 8, 4);
    return (
      bytes.length >= 12 &&
      ascii(bytes, 4, 4) === "ftyp" &&
      ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)
    );
  }
  return false;
}
