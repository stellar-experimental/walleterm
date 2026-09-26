// Typed RPC simulation responses for offline tests. No network client is created here.
import { SorobanDataBuilder, xdr, type rpc } from '@stellar/stellar-sdk';

type Success = rpc.Api.SimulateTransactionSuccessResponse;
type Failure = rpc.Api.SimulateTransactionErrorResponse;
type Restore = rpc.Api.SimulateTransactionRestoreResponse;

export function simulationSuccess(fields: Partial<Success> = {}): Success {
  return {
    id: 'offline',
    latestLedger: 0,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '0',
    ...fields,
  };
}
export function simulationError(error: string, fields: Partial<Failure> = {}): Failure {
  return { id: 'offline', latestLedger: 0, events: [], _parsed: true, error, ...fields };
}
export function simulationRestore(
  result: rpc.Api.SimulateHostFunctionResult,
  fields: Partial<Restore> = {},
): Restore {
  return {
    ...simulationSuccess(),
    result,
    restorePreamble: { minResourceFee: '0', transactionData: new SorobanDataBuilder() },
    ...fields,
  };
}
/** A diagnostic event with one contract event body, as the host emits it. */
export function diagnosticEvent(topics: xdr.ScVal[], data: xdr.ScVal) {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data })),
    }),
  });
}
/**
 * Removes a field that the SDK response type requires.
 * An RPC server can return such data. The runners check for it at run time, and tests keep those cases.
 */
export function withoutField<T extends object>(value: T, field: keyof T): T {
  const copy = { ...value };
  Reflect.deleteProperty(copy, field);
  return copy;
}
