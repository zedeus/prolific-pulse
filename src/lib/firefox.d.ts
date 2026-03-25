/**
 * Firefox-only WebExtension APIs not present in @types/chrome.
 * These are used with runtime detection: `if (browser.webRequest?.filterResponseData)`
 */
declare namespace browser.webRequest {
  function filterResponseData(requestId: string): StreamFilter;

  interface StreamFilter {
    onstart: ((event: Event) => void) | null;
    ondata: ((event: StreamFilterDataEvent) => void) | null;
    onstop: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    write(data: ArrayBuffer | Uint8Array): void;
    disconnect(): void;
    close(): void;
    status: 'uninitialized' | 'transferringdata' | 'finishedtransferringdata' | 'suspended' | 'closed' | 'disconnected' | 'failed';
    error: string;
  }

  interface StreamFilterDataEvent extends Event {
    data: ArrayBuffer;
  }
}
