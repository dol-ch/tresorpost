export interface ExpiryOption {
  label: string;
  seconds: number;
}

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: "5 min", seconds: 5 * MIN },
  { label: "1 hour", seconds: HOUR },
  { label: "1 day", seconds: DAY },
  { label: "7 days", seconds: 7 * DAY },
];

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

function withUnit(n: number, unit: string, digits: number): string {
  return `${Number(n.toFixed(digits))} ${unit}`;
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return withUnit(bytes / 1024, "KB", 1);
  if (bytes < 1024 * 1024 * 1024) return withUnit(bytes / (1024 * 1024), "MB", 2);
  if (bytes < 1024 * 1024 * 1024 * 1024) {
    return withUnit(bytes / (1024 * 1024 * 1024), "GB", 2);
  }
  return withUnit(bytes / (1024 * 1024 * 1024 * 1024), "TB", 2);
}

/** Cap for an attached file: S3 when the operator enabled it, else SQLite. */
export function uploadMaxBytes(
  s3Enabled: boolean,
  maxS3FileBytes: number,
  maxFileBytes: number,
): number {
  if (s3Enabled && maxS3FileBytes > 0) return maxS3FileBytes;
  return maxFileBytes > 0 ? maxFileBytes : MAX_FILE_BYTES;
}
