import type { SVGProps } from 'react'

type OpenClawMarkProps = SVGProps<SVGSVGElement>

export function OpenClawMark(props: OpenClawMarkProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
        fill="url(#openclaw-gradient)"
      />
      <path className="hc-lobster-claw-left" d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#openclaw-gradient)" />
      <path className="hc-lobster-claw-right" d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#openclaw-gradient)" />
      <path d="M45 15 Q35 5 30 8" stroke="#ff7a7a" strokeWidth="2" strokeLinecap="round" />
      <path d="M75 15 Q85 5 90 8" stroke="#ff7a7a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="45" cy="35" r="6" fill="#0b1018" />
      <circle cx="75" cy="35" r="6" fill="#0b1018" />
      <circle className="hc-lobster-eye" cx="46" cy="34" r="2" fill="#8df4ff" />
      <circle className="hc-lobster-eye" cx="76" cy="34" r="2" fill="#8df4ff" />
      <defs>
        <linearGradient id="openclaw-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff7a7a" />
          <stop offset="100%" stopColor="#d6415d" />
        </linearGradient>
      </defs>
    </svg>
  )
}
