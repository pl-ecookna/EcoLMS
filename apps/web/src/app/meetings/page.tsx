import { MeetingsWorkspaceView } from "@/components/meetings-client"
import { requireAuthUser } from "@/lib/auth/server"
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
  const currentUser = await requireAuthUser("/meetings")
  const pageParam = Number(searchParams?.page ?? 1)
  const initialPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const selectedMeetingId = searchParams?.meeting?.trim() || null
  const pageData = await requestServerJson<PaginatedMeetings>(
    `/api/meetings?page=${initialPage}&limit=${MEETINGS_PAGE_SIZE}`
  )
  const selectedMeetingIdResolved = selectedMeetingId
  const selectedMeeting = selectedMeetingIdResolved
    ? await requestServerJson<MeetingDetailRecord>(`/api/meetings/${selectedMeetingIdResolved}`)
    : null

  return (
    <MeetingsWorkspaceView
      currentUser={currentUser}
      currentPage={initialPage}
      pageData={pageData}
      selectedMeetingId={selectedMeetingIdResolved}
      selectedMeeting={selectedMeeting}
      showInfoSheet={searchParams?.info === "1"}
    />
  )
}
