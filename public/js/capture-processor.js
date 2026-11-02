// Web Audio always hands a worklet this many frames at a time.
const RENDER_QUANTUM = 128;

// Runs on the audio thread. Every microphone sample goes into a rolling buffer from the
// moment the microphone opens, so a clip can begin at a moment that has already passed:
// by the time a "start" message gets here, the press it reports is in the past. Positions
// are frames of the audio clock, the same clock as the main thread's context.currentTime.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.buffer = new Float32Array(Math.ceil(processorOptions.bufferSeconds * sampleRate));
    this.firstFrame = null;
    this.clip = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.clip = { startFrame: data.startFrame, endFrame: data.endFrame };
      } else if (data.type === 'stop' && this.clip) {
        // Only ever brings the end forward, so pressing Stop twice can't extend the clip.
        this.clip.endFrame = Math.min(this.clip.endFrame, data.endFrame);
      }
    };
  }

  finish() {
    const { length } = this.buffer;
    const { endFrame } = this.clip;
    const oldestFrame = currentFrame + RENDER_QUANTUM - length;
    const startFrame = Math.max(this.clip.startFrame, this.firstFrame, oldestFrame);
    const samples = new Float32Array(Math.max(0, endFrame - startFrame));
    for (let i = 0; i < samples.length; i++) {
      samples[i] = this.buffer[(startFrame + i) % length];
    }
    this.clip = null;
    this.port.postMessage(samples, [samples.buffer]);
  }

  process(inputs) {
    this.firstFrame ??= currentFrame;
    // There's no input until the stream delivers audio; those frames are silence.
    const input = inputs[0]?.[0];
    for (let i = 0; i < RENDER_QUANTUM; i++) {
      this.buffer[(currentFrame + i) % this.buffer.length] = input ? input[i] : 0;
    }
    if (this.clip && currentFrame + RENDER_QUANTUM >= this.clip.endFrame) this.finish();
    // Outputs are left silent; the node is only connected so the graph keeps pulling it.
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
