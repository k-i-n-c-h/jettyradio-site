export function base64Body(stream, path) {
  const encoder = new TextEncoder();
  let tail = new Uint8Array(0);
  return stream.pipeThrough(
    new TransformStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"path":' + JSON.stringify(path) + ',"file":"')
        );
      },
      transform(chunk, controller) {
        const bytes = new Uint8Array(tail.length + chunk.length);
        bytes.set(tail);
        bytes.set(chunk, tail.length);
        const end = bytes.length - (bytes.length % 3);
        for (let i = 0; i < end; i += 12288) {
          const part = bytes.subarray(i, Math.min(i + 12288, end));
          controller.enqueue(
            encoder.encode(btoa(String.fromCharCode(...part)))
          );
        }
        tail = bytes.slice(end);
      },
      flush(controller) {
        if (tail.length)
          controller.enqueue(
            encoder.encode(btoa(String.fromCharCode(...tail)))
          );
        controller.enqueue(encoder.encode('"}'));
      },
    })
  );
}
