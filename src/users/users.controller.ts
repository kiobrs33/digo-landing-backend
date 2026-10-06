import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/guards.js';
import { parseSite } from '../common/site.js';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto.js';
import { UsersService } from './users.service.js';

/** Usuarios del panel. No se eliminan: se desactivan, para conservar quién respondió cada reclamo. */
@ApiTags('Admin · Usuarios')
@Auth('ADMIN')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  /** Para elegir responsable de consultas y reclamos: lo puede ver cualquier usuario del panel. */
  @Get('assignable')
  @Auth()
  assignable(@Query('site') site?: string) {
    return this.users.assignable(parseSite(site));
  }

  @Post()
  create(@Body() body: CreateUserDto) {
    return this.users.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.update(id, body, user.id);
  }
}
