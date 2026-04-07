import { Body, Controller, Get, Param, Put } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

@Controller()
export class ArtifactsController {
  constructor(private readonly store: EcolmsStore) {}

  @Get("projects/:id/artifacts")
  async listArtifacts(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.listArtifacts(id),
      error: null,
    }
  }

  @Get("projects/:id/artifacts/:artifactId")
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

  @Put("projects/:id/artifacts/:artifactId")
  async updateArtifact(
    @Param("id") id: string,
    @Param("artifactId") artifactId: string,
    @Body()
    body: {
      contentMd: string
    }
  ) {
    return {
      success: true,
      data: await this.store.updateArtifact(id, artifactId, body.contentMd),
      error: null,
    }
  }
}
