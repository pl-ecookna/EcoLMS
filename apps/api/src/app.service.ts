import { Injectable } from "@nestjs/common"

@Injectable()
export class AppService {
  health() {
    return {
      success: true,
      data: {
        status: "ok",
        service: "api",
        timestamp: new Date().toISOString(),
      },
      error: null,
    }
  }
}
