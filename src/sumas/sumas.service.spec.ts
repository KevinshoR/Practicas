import { Test, TestingModule } from '@nestjs/testing';
import { SumasService } from './sumas.service';

describe('SumasService', () => {
  let service: SumasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SumasService],
    }).compile();

    service = module.get<SumasService>(SumasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
