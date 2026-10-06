import { Module } from '@nestjs/common';
import {
  AdminContactController,
  PublicContactController,
} from './contact.controller.js';
import { ContactService } from './contact.service.js';

@Module({
  controllers: [PublicContactController, AdminContactController],
  providers: [ContactService],
})
export class ContactModule {}
