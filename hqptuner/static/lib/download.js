// Hand text to the browser as a file download.

/**
 * Download `text` as a plain-text file named `filename`.
 *
 * @param {string} filename
 * @param {string} text
 */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
