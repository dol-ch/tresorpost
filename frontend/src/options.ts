export interface ExpiryOption {
  label: string;
  seconds: number;
}

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: "1 minute", seconds: MIN },
  { label: "5 minutes", seconds: 5 * MIN },
  { label: "15 minutes", seconds: 15 * MIN },
  { label: "30 minutes", seconds: 30 * MIN },
  { label: "1 hour", seconds: HOUR },
  { label: "3 hours", seconds: 3 * HOUR },
  { label: "6 hours", seconds: 6 * HOUR },
  { label: "12 hours", seconds: 12 * HOUR },
  { label: "1 day", seconds: DAY },
  { label: "3 days", seconds: 3 * DAY },
  { label: "7 days", seconds: 7 * DAY },
  { label: "1 month", seconds: 30 * DAY },
];

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
