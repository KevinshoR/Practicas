import { Injectable } from '@nestjs/common';

export interface CambioSensible {
  fechaCambio: string;
  celularAnterior: string;
  celularNuevo: string;
  correoAnterior: string;
  correoNuevo: string;
}

export interface HistoriaConsumoItem {
  estadoCredito: string;
  estadoBloqueo: string;
  cupoConsumido: string;
  balanceCredito: string;
  cantidadPagada: string;
  fechaCompra: string;
  tienda: string;
}

export interface DisparoCompraDto {
  cedula: string;
  valorCredito?: number;
  creCredito?: string;
  transactionId?: string;
  asuntoPersonalizado?: string;
  webhookUrl?: string;
}

export interface CorreoSimulado {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  fecha: string;
  datosExtraidos: {
    cedula: string;
    transactionId: string;
    valorCredito: number;
    creCredito: string;
  };
}

export interface ClienteQuemado {
  cedula: string;
  categoria: 'POSITIVO' | 'MALO' | 'DUDOSO' | 'CAMBIO_DATOS' | 'SIN_INFO';
  etiquetaCaso: string;
  sinInformacion?: boolean;
  // Información del cliente (Tabla 1)
  vinculacion: string;
  nombre: string;
  celularTexto: string;
  correoTexto: string;
  ciudadDepartamento: string;
  motivoBloqueoInicial: string;
  ultimoTipoBloqueo?: 'datos' | 'biometria' | null;
  // Alerta simulada asociada a la solicitud actual
  alerta: {
    transactionId: string;
    tienda: string;
    monto: number;
    tipo: 'onboarding' | 'monitoreo' | 'cambio_datos';
    ciudadOrigen: string;
  };
  // Datos para el motor antifraude (AlertaDto)
  celular: { reportes: number; entidades: number };
  correo: { reportes: number; entidades: number };
  direccion: { reportes: number; descripcion?: string };
  biometria: {
    disponible: boolean;
    proveedor: 'veriff' | 'unicus';
    nivelUnicus?: number;
    estado?: string;
  };
  historial: {
    creditosActivos: number;
    alDia: boolean;
    consumo_pct: number;
    comprasPrevias: number;
  };
  ciudadesFrecuentes: string[];
  // Tabla 2: Cambio de datos sensibles
  cambiosDatosSensibles: CambioSensible[];
  // Tabla 3: Historia del consumo
  historiaConsumo: HistoriaConsumoItem[];
}

const NOMBRES = [
  'Carlos Andrés Gómez Pérez', 'María Fernanda Rodríguez López', 'Juan Sebastián Martínez Castro',
  'Valentina Restrepo Mejía', 'Andrés Felipe Morales Ruiz', 'Laura Sofía Hernández Díaz',
  'Santiago Ramírez Salazar', 'Camila Andrea Torres Vargas', 'Diego Alejandro Ospina Cano',
  'Natalia Jiménez Arango', 'Jorge Eliécer Mendoza Peña', 'Daniela Alejandra Ríos Montoya',
  'Camilo Ernesto Quintero Gil', 'Paula Andrea Cardona Vélez', 'Alejandro José Pineda Sierra',
  'Juliana Marcela Duque Londoño', 'Sebastián David Acosta Guerrero', 'Manuela Giraldo Ochoa',
  'Mauricio Javier Patiño Muñoz', 'Carolina Isabel Navarro Barrios', 'Esteban Darío Álvarez Correa',
  'Gabriela Lucía Castillo Romero', 'Nicolás Fernando Serrano Vega', 'Luisa Fernanda Bermúdez Ortiz',
  'Óscar Iván Delgado Fajardo', 'Mariana Echeverri Palacio', 'Felipe Arturo Valencia Henao',
  'Sara Valentina Castaño Arias', 'Cristian David Hoyos Bedoya', 'Andrea Catalina Parra Molina',
  'Juan Pablo Bustamante Soto', 'Diana Marcela Franco Zapata', 'Miguel Ángel Córdoba Solarte',
  'Lina María Tamayo Botero', 'Héctor Fabio Trujillo Rincón', 'Verónica Agudelo Uribe',
  'David Leonardo Suárez Mora', 'Tatiana Paola Beltrán Cruz', 'Gustavo Adolfo Cárdenas Niño',
  'Alejandra María Velásquez Marín',
];

const TIENDAS = [
  'STOP Jeans Parque Berrío', 'YOYO Centro Comercial Santafé', 'DE-MODA Mayorca',
  'Calzado Rómulo Centro', 'Vélez Viva Envigado', 'Gef Unicentro',
  'Bosi Puerta del Norte', 'Totto Plaza Imperial', 'Koaj Viva Barranquilla',
  'Studio F Mall Plaza', 'Arturo Calle Centro Mayor', 'Tennis Oviedo',
];

