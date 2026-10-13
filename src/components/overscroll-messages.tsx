// Fixed behind <main>, so they only show in the bounce when you pull past the top or bottom.
export function OverscrollMessages() {
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 -z-10 pt-4 text-center text-sm text-muted-foreground"
      >
        Nothing up here. Go on, scroll down ↓
      </div>
      <div
        aria-hidden
        className="fixed inset-x-0 bottom-0 -z-10 flex flex-col items-center gap-1 px-6 pb-4 text-center text-sm text-muted-foreground"
      >
        <span>That&apos;s the bottom. Yes, really. ↑</span>
        <span className="max-w-sm text-xs italic">
          We all are made of star stuff. We are a way for the COSMOS to know
          itself.
        </span>
      </div>
    </>
  )
}
