import { Body, Controller, Param, Post } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

@Controller()
export class UploadsController {
  constructor(private readonly store: EcolmsStore) {}

  @Post("projects/:id/uploads/init")
  initUpload(
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
      data: this.store.initUpload(id, body),
      error: null,
    }
  }

  @Post("uploads/:uploadId/parts/sign")
  signUploadPart(
    @Param("uploadId") uploadId: string,
    @Body()
    body: {
      partNumber: number
    }
  ) {
    return {
      success: true,
      data: this.store.signUploadPart(uploadId, Number(body.partNumber)),
      error: null,
    }
  }

  @Post("uploads/:uploadId/complete")
  completeUpload(@Param("uploadId") uploadId: string) {
    return {
      success: true,
      data: this.store.completeUpload(uploadId),
      error: null,
    }
  }

  @Post("uploads/:uploadId/abort")
  abortUpload(@Param("uploadId") uploadId: string) {
    return {
      success: true,
      data: this.store.abortUpload(uploadId),
      error: null,
    }
  }
}
