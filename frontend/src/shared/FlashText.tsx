import { useEffect, useRef, useState } from 'react'

interface FlashTextProps {
  value: number
  children: React.ReactNode
  className?: string
  formatter?: (val: number) => string
}

export function FlashText({ value, children, className = '', formatter }: FlashTextProps) {
  const prevValue = useRef<number>(value)
  const [flashClass, setFlashClass] = useState('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (value > prevValue.current) {
      setFlashClass('animate-flash-up')
    } else if (value < prevValue.current) {
      setFlashClass('animate-flash-down')
    }

    prevValue.current = value

    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setFlashClass('')
    }, 800)

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [value])

  return (
    <div className={`transition-colors duration-300 rounded-sm px-1 -mx-1 ${flashClass} ${className}`}>
      {formatter ? formatter(value) : children}
    </div>
  )
}
