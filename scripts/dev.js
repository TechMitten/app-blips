import readline from 'readline';
import { spawn } from 'child_process';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const scenarios = [
  { name: '1. No Plan (Pick a plan modal)', env: { VITE_MOCK_PLAN: 'none', VITE_MOCK_TRIALING: 'false' } },
  { name: '2. Free Trial (7 days remaining)', env: { VITE_MOCK_PLAN: 'plus', VITE_MOCK_TRIALING: 'true' } },
  { name: '3. Plus Plan (Subscribed)', env: { VITE_MOCK_PLAN: 'plus', VITE_MOCK_TRIALING: 'false' } },
  { name: '4. Pro Plan (Subscribed)', env: { VITE_MOCK_PLAN: 'pro', VITE_MOCK_TRIALING: 'false' } }
];

console.log('Select a local billing scenario (or press enter for default Free Trial):');
scenarios.forEach(s => console.log(s.name));

rl.question('Scenario number (1-4): ', (answer) => {
  const num = parseInt(answer.trim(), 10);
  const scenario = (!isNaN(num) && num >= 1 && num <= 4) ? scenarios[num - 1] : scenarios[1]; // default to 2
  
  console.log(`\nStarting dev server with scenario: ${scenario.name.substring(3)}\n`);
  rl.close();

  const child = spawn('npx', ['vite'], {
    stdio: 'inherit',
    env: { ...process.env, ...scenario.env },
    shell: true
  });

  child.on('exit', code => process.exit(code || 0));
});
