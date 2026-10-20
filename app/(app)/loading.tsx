import { PageSkeleton } from '@/components/site/page-skeleton'

/** Every signed-in page while its data loads: a skeleton in the page's shape, never a blank screen. */
export default function Loading() {
  return <PageSkeleton />
}
