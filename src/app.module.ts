import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DecisionModule } from './decision/decision.module';
import { SumasModule } from './sumas/sumas.module';

@Module({
  imports: [DecisionModule, SumasModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
