/** Full-screen fallback used while a lazy route chunk loads. */
export function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-track-black">
      <span className="animate-pulse text-sm tracking-widest text-flag-yellow uppercase">
        Loading
      </span>
    </div>
  )
}
