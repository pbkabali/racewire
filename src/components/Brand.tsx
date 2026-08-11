/**
 * The Racewire wordmark, with the operator credit.
 *
 * One component rather than markup repeated in the shell and the picker, which
 * is how the two quietly drift apart.
 *
 * The logo lives in `public/brand/` rather than being imported through Vite so
 * that a missing file degrades to the `alt` text instead of failing the build.
 * That alt text is also the accessible name, so screen readers hear
 * "by Uganda Motor Club" either way.
 */
export function Brand({
  /** Hide the credit below `sm`, where the event header is already tight. */
  creditFrom = 'always',
}: {
  creditFrom?: 'always' | 'sm'
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-5 w-1.5 flex-none rounded-sm bg-danger" aria-hidden />

      <span className="text-lg font-bold tracking-tight text-fg">
        race<span className="text-accent-text">wire</span>
      </span>

      <span
        className={`${
          creditFrom === 'sm' ? 'hidden sm:flex' : 'flex'
        } items-center gap-1 text-[11px] whitespace-nowrap text-fg-subtle`}
      >
        by
        <img
          src="/brand/umc-logo.png"
          alt="Uganda Motor Club"
          width={20}
          height={20}
          className="h-5 w-5 object-contain"
        />
      </span>
    </span>
  )
}
