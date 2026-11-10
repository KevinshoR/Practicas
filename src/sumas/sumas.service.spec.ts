import { Test, TestingModule } from '@nestjs/testing';
import { SumasService } from './sumas.service';
import { DecisionService } from '../decision/decision.service';

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

  it('debe tener al menos 100 casos de cédulas quemadas (positivos, malos, dudosos, cambio de datos)', () => {
    const lista = service.listarClientes();
    expect(lista.length).toBeGreaterThanOrEqual(100);

    const decisionService = new DecisionService();
    const decisiones = new Set<string>();

    for (const item of lista) {
      const cliente = service.obtenerDatosCliente(item.cedula);
      const res =
        cliente.alerta.tipo === 'cambio_datos'
          ? decisionService.evaluarCambioDatos({
              alerta: cliente.alerta,
              datos: {
                celular: cliente.celular,
                correo: cliente.correo,
                direccion: cliente.direccion,
              },
              biometria: cliente.biometria,
              historial: cliente.historial,
              ciudadesFrecuentes: cliente.ciudadesFrecuentes,
            })
          : decisionService.evaluarRiesgo(
              {
                alerta: cliente.alerta,
                datos: {
                  celular: cliente.celular,
                  correo: cliente.correo,
                  direccion: cliente.direccion,
                },
                biometria: cliente.biometria,
                historial: cliente.historial,
                ciudadesFrecuentes: cliente.ciudadesFrecuentes,
              },
              cliente.alerta.tipo,
            );
      decisiones.add(res.decision);
    }

    expect(decisiones.has('PASA')).toBe(true);
    expect(decisiones.has('BLOQUEA')).toBe(true);
    expect(decisiones.has('ALERTA_HUMANA')).toBe(true);
  });
});

