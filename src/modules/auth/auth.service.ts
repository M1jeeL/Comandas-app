import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

import { randomBytes, createHash, randomUUID } from 'node:crypto';

const REFRESH_DAYS = 7;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

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

  async getAuthenticatedUser(userId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        userId,
        status: 'ACTIVE',
        business: { status: 'ACTIVE' },
      },
      include: {
        user: true,
      },
    });

    if (!membership) {
      throw new UnauthorizedException('Sesión inválida');
    }

    return {
      userId: membership.user.id,
      email: membership.user.email,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      businessId: membership.businessId,
      membershipId: membership.id,
      role: membership.role,
    };
  }

  private async createAccessToken(
    userId: string,
    membershipId: string,
    familyId: string,
  ) {
    const user = await this.getAuthenticatedUser(userId, membershipId);

    return this.jwtService.signAsync({
      sub: user.userId,
      businessId: user.businessId,
      membershipId: user.membershipId,
      role: user.role,
      sid: familyId,
    });
  }

  async login(loginDto: LoginDto) {
    const email = loginDto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await bcrypt.compare(loginDto.password, user.password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        business: { status: 'ACTIVE' },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new ForbiddenException('No tienes una membresía activa');
    }

    const refreshToken = generateRefreshToken();
    const familyId = randomUUID();

    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshSession.create({
      data: {
        familyId,
        userId: user.id,
        membershipId: membership.id,
        tokenHash: hashToken(refreshToken),
        expiresAt,
      },
    });

    const accessToken = await this.createAccessToken(
      user.id,
      membership.id,
      familyId,
    );

    const authenticatedUser = await this.getAuthenticatedUser(
      user.id,
      membership.id,
    );

    return {
      accessToken,
      refreshToken,
      user: authenticatedUser,
    };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const tokenHash = hashToken(refreshToken);

    const current = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
    });

    if (!current) {
      throw new UnauthorizedException('Sesión no válida');
    }

    if (current.revokedAt || current.replacedAt) {
      await this.prisma.refreshSession.updateMany({
        where: {
          familyId: current.familyId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      throw new UnauthorizedException('Se detectó reutilización de sesión');
    }

    if (current.expiresAt <= new Date()) {
      throw new UnauthorizedException('La sesión ha expirado');
    }

    const user = await this.getAuthenticatedUser(
      current.userId,
      current.membershipId,
    );

    const nextRefreshToken = generateRefreshToken();
    const nextHash = hashToken(nextRefreshToken);
    const now = new Date();

    const rotated = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshSession.updateMany({
        where: {
          id: current.id,
          revokedAt: null,
          replacedAt: null,
          expiresAt: { gt: now },
        },
        data: { replacedAt: now },
      });

      if (consumed.count !== 1) {
        return false;
      }

      await tx.refreshSession.create({
        data: {
          familyId: current.familyId,
          userId: current.userId,
          membershipId: current.membershipId,
          tokenHash: nextHash,
          expiresAt: current.expiresAt,
        },
      });

      return true;
    });

    if (!rotated) {
      await this.prisma.refreshSession.updateMany({
        where: {
          familyId: current.familyId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      throw new UnauthorizedException('La sesión ya fue renovada');
    }

    const accessToken = await this.createAccessToken(
      current.userId,
      current.membershipId,
      current.familyId,
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      user,
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      const session = await this.prisma.refreshSession.findUnique({
        where: {
          tokenHash: hashToken(refreshToken),
        },
      });

      if (session) {
        await this.prisma.refreshSession.updateMany({
          where: {
            familyId: session.familyId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }
    }

    return { message: 'Sesión cerrada correctamente' };
  }

  async revokeSessionFamily(userId: string, familyId: string) {
    await this.prisma.refreshSession.updateMany({
      where: {
        userId,
        familyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { message: 'Sesión cerrada correctamente' };
  }
}
