// Runs on the audio thread. Between a "start" and a "stop" message (or until maxSamples
// is reached) it copies every microphone sample, then posts them all back in one message.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = null;
    this.length = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.samples = new Float32Array(data.maxSamples);
        this.length = 0;
      } else if (data.type === 'stop') {
        this.finish();
      }
    };
  }

  finish() {
    if (!this.samples) return;
    const samples = this.samples.slice(0, this.length);
    this.samples = null;
    this.port.postMessage(samples, [samples.buffer]);
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (this.samples && input) {
      const n = Math.min(input.length, this.samples.length - this.length);
      this.samples.set(input.subarray(0, n), this.length);
      this.length += n;
      if (this.length === this.samples.length) this.finish();
    }
    // Outputs are left silent; the node is only connected so the graph keeps pulling it.
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
