// Clipboard write that also works in the insecure-context LAN hand-back.

// The hand-back runs over plain HTTP on the LAN, which is not a secure context,
// so `navigator.clipboard` is simply absent in every browser but on localhost.
// The deprecated execCommand path is the only one that works there.
/**
 * Put text on the clipboard, by the Clipboard API where the context is secure and by the execCommand path elsewhere.
 * @param {string} text
 * @returns {Promise<void>} resolves once the text is on the clipboard, rejects if it isn't
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("clipboard rejected the copy");
  } finally {
    ta.remove();
  }
}
