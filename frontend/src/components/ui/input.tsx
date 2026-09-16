import * as React from "react"
import { cn } from "cn"

function Input({
  className,
  type,
  readOnly,
  onFocus,
  onMouseUp,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      readOnly={readOnly}
      data-slot="input"
      className={cn(
        "min-h-11 w-full min-w-0 rounded-[12px] border border-border bg-muted px-3.5 py-2.5 font-sans text-[15px] text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        readOnly && "cursor-text",
        className
      )}
      {...props}
      onFocus={(e) => {
        if (readOnly) e.currentTarget.select()
        onFocus?.(e)
      }}
      onMouseUp={(e) => {
        // A click focuses then mouseup collapses the selection; keep select-all.
        if (readOnly) e.preventDefault()
        onMouseUp?.(e)
      }}
    />
  )
}

export { Input }
