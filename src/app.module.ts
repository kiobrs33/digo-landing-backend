import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CobranzaModule } from './cobranza/cobranza.module.js';
import { ComplaintsModule } from './complaints/complaints.module.js';
import { validateEnv } from './config/env.js';
import { ContactModule } from './contact/contact.module.js';
import { ContentModule } from './content/content.module.js';
import { HealthController } from './health/health.controller.js';
import { MailModule } from './mail/mail.module.js';
import { MediaModule } from './media/media.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PublishModule } from './publish/publish.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Límite base; cada endpoint público define el suyo con @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    MailModule,
    AuthModule,
    UsersModule,
    ComplaintsModule,
    ContactModule,
    PublishModule,
    MediaModule,
    ContentModule,
    CobranzaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
