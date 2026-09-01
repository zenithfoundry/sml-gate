import ollama from 'ollama';
import { CONFIG } from '../config.js';

export async function warmup(client = ollama): Promise<void> {
  const modelsToWarm = new Set([CONFIG.SLM_BRAIN_MODEL, CONFIG.SLM_GATE_MODEL]);
  
  try {
    const listResponse = await client.list();
    const availableModels = listResponse.models || [];
    
    for (const model of modelsToWarm) {
      if (!availableModels.some(m => m.name === model || m.model === model)) {
        console.warn(`not pulled — run ollama pull ${model}`);
      } else {
        try {
          await client.chat({
            model: model,
            messages: [{ role: 'user', content: 'hi' }],
            options: { num_predict: 1 }
          });
        } catch (e) {
          // Ignore error during warmup chat
        }
      }
    }
  } catch (err) {
    console.error('Failed to connect to Ollama for warmup:', err);
  }
}

export async function getModelsFootprint(models: string[], client = ollama): Promise<{ [key: string]: number }> {
  const result: { [key: string]: number } = {};
  try {
    const listResponse = await client.list();
    const availableModels = listResponse.models || [];
    
    for (const model of models) {
      const found = availableModels.find(m => m.name === model || m.model === model);
      if (found && found.size) {
        result[model] = found.size;
      }
    }
  } catch (err) {
    // Ignore error
  }
  return result;
}

export async function footprintReport(client = ollama): Promise<void> {
  console.log(`\n=== SLM Footprint Report ===`);
  const modelsToCheck = new Set([CONFIG.SLM_BRAIN_MODEL, CONFIG.SLM_GATE_MODEL]);
  let totalBytes = 0;
  
  try {
    const listResponse = await client.list();
    const availableModels = listResponse.models || [];
    
    for (const model of modelsToCheck) {
      const found = availableModels.find(m => m.name === model || m.model === model);
      if (found && found.size) {
        const sizeGB = (found.size / (1024 * 1024 * 1024)).toFixed(2);
        console.log(`- ${model}: ${sizeGB} GB`);
        totalBytes += found.size;
      } else {
        console.log(`- ${model}: not pulled — run ollama pull ${model}`);
      }
    }
    
    const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
    console.log(`Total footprint: ${totalGB} GB`);
    console.log(`RAM preset budget: ${CONFIG.RAM_PRESET}`);
  } catch (err) {
    throw new Error('Could not fetch model sizes. Is Ollama running?');
  }
}
