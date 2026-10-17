// Same-origin URL works with worker-src 'self'; no blob, remote script or secrets.
let timer;
self.onmessage = (message) => {
  if (message.data !== 'start' || timer) return;
  timer = setInterval(() => self.postMessage('heartbeat'), 30_000);
};
