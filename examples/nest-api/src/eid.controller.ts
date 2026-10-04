import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EidAuthService, EidVerifyError } from '@dafkedd/eid/nestjs';

const COOKIE = 'eid_nonce';

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

@Controller('eid')
export class EidController {
  constructor(private readonly eid: EidAuthService) {}

  // GET /eid/challenge → nonce, ook als httpOnly-cookie zodat hij bij deze browser hoort
  @Get('challenge')
  async challenge(@Res({ passthrough: true }) res: Response) {
    const { nonce } = await this.eid.createChallenge();
    res.cookie(COOKIE, nonce, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 300_000 });
    return { nonce };
  }

  // POST /eid/login (body = token van useEidLogin)
  @Post('login')
  @HttpCode(200)
  async login(@Body() token: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const nonce = readCookie(req, COOKIE);
    res.clearCookie(COOKIE);
    if (!nonce) throw new UnauthorizedException('nonce-invalid');
    try {
      const who = await this.eid.verify(token, nonce);
      // Hier: sessie of JWT aanmaken.
      return { firstNames: who.firstNames, lastName: who.lastName };
    } catch (error) {
      if (EidVerifyError.is(error)) throw new UnauthorizedException(error.code);
      throw error;
    }
  }
}
