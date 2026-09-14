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

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes < 1024 * 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}
