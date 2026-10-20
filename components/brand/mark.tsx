/**
 * THE MARK: an àpò, a cloth money pouch gathered at the neck with a
 * drawstring, the kind market women tuck into a wrapper. Drawn by hand as
 * a few paths (no icon pack). It takes the current text colour, and the
 * logo sets that to `ink`: Oxford Blue on Lavender, Lavender on Oxford in
 * dark mode, from the same file.
 */
export function Mark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      {/* The body of the pouch: wide and soft at the bottom, gathered at the neck. */}
      <path
        fill="currentColor"
        d="M17.2 15.6c-6.1 4.4-10.7 10.6-10.7 17.1 0 7.4 6.9 11.3 17.5 11.3s17.5-3.9 17.5-11.3c0-6.5-4.6-12.7-10.7-17.1-.9 1.3-3.3 2.1-6.8 2.1s-5.9-.8-6.8-2.1Z"
      />
      {/* The gathered frill above the drawstring. */}
      <path
        fill="currentColor"
        d="M16.4 13.4c-1.7-2.6-2.4-5.3-1.2-7.4 1.4.9 2.4 2 3.2 3.2.4-2 1.5-3.7 3.2-4.9.9 1.5 1.5 3 1.8 4.6.5-1.8 1.6-3.4 3.1-4.4 1.3 1.6 2 3.3 2 5 .9-1.2 2.1-2.2 3.6-2.8.8 2.3.2 4.7-1.6 6.9-1.6.9-4.4 1.4-7.5 1.4s-5.9-.5-6.6-1.6Z"
      />
      {/* The drawstring, knotted, its two ends hanging loose. */}
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M15.5 14.6c2.6 1.5 5.6 2.1 8.5 2.1s5.9-.6 8.5-2.1M24.3 16.9c-.8 3.2-2.6 5.4-5.1 6.6M24.3 16.9c1.1 2.9 3 4.8 5.6 5.6"
      />
      {/* Stitched seams on the cloth, drawn in the page colour so they read as gaps. */}
      <path
        fill="none"
        stroke="var(--color-page)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="1.6 2.4"
        d="M12.4 30.5c3.2 1.9 7.2 2.8 11.6 2.8s8.4-.9 11.6-2.8M15 37.6c2.6 1.1 5.6 1.6 9 1.6s6.4-.5 9-1.6"
      />
      {/* A naira coin peeping out: the pouch is for money. */}
      <circle cx="24" cy="25.4" r="3.4" fill="var(--color-page)" />
      <path fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" d="M22.6 27.4v-4l2.8 4v-4M21.9 25h4.2M21.9 26h4.2" />
    </svg>
  )
}
