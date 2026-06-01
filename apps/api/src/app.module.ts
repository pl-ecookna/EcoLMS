import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { APP_GUARD } from "@nestjs/core"

import { AppController } from "./app.controller"
import { ArtifactsController } from "./artifacts.controller"
import { InternalAuthGuard } from "./auth/auth.guard"
import { RolesGuard } from "./auth/roles.guard"
import { JobsController } from "./jobs.controller"
import { MeetingsController } from "./meetings.controller"
import { PromptsController } from "./prompts.controller"
import { ProjectsController } from "./projects.controller"
import { RedisQueueService } from "./redis/redis.service"
import { UploadsController } from "./uploads.controller"
import { AppService } from "./app.service"
import { PostgresService } from "./db/postgres.service"
import { EcolmsStore } from "./store/ecolms.store"
import { MeetingsStore } from "./store/meetings.store"

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
  ],
  controllers: [
    AppController,
    ProjectsController,
    UploadsController,
    ArtifactsController,
    JobsController,
    MeetingsController,
    PromptsController,
  ],
  providers: [
    AppService,
    PostgresService,
    RedisQueueService,
    EcolmsStore,
    MeetingsStore,
    {
      provide: APP_GUARD,
      useClass: InternalAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
