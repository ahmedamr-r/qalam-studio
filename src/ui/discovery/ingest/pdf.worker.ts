// pdf.js's worker, bundled as a module worker of the studio's own (see pdf.ts): importing it is
// enough, since it listens for its document's messages as soon as it loads in a worker.
import "pdfjs-dist/build/pdf.worker.min.mjs";
