import { MeetingsListView } from "@/components/meetings-client"
import { requestServerJson } from "@/lib/server-api"
import type { PaginatedMeetings } from "@/lib/ecolms-api"

const MEETINGS_PAGE_SIZE = 10

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: {
    page?: string
  }
}) {
  const pageParam = Number(searchParams?.page ?? 1)
  const initialPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const pageData = await requestServerJson<PaginatedMeetings>(
    `/api/meetings?page=${initialPage}&limit=${MEETINGS_PAGE_SIZE}`
  )

  return <MeetingsListView currentPage={initialPage} pageData={pageData} />
}
