import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const PORT = 'COM3';
const BAUD = 115200;

console.log(`=== ESP32-C3 Full Boot Test ===`);

const port = new SerialPort({ path: PORT, baudRate: BAUD, rtscts: false }, (err) => {
  if (err) { console.error('Open failed:', err.message); process.exit(1); }
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
let allOutput = [];
const startTs = Date.now();

parser.on('data', (line) => {
  const trimmed = line.trim();
  if (trimmed) {
    const ts = ((Date.now() - startTs) / 1000).toFixed(1);
    console.log(`[${ts}s] ${trimmed}`);
    allOutput.push(trimmed);
  }
});
port.on('error', (err) => console.error('ERR:', err.message));

await new Promise(r => setTimeout(r, 300));

console.log('Resetting to SPI boot mode...');
port.set({ dtr: false, rts: false });
await new Promise(r => setTimeout(r, 50));
port.set({ dtr: false, rts: true });
await new Promise(r => setTimeout(r, 50));
port.set({ dtr: true, rts: true });
await new Promise(r => setTimeout(r, 50));
port.set({ dtr: true, rts: false });
await new Promise(r => setTimeout(r, 50));
port.set({ dtr: false, rts: false });

console.log('Waiting for firmware boot + WiFi connection (20s)...\n');
await new Promise(r => setTimeout(r, 20000));

const hasBoot = allOutput.some(l => l.includes('AI-LED'));
console.log(hasBoot ? '\n>>> Firmware started!' : '\n>>> No firmware output detected.');

console.log('\n--- Sending PING ---');
port.write('PING\n');
await new Promise(r => setTimeout(r, 3000));

const gotPong = allOutput.some(l => l.includes('PONG'));
console.log(gotPong ? '>>> PONG OK! Firmware responding.' : '>>> No PONG.');

if (gotPong) {
  console.log('\n--- Sending RESET ---');
  allOutput = [];
  port.write('RESET\n');
  await new Promise(r => setTimeout(r, 6000));

  allOutput.forEach(l => console.log(`  ${l}`));
  const gotReset = allOutput.some(l => l.includes('restarting') || l.includes('clearConfig'));
  console.log(gotReset ? '\n>>> RESET confirmed!' : '\n>>> No RESET response.');
}

console.log('\n--- All captured output ---');
allOutput.forEach(l => console.log(`  ${l}`));

port.close(() => { process.exit(0); });
