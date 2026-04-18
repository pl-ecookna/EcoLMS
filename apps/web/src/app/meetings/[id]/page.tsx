import { MeetingDetailView } from "@/components/meetings-client"
import { requestServerJson } from "@/lib/server-api"
import type { MeetingDetailRecord } from "@/lib/ecolms-api"

export default async function MeetingDetailPage({
  params,
}: {
  params: {
    id: string
  }
}) {
  const meeting = await requestServerJson<MeetingDetailRecord>(`/api/meetings/${params.id}`)

  return <MeetingDetailView meetingId={params.id} initialMeeting={meeting} />
}
