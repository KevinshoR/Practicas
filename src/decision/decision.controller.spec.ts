import { BadRequestException } from '@nestjs/common';
import { DecisionService } from './decision.service';
import type { AlertaDto, RegistroHistorico } from './alerta.dto';

function base(): AlertaDto {
  return {
    alerta: { transactionId: 'T', monto: 200000, ciudadOrigen: 'Bogotá' },
    datos: {
      celular: { valor: '3001111111', reportes: 1, entidades: 1 },
      correo: { valor: 'actual@example.test', reportes: 1, entidades: 1 },
      direccion: { reportes: 0, entidades: 0 },
    },
    biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 5 },
    historial: {
      comprasPrevias: 0,
      creditosActivos: 0,
      alDia: false,
      consumo_pct: 0,
    },
    ciudadesFrecuentes: [],
    carga: 'completa',
  };
}
const registro = (
  valor: string,
  reportes: number,
  entidades: number,
): RegistroHistorico => ({ valor, reportes, entidades });
const servicio = new DecisionService();
const evaluar = (dto: AlertaDto, proceso = 'monitoreo') =>
  servicio.evaluarRiesgo(dto, proceso);

describe('Reglas acordadas con negocio', () => {
  it.each(['monitoreo', 'onboarding'])(
    'un solo celular fuerte pasa en %s aunque correo esté en cero',
    (proceso) => {
      const d = base();
      d.datos!.celular!.reportes = 6;
      d.datos!.correo = { reportes: 0, entidades: 0 };
      d.biometria = { disponible: true, proveedor: 'unicus', nivelUnicus: 1 };
      expect(evaluar(d, proceso)).toMatchObject({
        decision: 'PASA',
        codigo: 'CONTACTO_FUERTE',
      });
    },
  );
  it('un correo fuerte basta, sin dirección, ciudad ni historial', () => {
    const d = base();
    d.datos = { correo: { reportes: 6, entidades: 0 } };
    d.historial = undefined;
    d.biometria = { disponible: false };
    expect(evaluar(d).decision).toBe('PASA');
  });
  it('cinco reportes no se etiquetan como fuerte', () => {
    const d = base();
    d.datos!.celular = { reportes: 5, entidades: 0 };
    d.biometria = { disponible: false };
    expect(evaluar(d)).toMatchObject({
      decision: 'BLOQUEA',
      evidencia: { celular: { fuerte: false } },
    });
  });
  it.each([
    [5, 2],
    [3, 5],
    [5, 0],
    [0, 5],
    [20, 10],
  ])('alternativo %i/%i pasa frente a otro fuerte', (reportes, entidades) => {
    const d = base();
    d.historialDatos = {
      celulares: [
        registro('3001111111', reportes, entidades),
        registro('3002222222', 60, 40),
      ],
    };
    d.biometria = { disponible: true, proveedor: 'unicus', nivelUnicus: 1 };
    expect(evaluar(d).decision).toBe('PASA');
  });
  it.each([
    [1, 1],
    [3, 2],
    [4, 4],
    [0, 0],
  ])(
    'alternativo %i/%i no pasa con el resto débil aunque biometría sea buena',
    (reportes, entidades) => {
      const d = base();
      d.historialDatos = {
        celulares: [
          registro('3001111111', reportes, entidades),
          registro('3002222222', 30, 40),
        ],
      };
      expect(evaluar(d)).toMatchObject({
        decision: 'BLOQUEA',
        codigo: 'CONTACTOS_DEBILES_FRENTE_A_HISTORIAL',
      });
    },
  );
  it('correo fuerte rescata teléfono débil frente a alternativas fuertes', () => {
    const d = base();
    d.historialDatos = {
      celulares: [registro('3001111111', 1, 1), registro('3002222222', 30, 40)],
    };
    d.datos!.correo!.reportes = 6;
    expect(evaluar(d).decision).toBe('PASA');
  });
  it('una alternativa suficiente de correo también compensa el teléfono débil', () => {
    const d = base();
    d.historialDatos = {
      celulares: [registro('3001111111', 1, 1), registro('3002222222', 30, 40)],
      correos: [
        registro('actual@example.test', 3, 5),
        registro('otro@example.test', 10, 2),
      ],
    };
    expect(evaluar(d).decision).toBe('PASA');
  });
  it('no usa los conteos del contacto principal cuando el usado no coincide', () => {
    const d = base();
    d.datos!.celular!.reportes = 100;
    d.historialDatos = { celulares: [registro('3009999999', 30, 40)] };
    expect(evaluar(d)).toMatchObject({
      decision: 'BLOQUEA',
      evidencia: { celular: { reportes: 0, coincide: false } },
    });
  });
  it('no compara el teléfono con registros fuertes de correo', () => {
    const d = base();
    d.historialDatos = { correos: [registro('actual@example.test', 1, 1)] };
    expect(evaluar(d).evidencia.celular.hayOtroFuerte).toBe(false);
  });
  it('si los únicos contactos son débiles, combina biometría y datos', () => {
    expect(evaluar(base())).toMatchObject({
      decision: 'PASA',
      codigo: 'CONTACTOS_Y_BIOMETRIA',
    });
  });
  it('dirección, ciudad, pagos y biometría fuertes no salvan ambos contactos en cero', () => {
    const d = base();
    d.datos = {
      celular: { reportes: 0, entidades: 0 },
      correo: { reportes: 0, entidades: 0 },
      direccion: { reportes: 30, entidades: 20 },
    };
    d.ciudadesFrecuentes = ['Bogotá'];
    d.historial = { creditosActivos: 4, comprasPrevias: 20, alDia: true };
    expect(evaluar(d).decision).toBe('BLOQUEA');
  });
  it('la mora no se cuenta como historial favorable', () => {
    const d = base();
    d.historial = { creditosActivos: 2, comprasPrevias: 20, alDia: false };
    d.biometria = { disponible: true, proveedor: 'unicus', nivelUnicus: 1 };
    expect(evaluar(d)).toMatchObject({
      decision: 'BLOQUEA',
      evidencia: { historialFavorable: false },
    });
  });
  it('crédito activo al día respalda contactos débiles con Unicus bajo', () => {
    const d = base();
    d.historial = { creditosActivos: 1, alDia: true };
    d.biometria = { disponible: true, proveedor: 'unicus', nivelUnicus: 1 };
    expect(evaluar(d).decision).toBe('PASA');
  });
  it.each(['review', 'resubmission_requested', 'declined'])(
    'Veriff %s con contacto fuerte mantiene revisión humana',
    (estado) => {
      const d = base();
      d.datos!.celular!.reportes = 6;
      d.biometria = { disponible: true, proveedor: 'Veriff', estado };
      expect(evaluar(d).decision).toBe('ALERTA_HUMANA');
    },
  );
  it('Veriff rechazado sin respaldo bloquea', () => {
    const d = base();
    d.biometria = { disponible: true, proveedor: 'veriff', estado: 'declined' };
    expect(evaluar(d)).toMatchObject({
      decision: 'BLOQUEA',
      tipoBloqueo: 'biometria',
    });
  });
  it('si no cargó información se revisa, aunque la biometría esté aprobada', () => {
    const d = base();
    d.datos = undefined;
    d.historial = undefined;
    expect(evaluar(d).decision).toBe('ALERTA_HUMANA');
  });
  it('un cero confirmado no equivale a ausencia completa de información', () => {
    const d: AlertaDto = {
      alerta: base().alerta,
      datos: {
        celular: { reportes: 0, entidades: 0 },
        correo: { reportes: 0, entidades: 0 },
      },
    };
    expect(evaluar(d)).toMatchObject({
      decision: 'BLOQUEA',
      codigo: 'CONTACTOS_SIN_REPORTES',
    });
  });
  it('datos faltantes no se convierten en cero en evidencia', () => {
    const d = base();
    d.datos!.celular = undefined;
    expect(evaluar(d)).toMatchObject({
      decision: 'BLOQUEA',
      evidencia: { celular: { reportes: null, incompleto: true } },
    });
  });
  it('cambio de datos estudia biometría y datos pero conserva revisión humana', () => {
    const d = base();
    d.datos!.celular!.reportes = 6;
    expect(servicio.evaluarCambioDatos(d)).toMatchObject({
      decision: 'ALERTA_HUMANA',
      evaluacionSugerida: { decision: 'PASA' },
      evidencia: { calidadBiometria: 'buena' },
    });
  });
  it.each([999999, 1000000])('umbral estricto por monto %i', (monto) => {
    const d = base();
    d.alerta.monto = monto;
    expect(evaluar(d).evidencia.estricto).toBe(monto >= 1000000);
  });
  it.each([94, 95])('umbral estricto por consumo %i', (consumo_pct) => {
    const d = base();
    d.historial!.consumo_pct = consumo_pct;
    expect(evaluar(d).evidencia.estricto).toBe(consumo_pct >= 95);
  });
  it('Montería con tilde activa modo estricto', () => {
    const d = base();
    d.alerta.ciudadOrigen = 'Montería';
    expect(evaluar(d).evidencia.estricto).toBe(true);
  });
  it.each([-1, NaN, Infinity, 1.5, '6'])(
    'rechaza conteo inválido %s',
    (valor) => {
      const d = base();
      d.datos!.celular!.reportes = valor as number;
      expect(() => evaluar(d)).toThrow(BadRequestException);
    },
  );
  it('rechaza históricos duplicados en lugar de elegir el mayor', () => {
    const d = base();
    d.historialDatos = {
      celulares: [
        registro('3001111111', 1, 1),
        registro('300 111 1111', 30, 40),
      ],
    };
    expect(() => evaluar(d)).toThrow(BadRequestException);
  });
  it('normaliza correo para coincidencia exacta, sin sumar registros', () => {
    const d = base();
    d.datos!.correo!.valor = ' Actual@EXAMPLE.TEST ';
    d.historialDatos = {
      correos: [
        registro('actual@example.test', 6, 1),
        registro('otro@example.test', 30, 20),
      ],
    };
    expect(evaluar(d)).toMatchObject({
      decision: 'PASA',
      evidencia: { correo: { reportes: 6, coincide: true } },
    });
  });
});

describe('Dirección fuerte no sustituye al contacto', () => {
  it('con contactos débiles y Unicus bajo, la dirección fuerte sola no aprueba', () => {
    const d = base();
    d.datos!.direccion = { reportes: 40, entidades: 20 };
    d.biometria = { disponible: true, proveedor: 'unicus', nivelUnicus: 1 };
    expect(evaluar(d).decision).toBe('BLOQUEA');
  });
});
