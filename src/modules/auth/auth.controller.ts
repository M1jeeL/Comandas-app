import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';

import type { Request, Response } from 'express';

import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { TrustedOriginGuard } from './guards/trusted-origin.guard.js';

import { CurrentUser } from '../../common/decorators/current-user.decorators.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  clearRefreshCookieOptions,
} from './auth-cookies.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(TrustedOriginGuard)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);

    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @UseGuards(TrustedOriginGuard)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE];

    if (typeof token !== 'string') {
      throw new Error('Refresh token no encontrado');
    }

    const result = await this.authService.refresh(token);

    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('logout')
  @UseGuards(TrustedOriginGuard, JwtAuthGuard)
  async logout(
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.revokeSessionFamily(
      user.userId,
      user.sessionId,
    );

    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions);

    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtUser) {
    const authenticatedUser = await this.authService.getAuthenticatedUser(
      user.userId,
      user.membershipId,
    );

    return {
      user: authenticatedUser,
    };
  }
}
