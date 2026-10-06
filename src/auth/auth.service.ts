import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser, JwtPayload } from './auth-user.js';
import type { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({
    email,
    password,
  }: LoginDto): Promise<{ user: AuthUser; token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    // Mismo mensaje para usuario inexistente y contraseña errónea: no revela qué correos existen.
    if (
      !user ||
      !user.active ||
      !(await compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }
    const payload: JwtPayload = { sub: user.id };
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        sites: user.sites,
      },
      token: await this.jwt.signAsync(payload),
    };
  }
}
