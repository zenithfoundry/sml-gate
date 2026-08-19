import { footprintReport, warmup } from './footprint.js';

async function check() {
  try {
    await warmup();
    await footprintReport();
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error(`Error: ${String(err)}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  check();
}
