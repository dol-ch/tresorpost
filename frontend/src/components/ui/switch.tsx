import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full bg-border transition-colors outline-none data-[state=checked]:bg-primary focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[22px] translate-x-[3px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform data-[state=checked]:translate-x-[21px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
