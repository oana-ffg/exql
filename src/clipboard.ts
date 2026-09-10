export async function copyText(
  text: string,
  onNotice: (message: string) => void,
  message = "Copied to clipboard.",
) {
  try {
    await navigator.clipboard.writeText(text);
    onNotice(message);
  } catch (error) {
    onNotice(`Copy failed: ${(error as Error).message}`);
  }
}
