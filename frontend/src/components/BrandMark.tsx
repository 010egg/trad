import { useId } from 'react'

export function BrandMark({ className = '' }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  const strokeGradientId = `${uid}-stroke-gradient`
  const detailGradientId = `${uid}-detail-gradient`
  const glowId = `${uid}-glow`

  return (
    <svg
      viewBox="0 0 64 64"
      className={`block shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={strokeGradientId} x1="32" y1="4" x2="32" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff9b9b" />
          <stop offset="50%" stopColor="#ec2730" />
          <stop offset="100%" stopColor="#8b0911" />
        </linearGradient>
        <linearGradient id={detailGradientId} x1="18" y1="12" x2="50" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,208,208,0.92)" />
          <stop offset="100%" stopColor="rgba(255,166,166,0.52)" />
        </linearGradient>
        <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.15" floodColor="#ff4c4c" floodOpacity="0.18" />
        </filter>
      </defs>

      <rect x="5" y="5" width="54" height="54" rx="16" fill="rgba(14,2,3,0.74)" />
      <rect x="5.8" y="5.8" width="52.4" height="52.4" rx="15.2" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1.2" />
      <ellipse cx="32" cy="32.5" rx="19.4" ry="18.2" fill="rgba(255,68,68,0.03)" />

      <g
        filter={`url(#${glowId})`}
        fill="none"
        stroke={`url(#${strokeGradientId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g strokeWidth="1.7">
          <path d="M26.4 24.2C21.4 20.1 17.9 16 15.5 11.4" />
          <path d="M38.2 24.2C40.2 20.4 42.1 16.1 44 11.2" />
          <path d="M44 11.2C47.7 8.4 51.9 7.4 54.7 9.7C57.3 11.9 57.1 15.8 54.8 18.8C52.8 21.5 49.4 22.9 45.9 22.7" />

          <path d="M15.5 11.4C12.5 8.5 8.6 7.6 6.3 9.5C4.1 11.3 4.1 14.4 5.8 16.8C7.4 19.1 10.5 20.7 13.7 20.8" />
          <path d="M13.7 20.8C11.2 22.2 8.8 24.7 7.2 27.8C6.4 29.3 6.6 31 7.9 32C9.6 33.4 12.2 33.1 14.5 31.9C17.3 30.5 19.5 27.9 20.3 24.8" />

          <path d="M17.1 12.6C13.6 11.5 11 12.3 9.9 14.7C9 16.8 9.7 19 11.6 20.2C13.8 21.5 16.5 21.1 18.8 19.2" strokeWidth="1.45" />
          <path d="M15.2 22.1C12.5 23.7 10.8 25.4 9.7 27.8C9 29.4 9.5 30.8 10.7 31.3C12.7 32 15.7 30.3 18 27.3C19.2 25.7 20 24.1 20.3 22.5" strokeWidth="1.35" />

          <path d="M31.4 19.4C29.8 13.9 27.5 9.1 24.3 5.8" strokeWidth="1.45" />
          <path d="M32.9 19.1C32.7 14.5 32.8 10 33.4 6.1" strokeWidth="1.1" />
          <path d="M33.6 19.4C34.8 14.3 36.8 9.5 39.8 5.5" strokeWidth="1.45" />

          <path d="M27.9 22.1C29.3 19.4 31.8 17.6 35.1 17.2C39.8 16.7 43.8 18.8 46 22.9C47.6 25.9 47.8 29.8 46.7 34.3C45.4 39.6 44.8 43.9 45.2 47.5" />
          <path d="M26.5 24.3C24.7 28.4 24.3 32.4 24.9 36.2C25.5 39.7 27 43.3 29.5 46.7C32.1 50.3 35.8 53 40.3 54.8" />

          <path d="M28 22.1C29.2 19.7 31.2 18 33.8 17.4C37.2 16.6 40.4 17.3 42.8 19.2C45.6 21.5 46.8 25.1 46.3 29.9" strokeWidth="1.25" />
          <path d="M25.6 30.6C26.6 27 28.8 24.3 32.3 22.8C35.8 21.4 39.4 21.8 42.4 24C45 25.9 46.4 29 46.3 33.3" strokeWidth="1.15" />

          <path d="M46.5 32.6C49.7 34.4 52.5 36.9 54.4 40.1C55.6 42 55.5 44.1 54.1 45.3C52.3 46.8 49.3 46.6 46.4 45C43.5 43.4 41.2 40.7 40.2 37.6" />
          <path d="M45.7 35.5C48.2 36.8 49.8 38.2 51.4 40.4C52.5 41.9 52.7 43.4 51.9 44.4C50.8 45.6 48.5 45.4 46.2 44.1C43.7 42.7 41.9 40.5 41.1 38.2" strokeWidth="1.3" />

          <path d="M28.8 29.2C30.2 26.3 32.7 24.8 36 24.9C39.3 25 41.8 26.8 43.4 30.2" strokeWidth="1.15" />
          <path d="M29 34.6C32.2 33.2 35.4 33 38.8 34.1" strokeWidth="1.1" />
          <path d="M29.9 39.1C32.5 38.4 35 38.5 37.7 39.4" strokeWidth="1.05" />
          <path d="M31.5 43.2C33.6 42.9 35.5 43.2 37.3 44.2" strokeWidth="1.05" />

          <path d="M28.4 47.1C26.3 47.4 24.2 48.5 22.5 50.2C20.9 51.8 19.8 54 19.6 56.1" />
          <path d="M31.3 48.5C29.9 50.7 29.1 53.3 29.2 56.7" />
          <path d="M35.4 49.2C35.8 51.8 37 54.3 39.2 56.9" />
          <path d="M39.6 48.1C41.7 49.4 43.3 51.4 44.4 54C45.1 55.6 45.4 57 45.1 58.3" />
        </g>
      </g>

      <g fill={`url(#${detailGradientId})`}>
        <ellipse cx="33.1" cy="22.8" rx="0.88" ry="1.08" />
      </g>
    </svg>
  )
}

export function BrandWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1 whitespace-nowrap text-[15px] font-black tracking-[0.08em] text-[#eef9ff] ${className}`}>
      <span className="drop-shadow-[0_0_18px_rgba(114,233,251,0.08)]">Trade</span>
      <span className="bg-[linear-gradient(180deg,#9ef6ff_0%,#68def6_54%,#c4a26a_100%)] bg-clip-text text-transparent">
        Claw
      </span>
    </span>
  )
}
