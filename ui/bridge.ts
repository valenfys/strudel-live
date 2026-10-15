// Live's dialog bridge: how the editor dialog talks back to the extension host.
// Live injects one of these message handlers, depending on the platform's web
// view (WKWebView on macOS, WebView2 on Windows).

interface MessageHandler {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { live?: MessageHandler } };
    chrome?: { webview?: MessageHandler };
  }
}

/** Sends a result back to the extension host and closes this dialog. */
export function closeWithResult(result: string) {
  const message = { method: "close_and_send", params: [result] };
  const handler = window.webkit?.messageHandlers?.live ?? window.chrome?.webview;
  if (handler) handler.postMessage(message);
  else console.log("closeWithResult:", result);
}
