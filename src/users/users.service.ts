import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { Prisma } from '../generated/prisma/client.js';
import type { Site } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto, UpdateUserDto } from './dto/user.dto.js';

const publicFields = {
  id: true,
  email: true,
  name: true,
  role: true,
  sites: true,
  active: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Responsables posibles: activos y, si se indica, con acceso a ese espacio. */
  assignable(site?: Site) {
    return this.prisma.user.findMany({
      where: { active: true, sites: site ? { has: site } : undefined },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  list() {
    return this.prisma.user.findMany({
      select: publicFields,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create({ password, ...data }: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          ...data,
          email: data.email.toLowerCase(),
          passwordHash: await hash(password, 12),
        },
        select: publicFields,
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(
    id: string,
    { password, ...data }: UpdateUserDto,
    currentUserId: string,
  ) {
    if (
      id === currentUserId &&
      (data.active === false || (data.role && data.role !== 'ADMIN'))
    ) {
      throw new BadRequestException(
        'No puedes desactivarte ni quitarte el rol de administrador',
      );
    }
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...data,
          email: data.email?.toLowerCase(),
          passwordHash: password ? await hash(password, 12) : undefined,
        },
        select: publicFields,
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        return new ConflictException('Ya existe un usuario con ese correo');
      if (error.code === 'P2025')
        return new NotFoundException('Usuario no encontrado');
    }
    return error;
  }
}
