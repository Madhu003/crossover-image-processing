const DATA_URI_PREFIX = /^data:image\/[\w+.-]+;base64,/;

export function decodeBase64Image(payload: string): Buffer {
  const normalized = payload.replace(DATA_URI_PREFIX, "").trim();
  if (!normalized) {
    throw new Error("Image payload is empty");
  }

  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) {
    throw new Error("Invalid base64 image data");
  }

  return buffer;
}
