import { calculateCostUsd } from '../pricing/index.js';

async function main() {
  console.log('--- SLM Gate Ledger Smoke Test ---');

  const apiModel = 'gpt-5.6-luna';
  const apiCost = calculateCostUsd(apiModel, 250, 60);
  console.log(`Cost for ${apiModel} (250 in, 60 out): $${apiCost.toFixed(8)}`);

  const localModel = 'qwen3.5:1.5b';
  const localCost = calculateCostUsd(localModel, 250, 60);
  console.log(`Cost for ${localModel} (250 in, 60 out): $${localCost.toFixed(8)}`);

  if (localCost !== 0) {
    console.error(`❌ Local cost is not zero! Got: $${localCost}`);
    process.exit(1);
  } else {
    console.log(`✅ Local cost is $0.00000000 as expected.`);
  }

  const missingModel = 'not-a-real-model-123';
  try {
    calculateCostUsd(missingModel, 250, 60);
    console.error(`❌ Missing model did not throw error!`);
    process.exit(1);
  } catch (err: any) {
    if (err.name === 'PricingMissingError') {
      console.log(`✅ Missing model cleanly threw named error: ${err.message}`);
    } else {
      console.error(`❌ Expected PricingMissingError, got ${err.name}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('Smoke test passed successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
