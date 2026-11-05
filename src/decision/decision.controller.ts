import { Controller, Post, Body } from '@nestjs/common';
import { DecisionService } from './decision.service';
import { AlertaDto } from './alerta.dto';

@Controller('decision')
export class DecisionController {
  constructor(private readonly decisionService: DecisionService) {}

  @Post('onboarding')
  evaluarOnboarding(@Body() dto: AlertaDto) { return this.decisionService.evaluarRiesgo(dto, 'onboarding'); }

  @Post('monitoreo')
  evaluarMonitoreo(@Body() dto: AlertaDto) { return this.decisionService.evaluarRiesgo(dto, 'monitoreo'); }

  @Post('cambio_datos')
  evaluarCambioDatos(@Body() dto: AlertaDto) { return this.decisionService.evaluarRiesgo(dto, 'cambio_datos'); }
}
