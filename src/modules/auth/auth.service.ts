import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, businessName } = registerDto;

    // 1. Verificar que el email no esté registrado
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    // 2. Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // 3. Crear User + Business + Membership
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
        },
      });

      const business = await tx.business.create({
        data: {
          name: businessName,
        },
      });

      const location = await tx.location.create({
        data: {
          businessId: business.id,
          name: businessName,
        },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          businessId: business.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      const freePlan = await tx.plan.findUnique({
        where: {
          code: 'FREE',
        },
      });

      if (!freePlan) {
        throw new Error('FREE plan not configured');
      }

      const subscription = await tx.subscription.create({
        data: {
          locationId: location.id,
          planId: freePlan.id,
          status: 'ACTIVE',
        },
      });

      return {
        user,
        business,
        membership,
        subscription,
        location,
      };
    });

    // 4. Nunca devolver password al frontend
    const { password: _, ...userWithoutPassword } = result.user;

    return {
      user: userWithoutPassword,
      business: result.business,
      membership: result.membership,
      location: result.location,
      subscription: result.subscription,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
      },
    });

    if (!membership) {
      throw new UnauthorizedException(
        'El usuario no tiene una membresía activa',
      );
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      businessId: membership.businessId,
      membershipId: membership.id,
      role: membership.role,
    });

    const { password: _, ...userWithoutPassword } = user;

    return {
      accessToken,
      user: userWithoutPassword,
    };
  }
}
