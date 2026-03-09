import { cn } from '@ui/lib/utils'
import { inferProviderVisual } from '@/lib/provider-icon-inference'

interface ProviderIdentityProps {
  label: string
  provider?: string
  baseUrl?: string
  model?: string
  profileName?: string
  className?: string
}

export function ProviderIdentity({
  label,
  provider,
  baseUrl,
  model,
  profileName,
  className,
}: ProviderIdentityProps) {
  const visual = inferProviderVisual({ provider, baseUrl, model, profileName })

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/15"
        style={{ color: visual.iconColor }}
      >
        {visual.iconSrc ? (
          <img src={visual.iconSrc} alt={label} className="h-3 w-3 object-contain" />
        ) : (
          <span className="text-[9px] leading-none">{visual.badgeText}</span>
        )}
      </span>
      <span>{label}</span>
    </span>
  )
}
