import { Global, Module } from '@nestjs/common';
import {
  PublishController,
  PublishSummaryController,
} from './publish.controller.js';
import { PublishService } from './publish.service.js';

@Global()
@Module({
  controllers: [PublishController, PublishSummaryController],
  providers: [PublishService],
  exports: [PublishService],
})
export class PublishModule {}
