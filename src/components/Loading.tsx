/** Full-screen fallback used while a lazy route chunk loads. */
export function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <span className="animate-pulse text-sm tracking-widest text-accent-text uppercase">
        Loading
      </span>
    </div>
  )
}
