import { Controller, Get, Param, Post } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

@Controller()
export class JobsController {
  constructor(private readonly store: EcolmsStore) {}

  @Get("projects/:id/jobs")
  listJobs(@Param("id") id: string) {
    return {
      success: true,
      data: this.store.listJobs(id),
      error: null,
    }
  }

  @Post("projects/:id/jobs/:jobId/retry")
  retryJob(@Param("id") id: string, @Param("jobId") jobId: string) {
    return {
      success: true,
      data: this.store.retryJob(id, jobId),
      error: null,
    }
  }
}
