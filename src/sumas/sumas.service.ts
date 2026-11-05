import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class SumasService {
  private readonly baseDeDatos: Record<string, any> = {
    '1001001001': { 
      cedula: '1001001001', celular: { reportes: 8, entidades: 4 }, correo: { reportes: 5, entidades: 3 }, direccion: { reportes: 4 },
      biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 7, estado: 'Aprobado' },
      historial: { creditosActivos: 5, alDia: true }, ciudadesFrecuentes: ['Medellin', 'Bogota']
    },
    '2002002002': { 
      cedula: '2002002002', celular: { reportes: 0, entidades: 0 }, correo: { reportes: 0, entidades: 0 }, direccion: { reportes: 0 },
      biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
      historial: { creditosActivos: 0, alDia: false }, ciudadesFrecuentes: ['Cali']
    },
    '3003003003': { 
      cedula: '3003003003', celular: { reportes: 2, entidades: 1 }, correo: { reportes: 1, entidades: 1 }, direccion: { reportes: 1 },
      biometria: { disponible: true, proveedor: 'unicus', nivelUnicus: 5, estado: 'Aprobado' }, 
      historial: { creditosActivos: 1, alDia: true }, ciudadesFrecuentes: ['Medellin']
    },
    '4004004004': { 
      cedula: '4004004004', celular: { reportes: 0, entidades: 0 }, correo: { reportes: 4, entidades: 2 }, direccion: { reportes: 5 },
      biometria: { disponible: true, proveedor: 'veriff', estado: 'Aprobado' },
      historial: { creditosActivos: 4, alDia: true }, ciudadesFrecuentes: ['Envigado', 'Bello']
    }
  };

  obtenerDatosCliente(cedula: string) {
    const cliente = this.baseDeDatos[cedula];
    if (!cliente) throw new NotFoundException(`Cédula ${cedula} no encontrada`);
    return cliente;
  }
}