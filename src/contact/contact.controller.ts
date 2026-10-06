import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/guards.js';
import { isBot } from '../common/honeypot.js';
import { ContactService } from './contact.service.js';
import {
  BulkUpdateInquiriesDto,
  CreateInquiryDto,
  ListInquiriesQueryDto,
  UpdateInquiryDto,
} from './dto/contact.dto.js';

@ApiTags('Público · Contacto')
@Controller('public/contact')
@UseGuards(ThrottlerGuard)
export class PublicContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ApiOperation({ summary: 'Registra una consulta del formulario de contacto' })
  create(@Body() body: CreateInquiryDto) {
    if (isBot(body)) return { id: randomUUID(), createdAt: new Date() };
    return this.contact.create(body);
  }
}

@ApiTags('Admin · Consultas')
@Auth()
@Controller('admin/inquiries')
export class AdminContactController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  @ApiOperation({ summary: 'Listado con filtros, orden y conteo por estado' })
  list(@Query() query: ListInquiriesQueryDto, @CurrentUser() user: AuthUser) {
    return this.contact.list(query, user);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Excel (.xlsx) de las consultas que coinciden con los filtros',
  })
  async export(
    @Query() query: ListInquiriesQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const file = await this.contact.exportXlsx(query, user);
    return new StreamableFile(file, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="consultas.xlsx"',
    });
  }

  @Patch('bulk')
  @ApiOperation({
    summary: 'Mismo cambio de estado o responsable a varias consultas',
  })
  bulkUpdate(
    @Body() body: BulkUpdateInquiriesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contact.bulkUpdate(body, user);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Cantidad de consultas por sitio y estado' })
  summary(@CurrentUser() user: AuthUser) {
    return this.contact.summary(user);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.contact.assertAccess(id, user);
    return this.contact.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Cambia estado, responsable o notas; al atenderla registra cuándo y quién',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInquiryDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.contact.assertAccess(id, user);
    return this.contact.update(id, body, user.id);
  }
}
