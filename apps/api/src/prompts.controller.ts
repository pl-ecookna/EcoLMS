import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common"

import { Roles } from "./auth/roles.decorator"
import { EcolmsStore, type PromptModule } from "./store/ecolms.store"

@Controller("prompts")
@Roles("admin")
export class PromptsController {
  constructor(private readonly store: EcolmsStore) {}

  @Get()
  async listPrompts(@Query("module") module?: PromptModule) {
    return {
      success: true,
      data: await this.store.listPrompts(module),
      error: null,
    }
  }

  @Get(":module/:promptKey")
  async getPrompt(
    @Param("module") module: PromptModule,
    @Param("promptKey") promptKey: string
  ) {
    return {
      success: true,
      data: await this.store.getPrompt(module, promptKey),
      error: null,
    }
  }

  @Patch(":module/:promptKey")
  @Roles("admin")
  async updatePrompt(
    @Param("module") module: PromptModule,
    @Param("promptKey") promptKey: string,
    @Body()
    body: {
      title?: string
      systemPrompt?: string
      userPromptTemplate?: string
    }
  ) {
    return {
      success: true,
      data: await this.store.updatePrompt(module, promptKey, body),
      error: null,
    }
  }
}
