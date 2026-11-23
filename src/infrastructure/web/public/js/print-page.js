/**
 * Print view helper (/print): "Imprimir" button and optional automatic print dialog.
 */
const button = document.querySelector('[data-action="print"]');
// The desktop app has no print preview: it exposes `desktopApp.printPreview` to go through a PDF instead.
const print = () => (window.desktopApp?.printPreview ? window.desktopApp.printPreview() : window.print());
button?.addEventListener('click', print);

if (new URLSearchParams(window.location.search).get('autoprint') === '1') {
  window.addEventListener('load', () => {
    setTimeout(print, 300);
  });
}
