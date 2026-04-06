import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

@Controller()
export class ArtifactsController {
  constructor(private readonly store: EcolmsStore) {}

  @Get("projects/:id/artifacts")
  listArtifacts(@Param("id") id: string) {
    return {
      success: true,
      data: this.store.listArtifacts(id),
      error: null,
    }
  }

  @Get("projects/:id/artifacts/:artifactId")
  getArtifact(
    @Param("id") id: string,
    @Param("artifactId") artifactId: string
  ) {
    return {
      success: true,
      data: this.store.getArtifact(id, artifactId),
      error: null,
    }
  }

  @Put("projects/:id/artifacts/:artifactId")
  updateArtifact(
    @Param("id") id: string,
    @Param("artifactId") artifactId: string,
    @Body()
    body: {
      contentMd: string
    }
  ) {
    return {
      success: true,
      data: this.store.updateArtifact(id, artifactId, body.contentMd),
      error: null,
    }
  }

  @Post("projects/:id/artifacts/:artifactId/approve")
  approveArtifact(
    @Param("id") id: string,
    @Param("artifactId") artifactId: string
  ) {
    return {
      success: true,
      data: this.store.approveArtifact(id, artifactId),
      error: null,
    }
  }
}
