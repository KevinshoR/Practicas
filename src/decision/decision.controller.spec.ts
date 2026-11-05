import { Test, TestingModule } from '@nestjs/testing';
import { DecisionController } from './decision.controller';
import { DecisionService } from './decision.service';

describe('DecisionController', () => {
  let controller: DecisionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DecisionController],
      providers: [DecisionService],
    }).compile();
    controller = module.get<DecisionController>(DecisionController);
  });

  it('responde la decisión de una alerta', () => {
    const r = controller.evaluar({
      alerta: { transactionId: 'T1', tienda: 'DE-MODA', tipo: 'monitoreo' },
    });
    expect(r.decision).toBe('PASA');
  });
});
