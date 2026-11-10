import { Module } from '@nestjs/common';
import { SumasController } from './sumas.controller';
import { SumasService } from './sumas.service';

@Module({
  controllers: [SumasController],
  providers: [SumasService],
  exports: [SumasService],
})
export class SumasModule {}