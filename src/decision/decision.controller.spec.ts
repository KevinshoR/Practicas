import { DecisionService } from './decision.service';

const hist = (extra: any = {}) => ({ comprasPrevias: 2, creditosActivos: 1, alDia: true, consumo_pct: 40, ...extra });
const base: any = {
  alerta: { transactionId: 'T', monto: 200000, ciudadOrigen: 'Medellín' },
  datos: { celular: { reportes: 3, entidades: 2 }, correo: { reportes: 1, entidades: 1 } },
  biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
  historial: hist(),
  ciudadesFrecuentes: ['Medellín', 'Cartagena'],
};
const con = (c: any) => ({ ...base, ...c });
const veriff = (estado: string) => ({ disponible: true, proveedor: 'veriff', estado });
const unicus = (n: number) => ({ disponible: true, proveedor: 'unicus', nivelUnicus: n });
const sinBio = { disponible: false };
const dos = { celular: { reportes: 2, entidades: 2 }, correo: { reportes: 2, entidades: 2 } };
const sinRespaldo = { ciudadesFrecuentes: [], historial: hist({ comprasPrevias: 0, creditosActivos: 0, alDia: false }) };
const ciudad = (c: string, monto = 200000) => ({ alerta: { transactionId: 'T', monto, ciudadOrigen: c } });
const correoEn0 = { datos: { celular: { reportes: 3, entidades: 2 }, correo: { reportes: 0, entidades: 0 } } };

describe('DecisionService', () => {
  const s = new DecisionService();

  it.each<[string, any, string, string?]>([
    ['0-0 aunque haya respaldo', con({ datos: { celular: { reportes: 0, entidades: 0 }, correo: { reportes: 0, entidades: 0 } } }), 'BLOQUEA'],
    ['veriff aprobado', base, 'PASA'],
    ['veriff rechazado con respaldo', con({ biometria: veriff('declined') }), 'ALERTA_HUMANA'],
    ['veriff rechazado sin respaldo', con({ biometria: veriff('declined'), ...sinRespaldo }), 'BLOQUEA'],
    ['veriff en revisión', con({ biometria: veriff('review') }), 'ALERTA_HUMANA'],
    ['veriff resubmission_requested', con({ biometria: veriff('resubmission_requested') }), 'ALERTA_HUMANA'],
    ['veriff expirado con 2-2', con({ biometria: veriff('expired'), datos: dos }), 'PASA'],
    ['veriff abandonado con celular 2-1', con({ biometria: veriff('abandoned'), datos: { ...dos, celular: { reportes: 2, entidades: 1 } } }), 'BLOQUEA'],
    ['unicus 5 en normal', con({ biometria: unicus(5) }), 'PASA'],
    ['unicus 4 con respaldo', con({ biometria: unicus(4) }), 'PASA'],
    ['unicus 4 sin respaldo', con({ biometria: unicus(4), ...sinRespaldo }), 'BLOQUEA'],
    ['correo en 0 con respaldo', con(correoEn0), 'PASA'],
    ['correo en 0 sin respaldo', con({ ...correoEn0, ...sinRespaldo }), 'BLOQUEA'],
    ['un solo respaldo basta (historial)', con({ biometria: unicus(4), ciudadesFrecuentes: [] }), 'PASA'],
    ['consumo 95, unicus 6, con respaldo', con({ biometria: unicus(6), historial: hist({ consumo_pct: 95 }) }), 'PASA'],
    ['consumo 95, unicus 6, sin respaldo', con({ biometria: unicus(6), ciudadesFrecuentes: [], historial: hist({ consumo_pct: 95, comprasPrevias: 0 }) }), 'BLOQUEA'],
    ['consumo 95, unicus 7', con({ biometria: unicus(7), historial: hist({ consumo_pct: 95 }) }), 'PASA'],
    ['monto 1.5M, veriff aprobado, correo 1-1', con(ciudad('Medellín', 1500000)), 'PASA'],
    ['estricto, ubicación no coincide, biometría buena', con(ciudad('Bogotá', 1500000)), 'PASA'],
    ['cliente sin ciudades, biometría buena', con({ ciudadesFrecuentes: [] }), 'PASA'],
    ['ciudad de revisión exige unicus 7', con({ ...ciudad('Cartagena'), biometria: unicus(6), ciudadesFrecuentes: [], historial: hist({ comprasPrevias: 0 }) }), 'BLOQUEA'],
    ['Montería con tilde se reconoce', con({ ...ciudad('Montería'), biometria: unicus(6), ciudadesFrecuentes: [], historial: hist({ comprasPrevias: 0 }) }), 'BLOQUEA'],
    ['ciudad normal con unicus 6 pasa', con({ biometria: unicus(6), ...sinRespaldo }), 'PASA'],
    ['sin biometría 2-2', con({ biometria: sinBio, datos: dos }), 'PASA'],
    ['sin biometría celular 2-1', con({ biometria: sinBio, datos: { ...dos, celular: { reportes: 2, entidades: 1 } } }), 'BLOQUEA'],
    ['sin biometría en estricto con 2-2', con({ biometria: sinBio, datos: dos, ...ciudad('Medellín', 1500000) }), 'PASA'],
    ['onboarding sin biometría, 1 y 3', con({ biometria: sinBio }), 'PASA', 'onboarding'],
    ['onboarding con 2-2 y 2-2 (máximo 2)', con({ biometria: sinBio, datos: dos }), 'BLOQUEA', 'onboarding'],
    ['onboarding con correo en 0', con({ biometria: sinBio, ...correoEn0 }), 'BLOQUEA', 'onboarding'],
  ])('%s', (_n, dto, esperado, proceso = 'monitoreo') => {
    expect(s.evaluarRiesgo(dto, proceso).decision).toBe(esperado);
  });

  it('cambio de datos va a alerta humana', () => {
    expect(s.evaluarCambioDatos(base).decision).toBe('ALERTA_HUMANA');
  });
});