const DEPARTAMENTOS: Record<string, string> = {
  Medellin: 'Antioquia',
  Envigado: 'Antioquia',
  Bello: 'Antioquia',
  Bogota: 'Cundinamarca',
  Cali: 'Valle del Cauca',
  Pereira: 'Risaralda',
  Manizales: 'Caldas',
  Bucaramanga: 'Santander',
  Barranquilla: 'Atlántico',
  Cartagena: 'Bolívar',
  'Santa Marta': 'Magdalena',
  Soledad: 'Atlántico',
  Malambo: 'Atlántico',
  Valledupar: 'Cesar',
  Monteria: 'Córdoba',
  Sincelejo: 'Sucre',
  Riohacha: 'La Guajira',
};

const formatoCOP = (valor: number) =>
  '$' + valor.toLocaleString('es-CO', { maximumFractionDigits: 0 });

@Injectable()
export class SumasService {
  private readonly baseDeDatos: Record<string, ClienteQuemado> = {};

  constructor() {
    this.inicializarCasosQuemados();
  }

  private registrar(c: ClienteQuemado) {
    this.baseDeDatos[c.cedula] = c;
  }

  private crearCliente(params: {
    idx: number;
    cedula: string;
    categoria: ClienteQuemado['categoria'];
    etiquetaCaso: string;
    tipo: 'onboarding' | 'monitoreo' | 'cambio_datos';
    monto: number;
    ciudadOrigen: string;
    ciudadesFrecuentes: string[];
    celular: { reportes: number; entidades: number };
    correo: { reportes: number; entidades: number };
    direccionReportes: number;
    biometria: ClienteQuemado['biometria'];
    creditosActivos: number;
    alDia: boolean;
    consumo_pct: number;
    comprasPrevias: number;
    motivoBloqueoInicial?: string;
    conCambioSensible?: boolean;
    sinInformacion?: boolean;
  }): ClienteQuemado {
    const i = params.idx;
    const nombre = NOMBRES[i % NOMBRES.length];
    const tienda = TIENDAS[i % TIENDAS.length];
    const depto = DEPARTAMENTOS[params.ciudadOrigen] ?? 'Colombia';
    const sufijoTel = String(1000000 + ((i * 7919) % 8999999)).padStart(7, '0');
    const celularNum = `31${i % 9}${sufijoTel}`;
    const slugNombre = nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(' ')
      .slice(0, 2)
      .join('.');
    const correoStr = `${slugNombre}${i}@sumascorreo.co`;
    const cupoTotal = Math.max(params.monto + 500000, 2000000);
    const cupoConsumidoVal = Math.round((cupoTotal * params.consumo_pct) / 100);
    const balanceVal = Math.max(0, cupoTotal - cupoConsumidoVal);
    const pagadoVal = params.comprasPrevias * 320000;

    const cambiosDatosSensibles: CambioSensible[] =
      params.conCambioSensible || params.tipo === 'cambio_datos'
        ? [
            {
              fechaCambio: `2026-11-0${(i % 5) + 1} 14:${String((i * 7) % 60).padStart(2, '0')}`,
              celularAnterior: `300${String(2000000 + i * 1234).slice(0, 7)}`,
              celularNuevo: celularNum,
              correoAnterior: `anterior.${slugNombre}@mail.com`,
              correoNuevo: correoStr,
            },
          ]
        : [];

    const historiaConsumo: HistoriaConsumoItem[] =
      params.sinInformacion
        ? []
        : [
            {
              estadoCredito:
                params.creditosActivos > 0
                  ? params.alDia
                    ? `Al día (${params.creditosActivos} activo${params.creditosActivos > 1 ? 's' : ''})`
                    : `En mora (${params.creditosActivos} activo${params.creditosActivos > 1 ? 's' : ''})`
                  : 'Nuevo / Sin créditos activos',
              estadoBloqueo:
                params.motivoBloqueoInicial && params.motivoBloqueoInicial !== 'Sin bloqueo'
                  ? 'Bloqueo preventivo'
                  : 'Sin bloqueo',
              cupoConsumido: `${formatoCOP(cupoConsumidoVal)} (${params.consumo_pct}%)`,
              balanceCredito: formatoCOP(balanceVal),
              cantidadPagada: `${formatoCOP(pagadoVal)} (${params.comprasPrevias} compras)`,
              fechaCompra: `2026-11-0${(i % 6) + 1} 10:${String((i * 11) % 60).padStart(2, '0')}`,
              tienda,
            },
          ];

    return {
      cedula: params.cedula,
      categoria: params.categoria,
      etiquetaCaso: params.etiquetaCaso,
      sinInformacion: params.sinInformacion ?? false,
      vinculacion:
        params.tipo === 'onboarding'
          ? 'Onboarding Digital (Nuevo)'
          : `Cliente Vinculado (${2021 + (i % 4)}-0${(i % 8) + 1}-15)`,
      nombre,
      celularTexto: celularNum,
      correoTexto: correoStr,
      ciudadDepartamento: `${params.ciudadOrigen} / ${depto}`,
      motivoBloqueoInicial: params.motivoBloqueoInicial ?? 'Sin bloqueo',
      ultimoTipoBloqueo: null,
      alerta: {
        transactionId: `TXN-${10000 + i}`,
        tienda,
        monto: params.monto,
        tipo: params.tipo,
        ciudadOrigen: params.ciudadOrigen,
      },
      celular: params.celular,
      correo: params.correo,
      direccion: {
        reportes: params.direccionReportes,
        descripcion: `Calle ${10 + (i % 80)} # ${20 + (i % 50)}-${10 + (i % 40)}, ${params.ciudadOrigen}`,
      },
      biometria: params.biometria,
      historial: {
        creditosActivos: params.creditosActivos,
        alDia: params.alDia,
        consumo_pct: params.consumo_pct,
        comprasPrevias: params.comprasPrevias,
      },
      ciudadesFrecuentes: params.ciudadesFrecuentes,
      cambiosDatosSensibles,
      historiaConsumo,
    };
  }

