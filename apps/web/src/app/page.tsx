import { EcolmsDashboard } from "@/components/ecolms-dashboard"
import { requireAuthUser } from "@/lib/auth/server"

export default async function Home() {
  const currentUser = await requireAuthUser("/")
  return <EcolmsDashboard currentUser={currentUser} />
}
