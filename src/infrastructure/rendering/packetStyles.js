/**
 * Stylesheet of the printable letter packet. Embedded in exported .html files and served
 * at /css/packet.css for the in-app print view (the web CSP forbids inline styles).
 */
export const PACKET_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: #f4f1ea;
  color: #1d1d1b;
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Cambria, serif;
  font-size: 12pt;
  line-height: 1.6;
}
.packet { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.packet-toolbar {
  position: sticky; top: 0; z-index: 1;
  display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between;
  padding: .75rem 1.25rem; background: #1f3b57; color: #fff;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 11pt;
}
.packet-toolbar button {
  font: inherit; padding: .45rem 1rem; border: 0; border-radius: .375rem;
  background: #fff; color: #1f3b57; cursor: pointer; font-weight: 600;
}
.packet-toolbar button:focus-visible { outline: 3px solid #ffd166; outline-offset: 2px; }
.participant { margin: 0 0 3rem; }
.participant-header { border-bottom: 2px solid #1d1d1b; margin: 0 0 1.25rem; padding: 0 .25rem .5rem; }
.participant-header h1 { margin: 0; font-size: 20pt; font-weight: 700; letter-spacing: .01em; }
.participant-header p { margin: .25rem 0 0; color: #555; font-size: 10.5pt; }
/* Each letter is its own sheet: on screen a separate page, in print it starts on a new page. */
.letter, .participant > .empty {
  background: #fff; margin: 0 0 1.5rem; padding: 2.25rem 2.5rem;
  border-radius: .5rem; box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
}
.letter-header { margin-bottom: .75rem; }
.letter-recipient {
  margin: 0 0 .4rem; color: #7a5c2e; font-size: 9.5pt; letter-spacing: .08em; text-transform: uppercase;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.letter-meta { margin: 0; color: #555; font-size: 10pt; }
.letter-subject { margin: .2rem 0 0; font-size: 13pt; font-weight: 700; }
.letter-body { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; hyphens: manual; }
/* The e-mail's own formatting: its HTML sets colours, fonts and sizes; only spacing is normalized. */
.letter-formatted { white-space: normal; }
.letter-formatted p { margin: 0 0 .75em; }
.letter-formatted blockquote { margin: .5em 0 .5em 1em; padding-left: .75em; border-left: 3px solid #ddd6c8; }
.letter-formatted table { max-width: 100%; border-collapse: collapse; }
.letter-formatted td, .letter-formatted th { padding: .15em .4em; vertical-align: top; }
.letter-formatted img, .letter-formatted-image { display: inline-block; max-width: 100%; height: auto; }
.letter-attachments { margin: .75rem 0 0; padding-left: 1.25rem; color: #555; font-size: 10pt; }
.letter-attachments img { display: block; max-width: 100%; height: auto; margin: .5rem 0; }
.empty { color: #666; font-style: italic; }
.letter-image, .letter-inline-image { margin: 1rem 0; text-align: center; }
.letter-image img, .letter-inline-image img { max-width: 100%; height: auto; border: 1px solid #ddd6c8; }
.letter-body .letter-inline-image { white-space: normal; }
.letter-document { margin: 1rem 0 0; padding: .75rem 1rem; border-left: 3px solid #cfcac0; background: #faf8f3; }
.letter-document h3 { margin: 0 0 .5rem; font-size: 10.5pt; color: #555; font-weight: 600; }
.attachment-note { color: #7a2e2e; font-size: 10pt; }
img { max-width: 100%; height: auto; }

@page { margin: 18mm 16mm; }

@media print {
  body { background: #fff; font-size: 11.5pt; line-height: 1.55; }
  .no-print, .packet-toolbar { display: none !important; }
  .packet { max-width: none; padding: 0; margin: 0; }
  .participant { margin: 0; }
  /* On paper only the letters are printed: no participant title, letter count or empty notice
     (each letter already says «Para: …»). On screen they stay, to find your way around. */
  .participant-header, .participant > .empty { display: none !important; }
  .letter { box-shadow: none; border-radius: 0; padding: 0; margin: 0; }
  /* Never share a sheet with another letter: every letter starts a new page (a forced break
     before the very first one is ignored by browsers, so there is no blank first page). */
  .letter { break-before: page; page-break-before: always; }
  .letter-header { break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .letter-attachments img, .letter-image, .letter-inline-image { break-inside: avoid; page-break-inside: avoid; }
  .letter-document { background: none; }
  .letter-formatted-image { break-inside: avoid; page-break-inside: avoid; }
  /* Keep the colours chosen by the sender (backgrounds and coloured text) when printing. */
  .letter-formatted, .letter-formatted * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  a { color: inherit; text-decoration: none; }
}
`;
