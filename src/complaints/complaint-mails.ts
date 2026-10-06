import { escapeHtml } from '../common/html.js';
import type { ProviderInfo } from '../common/company.js';
import type { Complaint } from '../generated/prisma/client.js';
import { mailLayout, mailTable } from '../mail/layout.js';

const documentLabel = {
  DNI: 'DNI',
  CE: 'Carné de extranjería',
  PASAPORTE: 'Pasaporte',
  RUC: 'RUC',
};
const kindLabel = { RECLAMO: 'Reclamo', QUEJA: 'Queja' };
const itemLabel = { PRODUCTO: 'Producto', SERVICIO: 'Servicio' };

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(date);

function providerFooter(provider: ProviderInfo): string {
  return [
    provider.legalName,
    provider.ruc && `RUC ${provider.ruc}`,
    provider.address,
    provider.email,
    provider.phoneDisplay,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');
}

/** Hoja de reclamación completa (constancia para el consumidor y copia para el equipo). */
export function complaintSheet(
  complaint: Complaint,
  provider: ProviderInfo,
): string {
  const section = (title: string) =>
    `<h3 style="margin:22px 0 8px;font-size:15px;color:#041c7b">${escapeHtml(title)}</h3>`;
  return [
    mailTable([
      ['Hoja N°', complaint.code],
      ['Fecha de registro', formatDateTime(complaint.createdAt)],
      ['Proveedor', provider.legalName],
      ['RUC', provider.ruc],
      ['Domicilio del proveedor', provider.address],
    ]),
    section('1. Identificación del consumidor'),
    mailTable([
      ['Nombre o razón social', complaint.fullName],
      [
        'Documento',
        `${documentLabel[complaint.documentType]} ${complaint.documentNumber}`,
      ],
      ['Domicilio', complaint.address],
      ['Correo', complaint.email],
      ['Teléfono', complaint.phone],
      ['Menor de edad', complaint.isMinor ? 'Sí' : 'No'],
      ['Padre, madre o apoderado', complaint.guardianName],
      ['Documento del apoderado', complaint.guardianDocument],
    ]),
    section('2. Identificación del bien contratado'),
    mailTable([
      ['Tipo', itemLabel[complaint.itemType]],
      [
        'Monto reclamado',
        complaint.amount ? `S/ ${complaint.amount.toFixed(2)}` : null,
      ],
      ['Descripción', complaint.itemDescription],
    ]),
    section('3. Detalle'),
    mailTable([
      ['Tipo', kindLabel[complaint.kind]],
      ['Detalle', complaint.detail],
      ['Pedido del consumidor', complaint.request],
    ]),
  ].join('');
}

export function receiptMail(complaint: Complaint, provider: ProviderInfo) {
  const kind = kindLabel[complaint.kind].toLowerCase();
  return {
    to: complaint.email,
    subject: `Constancia de ${kind} N° ${complaint.code} · ${provider.name}`,
    html: mailLayout({
      title: `Libro de Reclamaciones · Hoja N° ${complaint.code}`,
      body: `<p>Hola ${escapeHtml(complaint.fullName)}:</p>
<p>Registramos tu ${kind}. Esta es la constancia de tu hoja de reclamación. Guárdala: el número <strong>${escapeHtml(complaint.code)}</strong> identifica tu caso.</p>
<p>Te responderemos a este correo a más tardar el <strong>${formatDate(complaint.dueDate)}</strong> (15 días hábiles).</p>
${complaintSheet(complaint, provider)}
<p style="margin-top:22px;font-size:13px;color:#4f5780">La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.</p>`,
      footer: providerFooter(provider),
    }),
  };
}

export function teamNoticeMail(
  complaint: Complaint,
  provider: ProviderInfo,
  teamAddress: string,
) {
  return {
    to: teamAddress,
    replyTo: complaint.email,
    subject: `[${complaint.site}] Nuev${complaint.kind === 'QUEJA' ? 'a queja' : 'o reclamo'} ${complaint.code} · vence ${formatDate(complaint.dueDate)}`,
    html: mailLayout({
      title: `Nueva hoja de reclamación N° ${complaint.code}`,
      body: `<p>Se registró una hoja en el Libro de Reclamaciones del sitio <strong>${complaint.site}</strong>. Plazo de respuesta: <strong>${formatDate(complaint.dueDate)}</strong>.</p>${complaintSheet(complaint, provider)}`,
      footer:
        'Respóndela desde el panel administrativo para que quede registrada.',
    }),
  };
}

export function responseMail(complaint: Complaint, provider: ProviderInfo) {
  const kind = kindLabel[complaint.kind].toLowerCase();
  return {
    to: complaint.email,
    subject: `Respuesta a tu ${kind} N° ${complaint.code} · ${provider.name}`,
    html: mailLayout({
      title: `Respuesta a la hoja N° ${complaint.code}`,
      body: `<p>Hola ${escapeHtml(complaint.fullName)}:</p>
<p>Esta es nuestra respuesta a tu ${kind} registrado el ${formatDateTime(complaint.createdAt)}:</p>
<div style="margin:16px 0;padding:16px;border-left:4px solid #de087e;background:#f3f5fc;white-space:pre-wrap">${escapeHtml(complaint.response)}</div>
<p>Si no estás conforme, puedes acudir al INDECOPI u OSIPTEL según corresponda.</p>`,
      footer: providerFooter(provider),
    }),
  };
}
