import { Test, TestingModule } from '@nestjs/testing';
import { SumasController } from './sumas.controller';
import { SumasService } from './sumas.service';

describe('SumasController', () => {
  let controller: SumasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SumasController],
      providers: [SumasService],
    }).compile();

    controller = module.get<SumasController>(SumasController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

