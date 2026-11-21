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
.participant {
  background: #fff; margin: 0 0 2rem; padding: 2.25rem 2.5rem;
  border-radius: .5rem; box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
}
.participant-header { border-bottom: 2px solid #1d1d1b; margin-bottom: 1.5rem; padding-bottom: .5rem; }
.participant-header h1 { margin: 0; font-size: 20pt; font-weight: 700; letter-spacing: .01em; }
.participant-header p { margin: .25rem 0 0; color: #555; font-size: 10.5pt; }
.letter { margin: 0 0 2rem; }
.letter + .letter { border-top: 1px solid #cfcac0; padding-top: 1.5rem; }
.letter-header { margin-bottom: .75rem; }
.letter-meta { margin: 0; color: #555; font-size: 10pt; }
.letter-subject { margin: .2rem 0 0; font-size: 13pt; font-weight: 700; }
.letter-body { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; hyphens: manual; }
.letter-attachments { margin: .75rem 0 0; padding-left: 1.25rem; color: #555; font-size: 10pt; }
.letter-attachments img { display: block; max-width: 100%; height: auto; margin: .5rem 0; }
.empty { color: #666; font-style: italic; }
img { max-width: 100%; height: auto; }

@page { margin: 18mm 16mm; }

@media print {
  body { background: #fff; font-size: 11.5pt; line-height: 1.55; }
  .no-print, .packet-toolbar { display: none !important; }
  .packet { max-width: none; padding: 0; margin: 0; }
  .participant {
    box-shadow: none; border-radius: 0; padding: 0; margin: 0;
    break-after: page; page-break-after: always;
  }
  .participant:last-child { break-after: auto; page-break-after: auto; }
  .letter-header { break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .letter-attachments img { break-inside: avoid; page-break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
`;
