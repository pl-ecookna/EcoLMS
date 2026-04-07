import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

@Controller("projects")
export class ProjectsController {
  constructor(private readonly store: EcolmsStore) {}

  @Post()
  async createProject(
    @Body()
    body: {
      name?: string
      githubRef?: string
      note?: string
    }
  ) {
    return {
      success: true,
      data: await this.store.createProject(body),
      error: null,
    }
  }

  @Get()
  async listProjects(@Query("page") page = "1", @Query("limit") limit = "25") {
    return {
      success: true,
      data: await this.store.listProjects(
        toPositiveInt(page, 1),
        toPositiveInt(limit, 25)
      ),
      error: null,
    }
  }

  @Get(":id")
  async getProject(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.getProject(id),
      error: null,
    }
  }

  @Post(":id/start")
  async startProject(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.startProject(id),
      error: null,
    }
  }

  @Get(":id/status")
  async getProjectStatus(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.getProjectStatus(id),
      error: null,
    }
  }

  @Get(":id/download")
  async downloadProject(@Param("id") id: string) {
    return {
      success: true,
      data: await this.store.downloadProject(id),
      error: null,
    }
  }
}
