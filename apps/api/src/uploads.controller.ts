import { Body, Controller, Param, Post } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

@Controller()
export class UploadsController {
  constructor(private readonly store: EcolmsStore) {}

  @Post("projects/:id/uploads/init")
  async initUpload(
    @Param("id") id: string,
    @Body()
    body: {
      fileName: string
      fileSize: number
      mimeType: string
      kind: string
    }
  ) {
    return {
      success: true,
      data: await this.store.initUpload(id, body),
      error: null,
    }
  }

  @Post("uploads/:uploadId/parts/sign")
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

  @Post("uploads/:uploadId/complete")
  async completeUpload(
    @Param("uploadId") uploadId: string,
    @Body()
    body: {
      parts: Array<{ partNumber: number; etag: string }>
    }
  ) {
    return {
      success: true,
      data: await this.store.completeUpload(uploadId, body.parts ?? []),
      error: null,
    }
  }

  @Post("uploads/:uploadId/abort")
  async abortUpload(@Param("uploadId") uploadId: string) {
    return {
      success: true,
      data: await this.store.abortUpload(uploadId),
      error: null,
    }
  }
}
