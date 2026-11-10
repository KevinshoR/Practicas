import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { DecisionController } from './decision.controller';
import { DecisionService } from './decision.service';
import { SumasService } from '../sumas/sumas.service';

describe('POST /decision/monitoreo/desde-correo', () => {
  let controller: DecisionController;
  let decisionService: DecisionService;
  let sumasService: SumasService;
  const envOriginal = process.env.DRY_RUN;

  beforeEach(async () => {
    process.env.DRY_RUN = 'true';
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DecisionController],
      providers: [DecisionService, SumasService],
    }).compile();

    controller = module.get<DecisionController>(DecisionController);
    decisionService = module.get<DecisionService>(DecisionService);
    sumasService = module.get<SumasService>(SumasService);
  });

  afterAll(() => {
    process.env.DRY_RUN = envOriginal;
  });

  it('1. Cédula inexistente: responde ALERTA_HUMANA con motivo "Cliente no encontrado en el sistema" y lo encola', () => {
    const res: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '9999999999',
      transactionId: 'TX-NO-EXISTE-1',
      valorCredito: 300000,
      creCredito: 'CRE-001',
    });

    expect(res.decision).toBe('ALERTA_HUMANA');
    expect(res.motivo).toBe('Cliente no encontrado en el sistema');
    expect(res.transactionId).toBe('TX-NO-EXISTE-1');
    expect(res.dryRun).toBe(true);
    expect(res.accion).toBe('ninguna');
    expect(
      decisionService.listarRevision().some((item) => item.transactionId === 'TX-NO-EXISTE-1'),
    ).toBe(true);
  });

  it('2. Duplicados: si el transactionId ya se procesó, devuelve { duplicado: true } sin reprocesar', () => {
    const primera: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '1001001001',
      transactionId: 'TX-DUP-100',
      valorCredito: 400000,
      creCredito: 'CRE-100',
    });
    expect(primera.decision).toBe('PASA');

    const segunda: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '1001001001',
      transactionId: 'TX-DUP-100',
      valorCredito: 400000,
      creCredito: 'CRE-100',
    });
    expect(segunda).toEqual({ duplicado: true });
  });

  it('3. Biometría pendiente y su reintento: primero devuelve pendienteBiometria y con esReintento=true decide PASA', () => {
    const intento1: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '8008008008',
      transactionId: 'TX-BIO-8008',
      valorCredito: 390000,
      creCredito: 'CRE-8008',
      esReintento: false,
    });

    expect(intento1).toEqual({
      pendienteBiometria: true,
      decision: null,
    });

    // Como quedó pendiente, no se marca como duplicado y permite el reintento
    const reintento: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '8008008008',
      transactionId: 'TX-BIO-8008',
      valorCredito: 390000,
      creCredito: 'CRE-8008',
      esReintento: true,
    });

    expect(reintento.decision).toBe('PASA');
    expect(reintento.transactionId).toBe('TX-BIO-8008');
  });

  it('4. DRY_RUN=true vs DRY_RUN=false en bloqueo: controla accion y llamada a SumasService', () => {
    const spyActualizar = jest.spyOn(sumasService, 'actualizarEstadoCliente');

    // Con DRY_RUN = true (modo sombra)
    process.env.DRY_RUN = 'true';
    const resSombra: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '2002002002',
      transactionId: 'TX-DRY-TRUE',
      valorCredito: 350000,
      creCredito: 'CRE-2002',
    });

    expect(resSombra.decision).toBe('BLOQUEA');
    expect(resSombra.dryRun).toBe(true);
    expect(resSombra.accion).toBe('solo_registrar');
    expect(spyActualizar).not.toHaveBeenCalled();

    // Con DRY_RUN = false (bloqueo activo)
    process.env.DRY_RUN = 'false';
    const resActivo: any = controller.evaluarMonitoreoDesdeCorreo({
      cedula: '7007007007',
      transactionId: 'TX-DRY-FALSE',
      valorCredito: 500000,
      creCredito: 'CRE-7007',
    });

    expect(resActivo.decision).toBe('BLOQUEA');
    expect(resActivo.tipoBloqueo).toBe('biometria');
    expect(resActivo.dryRun).toBe(false);
    expect(resActivo.accion).toBe('bloquear');
    expect(spyActualizar).toHaveBeenCalledWith(
      expect.objectContaining({
        cedula: '7007007007',
        decision: 'BLOQUEA',
        tipoBloqueo: 'biometria',
        transactionId: 'TX-DRY-FALSE',
      }),
    );
  });

  it('5. Registro en logs/decisiones.jsonl enmascara la cédula dejando solo los últimos 3 dígitos', () => {
    controller.evaluarMonitoreoDesdeCorreo({
      cedula: '1001001001',
      transactionId: 'TX-LOG-MASK',
      valorCredito: 450000,
      creCredito: 'CRE-LOG',
    });

    const logPath = path.resolve(process.cwd(), 'logs', 'decisiones.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const lineas = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    const ultimo = JSON.parse(lineas[lineas.length - 1]);

    expect(ultimo.transactionId).toBe('TX-LOG-MASK');
    expect(ultimo.cedula).toBe('*******001');
    expect(ultimo.cedula).not.toContain('1001001');
  });

  describe('6. Tabla de cédulas del punto 4', () => {
    const casosTabla: Array<{
      cedula: string;
      descripcion: string;
      monto: number;
      esReintento?: boolean;
      esperado: 'PASA' | 'BLOQUEA' | 'ALERTA_HUMANA';
    }> = [
      { cedula: '1001001001', descripcion: 'Cliente limpio (Unicus 7)', monto: 1500000, esperado: 'PASA' },
      { cedula: '3003003003', descripcion: 'Cliente limpio monitoreo normal', monto: 420000, esperado: 'PASA' },
      { cedula: '2002002002', descripcion: '0-0 en celular y correo', monto: 350000, esperado: 'BLOQUEA' },
      { cedula: '4004004004', descripcion: 'Un dato principal en 0 con respaldo', monto: 600000, esperado: 'PASA' },
      { cedula: '5005005005', descripcion: 'Un dato en 0 sin respaldo', monto: 480000, esperado: 'BLOQUEA' },
      { cedula: '6006006006', descripcion: 'Consumo de 96 con Unicus 7', monto: 500000, esperado: 'PASA' },
      { cedula: '7007007007', descripcion: 'Consumo de 96 con Unicus 6 y sin respaldo', monto: 500000, esperado: 'BLOQUEA' },
      { cedula: '8008008008', descripcion: 'Sin biometría con 2-2 (en reintento)', monto: 390000, esReintento: true, esperado: 'PASA' },
      { cedula: '9009009009', descripcion: 'Veriff rechazado con respaldo', monto: 650000, esperado: 'ALERTA_HUMANA' },
      { cedula: '1100110011', descripcion: 'Veriff en revisión', monto: 550000, esperado: 'ALERTA_HUMANA' },
      { cedula: '1200120012', descripcion: 'Ciudad de revisión reforzada con Unicus 6 y sin respaldo', monto: 620000, esperado: 'BLOQUEA' },
    ];

    it.each(casosTabla)(
      'Cédula $cedula ($descripcion) -> $esperado',
      ({ cedula, monto, esReintento, esperado }) => {
        const res: any = controller.evaluarMonitoreoDesdeCorreo({
          cedula,
          transactionId: `TX-TABLA-${cedula}`,
          valorCredito: monto,
          creCredito: `CRE-${cedula}`,
          esReintento,
        });

        expect(res.decision).toBe(esperado);
      },
    );
  });
});