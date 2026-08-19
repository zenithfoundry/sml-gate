import { CONFIG } from '../config.js';

export const roles = {
  get brain() {
    return CONFIG.SLM_BRAIN_MODEL;
  },
  get gate() {
    return CONFIG.SLM_GATE_MODEL;
  }
};
