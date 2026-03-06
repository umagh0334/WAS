class BrickwallLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: 0.891, minValue: 0.001, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const enabled = parameters.enabled[0] >= 0.5;
    const ceiling = parameters.ceiling[0];

    for (let ch = 0; ch < input.length; ch++) {
      const inp = input[ch];
      const out = output[ch];
      if (!inp) continue;

      if (enabled) {
        for (let i = 0; i < inp.length; i++) {
          const s = inp[i];
          if (s > ceiling) out[i] = ceiling;
          else if (s < -ceiling) out[i] = -ceiling;
          else out[i] = s;
        }
      } else {
        for (let i = 0; i < inp.length; i++) {
          out[i] = inp[i];
        }
      }
    }

    return true;
  }
}

registerProcessor('brickwall-limiter', BrickwallLimiterProcessor);
