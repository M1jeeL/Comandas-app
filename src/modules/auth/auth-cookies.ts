import type { CookieOptions } from 'express';

export const REFRESH_COOKIE = 'refreshToken';

const isProduction = process.env.NODE_ENV === 'production';

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const clearRefreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/auth',
};
