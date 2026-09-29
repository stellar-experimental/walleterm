// Demo-only presentation state. Walkthrough rows come from a ledger read; transaction phases come from the journal.
// Nothing here reads the network, signs, or decides what may be signed.
import type { ContractReview, ContractStage, WalkthroughLedger } from './contracts.ts';

export const stepTitles: Record<ContractStage, string> = {
  'upload-account': 'Upload the smart account code',
  'upload-target': 'Upload the counter code',
  'deploy-account': 'Deploy your smart account',
  'deploy-target': 'Deploy the counter',
  increment: 'Increase the counter',
};
export const stepButtons: Record<ContractStage, string> = {
  'upload-account': 'Upload smart account code',
  'upload-target': 'Upload counter code',
  'deploy-account': 'Deploy smart account',
  'deploy-target': 'Deploy counter',
  increment: 'Increase counter',
};

/** `pending`: no ledger state yet. `active`: an unfinished transaction belongs to this row. */
export type RowState = 'pending' | 'locked' | 'next' | 'done' | 'active';
export type UserStage = 'deploy-account' | 'deploy-target' | 'increment';
export interface WalkthroughView {
  code: { state: RowState; stage?: 'upload-account' | 'upload-target' };
  steps: { stage: UserStage; state: RowState }[];
  /** User steps done, 0 to 3. */
  done: number;
  /** The step to start next. The counter step repeats after the walkthrough is complete. */
  next: ContractStage | null;
}

export function walkthroughView(ledger: WalkthroughLedger | null, active?: ContractStage): WalkthroughView {
  const rows = (
    code: WalkthroughView['code'],
    states: [RowState, RowState, RowState],
    next: ContractStage | null,
  ): WalkthroughView => {
    const steps = (['deploy-account', 'deploy-target', 'increment'] as const).map((stage, index) => ({
      stage,
      state: states[index],
    }));
    if (active?.startsWith('upload')) code = { state: 'active', stage: active as 'upload-account' };
    for (const step of steps) if (step.stage === active) step.state = 'active';
    return { code, steps, done: states.filter((state) => state === 'done').length, next };
  };
  if (!ledger) return rows({ state: 'pending' }, ['pending', 'pending', 'pending'], null);
  const upload = !ledger.code.account ? 'upload-account' : !ledger.code.target ? 'upload-target' : undefined;
  const code: WalkthroughView['code'] = upload ? { state: 'next', stage: upload } : { state: 'done' };
  const account: RowState = ledger.account.exists ? 'done' : upload ? 'locked' : 'next';
  const target: RowState = ledger.target.exists ? 'done' : account === 'done' ? 'next' : 'locked';
  const counter: RowState =
    account !== 'done' || target !== 'done' ? 'locked' : (ledger.count ?? 0) > 0 ? 'done' : 'next';
  const next =
    upload ??
    (account === 'next'
      ? 'deploy-account'
      : target === 'next'
        ? 'deploy-target'
        : counter === 'locked'
          ? null
          : 'increment');
  return rows(code, [account, target, counter], next);
}

export type PhaseState = 'pending' | 'current' | 'done' | 'failed' | 'unknown';
export interface Phase {
  label: string;
  state: PhaseState;
  detail?: string;
}
export interface PhaseRecord {
  state: string;
  signed_xdr?: string;
  result?: unknown;
  contract?: Pick<ContractReview, 'stage' | 'authorizations' | 'authorizationReady'>;
}
interface Result {
  rejected?: boolean;
  code?: string;
  successful?: boolean;
  ledger?: number;
}

/**
 * The signing and submission phases of one journal record. `progress` describes live work in the current phase.
 * `confirmed` describes a confirmed result, for example its verification.
 */
export function transactionPhases(record: PhaseRecord, progress = '', confirmed = ''): Phase[] {
  const contract = record.contract;
  const authorize = !!contract?.authorizations.length;
  const phases: Phase[] = [
    ...(authorize
      ? [
          {
            label: 'Sign the authorization',
            detail:
              contract!.stage === 'increment'
                ? 'Your smart account approves +1.'
                : 'Your wallet approves this deployment.',
          },
        ]
      : []),
    { label: 'Sign the transaction' },
    { label: 'Submit to testnet' },
    { label: 'Confirm on the ledger' },
  ].map((phase) => ({ ...phase, state: 'pending' as PhaseState }));
  const signing = authorize && !contract!.authorizationReady ? 0 : authorize ? 1 : 0;
  const [submit, confirm] = [phases.length - 2, phases.length - 1];
  const result = (record.result && typeof record.result === 'object' ? record.result : {}) as Result;
  const reach = (index: number, state: PhaseState, detail?: string) => {
    for (let i = 0; i < index; i++) phases[i].state = 'done';
    phases[index].state = state;
    if (detail !== undefined) phases[index].detail = detail;
  };
  if (authorize && contract!.authorizationReady) phases[0].detail = 'Signed. Simulation accepted it.';
  switch (record.state) {
    case 'review':
      reach(signing, 'current');
      break;
    case 'waiting':
      reach(signing, 'current', progress || undefined);
      break;
    case 'signing_unknown':
      reach(signing, 'unknown', 'The signing result is unknown. Decline any 1Password prompt that appears.');
      break;
    case 'signed':
      reach(submit, 'current', progress || 'Signature verified. Ready to submit.');
      phases[submit - 1].detail = 'Signature verified.';
      break;
    case 'submitting':
      reach(submit, 'current', progress || 'Waiting for the testnet result.');
      break;
    case 'unknown':
      reach(submit, 'unknown', 'The result is unknown. Check the original hash before you try again.');
      break;
    case 'submitted':
      reach(
        confirm,
        'done',
        [result.ledger ? `Ledger ${result.ledger}.` : '', confirmed].filter(Boolean).join(' '),
      );
      break;
    case 'failed':
      if (result.rejected)
        reach(submit, 'failed', `Testnet rejected it${result.code ? `: ${result.code}` : ''}.`);
      else if (result.successful === false) reach(confirm, 'failed', 'The transaction failed on the ledger.');
      else reach(signing, 'failed', 'Signing failed.');
      break;
    case 'denied':
      reach(signing, 'failed', 'The signing request was declined.');
      break;
    case 'canceled':
      reach(signing, 'failed', 'The signing request was canceled.');
      break;
    case 'expired':
      if (record.signed_xdr) reach(submit, 'failed', 'The transaction expired before it reached the ledger.');
      else reach(signing, 'failed', 'The signing request expired.');
      break;
  }
  return phases;
}
