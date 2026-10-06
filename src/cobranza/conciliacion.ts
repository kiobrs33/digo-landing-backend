import type { FacturaMikrowisp } from './mikrowisp.service.js';
import type { PagoTelecredito } from './telecredito.js';

/**
 * Qué hacer con un pago del BCP en Mikrowisp:
 * - LISTO: va al Excel de pagos masivos con las facturas que cubre.
 * - YA_REGISTRADO: una factura ya tiene este número de operación (se subió antes).
 * - SIN_PENDIENTES: el cliente no debe nada; casi siempre alguien lo registró a mano.
 * - REVISAR: el monto no coincide con sus facturas pendientes; se revisa a mano.
 */
export type EstadoRegistro =
  'LISTO' | 'YA_REGISTRADO' | 'SIN_PENDIENTES' | 'REVISAR';

export type Asignacion = {
  estado: EstadoRegistro;
  /** Facturas que paga (LISTO) o donde ya está registrado (YA_REGISTRADO). */
  facturas: Pick<FacturaMikrowisp, 'id' | 'vencimiento' | 'total'>[];
  detalle: string;
};

const soles = (monto: number) => `S/ ${monto.toFixed(2)}`;
const centimos = (monto: number) => Math.round(monto * 100);
/** 'YYYY-MM-DD' → 'DD/MM/YYYY' */
const fecha = (iso: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';

/** ID de transacción de cada factura: el número de operación (con -1, -2… si cubre varias). */
export function transaccionDe(
  operacion: string,
  indice: number,
  cantidad: number,
) {
  return cantidad > 1 ? `${operacion}-${indice + 1}` : operacion;
}

const esDeLaOperacion = (transaccion: string, operacion: string) =>
  transaccion === operacion || transaccion.startsWith(`${operacion}-`);

/**
 * Asigna los pagos de un cliente (en orden de fecha y hora) a sus facturas pendientes. El BCP
 * cobra la deuda completa cargada (monto mínimo = total), así que un pago cubre las facturas más
 * antiguas cuya suma es exactamente lo pagado: una si debía un recibo, varias si debía varios.
 * Si después se emitió otra factura, esa queda pendiente. Si ninguna combinación cuadra, no se
 * adivina: queda para revisar.
 */
export function asignarPagos(
  pagos: Pick<PagoTelecredito, 'operacion' | 'montoPagado'>[],
  {
    pendientes,
    pagadas,
  }: { pendientes: FacturaMikrowisp[]; pagadas: FacturaMikrowisp[] },
): Asignacion[] {
  const disponibles = [...pendientes];
  return pagos.map((pago): Asignacion => {
    const registradas = pagadas.filter((factura) =>
      factura.transacciones.some((transaccion) =>
        esDeLaOperacion(transaccion, pago.operacion),
      ),
    );
    if (registradas.length) {
      return {
        estado: 'YA_REGISTRADO',
        facturas: registradas,
        detalle: `Ya registrado en Mikrowisp (factura ${registradas.map((f) => f.id).join(', ')}).`,
      };
    }

    let suma = 0;
    const objetivo = centimos(pago.montoPagado);
    for (let cantidad = 1; cantidad <= disponibles.length; cantidad++) {
      suma += centimos(disponibles[cantidad - 1].total);
      if (suma === objetivo) {
        const facturas = disponibles.splice(0, cantidad);
        return {
          estado: 'LISTO',
          facturas,
          detalle:
            cantidad === 1
              ? `Paga la factura ${facturas[0].id} (vence ${fecha(facturas[0].vencimiento)}).`
              : `Paga ${cantidad} facturas: ${facturas.map((f) => `${f.id} (${soles(f.total)})`).join(' + ')}.`,
        };
      }
      if (suma > objetivo) break;
    }

    if (!disponibles.length) {
      const ultima = [...pagadas].sort((a, b) =>
        b.fechaPago.localeCompare(a.fechaPago),
      )[0];
      return {
        estado: 'SIN_PENDIENTES',
        facturas: [],
        detalle: ultima
          ? `No tiene facturas pendientes. La última (${ultima.id}) se pagó el ${fecha(ultima.fechaPago)} por ${ultima.formaPago || 'otro medio'}: probablemente ya se registró a mano.`
          : 'No tiene facturas pendientes.',
      };
    }
    return {
      estado: 'REVISAR',
      facturas: [],
      detalle: `Pagó ${soles(pago.montoPagado)} y sus facturas pendientes no suman eso: ${disponibles
        .map((f) => `${f.id} vence ${fecha(f.vencimiento)} ${soles(f.total)}`)
        .join(' · ')}.`,
    };
  });
}
