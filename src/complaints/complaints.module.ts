import { Module } from '@nestjs/common';
import {
  AdminComplaintsController,
  PublicComplaintsController,
} from './complaints.controller.js';
import { ComplaintsService } from './complaints.service.js';

@Module({
  controllers: [PublicComplaintsController, AdminComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
