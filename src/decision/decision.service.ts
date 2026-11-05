import { Injectable } from '@nestjs/common';
import { AlertaDto } from './alerta.dto';

@Injectable()
export class DecisionService {
  // Lista de zonas con alto índice de fraude
  private readonly CIUDADES_ZONA_ROJA = ['barranquilla', 'cartagena', 'santa marta', 'soledad', 'malambo', 'valledupar', 'monteria', 'sincelejo', 'riohacha'];

  evaluarRiesgo(dto: AlertaDto, proceso: string) {
    const { alerta, datos, biometria, historial, ciudadesFrecuentes } = dto;
    const ciudadOrigen = alerta?.ciudadOrigen ? alerta.ciudadOrigen.toLowerCase() : '';
    const monto = alerta?.monto || 0;

    // 1. Determinar si requiere MODO ESTRICTO
    let esModoEstricto = false;
    let motivoEstricto = '';

    if (proceso === 'onboarding' || monto >= 1000000) {
      esModoEstricto = true; motivoEstricto = 'Monto alto o proceso de Onboarding.';
    } else if (this.CIUDADES_ZONA_ROJA.includes(ciudadOrigen)) {
      esModoEstricto = true; motivoEstricto = `Transacción desde Zona Roja (${alerta.ciudadOrigen}).`;
    } else if (ciudadesFrecuentes && ciudadesFrecuentes.length > 0 && !ciudadesFrecuentes.map(c => c.toLowerCase()).includes(ciudadOrigen)) {
      esModoEstricto = true; motivoEstricto = 'Ciudad de origen no coincide con el historial del cliente.';
    }

    // 2. Extraer puntajes de la matriz
    const repCelular = datos?.celular?.reportes || 0;
    const repCorreo = datos?.correo?.reportes || 0;
    const repDireccion = datos?.direccion?.reportes || 0;
    const credActivos = historial?.creditosActivos || 0;

    // 3. Evaluar Biometría
    const tieneBiometria = biometria?.disponible;
    const esVeriffAprobado = biometria?.proveedor === 'veriff' && biometria?.estado === 'Aprobado';
    const nivelUnicus = biometria?.nivelUnicus || 0;
    
    const biometriaPerfecta = esVeriffAprobado || (biometria?.proveedor === 'unicus' && nivelUnicus === 7);
    const biometriaAceptable = esVeriffAprobado || (biometria?.proveedor === 'unicus' && nivelUnicus >= 6);

    // --- LÓGICA MODO ESTRICTO ---
    if (esModoEstricto) {
      if (!tieneBiometria) return { decision: 'BLOQUEA', motivo: 'Modo Estricto: Falta biometría. ' + motivoEstricto };
      if (!biometriaPerfecta) return { decision: 'ALERTA_HUMANA', motivo: 'Modo Estricto: Biometría dudosa, requiere revisión humana. ' + motivoEstricto };

      // Contar apoyos fuertes (>=3 reportes/créditos)
      let apoyosFuertes = 0;
      if (repCelular >= 3) apoyosFuertes++;
      if (repCorreo >= 3) apoyosFuertes++;
      if (repDireccion >= 3) apoyosFuertes++;
      if (credActivos >= 3 && historial?.alDia) apoyosFuertes++;

      if (apoyosFuertes >= 2) {
        return { decision: 'PASA', motivo: `Modo Estricto superado. Biometría perfecta y ${apoyosFuertes} datos de respaldo fuertes. ` + motivoEstricto };
      } else {
        return { decision: 'BLOQUEA', motivo: `Modo Estricto: Biometría perfecta pero insuficientes datos de respaldo. ` + motivoEstricto };
      }
    }

    // --- LÓGICA MODO NORMAL ---
    if (repCelular === 0 && repCorreo === 0) {
      if (repDireccion === 0 && credActivos === 0) {
         return { decision: 'BLOQUEA', motivo: 'Bloqueo 0-0: No hay datos en celular, correo, dirección ni historial (Esperar 3 mins y reintentar).' };
      }
    }

    if (tieneBiometria && !biometriaAceptable) {
       return { decision: 'ALERTA_HUMANA', motivo: 'Biometría no aprobó el mínimo aceptable (Nivel < 6 o no aprobado).' };
    }

    if (repCelular > 0 || repCorreo > 0 || repDireccion > 0 || (credActivos > 0 && historial?.alDia)) {
       return { decision: 'PASA', motivo: 'Monitoreo Normal: Datos suficientes y sin anomalías de ubicación.' };
    }

    return { decision: 'BLOQUEA', motivo: 'No hay suficientes datos de confianza para aprobar.' };
  }
}
