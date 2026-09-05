import { generateAppCode } from '../src/lib/llm.js';

async function main() {
  const code = '<html><body>Test</body></html>';
  const result = await generateAppCode('Add a button', code, (chunk, kind) => {
    console.log(`Chunk [${kind}]: ${chunk}`);
  }, 'both');
  console.log('Result reply:', result.reply);
}

main().catch(console.error);
