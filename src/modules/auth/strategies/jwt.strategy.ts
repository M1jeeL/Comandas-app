import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../prisma.service.js';

export interface JwtPayload {
  sub: string;
  businessId: string;
  membershipId: string;
  role: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.membershipId || !payload.sid) {
      throw new UnauthorizedException('Token inválido');
    }

    const session = await this.prisma.refreshSession.findFirst({
      where: {
        familyId: payload.sid,
        userId: payload.sub,
        membershipId: payload.membershipId,
        revokedAt: null,
        replacedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Sesión inválida');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: payload.membershipId,
        userId: payload.sub,
        businessId: payload.businessId,
        status: 'ACTIVE',
        business: { status: 'ACTIVE' },
      },
      include: { user: true },
    });

    if (!membership) {
      throw new UnauthorizedException('Membresía inválida o inactiva');
    }

    return {
      userId: membership.userId,
      businessId: membership.businessId,
      membershipId: membership.id,
      role: membership.role,
      sessionId: session.familyId,
    };
  }
}
