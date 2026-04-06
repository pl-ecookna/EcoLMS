import { Injectable } from "@nestjs/common"

import { EcolmsStore } from "./store/ecolms.store"

@Injectable()
export class AppService {
  constructor(private readonly store: EcolmsStore) {}

  async health() {
    const stats = await this.store.health()
    return {
      success: true,
      data: { status: "ok", service: "api", timestamp: new Date().toISOString(), stats },
      error: null,
    }
  }
}
