import { ArmStats } from './arms.js';

/**
 * Renders an SVG chart visualizing the deferral curve and performance of the routing strategies.
 * 
 * The generated chart plots the routing rate (fraction of tasks escalated to the cloud API) on the X-axis
 * against the resulting accuracy on the Y-axis. It displays two theoretical curves (baselines) and three
 * fixed points representing the actual strategies.
 * 
 * The axes dynamically scale based on the minimum and maximum accuracies observed across all_slm, armA, and armB
 * to ensure all points are visible.
 * 
 * @param allSlm The performance statistics when forcing the small local model (100% local)
 * @param armA The performance statistics when forcing the cloud API (100% escalated)
 * @param armB The performance statistics of the actual dynamic router logic
 * @param randomAtF A function calculating expected accuracy at a given routing rate `f` for a random baseline
 * @param oracleAtF A function calculating expected accuracy at a given routing rate `f` for an ideal "cheater" baseline
 * @returns A fully constructed SVG XML string representing the chart
 */
export function renderSvg(
  allSlm: ArmStats,
  armA: ArmStats,
  armB: ArmStats,
  randomAtF: (f: number) => number,
  oracleAtF: (f: number) => number
): string {
  const width = 600;
  const height = 400;
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // scaleX: routing rate [0, 1] -> [0, innerWidth]
  // scaleY: accuracy [minAcc, maxAcc] -> [innerHeight, 0]
  const minAcc = Math.max(0, Math.min(allSlm.accuracy, armA.accuracy, armB.accuracy) - 0.1);
  const maxAcc = Math.min(1, Math.max(allSlm.accuracy, armA.accuracy, armB.accuracy) + 0.1);
  
  const scaleX = (x: number) => x * innerWidth;
  const scaleY = (y: number) => innerHeight - ((y - minAcc) / (maxAcc - minAcc)) * innerHeight;

  let randomPath = `M ${scaleX(0)},${scaleY(randomAtF(0))} L ${scaleX(1)},${scaleY(randomAtF(1))}`;
  
  let oraclePath = `M ${scaleX(0)},${scaleY(oracleAtF(0))}`;
  for (let i = 1; i <= 10; i++) {
    const f = i / 10;
    oraclePath += ` L ${scaleX(f)},${scaleY(oracleAtF(f))}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <style>
      .axis { stroke: #333; stroke-width: 2; }
      .tick { stroke: #ccc; stroke-width: 1; stroke-dasharray: 4; }
      .random { stroke: #666; stroke-width: 2; stroke-dasharray: 4; fill: none; }
      .oracle { stroke: #2196f3; stroke-width: 2; fill: none; }
      .point { fill: #f44336; }
      text { font-family: sans-serif; font-size: 12px; }
    </style>
    <g transform="translate(${margin.left}, ${margin.top})">
      <!-- Grid -->
      <line class="tick" x1="0" y1="0" x2="${innerWidth}" y2="0" />
      <line class="tick" x1="0" y1="${innerHeight/2}" x2="${innerWidth}" y2="${innerHeight/2}" />
      <line class="tick" x1="0" y1="${innerHeight}" x2="${innerWidth}" y2="${innerHeight}" />
      
      <!-- Axes -->
      <line class="axis" x1="0" y1="${innerHeight}" x2="${innerWidth}" y2="${innerHeight}" />
      <line class="axis" x1="0" y1="0" x2="0" y2="${innerHeight}" />
      
      <!-- Lines -->
      <path class="random" d="${randomPath}" />
      <path class="oracle" d="${oraclePath}" />
      
      <!-- ArmB Point -->
      <circle class="point" cx="${scaleX(armB.routingRate)}" cy="${scaleY(armB.accuracy)}" r="5" />
      
      <!-- Points for SLM and API -->
      <circle cx="${scaleX(0)}" cy="${scaleY(allSlm.accuracy)}" r="4" fill="#000" />
      <circle cx="${scaleX(1)}" cy="${scaleY(armA.accuracy)}" r="4" fill="#000" />
      
      <!-- Labels -->
      <text x="${innerWidth/2}" y="${innerHeight + 30}" text-anchor="middle">Routing Rate (Cloud %)</text>
      <text x="-${innerHeight/2}" y="-40" text-anchor="middle" transform="rotate(-90)">Accuracy</text>
      
      <text x="${scaleX(armB.routingRate) + 10}" y="${scaleY(armB.accuracy) - 10}">Arm B</text>
      <text x="${scaleX(0) + 10}" y="${scaleY(allSlm.accuracy) - 10}">All SLM</text>
      <text x="${scaleX(1) - 40}" y="${scaleY(armA.accuracy) - 10}">Arm A (API)</text>
    </g>
  </svg>`;
}
