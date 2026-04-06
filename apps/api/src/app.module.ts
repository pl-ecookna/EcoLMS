import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"

import { AppController } from "./app.controller"
import { ArtifactsController } from "./artifacts.controller"
import { JobsController } from "./jobs.controller"
import { ProjectsController } from "./projects.controller"
import { RedisQueueService } from "./redis/redis.service"
import { UploadsController } from "./uploads.controller"
import { AppService } from "./app.service"
import { PostgresService } from "./db/postgres.service"
import { EcolmsStore } from "./store/ecolms.store"

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
  ],
  providers: [AppService, PostgresService, RedisQueueService, EcolmsStore],
})
export class AppModule {}
