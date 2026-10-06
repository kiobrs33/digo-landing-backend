import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Role, Site } from '../../generated/prisma/enums.js';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @Length(10, 200)
  password: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({
    enum: Site,
    isArray: true,
    description: 'Espacios del panel a los que tiene acceso',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un espacio: Hogar o Empresas' })
  @IsEnum(Site, { each: true })
  sites: Site[];
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
