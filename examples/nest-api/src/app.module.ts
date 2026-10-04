import { Module } from '@nestjs/common';
import { EidAuthModule } from '@dafkedd/eid/nestjs';
import { TEST_ROOT_CA, TEST_CITIZEN_CA } from '@dafkedd/eid/mock';
import { EidController } from './eid.controller.js';

const testCard = process.env.EID_TEST_CARD === '1'; // alleen met `npx dafke-eid --mock`

@Module({
  imports: [
    EidAuthModule.forRoot({
      origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
      ...(testCard ? { trust: { roots: [TEST_ROOT_CA], intermediates: [TEST_CITIZEN_CA] }, revocation: false as const } : {}),
    }),
  ],
  controllers: [EidController],
})
export class AppModule {}
