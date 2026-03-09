import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "../lib/utils"
import { Button } from "./button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export type ComboboxOption = {
  value: string
  label?: string
}

export interface ComboboxProps {
  value: string
  onValueChange: (next: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  allowCustom?: boolean
  disabled?: boolean
  className?: string
  triggerClassName?: string
  contentClassName?: string
}

function normalize(s: string) {
  return (s ?? "").trim().toLowerCase()
}

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  allowCustom = true,
  disabled,
  className,
  triggerClassName,
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)

  const portalContainer = React.useMemo(() => {
    if (!open) return null
    return triggerRef.current?.closest('[role="dialog"]') as HTMLElement | null
  }, [open])

  const normalizedValue = normalize(value)
  const selected = React.useMemo(() => {
    if (!normalizedValue) return null
    return options.find((o) => normalize(o.value) === normalizedValue) ?? null
  }, [normalizedValue, options])

  const canUseCustom = allowCustom && normalize(query).length > 0 && normalize(query) !== normalizedValue
  const customAlreadyExists = React.useMemo(() => {
    const q = normalize(query)
    if (!q) return false
    return options.some((o) => normalize(o.value) === q)
  }, [options, query])

  const commit = (next: string) => {
    onValueChange(next)
    setOpen(false)
    setQuery("")
  }

  const label = selected?.label ?? selected?.value ?? value

  return (
    <div className={cn(className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              // Make it feel like an input field.
              "h-10 w-full justify-between rounded-xl border-border/70 bg-background/60 px-3 text-sm",
              "hover:bg-background/70",
              triggerClassName
            )}
          >
            <span className={cn("min-w-0 truncate text-left", !label ? "text-muted-foreground" : "")}>
              {label || placeholder}
            </span>
            <ChevronsUpDown className="opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          portalContainer={portalContainer}
          className={cn("w-[var(--radix-popover-trigger-width)] p-2", contentClassName)}
        >
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {canUseCustom && !customAlreadyExists ? (
                  <CommandItem
                    value={query}
                    onSelect={(currentValue) => commit(currentValue)}
                  >
                    Use "{query}"
                  </CommandItem>
                ) : null}
                {options.map((opt) => {
                  const isSelected = normalize(opt.value) === normalizedValue
                  const searchValue = `${opt.label ?? ""} ${opt.value}`.trim()
                  return (
                    <CommandItem
                      key={opt.value}
                      value={searchValue}
                      onSelect={() => {
                        // Keep stored value stable while searching by both label and value.
                        commit(opt.value)
                      }}
                    >
                      {opt.label ?? opt.value}
                      <Check className={cn("ml-auto", isSelected ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