  private inicializarCasosQuemados() {
    let idx = 1;

    // =========================================================================
    // 0. CASOS CLÁSICOS + PERFILES EXACTOS DE MONITOREO (PUNTO 4)
    // =========================================================================

    // Perfil 1: Cliente limpio (PASA) — conservando 1001001001 y 3003003003
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '1001001001',
        categoria: 'POSITIVO',
        etiquetaCaso: 'Positivo Estricto — Unicus 7 + Historial Sólido ($1.5M)',
        tipo: 'onboarding',
        monto: 1500000,
        ciudadOrigen: 'Medellin',
        ciudadesFrecuentes: ['Medellin', 'Bogota'],
        celular: { reportes: 8, entidades: 4 },
        correo: { reportes: 5, entidades: 3 },
        direccionReportes: 4,
        biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 7, estado: 'Aprobado' },
        creditosActivos: 5,
        alDia: true,
        consumo_pct: 45,
        comprasPrevias: 6,
      }),
    );

    // Perfil 2: 0-0 en celular y correo (BLOQUEA) — conservando 2002002002
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '2002002002',
        categoria: 'MALO',
        etiquetaCaso: 'Bloqueo 0-0 — Celular y Correo en 0-0',
        tipo: 'monitoreo',
        monto: 350000,
        ciudadOrigen: 'Cali',
        ciudadesFrecuentes: ['Cali'],
        celular: { reportes: 0, entidades: 0 },
        correo: { reportes: 0, entidades: 0 },
        direccionReportes: 0,
        biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
        creditosActivos: 0,
        alDia: false,
        consumo_pct: 20,
        comprasPrevias: 0,
        motivoBloqueoInicial: 'Alerta 0-0 en centrales',
      }),
    );

    // Perfil 1 (Monitoreo estándar limpio): conservando 3003003003 (PASA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '3003003003',
        categoria: 'POSITIVO',
        etiquetaCaso: 'Positivo Monitoreo — Unicus 5 + Datos 2-1 y 1-1',
        tipo: 'monitoreo',
        monto: 420000,
        ciudadOrigen: 'Medellin',
        ciudadesFrecuentes: ['Medellin'],
        celular: { reportes: 2, entidades: 1 },
        correo: { reportes: 1, entidades: 1 },
        direccionReportes: 1,
        biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 5, estado: 'Aprobado' },
        creditosActivos: 1,
        alDia: true,
        consumo_pct: 35,
        comprasPrevias: 2,
      }),
    );

    // Perfil 3: Un dato principal en 0 con respaldo (PASA) — conservando 4004004004
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '4004004004',
        categoria: 'POSITIVO',
        etiquetaCaso: 'Positivo con Respaldo — Celular en 0 pero Correo 4-2 + Historial',
        tipo: 'monitoreo',
        monto: 600000,
        ciudadOrigen: 'Envigado',
        ciudadesFrecuentes: ['Envigado', 'Bello'],
        celular: { reportes: 0, entidades: 0 },
        correo: { reportes: 4, entidades: 2 },
        direccionReportes: 5,
        biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
        creditosActivos: 4,
        alDia: true,
        consumo_pct: 50,
        comprasPrevias: 4,
      }),
    );

    // Perfil 4: Un dato en 0 sin respaldo (BLOQUEA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '5005005005',
        categoria: 'MALO',
        etiquetaCaso: 'Bloqueo — Correo en 0 sin respaldo de ubicación ni historial',
        tipo: 'monitoreo',
        monto: 480000,
        ciudadOrigen: 'Pereira',
        ciudadesFrecuentes: ['Medellin'],
        celular: { reportes: 3, entidades: 2 },
        correo: { reportes: 0, entidades: 0 },
        direccionReportes: 0,
        biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
        creditosActivos: 0,
        alDia: false,
        consumo_pct: 30,
        comprasPrevias: 0,
        motivoBloqueoInicial: 'Un dato principal en 0 sin respaldo suficiente',
      }),
    );

    // Perfil 5: Consumo de 96 con Unicus 7 (PASA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '6006006006',
        categoria: 'POSITIVO',
        etiquetaCaso: 'Positivo Modo Estricto — Consumo 96% con Unicus 7',
        tipo: 'monitoreo',
        monto: 500000,
        ciudadOrigen: 'Medellin',
        ciudadesFrecuentes: ['Medellin'],
        celular: { reportes: 5, entidades: 3 },
        correo: { reportes: 4, entidades: 2 },
        direccionReportes: 3,
        biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 7, estado: 'Aprobado' },
        creditosActivos: 2,
        alDia: true,
        consumo_pct: 96,
        comprasPrevias: 4,
      }),
    );

    // Perfil 6: Consumo de 96 con Unicus 6 y sin respaldo (BLOQUEA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '7007007007',
        categoria: 'MALO',
        etiquetaCaso: 'Bloqueo Modo Estricto — Consumo 96% con Unicus 6 sin respaldo',
        tipo: 'monitoreo',
        monto: 500000,
        ciudadOrigen: 'Cali',
        ciudadesFrecuentes: ['Bogota'],
        celular: { reportes: 3, entidades: 2 },
        correo: { reportes: 2, entidades: 1 },
        direccionReportes: 0,
        biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 6, estado: 'Aprobado' },
        creditosActivos: 1,
        alDia: false,
        consumo_pct: 96,
        comprasPrevias: 0,
        motivoBloqueoInicial: 'Modo estricto (consumo >= 95%) con Unicus 6 sin respaldo',
      }),
    );

    // Perfil 7: Sin biometría (disponible: false -> en reintento evalúa 2-2 y PASA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '8008008008',
        categoria: 'POSITIVO',
        etiquetaCaso: 'Sin Biometría con 2-2 en Celular y Correo (Pendiente -> Reintento PASA)',
        tipo: 'monitoreo',
        monto: 390000,
        ciudadOrigen: 'Medellin',
        ciudadesFrecuentes: ['Medellin'],
        celular: { reportes: 3, entidades: 2 },
        correo: { reportes: 3, entidades: 2 },
        direccionReportes: 2,
        biometria: { disponible: false, proveedor: 'veriff', estado: 'No realizada' },
        creditosActivos: 2,
        alDia: true,
        consumo_pct: 30,
        comprasPrevias: 3,
      }),
    );

    // Perfil 8: Veriff rechazado con respaldo (ALERTA_HUMANA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '9009009009',
        categoria: 'DUDOSO',
        etiquetaCaso: 'Alerta Humana — Veriff Rechazado (declined) con Respaldo de Historial',
        tipo: 'monitoreo',
        monto: 650000,
        ciudadOrigen: 'Medellin',
        ciudadesFrecuentes: ['Medellin', 'Envigado'],
        celular: { reportes: 5, entidades: 3 },
        correo: { reportes: 4, entidades: 3 },
        direccionReportes: 3,
        biometria: { disponible: true, proveedor: 'veriff', estado: 'declined' },
        creditosActivos: 3,
        alDia: true,
        consumo_pct: 45,
        comprasPrevias: 5,
        motivoBloqueoInicial: 'Biometría rechazada con respaldo de historial',
      }),
    );

    // Perfil 9: Veriff en revisión (ALERTA_HUMANA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '1100110011',
        categoria: 'DUDOSO',
        etiquetaCaso: 'Alerta Humana — Veriff en Revisión (review)',
        tipo: 'monitoreo',
        monto: 550000,
        ciudadOrigen: 'Bogota',
        ciudadesFrecuentes: ['Bogota'],
        celular: { reportes: 4, entidades: 2 },
        correo: { reportes: 3, entidades: 2 },
        direccionReportes: 2,
        biometria: { disponible: true, proveedor: 'veriff', estado: 'review' },
        creditosActivos: 2,
        alDia: true,
        consumo_pct: 50,
        comprasPrevias: 3,
        motivoBloqueoInicial: 'Biometría en revisión por proveedor',
      }),
    );

    // Perfil 10: Ciudad de revisión reforzada con Unicus 6 y sin respaldo (BLOQUEA)
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '1200120012',
        categoria: 'MALO',
        etiquetaCaso: 'Bloqueo — Ciudad de Revisión Reforzada (Barranquilla) con Unicus 6 sin respaldo',
        tipo: 'monitoreo',
        monto: 620000,
        ciudadOrigen: 'Barranquilla',
        ciudadesFrecuentes: [],
        celular: { reportes: 3, entidades: 2 },
        correo: { reportes: 2, entidades: 2 },
        direccionReportes: 0,
        biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 6, estado: 'Aprobado' },
        creditosActivos: 0,
        alDia: false,
        consumo_pct: 50,
        comprasPrevias: 0,
        motivoBloqueoInicial: 'Ciudad de revisión reforzada con Unicus 6 sin respaldo',
      }),
    );

    // Caso de la captura de pantalla ("108761xxx") -> Sin información
    this.registrar(
      this.crearCliente({
        idx: idx++,
        cedula: '108761000',
        categoria: 'SIN_INFO',
        etiquetaCaso: 'Sin información en centrales (Caso captura 108761xxx)',
        tipo: 'monitoreo',
        monto: 300000,
        ciudadOrigen: 'Medellin',
        ciudadesFrecuentes: [],
        celular: { reportes: 0, entidades: 0 },
        correo: { reportes: 0, entidades: 0 },
        direccionReportes: 0,
        biometria: { disponible: false, proveedor: 'veriff', estado: 'Sin registro' },
        creditosActivos: 0,
        alDia: false,
        consumo_pct: 0,
        comprasPrevias: 0,
        sinInformacion: true,
        motivoBloqueoInicial: 'Sin información',
      }),
    );

    // =========================================================================
    // 1. CASOS POSITIVOS (PASA) — 40 CASOS (Cédulas 1010000001 a 1010000040)
    // =========================================================================
    const ciudadesNormales = ['Medellin', 'Bogota', 'Cali', 'Pereira', 'Manizales', 'Bucaramanga', 'Envigado', 'Bello'];
    const ciudadesReforzadas = ['Barranquilla', 'Cartagena', 'Santa Marta', 'Valledupar', 'Monteria', 'Sincelejo', 'Riohacha'];

    for (let n = 1; n <= 40; n++) {
      const cedula = `10100000${String(n).padStart(2, '0')}`;
      const ciudad = ciudadesNormales[n % ciudadesNormales.length];

      if (n <= 12) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'POSITIVO',
            etiquetaCaso: `PASA #${n} — Monitoreo Normal (${n % 2 === 0 ? 'Veriff Aprobado' : 'Unicus ' + (5 + (n % 3))})`,
            tipo: 'monitoreo',
            monto: 250000 + n * 25000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad, 'Bogota'],
            celular: { reportes: 2 + (n % 6), entidades: 1 + (n % 4) },
            correo: { reportes: 1 + (n % 5), entidades: 1 + (n % 3) },
            direccionReportes: 1 + (n % 4),
            biometria:
              n % 2 === 0
                ? { disponible: true, proveedor: 'veriff', estado: 'Aprobado' }
                : { disponible: true, proveedor: 'unicus', nivelUnicus: 5 + (n % 3), estado: 'Aprobado' },
            creditosActivos: 1 + (n % 3),
            alDia: true,
            consumo_pct: 25 + n * 3,
            comprasPrevias: 1 + (n % 5),
          }),
        );
      } else if (n <= 20) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'POSITIVO',
            etiquetaCaso: `PASA #${n} — Modo Estricto Superado ($${(1000000 + n * 50000).toLocaleString('es-CO')})`,
            tipo: n % 2 === 0 ? 'onboarding' : 'monitoreo',
            monto: 1000000 + n * 50000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 4 + (n % 5), entidades: 2 + (n % 3) },
            correo: { reportes: 3 + (n % 4), entidades: 2 + (n % 2) },
            direccionReportes: 2 + (n % 3),
            biometria:
              n % 2 === 0
                ? { disponible: true, proveedor: 'unicus', nivelUnicus: 7, estado: 'Aprobado' }
                : { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
            creditosActivos: 2 + (n % 4),
            alDia: true,
            consumo_pct: n % 3 === 0 ? 96 : 55,
            comprasPrevias: 3 + (n % 4),
          }),
        );
      } else if (n <= 28) {
        const ciudadZona = ciudadesReforzadas[n % ciudadesReforzadas.length];
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'POSITIVO',
            etiquetaCaso: `PASA #${n} — Zona Reforzada (${ciudadZona}) con Biometría Buena`,
            tipo: 'monitoreo',
            monto: 480000 + n * 10000,
            ciudadOrigen: ciudadZona,
            ciudadesFrecuentes: [ciudadZona],
            celular: { reportes: 5, entidades: 3 },
            correo: { reportes: 3, entidades: 2 },
            direccionReportes: 2,
            biometria:
              n % 2 === 0
                ? { disponible: true, proveedor: 'unicus', nivelUnicus: 7, estado: 'Aprobado' }
                : { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
            creditosActivos: 2,
            alDia: true,
            consumo_pct: 40,
            comprasPrevias: 3,
          }),
        );
      } else if (n <= 34) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'POSITIVO',
            etiquetaCaso: `PASA #${n} — Sin Biometría pero cumple regla 2-2 en Celular y Correo`,
            tipo: 'monitoreo',
            monto: 390000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 3 + (n % 3), entidades: 2 + (n % 2) },
            correo: { reportes: 2 + (n % 3), entidades: 2 + (n % 2) },
            direccionReportes: 2,
            biometria:
              n % 2 === 0
                ? { disponible: false, proveedor: 'veriff', estado: 'No realizada' }
                : { disponible: true, proveedor: 'veriff', estado: 'expired' },
            creditosActivos: 2,
            alDia: true,
            consumo_pct: 30,
            comprasPrevias: 2,
          }),
        );
      } else {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'POSITIVO',
            etiquetaCaso: `PASA #${n} — Biometría Baja (Unicus 4) respaldada por Historial y Ciudad`,
            tipo: 'monitoreo',
            monto: 310000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 3, entidades: 2 },
            correo: { reportes: n % 2 === 0 ? 0 : 2, entidades: n % 2 === 0 ? 0 : 1 },
            direccionReportes: 3,
            biometria:
              n % 2 === 0
                ? { disponible: true, proveedor: 'veriff', estado: 'Aprobado' }
                : { disponible: true, proveedor: 'unicus', nivelUnicus: 4, estado: 'Aprobado' },
            creditosActivos: 2,
            alDia: true,
            consumo_pct: 45,
            comprasPrevias: 4,
          }),
        );
      }
    }

    // =========================================================================
    // 2. CASOS MALOS / BLOQUEA — 40 CASOS (Cédulas 2020000001 a 2020000040)
    // =========================================================================
    for (let n = 1; n <= 40; n++) {
      const cedula = `20200000${String(n).padStart(2, '0')}`;
      const ciudad = ciudadesNormales[n % ciudadesNormales.length];
      const ciudadZona = ciudadesReforzadas[n % ciudadesReforzadas.length];

      if (n <= 10) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'MALO',
            etiquetaCaso: `BLOQUEA #${n} — Regla 0-0 (Celular 0-0 y Correo 0-0)`,
            tipo: n % 2 === 0 ? 'onboarding' : 'monitoreo',
            monto: 300000 + n * 40000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 0, entidades: 0 },
            correo: { reportes: 0, entidades: 0 },
            direccionReportes: 0,
            biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
            creditosActivos: 0,
            alDia: false,
            consumo_pct: 10,
            comprasPrevias: 0,
            motivoBloqueoInicial: 'Celular y correo sin reportes (0-0)',
          }),
        );
      } else if (n <= 20) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'MALO',
            etiquetaCaso: `BLOQUEA #${n} — Onboarding con reportes insuficientes (${n % 2 === 0 ? '2 y 2' : '4 y 0'})`,
            tipo: 'onboarding',
            monto: 450000 + n * 20000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [],
            celular: n % 2 === 0 ? { reportes: 2, entidades: 2 } : { reportes: 4, entidades: 2 },
            correo: n % 2 === 0 ? { reportes: 2, entidades: 2 } : { reportes: 0, entidades: 0 },
            direccionReportes: 1,
            biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
            creditosActivos: 0,
            alDia: true,
            consumo_pct: 0,
            comprasPrevias: 0,
            motivoBloqueoInicial: 'Onboarding sin reportes mínimos requeridos',
          }),
        );
      } else if (n <= 28) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'MALO',
            etiquetaCaso: `BLOQUEA #${n} — Sin Biometría y no cumple 2-2 (Celular 2-1)`,
            tipo: 'monitoreo',
            monto: 520000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 2, entidades: 1 },
            correo: { reportes: 2, entidades: 2 },
            direccionReportes: 1,
            biometria:
              n % 2 === 0
                ? { disponible: false, proveedor: 'veriff', estado: 'Sin biometría' }
                : { disponible: true, proveedor: 'veriff', estado: 'abandoned' },
            creditosActivos: 1,
            alDia: true,
            consumo_pct: 40,
            comprasPrevias: 1,
            motivoBloqueoInicial: 'Sin biometría; celular o correo no cumplen 2-2',
          }),
        );
      } else if (n <= 35) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'MALO',
            etiquetaCaso: `BLOQUEA #${n} — Biometría ${n % 2 === 0 ? 'Rechazada (Veriff)' : 'Insuficiente en Zona Reforzada (Unicus 6)'} sin respaldo`,
            tipo: 'monitoreo',
            monto: 680000,
            ciudadOrigen: ciudadZona,
            ciudadesFrecuentes: [],
            celular: { reportes: 3, entidades: 2 },
            correo: { reportes: 2, entidades: 2 },
            direccionReportes: 0,
            biometria:
              n % 2 === 0
                ? { disponible: true, proveedor: 'veriff', estado: 'declined' }
                : { disponible: true, proveedor: 'unicus', nivelUnicus: 6, estado: 'Aprobado' },
            creditosActivos: 0,
            alDia: false,
            consumo_pct: 50,
            comprasPrevias: 0,
            motivoBloqueoInicial: 'Biometría rechazada/baja sin respaldo suficiente',
          }),
        );
      } else {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'MALO',
            etiquetaCaso: `BLOQUEA #${n} — Correo en 0 sin respaldo de ubicación ni historial`,
            tipo: 'monitoreo',
            monto: 590000,
            ciudadOrigen: 'Cartagena',
            ciudadesFrecuentes: ['Medellin'],
            celular: { reportes: 3, entidades: 2 },
            correo: { reportes: 0, entidades: 0 },
            direccionReportes: 0,
            biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
            creditosActivos: 0,
            alDia: false,
            consumo_pct: 30,
            comprasPrevias: 0,
            motivoBloqueoInicial: 'Un dato principal en 0 sin respaldo suficiente',
          }),
        );
      }
    }

    // =========================================================================
    // 3. CASOS DUDOSOS / ALERTA_HUMANA — 35 CASOS (Cédulas 3030000001 a 3030000035)
    // =========================================================================
    for (let n = 1; n <= 35; n++) {
      const cedula = `30300000${String(n).padStart(2, '0')}`;
      const ciudad = ciudadesNormales[n % ciudadesNormales.length];

      if (n <= 12) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'DUDOSO',
            etiquetaCaso: `ALERTA HUMANA #${n} — Biometría en Revisión (${n % 2 === 0 ? 'Veriff review' : 'resubmission_requested'})`,
            tipo: 'monitoreo',
            monto: 750000 + n * 30000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 4, entidades: 2 },
            correo: { reportes: 3, entidades: 2 },
            direccionReportes: 2,
            biometria: {
              disponible: true,
              proveedor: 'veriff',
              estado: n % 2 === 0 ? 'review' : 'resubmission_requested',
            },
            creditosActivos: 2,
            alDia: true,
            consumo_pct: 60,
            comprasPrevias: 2,
            motivoBloqueoInicial: 'En cola de revisión humana (Biometría dudosa)',
          }),
        );
      } else if (n <= 24) {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'DUDOSO',
            etiquetaCaso: `ALERTA HUMANA #${n} — Veriff Rechazado pero Cliente con Historial Favorable`,
            tipo: 'monitoreo',
            monto: 920000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad, 'Medellin'],
            celular: { reportes: 5, entidades: 3 },
            correo: { reportes: 4, entidades: 3 },
            direccionReportes: 3,
            biometria: { disponible: true, proveedor: 'veriff', estado: 'declined' },
            creditosActivos: 3,
            alDia: true,
            consumo_pct: 48,
            comprasPrevias: 5,
            motivoBloqueoInicial: 'Biometría rechazada con respaldo de historial',
          }),
        );
      } else {
        this.registrar(
          this.crearCliente({
            idx: idx++,
            cedula,
            categoria: 'CAMBIO_DATOS',
            etiquetaCaso: `ALERTA HUMANA #${n} — Cambio de Datos Sensibles (Validar línea activa)`,
            tipo: 'cambio_datos',
            monto: 540000 + n * 15000,
            ciudadOrigen: ciudad,
            ciudadesFrecuentes: [ciudad],
            celular: { reportes: 4, entidades: 2 },
            correo: { reportes: 3, entidades: 2 },
            direccionReportes: 2,
            biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 6, estado: 'Aprobado' },
            creditosActivos: 2,
            alDia: true,
            consumo_pct: 55,
            comprasPrevias: 3,
            conCambioSensible: true,
            motivoBloqueoInicial: 'Validación manual por cambio de celular/correo',
          }),
        );
      }
    }
  }

  /**
   * Verifica si una cédula existe realmente como cliente registrado en el mock
   * (y no es el caso especial de "sinInformacion")
   */
  existeClienteEnSistema(cedula: string): boolean {
    const limpio = String(cedula ?? '').trim();
    const cliente = this.baseDeDatos[limpio];
    return Boolean(cliente && !cliente.sinInformacion);
  }

  listarClientes() {
    return Object.values(this.baseDeDatos).map((c) => ({
      cedula: c.cedula,
      nombre: c.nombre,
      categoria: c.categoria,
      etiquetaCaso: c.etiquetaCaso,
      tipo: c.alerta.tipo,
      monto: c.alerta.monto,
      ciudadOrigen: c.alerta.ciudadOrigen,
      sinInformacion: Boolean(c.sinInformacion),
    }));
  }

  obtenerDatosCliente(cedula: string) {
    const limpio = String(cedula ?? '').trim();
    const cliente = this.baseDeDatos[limpio];
    if (!cliente) {
      return {
        cedula: limpio || 'Sin documento',
        categoria: 'SIN_INFO',
        etiquetaCaso: 'Documento sin registros en Sumas para ti',
        sinInformacion: true,
        vinculacion: 'Sin registro',
        nombre: 'Sin información',
        celularTexto: 'Sin información',
        correoTexto: 'Sin información',
        ciudadDepartamento: 'Sin información',
        motivoBloqueoInicial: 'Sin información',
        ultimoTipoBloqueo: null,
        alerta: {
          transactionId: `TXN-${Date.now().toString().slice(-5)}`,
          tienda: 'Simulador Sumas',
          monto: 0,
          tipo: 'monitoreo',
          ciudadOrigen: 'Medellin',
        },
        celular: { reportes: 0, entidades: 0 },
        correo: { reportes: 0, entidades: 0 },
        direccion: { reportes: 0, descripcion: 'Sin dirección registrada' },
        biometria: { disponible: false, proveedor: 'veriff', estado: 'Sin información' },
        historial: { creditosActivos: 0, alDia: false, consumo_pct: 0, comprasPrevias: 0 },
        ciudadesFrecuentes: [],
        cambiosDatosSensibles: [],
        historiaConsumo: [],
      };
    }
    return cliente;
  }

  actualizarEstadoCliente(payload: {
    cedula: string;
    decision: string;
    motivo: string;
    transactionId?: string;
    tipoBloqueo?: 'datos' | 'biometria' | null;
  }) {
    const cliente = this.baseDeDatos[payload.cedula];
    if (cliente) {
      cliente.ultimoTipoBloqueo = payload.tipoBloqueo ?? null;
      const etiquetaTipo = payload.tipoBloqueo ? ` [${payload.tipoBloqueo}]` : '';
      cliente.motivoBloqueoInicial =
        payload.decision === 'PASA'
          ? 'Aprobado / Sin bloqueo'
          : `${payload.decision}${etiquetaTipo}: ${payload.motivo}`;
      if (cliente.historiaConsumo.length > 0) {
        cliente.historiaConsumo[0].estadoBloqueo =
          payload.decision === 'PASA'
            ? 'Desbloqueado / Aprobado'
            : `Bloqueo (${payload.decision}${etiquetaTipo})`;
      }
    }
    return cliente;
  }

  // ===========================================================================
  // DISPARADOR INTERNO DE ALERTAS DE COMPRA -> CORREO MONITOREO (HACIA N8N)
  // ===========================================================================

  construirCorreoAlerta(dto: DisparoCompraDto): CorreoSimulado {
    const limpio = String(dto.cedula ?? '').trim();
    const clienteRegistrado = this.baseDeDatos[limpio];
    const valorCredito =
      dto.valorCredito ?? (clienteRegistrado ? clienteRegistrado.alerta.monto : 450000);
    const transactionId =
      dto.transactionId || `TXN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const creCredito =
      dto.creCredito || `CRE-${Math.floor(100000 + Math.random() * 900000)}`;

    const subject =
      dto.asuntoPersonalizado ||
      `Alerta de Monitoreo Transaccional - Crédito ${creCredito} - Tx ${transactionId}`;

    const text = [
      'Notificación automática del Disparador Transaccional Sumas:',
      `Cédula: ${limpio}`,
      `Transacción: ${transactionId}`,
      `Valor Crédito: ${valorCredito}`,
      `CRE Crédito: ${creCredito}`,
    ].join('\n');

    const html = `
      <div>
        <h3>Alerta de Monitoreo Transaccional - Sumas</h3>
        <ul>
          <li><strong>Cédula:</strong> ${limpio}</li>
          <li><strong>Transacción:</strong> ${transactionId}</li>
          <li><strong>Valor Crédito:</strong> ${valorCredito}</li>
          <li><strong>CRE Crédito:</strong> ${creCredito}</li>
        </ul>
      </div>
    `.trim();

    return {
      from: 'disparador-transaccional@sumas.local',
      to: 'monitoreo@sumas.local',
      subject,
      text,
      html,
      fecha: new Date().toISOString(),
      datosExtraidos: {
        cedula: limpio,
        transactionId,
        valorCredito,
        creCredito,
      },
    };
  }

  async dispararAlertaCorreo(dto: DisparoCompraDto) {
    const correo = this.construirCorreoAlerta(dto);
    const webhookUrl =
      dto.webhookUrl ||
      process.env.N8N_WEBHOOK_URL ||
      'http://[::1]:5678/webhook/correo-monitoreo';

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(correo),
      });

      const respuestaTexto = await res.text();
      let respuestaN8n: unknown = respuestaTexto;
      try {
        respuestaN8n = JSON.parse(respuestaTexto);
      } catch {
        // Dejar como texto plano si n8n no devolvió JSON
      }

      return {
        enviadoAN8n: res.ok,
        statusN8n: res.status,
        webhookUrl,
        correo,
        respuestaN8n,
      };
    } catch (error) {
      return {
        enviadoAN8n: false,
        webhookUrl,
        error: (error as Error).message,
        nota: 'n8n no respondió en el webhook indicado, pero el correo simulado fue generado correctamente.',
        correo,
      };
    }
  }

  async dispararLotePerfilesPrueba(webhookUrl?: string) {
    const cedulasPrueba = [
      '1001001001', // Limpio (Unicus 7) -> PASA
      '2002002002', // 0-0 celular y correo -> BLOQUEA
      '4004004004', // Dato en 0 con respaldo -> PASA
      '5005005005', // Dato en 0 sin respaldo -> BLOQUEA
      '6006006006', // Consumo 96 con Unicus 7 -> PASA
      '7007007007', // Consumo 96 con Unicus 6 sin respaldo -> BLOQUEA
      '8008008008', // Sin biometría con 2-2 -> Pendiente / Reintento PASA
      '9009009009', // Veriff rechazado con respaldo -> ALERTA_HUMANA
      '1100110011', // Veriff en revisión -> ALERTA_HUMANA
      '1200120012', // Ciudad reforzada con Unicus 6 sin respaldo -> BLOQUEA
    ];

    const resultados = [];
    for (const cedula of cedulasPrueba) {
      const resultado = await this.dispararAlertaCorreo({ cedula, webhookUrl });
      resultados.push(resultado);
    }

    return {
      totalDisparados: resultados.length,
      resultados,
    };
  }
}