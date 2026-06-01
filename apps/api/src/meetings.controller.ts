import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common"

import { Roles } from "./auth/roles.decorator"
import {
  type MeetingStageId,
  MeetingsStore,
} from "./store/meetings.store"

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

@Controller()
export class MeetingsController {
  constructor(private readonly store: MeetingsStore) {}

  @Post("meetings")
  async createMeeting(
    @Body()
    body: {
      title?: string
      description?: string
    }
  ) {
    return {
      success: true,
      data: await this.store.createMeeting(body),
      error: null,
    }
  }

  @Get("meetings")
  async listMeetings(@Query("page") page = "1", @Query("limit") limit = "25") {
    return {
      success: true,
      data: await this.store.listMeetings(
        toPositiveInt(page, 1),
        toPositiveInt(limit, 25)
      ),
      error: null,
    }
  }

  @Get("meetings/:id")
  async getMeeting(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.getMeeting(id),
      error: null,
    }
  }

  @Patch("meetings/:id")
  async updateMeeting(
    @Param("id") id: string,
    @Body()
    body: {
      title?: string
      description?: string
    }
  ) {
    return {
      success: true,
      data: await this.store.updateMeeting(id, body),
      error: null,
    }
  }

  @Delete("meetings/:id")
  @Roles("admin")
  async deleteMeeting(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.deleteMeeting(id),
      error: null,
    }
  }

  @Post("meetings/:id/uploads/init")
  async initUpload(
    @Param("id") id: string,
    @Body()
    body: {
      fileName: string
      fileSize: number
      mimeType: string
    }
  ) {
    return {
      success: true,
      data: await this.store.initUpload(id, body),
      error: null,
    }
  }

  @Post("meeting-uploads/:uploadId/parts/sign")
  async signUploadPart(
    @Param("uploadId") uploadId: string,
    @Body()
    body: {
      partNumber: number
    }
  ) {
    return {
      success: true,
      data: await this.store.signUploadPart(uploadId, Number(body.partNumber)),
      error: null,
    }
  }

  @Post("meeting-uploads/:uploadId/complete")
  async completeUpload(@Param("uploadId") uploadId: string) {
    return {
      success: true,
      data: await this.store.completeUpload(uploadId),
      error: null,
    }
  }

  @Post("meeting-uploads/:uploadId/abort")
  async abortUpload(@Param("uploadId") uploadId: string) {
    return {
      success: true,
      data: await this.store.abortUpload(uploadId),
      error: null,
    }
  }

  @Post("meetings/:id/start")
  async startMeeting(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.startMeeting(id),
      error: null,
    }
  }

  @Post("meetings/:id/generate")
  async generateMeetingStage(
    @Param("id") id: string,
    @Body()
    body: {
      stage: Exclude<MeetingStageId, "audio_prepared">
      overwriteExisting?: boolean
    }
  ) {
    return {
      success: true,
      data: await this.store.generateMeetingStage(id, body),
      error: null,
    }
  }

  @Get("meetings/:id/status")
  async getMeetingStatus(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.getMeetingStatus(id),
      error: null,
    }
  }

  @Get("meetings/:id/transcript")
  async getTranscript(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.getTranscript(id),
      error: null,
    }
  }

  @Get("meetings/:id/segments")
  async listSegments(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.listSegments(id),
      error: null,
    }
  }

  @Patch("meetings/:id/speakers/:speakerId")
  async updateSpeaker(
    @Param("id") id: string,
    @Param("speakerId") speakerId: string,
    @Body()
    body: {
      displayName: string
    }
  ) {
    return {
      success: true,
      data: await this.store.updateSpeaker(id, speakerId, body),
      error: null,
    }
  }

  @Get("meetings/:id/artifacts")
  async listArtifacts(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.listArtifacts(id),
      error: null,
    }
  }

  @Get("meetings/:id/artifacts/:artifactId")
  async getArtifact(
    @Param("id") id: string,
    @Param("artifactId") artifactId: string
  ) {
    return {
      success: true,
      data: await this.store.getArtifact(id, artifactId),
      error: null,
    }
  }

  @Put("meetings/:id/artifacts/:artifactId")
  async updateArtifact(
    @Param("id") id: string,
    @Param("artifactId") artifactId: string,
    @Body()
    body: {
      contentMd?: string
      contentJson?: Record<string, unknown>
    }
  ) {
    return {
      success: true,
      data: await this.store.updateArtifact(id, artifactId, body),
      error: null,
    }
  }

  @Get("meetings/:id/jobs")
  async listJobs(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.listJobs(id),
      error: null,
    }
  }

  @Post("meetings/:id/jobs/:jobId/retry")
  @Roles("admin")
  async retryJob(@Param("id") id: string, @Param("jobId") jobId: string) {
    return {
      success: true,
      data: await this.store.retryJob(id, jobId),
      error: null,
    }
  }

  @Get("meetings/:id/download")
  async downloadMeeting(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.downloadMeeting(id),
      error: null,
    }
  }
}
