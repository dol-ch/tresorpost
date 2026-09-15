export type SecretKind = "text" | "image" | "file" | "video";

/** Infer payload kind from MIME, then filename — text is the no-file default. */
export function kindFromFile(file: File): Exclude<SecretKind, "text"> {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime && mime !== "application/octet-stream") return "file";
  if (/\.(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp|ico)$/i.test(name)) return "image";
  if (/\.(mp4|m4v|mov|webm|avi|mkv|ogv|3gp)$/i.test(name)) return "video";
  return "file";
}

/** Browsers often leave `File.type` empty for .mov/.avi; hint a playable MIME. */
export function mimeForUpload(file: File, kind: SecretKind): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".avi")) return "video/x-msvideo";
  if (n.endsWith(".mkv")) return "video/x-matroska";
  if (n.endsWith(".ogv")) return "video/ogg";
  if (n.endsWith(".3gp")) return "video/3gpp";
  if (kind === "video") return "video/mp4";
  if (kind === "image") return "image/*";
  return "application/octet-stream";
}
