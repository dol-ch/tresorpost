import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-0.5 rounded-xl bg-muted p-[3px]",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-[9px] px-2.5 py-[9px] font-sans text-[13.5px] font-medium text-muted-foreground transition-colors",
              active && "bg-card text-foreground font-semibold shadow-[0_1px_3px_rgba(0,0,0,.08)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
