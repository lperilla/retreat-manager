/**
 * Print view helper (/print): "Imprimir" button and optional automatic print dialog.
 */
const button = document.querySelector('[data-action="print"]');
button?.addEventListener('click', () => window.print());

if (new URLSearchParams(window.location.search).get('autoprint') === '1') {
  window.addEventListener('load', () => {
    setTimeout(() => window.print(), 300);
  });
}
