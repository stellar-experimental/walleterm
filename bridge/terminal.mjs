import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';

export async function reviewInTerminal(request, { signal, input = process.stdin, output = process.stdout,
  interrupt = () => process.kill(process.pid, 'SIGINT') } = {}) {
  if (!input.isTTY || !output.isTTY) throw Error('Run walleterm tunnel in an interactive terminal to approve signing.');
  signal?.throwIfAborted();
  const challenge = randomBytes(3).toString('hex');
  // Escape all control characters and non-ASCII characters before terminal output.
  const details = JSON.stringify({ claimed_website: request.origin, signer: request.signer, ...request.details }, null, 2)
    .replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  // Discard input typed before this prompt, such as an extra Enter or an answer to an earlier review.
  const discard = () => {};
  input.on('data', discard); input.resume();
  await new Promise(resolve => setTimeout(resolve, 50));
  input.off('data', discard);
  signal?.throwIfAborted();
  const prompt = createInterface({ input, output });
  // Raw mode turns Ctrl+C into a readline event. Forward it so Ctrl+C still stops the service.
  prompt.on('SIGINT', interrupt);
  try {
    output.write(`\nReview this TESTNET transaction. The claimed website is not independently verified.\n${details}\n`);
    const answer = await prompt.question(`Type sign ${challenge} to sign. Press Enter to deny: `, { signal });
    if (answer !== `sign ${challenge}`) { output.write('The request was denied.\n'); return false; }
    output.write('Requesting the signature from 1Password. Check your Mac for its approval prompt.\n');
    return true;
  } finally { prompt.close(); }
}
