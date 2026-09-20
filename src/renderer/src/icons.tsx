const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function PlayIcon() {
  return (
    <svg {...svgBase} fill="currentColor" stroke="none">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg {...svgBase} fill="currentColor" stroke="none">
      <rect x="6.5" y="4.5" width="3.6" height="15" rx="1.1" />
      <rect x="13.9" y="4.5" width="3.6" height="15" rx="1.1" />
    </svg>
  )
}

export function NextIcon() {
  return (
    <svg {...svgBase} fill="currentColor" stroke="none">
      <path d="M5 5.5v13l10-6.5z" />
      <rect x="16.4" y="5" width="2.6" height="14" rx="1" />
    </svg>
  )
}

export function PrevIcon() {
  return (
    <svg {...svgBase} fill="currentColor" stroke="none">
      <path d="M19 5.5v13L9 12z" />
      <rect x="5" y="5" width="2.6" height="14" rx="1" />
    </svg>
  )
}

export function MusicIcon() {
  return (
    <svg {...svgBase}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.8" />
      <circle cx="16.5" cy="16" r="2.8" />
    </svg>
  )
}

export function GaugeIcon() {
  return (
    <svg {...svgBase}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4.2-6" />
    </svg>
  )
}

export function ClipboardIcon() {
  return (
    <svg {...svgBase}>
      <rect x="6" y="4.5" width="12" height="16" rx="2.4" />
      <path d="M9.5 4.5V3.4A1.4 1.4 0 0 1 10.9 2h2.2a1.4 1.4 0 0 1 1.4 1.4v1.1" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg {...svgBase}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.2v2M12 18.8v2M4.8 12h-2M21.2 12h-2M6.9 6.9L5.5 5.5M18.5 18.5l-1.4-1.4M17.1 6.9l1.4-1.4M5.5 18.5l1.4-1.4" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...svgBase}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function PinIcon() {
  return (
    <svg {...svgBase}>
      <path d="M12 16.5V21" />
      <path d="M9.2 3.4h5.6l-1 6.1 2.7 2.7H7.5l2.7-2.7z" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...svgBase}>
      <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.1A1.6 1.6 0 0 0 9 20.5h6a1.6 1.6 0 0 0 1.6-1.4L17.5 7" />
    </svg>
  )
}

export function BatteryIcon({ level = 1 }: { level?: number }) {
  return (
    <svg {...svgBase} strokeWidth={1.7}>
      <rect x="2.5" y="7.5" width="16" height="9" rx="2.4" />
      <path d="M21 10.6v2.8" />
      <rect
        x="4.6"
        y="9.6"
        width={Math.max(1.2, 11.8 * Math.min(1, Math.max(0, level)))}
        height="5.2"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  )
}

export function ArrowDownIcon() {
  return (
    <svg {...svgBase}>
      <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />
    </svg>
  )
}

export function ArrowUpIcon() {
  return (
    <svg {...svgBase}>
      <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />
    </svg>
  )
}

export function ImageIcon() {
  return (
    <svg {...svgBase} strokeWidth={1.8}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.4" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.5 17l4.6-4.4 3.4 3 2.6-2.2 4.4 3.6" />
    </svg>
  )
}

export function IdleIcon() {
  return (
    <svg {...svgBase} strokeWidth={1.7}>
      <path d="M4 12h5l1.6-4 3 8 1.6-4h4.8" />
    </svg>
  )
}

export function PowerIcon() {
  return (
    <svg {...svgBase}>
      <path d="M12 3v9" />
      <path d="M6.8 6.8a8 8 0 1 0 10.4 0" />
    </svg>
  )
}

export function TimerIcon() {
  return (
    <svg {...svgBase}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 13V9.5M10 2.5h4" />
    </svg>
  )
}

export function VolumeIcon() {
  return (
    <svg {...svgBase}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" stroke="none" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  )
}

export function WrenchIcon() {
  return (
    <svg {...svgBase}>
      <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.6 2.6 1.9 1.9 2.6-2.6a4 4 0 0 1-5.4 4.8L8.6 16.8a2 2 0 1 1-2.9-2.9l7.5-7.4z" />
      <path d="M5.5 16.5h.01" />
    </svg>
  )
}

export function BoxIcon() {
  return (
    <svg {...svgBase}>
      <path d="M3.5 8L12 3.5 20.5 8v8L12 20.5 3.5 16z" />
      <path d="M3.5 8L12 12.5 20.5 8M12 12.5v8" />
    </svg>
  )
}

export function GamepadIcon() {
  return (
    <svg {...svgBase}>
      <path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.7 3.4a2.6 2.6 0 0 1-4.6 1L15.5 16h-7l-1.1 1.8a2.6 2.6 0 0 1-4.6-1l-.7-3.4A4.5 4.5 0 0 1 6.5 8z" />
      <path d="M8 11v3M6.5 12.5h3" />
      <path d="M15.8 11.5h.01M17.8 13.5h.01" />
    </svg>
  )
}

export function PaletteIcon() {
  return (
    <svg {...svgBase}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-.9-.6-1.4-.6-2.2 0-1 .8-1.8 2-1.8h1.8a3.3 3.3 0 0 0 3.3-3.3C20.5 6.7 16.7 3.5 12 3.5z" />
      <path d="M7.5 10.5h.01M11 7.5h.01M15 8.5h.01" />
    </svg>
  )
}
