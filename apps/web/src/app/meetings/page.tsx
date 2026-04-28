import { MeetingsWorkspaceView } from "@/components/meetings-client"
import { requestServerJson } from "@/lib/server-api"
import type { MeetingDetailRecord, PaginatedMeetings } from "@/lib/ecolms-api"

const MEETINGS_PAGE_SIZE = 10

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: {
    page?: string
    meeting?: string
    info?: string
  }
}) {
  const pageParam = Number(searchParams?.page ?? 1)
  const initialPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const selectedMeetingId = searchParams?.meeting?.trim() || null
  const pageData = await requestServerJson<PaginatedMeetings>(
    `/api/meetings?page=${initialPage}&limit=${MEETINGS_PAGE_SIZE}`
  )
  const selectedMeetingIdResolved = selectedMeetingId ?? pageData.items[0]?.id ?? null
  const selectedMeeting = selectedMeetingIdResolved
    ? await requestServerJson<MeetingDetailRecord>(`/api/meetings/${selectedMeetingIdResolved}`)
    : null

  return (
    <MeetingsWorkspaceView
      currentPage={initialPage}
      pageData={pageData}
      selectedMeetingId={selectedMeetingIdResolved}
      selectedMeeting={selectedMeeting}
      showInfoSheet={searchParams?.info === "1"}
    />
  )
}
