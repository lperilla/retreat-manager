/**
 * Batch export / print actions. After an export or a print, staff are asked (with
 * confirmation) whether the participants should be marked as printed.
 */
import { api } from './api.js';
import { h } from './dom.js';
import { lettersLabel, plural } from './format.js';
import { emit, state } from './state.js';
import { confirmDialog, toast, toastError } from './ui.js';

/**
 * @param {string} url
 * @param {string} filename
 */
function triggerDownload(url, filename) {
  const link = h('a', { href: url, download: filename, class: 'd-none' });
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * @param {string[]} participantIds
 */
async function offerMarkPrinted(participantIds) {
  const accepted = await confirmDialog({
    title: '¿Marcar como impresos?',
    body: `Se marcará ${plural(participantIds.length, 'participante', 'participantes')} como «Impresa». Puedes cambiarlo después desde el directorio.`,
    confirmLabel: 'Marcar como impresos',
    cancelLabel: 'Ahora no',
  });
  if (!accepted) return;
  try {
    await api.updatePrintStatus(participantIds, 'printed');
    toast('Estado de impresión actualizado.');
    emit('data-changed');
  } catch (error) {
    toastError(error);
  }
}

/**
 * @param {string[]} participantIds
 * @param {'html' | 'txt' | 'json' | 'pdf'} format  'pdf' = every PDF attachment merged into one file.
 * @param {string | null} [afterDate]
 */
export async function exportLetters(participantIds, format, afterDate = null) {
  if (participantIds.length === 0) {
    toast('Selecciona al menos un participante.', 'warning');
    return;
  }
  try {
    const result = await api.createExport({ participantIds, format, afterDate, includeAttachments: state.includeAttachments, originalFormat: state.originalFormat });
    triggerDownload(result.downloadUrl, result.filename);
    if (format === 'pdf') {
      toast('PDF de adjuntos listo: todos los PDF adjuntos en un solo archivo, en el orden de las cartas.');
      return;
    }
    toast(`Exportación lista: ${plural(result.participantCount, 'participante', 'participantes')}, ${lettersLabel(result.letterCount)}.`);
    await offerMarkPrinted(result.participantIds);
  } catch (error) {
    toastError(error);
  }
}

/**
 * Opens the printable packet in a new tab (one page per participant) and asks afterwards.
 * @param {string[]} participantIds
 * @param {string | null} [afterDate]
 */
export async function printLetters(participantIds, afterDate = null) {
  if (participantIds.length === 0) {
    toast('Selecciona al menos un participante.', 'warning');
    return;
  }
  const params = new URLSearchParams({ participantIds: participantIds.join(','), autoprint: '1' });
  if (afterDate) params.set('afterDate', afterDate);
  if (!state.includeAttachments) params.set('includeAttachments', '0');
  if (!state.originalFormat) params.set('originalFormat', '0');
  window.open(`/print?${params.toString()}`, '_blank', 'noopener');
  await offerMarkPrinted(participantIds);
}
