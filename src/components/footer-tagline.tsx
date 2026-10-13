import { useEffect, useState } from "react"
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  MotionConfig,
} from "motion/react"
import * as m from "motion/react-m"

const phrases = [
  "Probably with too many tabs open.",
  "Powered by curiosity and Ctrl+Z.",
  "Made between two render crashes.",
  "Somewhere between design and code.",
  "Survived another After Effects crash.",
  "Probably exploring another universe.",
  "Learning things the unnecessarily hard way.",
  "Works on my machine. Probably.",
]

const INTERVAL = 4000

export function FooterTagline() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      // Random pick, but never the line that is already showing.
      setIndex((current) => {
        const next = Math.floor(Math.random() * (phrases.length - 1))
        return next >= current ? next + 1 : next
      })
    }, INTERVAL)
    return () => clearInterval(id)
  }, [paused])

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        {/* Pauses while hovered or focused so the line can actually be read. */}
        <p
          className="flex items-start gap-1"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span className="shrink-0">Made by Vigs.</span>
          {/* Fixed height (two lines on narrow screens) so the footer never changes size. */}
          <span className="relative block h-8 min-w-0 flex-1 overflow-hidden sm:h-4">
            <AnimatePresence initial={false}>
              <m.span
                key={index}
                className="absolute inset-x-0 top-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                {phrases[index]}
              </m.span>
            </AnimatePresence>
          </span>
        </p>
      </MotionConfig>
    </LazyMotion>
  )
}
