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
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/guards.js';
import { isBot } from '../common/honeypot.js';
import { parseSite } from '../common/site.js';
import {
  ComplaintsService,
  formatComplaintCode,
} from './complaints.service.js';
import {
  BulkUpdateComplaintsDto,
  ListComplaintsQueryDto,
  RespondComplaintDto,
  UpdateComplaintManagementDto,
  UpdateComplaintStatusDto,
} from './dto/admin-complaint.dto.js';
import { CreateComplaintDto } from './dto/create-complaint.dto.js';

@ApiTags('Público · Libro de Reclamaciones')
@Controller('public/complaints')
@UseGuards(ThrottlerGuard)
export class PublicComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @ApiOperation({
    summary:
      'Registra una hoja de reclamación y envía la constancia por correo',
  })
  create(@Body() body: CreateComplaintDto) {
    if (isBot(body)) {
      return {
        code: formatComplaintCode(0, new Date().getFullYear()),
        kind: body.kind,
        createdAt: new Date(),
        dueDate: null,
        receiptSent: true,
      };
    }
    return this.complaints.create(body);
  }
}

@ApiTags('Admin · Libro de Reclamaciones')
@Auth()
@Controller('admin/complaints')
export class AdminComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  list(@Query() query: ListComplaintsQueryDto, @CurrentUser() user: AuthUser) {
    return this.complaints.list(query, user);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Excel (.xlsx) de las hojas que coinciden con los filtros',
  })
  async export(
    @Query() query: ListComplaintsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const file = await this.complaints.exportXlsx(query, user);
    return new StreamableFile(file, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="libro-de-reclamaciones.xlsx"',
    });
  }

  @Patch('bulk')
  @ApiOperation({
    summary: 'Responsable o estado (pendiente / en proceso) de varias hojas',
  })
  bulkUpdate(
    @Body() body: BulkUpdateComplaintsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.complaints.bulkUpdate(body, user);
  }

  @Get('next')
  @ApiOperation({
    summary: 'Siguiente hoja sin responder (la que vence antes)',
  })
  next(
    @CurrentUser() user: AuthUser,
    @Query('after') after?: string,
    @Query('site') site?: string,
  ) {
    return this.complaints.next(user, after, parseSite(site));
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Pendientes, vencidas y por vencer (3 días hábiles)',
  })
  summary(@CurrentUser() user: AuthUser, @Query('site') site?: string) {
    return this.complaints.summary(user, parseSite(site));
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.complaints.assertAccess(id, user);
    return this.complaints.findOne(id);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateComplaintStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.complaints.assertAccess(id, user);
    return this.complaints.updateStatus(id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Responsable y notas internas' })
  async updateManagement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateComplaintManagementDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.complaints.assertAccess(id, user);
    return this.complaints.updateManagement(id, body);
  }

  @Post(':id/response')
  @ApiOperation({ summary: 'Registra la respuesta y la envía al consumidor' })
  async respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RespondComplaintDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.complaints.assertAccess(id, user);
    return this.complaints.respond(id, body.response, user.id);
  }

  @Post(':id/response/resend')
  @ApiOperation({ summary: 'Reenvía la respuesta por correo' })
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.complaints.assertAccess(id, user);
    return this.complaints.resendResponse(id);
  }
}
